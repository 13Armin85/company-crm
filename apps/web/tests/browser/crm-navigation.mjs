/* eslint-disable no-await-in-loop -- Verify sequential navigation in one authenticated session. */
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
const slug = env.INTERNAL_WORKSPACE_SLUG || "dev-workspace";
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(60000);
page.setDefaultNavigationTimeout(120000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(env.DEV_ADMIN_EMAIL);
  await page.locator('input[name="password"]').fill(env.DEV_ADMIN_PASSWORD);
  await page.locator('.auth-card button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname !== "/login");
  const response = await page.request.get(`${base}/api/workspaces/${slug}/navigation/`);
  assert(response.ok(), `Navigation API status ${response.status()}`);
  const document = await response.json();
  const roles = document.routes.find((item) => item.path === "/roles");
  const org = document.categories.find((item) => item.id === roles.category);
  const designer = document.routes.find((item) => item.path === "/settings/engine");
  const designPage = document.design_pages.find((item) => item.code === "roles");
  assert(designPage && org && designer);
  for (const route of ["/roles", "/sections/old-category/roles", roles.to]) {
    await page.goto(base + route);
    await page.waitForURL((url) => url.pathname === roles.to);
    await page.waitForFunction(
      (title) => document.querySelector(".breadcrumb")?.textContent.includes(title),
      org.title
    );
    assert((await page.locator(".breadcrumb").innerText()).includes(roles.label));
  }
  await page.goto(`${base}${designer.to}?page=roles`);
  await page.waitForURL((url) => url.searchParams.get("category") === designPage.category);
  await page.locator(".engine-workspace").waitFor();
  await page.waitForFunction(
    (title) => document.querySelector(".breadcrumb")?.textContent.includes(title),
    designPage.title
  );
  assert.equal(await page.locator(".engine-workspace-sidebar select").inputValue(), designPage.category);
  await page.reload();
  await page.locator(".engine-workspace").waitFor();
  assert.equal(new URL(page.url()).searchParams.get("page"), "roles");
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(400);
    const singleLine = await page.locator(".breadcrumb").evaluate((nav) => {
      const rows = [...nav.querySelectorAll("li")].map((item) => item.getBoundingClientRect().top);
      return rows.every((top) => Math.abs(top - rows[0]) <= 1) && nav.getBoundingClientRect().right <= innerWidth + 1;
    });
    assert(singleLine, `Breadcrumb overflow at ${width}px`);
  }
  assert.deepEqual(errors, []);
  console.log(
    "NAVIGATION_VERIFIED",
    base,
    document.categories.length,
    "categories",
    document.design_pages.length,
    "design pages"
  );
} finally {
  await browser.close();
}
