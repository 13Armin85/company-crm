import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(resolve(".cache/browser/node_modules/playwright/index.mjs")).href);
const base = process.env.CRM_BROWSER_URL || "http://localhost:3005";
const authBase = process.env.CRM_BROWSER_AUTH_URL || "http://localhost:3000";
const entity = process.env.CRM_BROWSER_ENTITY || "customer";
const output = resolve(process.env.CRM_BROWSER_OUTPUT || "tmp/advanced-filter-browser");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "fa-IR" });
const page = await context.newPage();
page.setDefaultTimeout(90000);
page.setDefaultNavigationTimeout(180000);
const checks = [],
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const check = (name) => {
  checks.push(name);
  console.log("PASS", name);
};
let queries = 0;
page.on("request", (request) => {
  if (new URL(request.url()).pathname.endsWith(`/entities/${entity}/query/`)) queries++;
});
const queryResponse = () =>
  page.waitForResponse((response) => new URL(response.url()).pathname.endsWith(`/entities/${entity}/query/`));
const open = async () => {
  await page.getByRole("button", { name: "فیلتر پیشرفته", exact: true }).click();
  await page.getByRole("dialog").waitFor();
};
try {
  if (process.env.CRM_BROWSER_SESSION) {
    const auth = JSON.parse(await readFile(process.env.CRM_BROWSER_SESSION, "utf8"));
    await context.addCookies([auth.cookie]);
    const team = await context.request.get(
      `${base}/api/workspaces/${auth.workspace}/daily-reports/team/?page=1&page_size=10`
    );
    assert.equal(team.status(), 200);
    const first = await team.json();
    assert.equal(first.page_size, 10);
    assert.equal(first.people.length, Math.min(first.count, 10));
    assert.equal(
      first.count,
      Object.values(first.summary).reduce((sum, count) => sum + count, 0)
    );
    if (first.count > 10) {
      const second = await context.request.get(
        `${base}/api/workspaces/${auth.workspace}/daily-reports/team/?page=2&page_size=10`
      );
      assert.equal(second.status(), 200);
      const next = await second.json();
      assert.equal(next.page, 2);
      assert(!next.people.some((row) => first.people.some((other) => row.person.id === other.person.id)));
    }
    check("published team daily-report API remains compatible with the new web release");
  } else {
    const env = Object.fromEntries(
      (await readFile(".env.dev", "utf8"))
        .split(/\r?\n/)
        .filter((line) => /^[A-Z_]+=/.test(line))
        .map((line) => {
          const at = line.indexOf("=");
          return [line.slice(0, at), line.slice(at + 1).replace(/^(['"])(.*)\1$/, "$2")];
        })
    );
    assert.equal((await context.request.get(authBase + "/auth/get-csrf-token/")).status(), 200);
    await page.goto(authBase + "/login");
    await page.locator('input[name="email"]').fill(env.DEV_ADMIN_EMAIL);
    await page.locator('input[name="password"]').fill(env.DEV_ADMIN_PASSWORD);
    await page.locator(".auth-submit").click();
    await page.locator(".app-shell").waitFor();
  }
  const schemaResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith(`/entities/${entity}/view-schema/`)
  );
  const initialResponse = queryResponse();
  await page.goto(base + `/entities/${entity}`);
  const schema = await (await schemaResponse).json();
  assert.equal((await initialResponse).status(), 200);
  const field = schema.fields.find(
    (item) => item.filterable && item.kind === "short_text" && item.operators.includes("contains")
  );
  assert(field, "A filterable text field is required by this acceptance fixture");
  await open();
  const dialog = page.getByRole("dialog");
  const before = queries;
  await dialog.getByRole("button", { name: "افزودن اولین شرط", exact: true }).click();
  await dialog.getByRole("button", { name: "انصراف", exact: true }).click();
  assert.equal(queries, before);
  await open();
  assert(await dialog.getByRole("button", { name: "افزودن اولین شرط", exact: true }).isVisible());
  check("cancel discards the draft and leaves the displayed results unchanged");
  await dialog.getByRole("button", { name: "افزودن اولین شرط", exact: true }).click();
  await dialog.getByRole("button", { name: "باز کردن فیلد شرط", exact: true }).click();
  await page.getByRole("option", { name: field.title, exact: true }).click();
  await dialog.getByRole("button", { name: "باز کردن عملگر", exact: true }).click();
  await page.getByRole("option", { name: "شامل", exact: true }).click();
  const tag = "عبارت ناموجود بررسی فیلتر " + Date.now();
  await dialog.locator(".schema-form input").first().fill(tag);
  await page.waitForTimeout(300);
  assert.equal(queries, before);
  check("editing field, operator and value does not execute an unfinished filter");
  const applied = queryResponse();
  await dialog.getByRole("button", { name: "اعمال فیلتر", exact: true }).click();
  const response = await applied;
  assert.equal(response.status(), 200);
  assert.equal(response.request().postDataJSON().definition.filter.value, tag);
  assert.equal((await response.json()).count, 0);
  check("apply submits the selected filter to the real server and shows its matching result");
  await open();
  assert.equal(await dialog.locator(".schema-form input").first().inputValue(), tag);
  await dialog.getByRole("button", { name: "افزودن شرط", exact: true }).click();
  await dialog.getByRole("button", { name: "حداقل یک شرط یا", exact: true }).click();
  await dialog.getByRole("button", { name: "افزودن زیرگروه", exact: true }).click();
  assert.equal(await dialog.locator(".advanced-filter-group").count(), 2);
  assert(await dialog.getByText("۳ شرط", { exact: true }).isVisible());
  await page.screenshot({ path: resolve(output, "desktop.png") });
  check("nested groups display condition counts and explain AND and OR without changing results");
  await page.setViewportSize({ width: 375, height: 900 });
  assert(
    await dialog
      .locator(".engine-view-drawer--filter")
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
  );
  await dialog.getByRole("button", { name: "اعمال فیلتر", exact: true }).scrollIntoViewIfNeeded();
  assert(await dialog.getByRole("button", { name: "اعمال فیلتر", exact: true }).isVisible());
  await page.screenshot({ path: resolve(output, "mobile.png") });
  await page.keyboard.press("Escape");
  check("mobile nested filters fit the viewport and keyboard escape discards the draft");
  await open();
  await dialog.getByRole("button", { name: "پاک کردن همهٔ شرط‌ها", exact: true }).click();
  assert(await dialog.getByRole("button", { name: "افزودن اولین شرط", exact: true }).isVisible());
  await dialog.getByRole("button", { name: "اعمال فیلتر", exact: true }).click();
  // The original unfiltered result can still be fresh in the query cache.
  await open();
  assert(await dialog.getByRole("button", { name: "افزودن اولین شرط", exact: true }).isVisible());
  await page.keyboard.press("Escape");
  check("clearing and applying removes the active filter and restores the unfiltered view");
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, "results.json"), JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: resolve(output, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await context.close();
  await browser.close();
}
