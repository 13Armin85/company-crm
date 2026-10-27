// Isolated synthetic responses; no request can modify the running Docker database.
/* eslint-disable no-await-in-loop -- Calendar interactions depend on the preceding selection and viewport. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(
  pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE ?? ".cache/browser/node_modules/playwright/index.mjs")).href
);
const base = process.env.CRM_BROWSER_URL ?? "http://localhost:3000";
const browserScope = process.env.CRM_BROWSER_SCOPE ?? "all";
assert(
  ["all", "navigation", "calendar"].includes(browserScope),
  "CRM_BROWSER_SCOPE must be all, navigation or calendar"
);
const output = resolve(process.env.CRM_BROWSER_OUTPUT ?? ".cache/browser/docker-calendars");
await mkdir(output, { recursive: true });
const projects = [1, 2].map((id) => ({ id: `project-${id}`, name: `پروژه ${id}`, identifier: `P${id}` }));
const user = { id: "user-1", display_name: "کاربر آزمایشی", user_timezone: "Asia/Tehran" };
const permissions = [
  "Issue.View",
  "Issue.Create",
  "Project.View",
  "Project.Edit",
  "Project.Create",
  "Absence.View",
  "Absence.Create",
  "Absence.ManageAll",
  "Access.UserException.View",
  "Access.UserException.Manage",
  "User.View",
  "OrganizationUnit.View",
  "OrganizationUnit.Disable",
  "OrganizationUnit.Delete",
];
let theme = "light";
const checks = [];
const errors = [];
const browser = await chromium.launch({
  executablePath: process.env.CRM_BROWSER_EXECUTABLE ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const context = await browser.newContext();
await context.addInitScript(() => localStorage.setItem("hamkar-workspace", "calendar-test"));
await context.route(/\/(api|auth)\//, async (route) => {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  if (request.method() !== "GET") return route.fulfill({ status: 200, json: {} });
  let data = [];
  if (path === "/api/users/me/") data = user;
  else if (path.endsWith("/profile/")) data = { theme: { theme } };
  else if (path.endsWith("/workspaces/")) data = [{ id: "workspace-1", slug: "calendar-test", name: "شرکت آزمایشی" }];
  else if (path.endsWith("/access/me/")) data = { permissions, explanations: [], role_grants: [] };
  else if (path.endsWith("/members/")) data = [{ id: "member-1", member: user, is_active: true }];
  else if (path.endsWith("/projects/") || path.endsWith("/projects/details/")) data = projects;
  else if (path.endsWith("/organization/units/"))
    data = [
      { id: "unit-active", title: "واحد فعال", member_ids: [], is_active: true },
      { id: "unit-inactive", title: "واحد غیرفعال", member_ids: [], is_active: false },
    ];
  else if (path.endsWith("/organization/users/user-1/"))
    data = { ...user, membership_id: "member-1", is_active: true, role_ids: [], unit_ids: [] };
  else if (path.endsWith("/users/user-1/exceptions/"))
    data = [
      {
        id: "timed-exception",
        permission: "permission-1",
        permission_code: "Project.View",
        permission_name: "مشاهده پروژه‌ها",
        effect: "ALLOW",
        is_active: true,
        starts_at: "2024-03-20T00:00:00Z",
        ends_at: "2030-03-20T00:00:00Z",
      },
    ];
  else if (path.endsWith("/organization/permissions/"))
    data = [{ id: "permission-1", code: "Project.View", name: "مشاهده پروژه‌ها", category: "Project", is_active: true }];
  else if (/\/projects\/project-\d\/$/.test(path)) data = projects.find((row) => path.includes(`/${row.id}/`));
  else if (path.endsWith("/issues/")) {
    const id = path.match(/\/projects\/(project-\d)\//)?.[1];
    data = [
      { id: `${id}-nowruz`, name: `موعد نوروز ${id}`, target_date: "2024-03-20", sequence_id: 1 },
      { id: `${id}-esfand`, name: `موعد اسفند ${id}`, target_date: "2024-03-19", sequence_id: 2 },
    ];
  } else if (path.endsWith("/absences/")) data = { absences: [], manageable_user_ids: [user.id], delegations: [] };
  return route.fulfill({ json: data });
});
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));
const go = async (path) => {
  const delay = Number(process.env.CRM_BROWSER_NAVIGATION_DELAY_MS ?? 0);
  if (delay > 0) await new Promise((complete) => setTimeout(complete, delay));
  await page.goto(base + path, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.locator(".app-shell").waitFor({ timeout: 60000 });
};
const choose = async (label, text, scope = page) => {
  const input = scope.getByRole("combobox", { name: label, exact: true });
  await input.fill(text);
  await page.locator(".selector-single-option").first().waitFor();
  await input.press("ArrowDown");
  await input.press("Enter");
};
const checkPicker = async (scope, label) => {
  await scope.evaluate(async (element) => {
    await Promise.all(
      element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined))
    );
  });
  const trigger = scope.getByRole("button", { name: label, exact: true });
  await trigger.scrollIntoViewIfNeeded();
  const before = await scope.boundingBox();
  const triggerBefore = await trigger.boundingBox();
  await trigger.click();
  const popup = page.locator(".persian-calendar");
  await popup.waitFor();
  assert.equal(
    await popup.getByRole("button", { name: "پاک‌کردن", exact: true }).count(),
    1,
    "existing forms retain their clear-date action"
  );
  await popup.evaluate(() => new Promise((complete) => requestAnimationFrame(() => requestAnimationFrame(complete))));
  const after = await scope.boundingBox();
  const triggerAfter = await trigger.boundingBox();
  assert(Math.abs(before.height - after.height) < 1, `${label}: opening does not resize the form`);
  assert(Math.abs(triggerBefore.y - triggerAfter.y) < 1, `${label}: opening preserves the scroll position`);
  const layout = await popup.evaluate((panel) => {
    const rect = panel.getBoundingClientRect();
    const days = [...panel.querySelectorAll(".persian-calendar-grid button")].map((day) => {
      const box = day.getBoundingClientRect();
      return { width: box.width, height: box.height };
    });
    return {
      position: getComputedStyle(panel).position,
      rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, viewportHeight: innerHeight },
      inViewport: rect.left >= 0 && rect.right <= innerWidth + 1 && rect.top >= 0 && rect.bottom <= innerHeight + 1,
      weekdays: panel.querySelectorAll(".persian-calendar-weekdays span").length,
      days,
    };
  });
  assert.notEqual(layout.position, "static");
  assert(layout.inViewport, `${label}: popup stays within the viewport ${JSON.stringify(layout.rect)}`);
  assert.equal(layout.weekdays, 7);
  assert(layout.days.every((day) => Math.abs(day.width - layout.days[0].width) < 1 && day.height === 36));
  const gridOffset = () =>
    popup.evaluate(
      (panel) =>
        panel.querySelector(".persian-calendar-grid").getBoundingClientRect().top - panel.getBoundingClientRect().top
    );
  const gridBefore = await gridOffset();
  const year = popup.getByRole("combobox", { name: "سال", exact: true });
  await year.fill("1399");
  await page.locator(".selector-single-option").first().waitFor();
  const gridAfter = await gridOffset();
  assert(Math.abs(gridBefore - gridAfter) < 1, `${label}: year choices do not move the day grid`);
  await year.press("ArrowDown");
  await year.press("Enter");
  await popup.getByRole("combobox", { name: "ماه", exact: true }).selectOption("12");
  assert.equal(await popup.getByRole("button", { name: "۳۰ اسفند ۱۳۹۹", exact: true }).count(), 1);
  await choose("سال", "١٤٠٠", popup);
  assert.equal(await popup.getByRole("button", { name: "۳۰ اسفند ۱۴۰۰", exact: true }).count(), 0);
  await page.screenshot({ path: resolve(output, `picker-${label}-${page.viewportSize().width}-${theme}.png`) });
  await popup.getByRole("button", { name: "۲۹ اسفند ۱۴۰۰", exact: true }).click();
  assert.match(await trigger.textContent(), /۲۹ اسفند ۱۴۰۰/);
  await trigger.click();
  await popup.waitFor();
  await popup.getByRole("button", { name: "ماه قبل", exact: true }).focus();
  await page.keyboard.press("Escape");
  await popup.waitFor({ state: "hidden" });
  checks.push({
    picker: label,
    width: page.viewportSize().width,
    theme,
    stableForm: true,
    stableYearDropdown: true,
    uniformDays: true,
    inViewport: true,
    leapEsfand: true,
    monthAndYearSelection: true,
  });
};

try {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (theme of ["light", "dark"]) {
      for (const path of ["/calendar", "/projects/project-1?tab=calendar"]) {
        await go(path);
        const cardBefore = await page.locator(".calendar-card").boundingBox();
        const navigation = page.getByRole("region", { name: "انتخاب تاریخ تقویم", exact: true });
        assert.equal(await navigation.count(), 1);
        assert.equal(await navigation.locator("h2").count(), 1);
        assert.equal(await navigation.getByRole("button", { name: "رفتن به تاریخ", exact: true }).count(), 1);
        assert.equal(await navigation.evaluate((element) => getComputedStyle(element).borderRadius), "12px");
        await page.getByRole("combobox", { name: "سال تقویم", exact: true }).fill("1403");
        await page.locator(".selector-single-option").first().waitFor();
        const cardAfter = await page.locator(".calendar-card").boundingBox();
        assert(Math.abs(cardBefore.y - cardAfter.y) < 1, `${path}: year choices do not move the calendar`);
        await choose("سال تقویم", "1403");
        await choose("ماه تقویم", "فروردین");
        await page.locator('.calendar-grid[aria-label="فروردین ۱۴۰۳"] article').first().waitFor();
        assert.equal(await page.locator(".calendar-grid article").count(), path === "/calendar" ? 2 : 1);
        assert.match(await page.locator(".calendar-grid").textContent(), /موعد نوروز project-1/);
        assert.doesNotMatch(await page.locator(".calendar-grid").textContent(), /موعد اسفند/);
        await page.getByRole("button", { name: "ماه قبل", exact: true }).click();
        assert.equal(await page.getByRole("combobox", { name: "ماه تقویم", exact: true }).inputValue(), "اسفند");
        assert.equal(await page.getByRole("combobox", { name: "سال تقویم", exact: true }).inputValue(), "۱۴۰۲");
        assert.match(await page.locator(".calendar-grid").textContent(), /موعد اسفند project-1/);
        await page.getByRole("button", { name: "ماه بعد", exact: true }).click();
        assert.equal(await page.getByRole("combobox", { name: "سال تقویم", exact: true }).inputValue(), "۱۴۰۳");
        await choose("سال تقویم", "۱۳۹۹");
        await choose("ماه تقویم", "اسفند");
        assert.equal(
          await page
            .locator(".calendar-grid > div > span")
            .filter({ hasText: /^۳۰$/ })
            .count(),
          1
        );
        await choose("سال تقویم", "١٤٠٠");
        assert.equal(
          await page
            .locator(".calendar-grid > div > span")
            .filter({ hasText: /^۳۰$/ })
            .count(),
          0
        );
        assert.equal(
          await page
            .locator(".calendar-grid > div > span")
            .filter({ hasText: /^۲۹$/ })
            .count(),
          1
        );
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        assert.equal(overflow, false, `${path}/${width}/${theme}: horizontal overflow`);
        assert(
          await page.locator(".calendar-card").evaluate((card) => card.scrollWidth <= card.clientWidth + 1),
          "all seven calendar columns fit the card"
        );
        assert(
          await page
            .getByRole("combobox", { name: "سال تقویم", exact: true })
            .evaluate((input) => input.clientWidth > 55),
          "year remains readable"
        );

        const trigger = navigation.getByRole("button", { name: "رفتن به تاریخ", exact: true });
        const gridBeforePicker = await page.locator(".calendar-card").boundingBox();
        await trigger.click();
        const popup = page.locator(".persian-calendar");
        await popup.waitFor();
        const gridAfterPicker = await page.locator(".calendar-card").boundingBox();
        assert(Math.abs(gridBeforePicker.y - gridAfterPicker.y) < 1, "date picker does not move the main calendar");
        assert.equal(await popup.getByRole("button", { name: "پاک‌کردن", exact: true }).count(), 0);
        assert(
          await popup.evaluate((panel) => {
            const rect = panel.getBoundingClientRect();
            return rect.left >= 0 && rect.right <= innerWidth + 1 && rect.top >= 0 && rect.bottom <= innerHeight + 1;
          }),
          "jump-to-date popup fits the viewport"
        );
        await choose("سال", "۱۳۹۹", popup);
        await popup.getByRole("combobox", { name: "ماه", exact: true }).selectOption("12");
        await popup.getByRole("button", { name: "۳۰ اسفند ۱۳۹۹", exact: true }).focus();
        await page.keyboard.press("Enter");
        await popup.waitFor({ state: "hidden" });
        assert.equal(await page.getByRole("combobox", { name: "سال تقویم", exact: true }).inputValue(), "۱۳۹۹");
        assert.match(await trigger.textContent(), /۳۰ اسفند ۱۳۹۹/);
        assert.equal(
          await page.locator('.calendar-grid > div[data-selected="true"][aria-label="۳۰ اسفند ۱۳۹۹"]').count(),
          1
        );
        await choose("سال تقویم", "1400");
        assert.match(await trigger.textContent(), /۲۹ اسفند ۱۴۰۰/);
        assert.equal(
          await page.locator('.calendar-grid > div[data-selected="true"][aria-label="۲۹ اسفند ۱۴۰۰"]').count(),
          1
        );
        await trigger.click();
        await popup.waitFor();
        await choose("سال", "1403", popup);
        await popup.getByRole("combobox", { name: "ماه", exact: true }).selectOption("1");
        await popup.getByRole("button", { name: "۱ فروردین ۱۴۰۳", exact: true }).click();
        await popup.waitFor({ state: "hidden" });
        assert.equal(
          await page.locator('.calendar-grid > div[data-selected="true"][aria-label="۱ فروردین ۱۴۰۳"]').count(),
          1
        );
        assert.equal(await page.locator(".calendar-grid article").count(), path === "/calendar" ? 2 : 1);
        await trigger.click();
        await popup.waitFor();
        await popup.getByRole("button", { name: "ماه قبل", exact: true }).focus();
        await page.keyboard.press("Escape");
        await popup.waitFor({ state: "hidden" });
        assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
        assert.match(await trigger.textContent(), /۱ فروردین ۱۴۰۳/);
        checks.push({
          path,
          width,
          theme,
          dateJump: true,
          selectedDayHighlight: true,
          leapDayClamp: true,
          keyboardAndEscape: true,
          stablePopup: true,
        });
        if (width === 320 || width === 1440)
          await page.screenshot({
            path: resolve(output, `${path === "/calendar" ? "calendar" : "project"}-${width}-${theme}.png`),
            fullPage: true,
          });
        await navigation.getByRole("button", { name: "امروز", exact: true }).click();
        assert.equal(await page.locator(".calendar-grid > div.today[data-selected='true']").count(), 1);
        checks.push({ path, width, theme, monthAndYear: true, nowruzNavigation: true, leapEsfand: true, overflow });
      }
    }
  }
  if (browserScope === "all")
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (theme of ["light", "dark"]) {
        await go("/projects/project-1?tab=settings");
        await checkPicker(page.locator(".project-settings-form"), "تاریخ پایان");
        await page.getByRole("button", { name: "چرخه‌ها", exact: true }).click();
        await checkPicker(page.locator(".cycle-form"), "شروع");
        await checkPicker(page.locator(".cycle-form"), "پایان");
        await page.getByRole("button", { name: "ایجاد", exact: true }).click();
        await checkPicker(page.getByRole("dialog"), "تاریخ پایان");
        await page.getByRole("dialog").getByRole("button", { name: "انصراف", exact: true }).click();
        await go("/absences");
        await page.getByRole("button", { name: "ثبت عدم حضور", exact: true }).click();
        await checkPicker(page.getByRole("dialog"), "شروع");
        await checkPicker(page.getByRole("dialog"), "پایان");
        assert.equal(await page.locator('input[type="date"], input[type="datetime-local"]').count(), 0);
        await page.getByRole("dialog").getByRole("button", { name: "بستن", exact: true }).click();
        await go("/team/user-1");
        await page.getByRole("button", { name: "ویرایش دسترسی", exact: true }).click();
        await page.getByRole("button", { name: "ویرایش بازهٔ قبلی", exact: true }).click();
        await checkPicker(page.locator(".user-access-panel"), "شروع اختیاری");
        await checkPicker(page.locator(".user-access-panel"), "پایان اختیاری");
        await go("/organization");
        for (const label of ["غیرفعال کردن", "فعال کردن", "حذف واحد"]) {
          const action = page.locator(".org-node-actions").getByRole("button", { name: label, exact: true }).first();
          await action.waitFor();
          assert.equal(await action.locator("svg").count(), 1);
          assert.equal((await action.textContent()).trim(), "");
          assert.equal(await action.getAttribute("title"), label);
        }
        await page.locator(".org-node-actions").getByRole("button", { name: "حذف واحد", exact: true }).first().click();
        await page.getByRole("dialog").getByRole("button", { name: "حذف واحد", exact: true }).waitFor();
        await page.getByRole("dialog").getByRole("button", { name: "انصراف", exact: true }).click();
        checks.push({ organization: true, width, theme, iconActions: true, deleteConfirmation: true });
      }
    }
  if (browserScope === "navigation") {
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (theme of ["light", "dark"]) {
        await go("/projects/project-1?tab=settings");
        await checkPicker(page.locator(".project-settings-form"), "تاریخ پایان");
      }
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks: checks.length, errors, passed: true }));
  await writeFile(resolve(output, "report.json"), JSON.stringify({ checks, errors, passed: true }, null, 2));
} catch (error) {
  await writeFile(resolve(output, "report.json"), JSON.stringify({ checks, errors, passed: false }, null, 2));
  await page.screenshot({ path: resolve(output, "failure.png"), fullPage: true }).catch(() => undefined);
  throw error;
} finally {
  await browser.close();
}
