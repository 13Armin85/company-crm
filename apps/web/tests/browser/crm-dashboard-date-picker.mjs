/* Check immediate widget persistence and the date picker inside its settings drawer. */
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
const browser = await chromium.launch({
  executablePath: process.env.CRM_BROWSER_EXECUTABLE ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
let page;
let addedWidgetId;
let dashboardApiUrl;

try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(45_000);
  await page.goto(`${process.env.CRM_BROWSER_URL ?? "http://localhost:3000"}/login`);
  await page.locator('input[name="email"]').fill(env.DEV_ADMIN_EMAIL);
  await page.locator('input[name="password"]').fill(env.DEV_ADMIN_PASSWORD);
  await page.locator(".auth-submit").click();
  await page.locator(".custom-dashboard").waitFor();
  const widgetCreated = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/dashboard/widgets/")
  );
  await page.getByRole("button", { name: "ویرایش چیدمان" }).click();
  await page.locator(".dashboard-editbar").getByRole("button", { name: "افزودن ویجت" }).click();
  await page
    .locator(".dashboard-gallery")
    .getByRole("button", { name: /تقویم کوچک/ })
    .click();

  const createResponse = await widgetCreated;
  assert.equal(createResponse.status(), 201, "the widget must be saved by the backend when selected");
  const created = await createResponse.json();
  addedWidgetId = created.widget_id;
  dashboardApiUrl = new URL("../", createResponse.url()).href;
  const saved = await (await page.request.get(dashboardApiUrl)).json();
  assert(
    saved.tabs.some((tab) => tab.widgets.some((widget) => widget.id === addedWidgetId)),
    "the new widget must appear in the persisted dashboard"
  );

  const drawer = page.locator(".dashboard-drawer");
  await drawer.getByRole("button", { name: "شروع بازه زمانی" }).click();
  const calendar = page.locator(".persian-calendar");
  await calendar.waitFor();
  assert(
    await calendar.evaluate((panel) => {
      const rect = panel.getBoundingClientRect();
      const at = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return at === panel || panel.contains(at);
    }),
    "calendar panel must be above the dashboard backdrop"
  );
  await calendar.getByRole("combobox", { name: "سال" }).fill("14");
  const yearOptions = page.locator(".selector-single-options");
  await yearOptions.waitFor();
  assert(
    await yearOptions.evaluate((panel) => {
      const rect = panel.getBoundingClientRect();
      const at = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return at === panel || panel.contains(at);
    }),
    "year choices must be above the dashboard backdrop"
  );
  await calendar.getByRole("combobox", { name: "سال" }).press("Escape");
  await calendar.locator(".persian-calendar-grid button:not([disabled])").first().click();
  assert.equal(await drawer.isVisible(), true, "choosing a date must keep widget settings open");
  assert.notEqual(await drawer.getByRole("button", { name: "شروع بازه زمانی" }).textContent(), "انتخاب تاریخ شمسی");
  await drawer.getByRole("button", { name: "پایان بازه زمانی" }).click();
  await calendar.waitFor();
  await calendar.locator(".persian-calendar-grid button:not([disabled])").first().click();
  assert.equal(await drawer.isVisible(), true, "choosing the end date must keep widget settings open");
  await drawer.getByRole("button", { name: "بستن" }).click();
  await page.getByRole("button", { name: "انصراف" }).click();
  process.stdout.write("dashboard date picker is visible and selectable\n");
} finally {
  if (page && addedWidgetId && dashboardApiUrl) {
    const current = await (await page.request.get(dashboardApiUrl)).json();
    const tabs = current.tabs.map((tab) => ({
      ...tab,
      widgets: tab.widgets.filter((widget) => widget.id !== addedWidgetId),
    }));
    const csrf = await (await page.request.get(new URL("/auth/get-csrf-token/", dashboardApiUrl))).json();
    const restored = await page.request.put(dashboardApiUrl, {
      data: { tabs, revision: current.revision },
      headers: { "X-CSRFTOKEN": csrf.csrf_token },
    });
    assert(restored.ok(), "the temporary widget must be removed after the browser check");
  }
  await browser.close();
}
