// All API requests use synthetic responses, including saves; the running database is never modified.
/* eslint-disable no-await-in-loop -- Each interaction depends on the previous value and viewport. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(
  pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE ?? ".cache/browser/node_modules/playwright/index.mjs")).href
);
const base = process.env.CRM_BROWSER_URL ?? "http://localhost:3015";
const output = resolve(process.env.CRM_BROWSER_OUTPUT ?? ".cache/browser/absence-time");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CRM_BROWSER_EXECUTABLE ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const context = await browser.newContext();
await context.addInitScript(() => localStorage.setItem("hamkar-workspace", "absence-test"));
let theme = "light";
let finishSave;
const saves = [];
const checks = [];
const errors = [];
const user = { id: "user-1", display_name: "کاربر آزمایشی", user_timezone: "Asia/Tehran" };
await context.route(/\/(api|auth)\//, async (route) => {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  if (request.method() !== "GET") {
    if (request.method() === "POST" && path.endsWith("/absences/")) {
      saves.push(request.postDataJSON());
      await new Promise((complete) => {
        finishSave = complete;
      });
      return route.fulfill({ json: { id: "absence-1", ...saves.at(-1) } });
    }
    return route.fulfill({ json: {} });
  }
  let data = [];
  if (path === "/api/users/me/") data = user;
  else if (path.endsWith("/profile/")) data = { theme: { theme } };
  else if (path.endsWith("/workspaces/")) data = [{ id: "workspace-1", slug: "absence-test", name: "شرکت آزمایشی" }];
  else if (path.endsWith("/access/me/"))
    data = {
      permissions: [
        "Absence.View",
        "Absence.Create",
        "Absence.ManageAll",
        "Project.View",
        "Project.Create",
        "Issue.Create",
      ],
      explanations: [],
      role_grants: [],
    };
  else if (path.endsWith("/members/")) data = [{ id: "member-1", member: user, is_active: true }];
  else if (path.endsWith("/absences/")) data = { absences: [], manageable_user_ids: [user.id], delegations: [] };
  return route.fulfill({ json: data });
});
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));
const go = async (path) => {
  await page.goto(base + path, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.locator(".app-shell").waitFor({ timeout: 60000 });
};
const selectDate = async (dialog, label) => {
  await dialog.getByRole("button", { name: label, exact: true }).click();
  const calendar = page.locator(".persian-calendar");
  const year = calendar.getByRole("combobox", { name: "سال", exact: true });
  await year.fill("1403");
  await page.locator(".selector-single-option").first().waitFor();
  await year.press("ArrowDown");
  await year.press("Enter");
  await calendar.getByRole("combobox", { name: "ماه", exact: true }).selectOption("1");
  await calendar.getByRole("button", { name: "۱ فروردین ۱۴۰۳", exact: true }).click();
};

try {
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (theme of ["light", "dark"]) {
      await go("/absences");
      await page.getByRole("button", { name: "ثبت عدم حضور", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await selectDate(dialog, "شروع");
      await selectDate(dialog, "پایان");
      const hour = dialog.getByRole("spinbutton", { name: "ساعت شروع", exact: true });
      const minute = dialog.getByRole("spinbutton", { name: "دقیقه شروع", exact: true });
      await hour.fill("۰۹");
      await minute.fill("١٧");
      await minute.press("Tab");
      assert.equal(await hour.inputValue(), "۰۹");
      assert.equal(await minute.inputValue(), "۱۷");
      await hour.fill("24");
      assert.equal(await hour.inputValue(), "۰۹", "out-of-range hours are rejected");
      await minute.fill("60");
      assert.equal(await minute.inputValue(), "۱۷", "out-of-range minutes are rejected");
      await minute.fill("");
      await minute.press("Tab");
      assert.equal(await minute.inputValue(), "۱۷", "unfinished input restores the last valid minute");
      await minute.fill("59");
      await minute.press("ArrowUp");
      assert.equal(await minute.inputValue(), "۰۰", "keyboard step wraps at 59");
      await minute.press("ArrowDown");
      assert.equal(await minute.inputValue(), "۵۹");
      await dialog.getByRole("button", { name: "۳۰ دقیقه شروع", exact: true }).click();
      await dialog.getByRole("button", { name: "افزایش ساعت شروع", exact: true }).click();
      assert.equal(await hour.inputValue(), "۱۰");
      assert.equal(await minute.inputValue(), "۳۰");
      const endHour = dialog.getByRole("spinbutton", { name: "ساعت پایان", exact: true });
      await endHour.fill("09");
      await dialog.getByRole("spinbutton", { name: "دقیقه پایان", exact: true }).fill("00");
      await dialog.getByText("پایان باید بعد از شروع باشد.", { exact: true }).waitFor();
      assert.equal(await dialog.locator('button[type="submit"]').isDisabled(), true);
      await endHour.fill("11");
      await dialog.getByRole("spinbutton", { name: "دقیقه پایان", exact: true }).fill("47");
      await endHour.press("Tab");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert(
        await dialog
          .locator(".persian-time-picker")
          .evaluateAll((fields) => fields.every((field) => field.scrollWidth <= field.clientWidth + 1)),
        "time controls fit even at 320px"
      );
      await page.screenshot({ path: resolve(output, `absence-${width}-${theme}.png`), fullPage: true });
      const userSelect = dialog.getByRole("combobox", { name: "کاربر", exact: true });
      if (!(await userSelect.inputValue())) {
        await userSelect.fill("کاربر");
        await page.locator(".selector-single-option").first().click();
      }
      const count = saves.length;
      await dialog.locator('button[type="submit"]').click();
      await dialog.locator(".persian-time-picker:disabled").first().waitFor();
      assert.equal(await hour.isDisabled(), true);
      assert.equal(await dialog.getByRole("button", { name: "۱۵ دقیقه شروع", exact: true }).isDisabled(), true);
      assert.equal(saves.length, count + 1);
      assert.deepEqual(saves.at(-1), {
        user: user.id,
        starts_at: "2024-03-20T07:00:00.000Z",
        ends_at: "2024-03-20T08:17:00.000Z",
        reason: "",
      });
      finishSave();
      await dialog.waitFor({ state: "hidden" });
      checks.push({
        width,
        theme,
        persianAndArabicDigits: true,
        exactMinute: true,
        keyboard: true,
        rangeValidation: true,
        disabledWhileSaving: true,
        timezonePayload: true,
      });
    }
  }
  await go("/projects");
  await page.getByRole("button", { name: "ایجاد", exact: true }).click();
  const create = page.getByRole("dialog");
  await create.getByRole("button", { name: "پروژه", exact: true }).click();
  assert.equal(
    await create
      .getByText("شناسه یکتا پس از ثبت، خودکار تولید می‌شود و برای جست‌وجو قابل استفاده است.", { exact: true })
      .count(),
    0
  );
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(output, "report.json"),
    JSON.stringify({ passed: true, checks, hiddenIdentifierHint: true, errors }, null, 2)
  );
  console.log(JSON.stringify({ passed: true, checks: checks.length, hiddenIdentifierHint: true, errors }));
} catch (error) {
  await page.screenshot({ path: resolve(output, "failure.png"), fullPage: true }).catch(() => undefined);
  await writeFile(resolve(output, "report.json"), JSON.stringify({ passed: false, checks, errors }, null, 2));
  throw error;
} finally {
  finishSave?.();
  await browser.close();
}
