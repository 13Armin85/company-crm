/* eslint-disable no-await-in-loop -- Steps share one real authenticated test session. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(resolve(".cache/browser/node_modules/playwright/index.mjs")).href);
const env = Object.fromEntries(
  (await readFile(".env.dev", "utf8"))
    .split(/\r?\n/)
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at), line.slice(at + 1).replace(/^(['"])(.*)\1$/, "$2")];
    })
);
const base = process.env.CRM_BROWSER_URL || "http://localhost:3000";
assert(new URL(base).hostname === "localhost", "Page lifecycle probe is restricted to local Docker");
const slug = env.INTERNAL_WORKSPACE_SLUG || "dev-workspace";
const code = `qa-page-${Date.now()}`;
const title = `صفحهٔ آزمایش حذف ${Date.now()}`;
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.setDefaultTimeout(90000);
page.setDefaultNavigationTimeout(120000);
let createdId;
try {
  await page.goto(`${base}/login`);
  await page.locator(".auth-submit:enabled").waitFor();
  await page.locator('input[name="email"]').fill(env.DEV_ADMIN_EMAIL);
  await page.locator('input[name="password"]').fill(env.DEV_ADMIN_PASSWORD);
  await page.locator(".auth-submit").click();
  await page.locator(".app-shell").waitFor();
  await page.goto(`${base}/entities`);
  await page.locator(".page-content").getByRole("button", { name: "ساخت صفحهٔ جدید", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("نام صفحه", { exact: true }).fill(title);
  await dialog.getByLabel("کد انگلیسی", { exact: true }).fill(code);
  await dialog.getByLabel("دسته‌بندی صفحهٔ جدید", { exact: true }).selectOption("org");
  const creationResponse = page.waitForResponse(
    (response) => response.url().endsWith("/engine/pages/") && response.request().method() === "POST"
  );
  await dialog.getByRole("button", { name: "ساخت صفحه", exact: true }).click();
  const created = await creationResponse;
  assert.equal(created.status(), 201);
  const createdEntity = await created.json();
  createdId = createdEntity.id;
  await page.waitForURL((url) => url.pathname === `/sections/org/entities/${code}`);
  await page.locator(".page-content h1").filter({ hasText: title }).waitFor();
  await page.reload();
  await page.locator(".page-content h1").filter({ hasText: title }).waitFor();
  const beforeDelete = await (await page.request.get(`${base}/api/workspaces/${slug}/engine/catalog/`)).json();
  const management = beforeDelete.entities.find((row) => row.code === code)?.page_management;
  console.log("PAGE_DELETE_CAPABILITY", JSON.stringify(management));
  assert(management?.can_delete && management?.can_manage, "Backend did not grant deletion of the empty probe page");
  console.log("PAGE_ACTIONS", JSON.stringify(await page.locator(".page-header button").allTextContents()));
  await page.screenshot({ path: resolve(".cache/quality-page-before-delete.png"), fullPage: true });
  await page.getByRole("button", { name: `حذف صفحهٔ ${title}`, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "حذف صفحه", exact: true }).click();
  await page.waitForURL((url) => url.pathname.endsWith("/entities"));
  const catalog = await (await page.request.get(`${base}/api/workspaces/${slug}/engine/catalog/`)).json();
  assert(!catalog.entities.some((entity) => entity.code === code));
  const navigation = await (await page.request.get(`${base}/api/workspaces/${slug}/navigation/`)).json();
  assert(!navigation.entities.some((entity) => entity.code === code));
  createdId = undefined;
  console.log(
    "PAGE_LIFECYCLE_VERIFIED: create, published form, database category URL, reload, delete and menu refresh"
  );
} finally {
  if (createdId) {
    const csrf = await (await page.request.get(`${base}/auth/get-csrf-token/`)).json();
    const response = await page.request.delete(
      `${base}/api/workspaces/${slug}/engine/definitions/entities/${createdId}/`,
      { headers: { "X-CSRFTOKEN": csrf.csrf_token } }
    );
    assert.equal(response.status(), 204, "The probe could not clean up its own empty test page");
  }
  await browser.close();
}
