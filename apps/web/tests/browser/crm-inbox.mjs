/* eslint-disable no-await-in-loop -- Browser steps depend on the preceding interaction and viewport. */
// Synthetic responses isolate every mutation from the deployed database.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(resolve(".cache/browser/node_modules/playwright/index.mjs")).href);
const base = process.env.CRM_BROWSER_URL ?? "http://localhost:3000";
const output = resolve(process.env.CRM_BROWSER_OUTPUT ?? ".cache/browser/docker-inbox");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const checks = [];
const errors = [];
try {
  for (const width of [320, 1440]) {
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      context.setDefaultNavigationTimeout(120000);
      await context.addInitScript(() => localStorage.setItem("hamkar-workspace", "inbox-test"));
      const full = "متن کامل اعلان و تمام جزئیات آن\n".repeat(300) + "پایان متن کامل <img src=x onerror=alert(1)>";
      const rows = [
        {
          id: "notice-1",
          title: "اعلان اول",
          sender: "mentioned",
          read_at: null,
          archived_at: "2026-10-10",
          snoozed_till: "2026-10-12",
        },
        { id: "notice-2", title: "اعلان دوم", sender: "issue_comment", read_at: null },
        { id: "notice-3", title: "اعلان خوانده شده", sender: "updated", read_at: "2026-10-10" },
      ].map((row) =>
        Object.assign({}, row, {
          message_stripped: "خلاصه اعلان",
          project: "project-1",
          created_at: "2026-10-11T09:00:00Z",
          triggered_by_details: { display_name: "همکار آزمایشی" },
        })
      );
      let failAll = true;
      let failDetails = false;
      let allCalls = 0;
      let readCalls = 0;
      let listCalls = 0;
      await context.route(/\/(api|auth)\//, async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const path = url.pathname;
        if (request.method() !== "GET") {
          if (path.endsWith("/mark-all-read/")) {
            allCalls++;
            assert.equal(request.postDataJSON().all_notifications, true);
            if (failAll) return route.fulfill({ status: 500, json: { error: "خواندن اعلان‌ها انجام نشد" } });
            rows.forEach((row) => {
              row.read_at ??= "2026-10-11T10:00:00Z";
            });
          } else if (path.endsWith("/read/")) {
            readCalls++;
            rows.find((row) => path.includes(`/${row.id}/`)).read_at = "2026-10-11T10:00:00Z";
          }
          return route.fulfill({ json: {} });
        }
        let data = [];
        if (path === "/api/users/me/") data = { id: "user-1", display_name: "کاربر", user_timezone: "Asia/Tehran" };
        else if (path.endsWith("/profile/")) data = { theme: { theme } };
        else if (path.endsWith("/workspaces/"))
          data = [{ id: "workspace-1", slug: "inbox-test", name: "شرکت آزمایشی" }];
        else if (path.endsWith("/access/me/"))
          data = { permissions: ["Issue.View", "Project.View"], explanations: [], role_grants: [] };
        else if (path.endsWith("/notifications/")) {
          listCalls++;
          assert.equal(url.searchParams.get("all_notifications"), "true");
          data = rows;
        } else if (/\/notifications\/notice-\d\/$/.test(path)) {
          if (failDetails) return route.fulfill({ status: 500, json: { error: "خطای جزئیات" } });
          data = { ...rows.find((row) => path.includes(`/${row.id}/`)), message_text: full };
        }
        return route.fulfill({ json: data });
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      const delay = Number(process.env.CRM_BROWSER_NAVIGATION_DELAY_MS ?? 0);
      if (delay > 0) await new Promise((complete) => setTimeout(complete, delay));
      await page.goto(base + "/inbox", { waitUntil: "domcontentloaded" });
      await page.locator(".inbox-list > button").first().waitFor({ timeout: 60000 });
      assert.equal(await page.locator(".inbox-list > button").count(), 3);
      assert.equal(await page.locator(".inbox-list > button.unread").count(), 2);
      assert.match(await page.locator(".inbox-overview").textContent(), /۲ اعلان خوانده‌نشده/);
      assert.equal(await page.locator(".inbox-item-kicker").count(), 3);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1),
        false,
        `inbox must not overflow horizontally at ${width}px in ${theme} mode`
      );
      await page.screenshot({ path: resolve(output, `inbox-list-${width}-${theme}.png`), fullPage: true });
      await page.getByRole("button", { name: "خواندن همه", exact: true }).click();
      await page.getByText("خواندن اعلان‌ها انجام نشد", { exact: true }).first().waitFor();
      assert.equal(await page.locator(".inbox-list > button.unread").count(), 2);
      checks.push({ width, theme, failedReadAllPreservesUnread: true });

      await page.locator(".inbox-list > button").first().click();
      const modal = page.getByRole("dialog");
      await modal.locator(".notification-message").filter({ hasText: "پایان متن کامل" }).waitFor();
      assert.equal(await modal.locator(".notification-message").textContent(), full);
      assert.equal(await modal.locator(".notification-message img").count(), 0);
      assert.match(await modal.textContent(), /همکار آزمایشی/);
      assert.equal(
        await modal.getByRole("link", { name: "مشاهده کارهای پروژه" }).getAttribute("href"),
        "/projects/project-1?tab=issues"
      );
      await page.waitForFunction(() => document.querySelectorAll(".inbox-list > button.unread").length === 1);
      assert.equal(readCalls, 1);
      assert.equal(await modal.evaluate((element) => element.scrollWidth > element.clientWidth + 1), false);
      await page.screenshot({ path: resolve(output, `inbox-${width}-${theme}.png`), fullPage: true });
      await modal.locator("footer").getByRole("button", { name: "بستن", exact: true }).click();
      checks.push({ width, theme, unreadOpensFullTextAndMarksRead: true });

      failAll = false;
      await page.getByRole("button", { name: "اعلان‌ها", exact: true }).click();
      const drawer = page.locator(".notification-drawer.is-open");
      await drawer.getByRole("button", { name: "خواندن همه", exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll(".inbox-list > button.unread").length === 0);
      assert.equal(await page.locator('.main-nav a[href="/inbox"] b').count(), 0);
      assert.equal(await page.locator(".topbar .has-notification").count(), 0);
      assert.equal(allCalls, 2);
      assert(listCalls > 1);
      assert.equal(await drawer.getByRole("button", { name: "خواندن همه", exact: true }).isDisabled(), true);
      await drawer.getByRole("button", { name: "بستن", exact: true }).click();
      assert.equal(
        await page.getByRole("main").getByRole("button", { name: "خواندن همه", exact: true }).isDisabled(),
        true
      );
      checks.push({ width, theme, allReadAndBadgeCleared: true });

      failDetails = true;
      await page.locator(".inbox-list > button").nth(2).click();
      await modal.getByRole("alert").waitFor({ timeout: 20000 });
      assert.equal(readCalls, 1);
      assert.equal(await modal.locator(".notification-message").textContent(), "خلاصه اعلان");
      failDetails = false;
      await modal.getByRole("button", { name: "تلاش دوباره", exact: true }).click();
      await modal.locator(".notification-message").filter({ hasText: "پایان متن کامل" }).waitFor();
      assert.equal(await modal.locator(".notification-message").textContent(), full);
      checks.push({ width, theme, readNotificationOpensAndDetailRetryWorks: true });
      await modal.locator("footer").getByRole("button", { name: "بستن", exact: true }).click();
      await page.getByRole("button", { name: "اعلان‌ها", exact: true }).click();
      await drawer.locator(".notification-list > button").nth(2).click();
      await modal.locator(".notification-message").filter({ hasText: "پایان متن کامل" }).waitFor();
      assert.equal(await modal.locator(".notification-message").textContent(), full);
      assert.equal(readCalls, 1);
      checks.push({ width, theme, drawerOpensFullDetails: true });
      await modal.locator("footer").getByRole("button", { name: "بستن", exact: true }).click();
      Object.assign(rows[2], {
        title: "updated the priority to",
        sender: "in_app:issue_activities",
        project_name: "پروژه ارتباط با مشتری",
        entity_title: "پیگیری درخواست مشتری",
        triggered_by_details: { display_name: "admin" },
        data: {
          issue: { name: "پیگیری درخواست مشتری" },
          issue_activity: { field: "priority", verb: "updated", old_value: "high", new_value: "urgent" },
        },
      });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator(".inbox-list > button").nth(2).getByRole("heading", { name: "تغییر اولویت" }).waitFor();
      const localized = page.locator(".inbox-list > button").nth(2);
      assert.match(await localized.textContent(), /مدیر سامانه.*زیاد.*فوری/);
      assert.match(await localized.textContent(), /پروژه ارتباط با مشتری/);
      await localized.click();
      await modal.getByText("اولویت جدید", { exact: true }).waitFor();
      assert.match(await modal.textContent(), /پیگیری درخواست مشتری/);
      assert.match(await modal.textContent(), /انجام‌دهنده/);
      assert.match(await modal.textContent(), /اولویت قبلی.*زیاد.*اولویت جدید.*فوری/);
      assert.doesNotMatch(await modal.textContent(), /updated|priority|high|urgent|admin|project-1|issue_activity/);
      assert.equal(await modal.evaluate((element) => element.scrollWidth > element.clientWidth + 1), false);
      await page.screenshot({ path: resolve(output, `inbox-persian-${width}-${theme}.png`), fullPage: true });
      checks.push({ width, theme, localizedEventAndUsefulContext: true });
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks: checks.length, errors, passed: true }));
  await writeFile(resolve(output, "report.json"), JSON.stringify({ checks, errors, passed: true }, null, 2));
} finally {
  await browser.close();
}
