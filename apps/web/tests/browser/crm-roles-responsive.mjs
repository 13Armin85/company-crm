/* eslint-disable no-await-in-loop -- Each viewport is checked after the page settles. */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(resolve(".cache/browser/node_modules/playwright/index.mjs")).href);
const browser = await chromium.launch({
  executablePath: process.env.CRM_BROWSER_EXECUTABLE ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const context = await browser.newContext();
const errors = [];
await context.addInitScript(() => localStorage.setItem("hamkar-workspace", "test"));
await context.route(
  (url) => /^\/(api|auth)\//.test(url.pathname),
  async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data = [];
    if (path === "/auth/get-csrf-token/") data = { csrf_token: "test-token" };
    else if (path === "/api/users/me/") data = { id: "user", display_name: "کاربر آزمایشی" };
    else if (path.endsWith("/workspaces/")) data = [{ id: "workspace", slug: "test", name: "شرکت" }];
    else if (path.endsWith("/access/me/"))
      data = { permissions: ["Role.View", "Role.Edit", "Role.Permission.Assign"], explanations: [] };
    else if (path.endsWith("/profile/")) data = { theme: { theme: "light" } };
    else if (path.endsWith("/surfaces/roles/"))
      data = {
        code: "roles",
        title: "نقش‌ها",
        definition: {
          native: {},
          fields: [],
          columns: ["نام نقش", "توضیح", "وضعیت", "مجوزها", "کاربران دارای نقش", "عملیات"].map(
            (name) => `native:${name}`
          ),
        },
        schema: { fields: [], defaults: {} },
        native_fields: [],
        native_columns: [],
        engine_fields: [],
      };
    else if (path.endsWith("/organization/roles/"))
      data = {
        results: [{ id: "role", name: "مدیر تیم", description: "مدیریت تیم", permission_ids: [], is_active: true }],
        count: 1,
        page: 1,
        page_size: 25,
        pages: 1,
      };
    await route.fulfill({ json: data });
  }
);

try {
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(30000);
  for (const width of [1440, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${process.env.CRM_BROWSER_URL ?? "http://localhost:3000"}/roles`);
    await page.locator(".roles-table tbody tr").first().waitFor();
    assert.equal(await page.locator(".roles-table .role-name-cell").innerText(), "مدیر تیم");
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    assert(scrollWidth <= width + 1, `document overflows at ${width}px: ${scrollWidth}px`);
    if (width <= 768) {
      assert.equal(await page.locator(".roles-table thead").isVisible(), false);
      assert.equal(await page.locator('.roles-table td[data-label="وضعیت"] .roles-status').isVisible(), true);
    }
    await page.getByRole("button", { name: "راهنمای صفحهٔ نقش‌های سازمانی" }).click();
    assert.equal(await page.getByRole("dialog", { name: "نقش‌های سازمانی" }).isVisible(), true);
    assert.equal(await page.getByRole("heading", { name: "این صفحه چه کاری انجام می‌دهد؟" }).isVisible(), true);
    assert.equal(await page.getByRole("heading", { name: "روش استفاده" }).isVisible(), true);
    assert.equal(await page.getByRole("button", { name: "متوجه شدم" }).isVisible(), true);
    const helpBounds = await page.locator(".page-help-layer").evaluate((element) => ({
      parent: element.parentElement?.tagName,
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
    }));
    assert.equal(helpBounds.parent, "BODY");
    assert.equal(helpBounds.width, width);
    assert.equal(helpBounds.height, 900);
    if (process.env.CRM_HELP_SCREENSHOT && width === 375)
      await page.screenshot({ path: process.env.CRM_HELP_SCREENSHOT });
    await page.getByRole("button", { name: "بستن راهنما" }).click();
  }
  assert.deepEqual(errors, []);
  console.log("PASS: roles at 1440, 768, 375 and 320px; help dialog and no page overflow");
} finally {
  await browser.close();
}
