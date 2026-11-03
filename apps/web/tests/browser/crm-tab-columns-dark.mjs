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
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1).replace(/^(['"])(.*)\1$/, "$2")];
    })
);
const base = process.env.CRM_BROWSER_URL || "http://localhost:3000";
const browser = await chromium.launch({
  executablePath: process.env.CRM_BROWSER_EXECUTABLE || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});

try {
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(env.DEV_ADMIN_EMAIL);
  await page.locator('input[name="password"]').fill(env.DEV_ADMIN_PASSWORD);
  await page.locator('.auth-card button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname !== "/login");

  await page.goto(`${base}/roles`);
  const table = page.locator(".surface-table-wrap table");
  await table.waitFor();
  const headers = () =>
    table
      .locator("thead th")
      .allTextContents()
      .then((items) => items.map((item) => item.trim()));
  const before = await headers();
  assert(before.length > 1, "The roles table needs at least two columns for this check");
  const selected = before[0];
  await page.getByRole("button", { name: /تب‌های من/ }).click();
  assert.equal(await page.locator(".table-tab-creator").count(), 0, "Column selection must not require a new tab");
  const columnGroup = page.locator(".table-tab-active-column-list");
  await columnGroup.locator("label").filter({ hasText: selected }).first().locator('input[type="checkbox"]').uncheck();
  assert(!(await headers()).includes(selected), "Unchecking a column must remove its table header immediately");
  await page.reload();
  await table.waitFor();
  assert(!(await headers()).includes(selected), "The hidden column must stay hidden after reloading");
  console.log("PASS tab column checkbox updates and persists the table");

  await page.goto(base);
  await page.locator(".dashboard-role-picker").waitFor();
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  const colors = await page.evaluate(() => {
    const picker = document.querySelector(".dashboard-role-picker");
    const widget = document.querySelector(".dashboard-widget");
    return {
      picker: picker && getComputedStyle(picker).backgroundColor,
      widget: widget && getComputedStyle(widget).backgroundColor,
      scheme: getComputedStyle(document.querySelector(".custom-dashboard")).colorScheme,
    };
  });
  assert.equal(colors.picker, "rgb(21, 24, 30)", "Dashboard view picker must use the dark surface");
  if (colors.widget) assert.equal(colors.widget, "rgb(21, 24, 30)", "Dashboard widgets must use the dark surface");
  assert.equal(colors.scheme, "dark");
  console.log("PASS dashboard view and widgets use dark surfaces");
} finally {
  await browser.close();
}
