// Only synthetic API responses; no deployed records are changed.
/* eslint-disable no-await-in-loop -- Each scenario depends on its preceding browser interactions. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(resolve(".cache/browser/node_modules/playwright/index.mjs")).href);
const base = process.env.CRM_BROWSER_URL ?? "http://localhost:3000";
const output = resolve(process.env.CRM_BROWSER_OUTPUT ?? ".cache/browser/docker-header-notifications");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const checks = [],
  errors = [];
try {
  for (const width of [320, 1440]) {
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      context.setDefaultTimeout(60000);
      context.setDefaultNavigationTimeout(120000);
      await context.addInitScript(() => localStorage.setItem("hamkar-workspace", "header-test"));
      const rows = [
        {
          id: "old",
          title: "اعلان قبلی",
          message_stripped: "اطلاعات قبلی",
          read_at: "2026-10-01",
          created_at: "2026-10-01",
        },
      ];
      let failList = false,
        failRead = false,
        failAll = false,
        listCalls = 0;
      await context.route(/\/(api|auth)\//, async (route) => {
        const request = route.request(),
          path = new URL(request.url()).pathname;
        if (request.method() !== "GET") {
          if (path.endsWith("/mark-all-read/")) {
            if (failAll) return route.fulfill({ status: 500, json: { error: "خواندن اعلان‌ها انجام نشد" } });
            rows.forEach((row) => {
              row.read_at ??= "2026-10-14";
            });
          } else if (path.endsWith("/read/")) {
            if (failRead) return route.fulfill({ status: 500, json: { error: "خواندن اعلان انجام نشد" } });
            rows.find((row) => path.includes(`/${row.id}/`)).read_at = "2026-10-14";
          } else assert.fail("Unexpected mutation in notification test");
          return route.fulfill({ json: {} });
        }
        let data = [];
        if (path === "/api/users/me/")
          data = { id: "user-1", display_name: "سارا رضایی", user_timezone: "Asia/Tehran" };
        else if (path.endsWith("/profile/")) data = { theme: { theme } };
        else if (path.endsWith("/workspaces/"))
          data = [{ id: "workspace-1", slug: "header-test", name: "شرکت آزمایشی" }];
        else if (path.endsWith("/access/me/"))
          data = {
            permissions: ["Issue.View", "Project.View", "Routing.View", "Routing.Queue.View"],
            explanations: [],
            role_grants: [],
          };
        else if (path.endsWith("/notifications/")) {
          listCalls++;
          if (failList) return route.fulfill({ status: 500, json: { error: "خطای شبکه" } });
          data = rows;
        } else if (/\/notifications\/[^/]+\/$/.test(path)) data = rows.find((row) => path.includes(`/${row.id}/`));
        return route.fulfill({ json: data });
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.clock.install();
      await page.goto(base + "/inbox", { waitUntil: "domcontentloaded" });
      await page.locator(".inbox-list > button").waitFor();
      const bell = page.locator(".topbar .notification-button"),
        drawer = page.locator(".notification-drawer.is-open");
      const badge = page.locator(".topbar .notification-badge");
      assert.equal(await badge.count(), 0);
      await bell.click();
      await drawer.getByRole("button", { name: "خوانده‌نشده", exact: true }).click();
      await drawer.getByText("اعلان خوانده‌نشده‌ای ندارید", { exact: true }).waitFor();
      checks.push({ width, theme, emptyUnreadHeader: true });

      rows.unshift({
        id: "task",
        entity_name: "workspace_task",
        sender: "crm:workspace_task",
        receiver: "user-1",
        read_at: null,
        created_at: "2026-10-14",
        data: {
          issue: { name: "پیگیری مشتری" },
          issue_activity: {
            field: "assignees",
            verb: "updated",
            old_value: "",
            new_value: "سارا",
            new_identifier: "user-1",
          },
        },
      });
      const callsBefore = listCalls;
      await page.clock.fastForward(16000);
      await drawer.getByText("واگذاری کار", { exact: true }).waitFor();
      assert(listCalls > callsBefore, "The header must poll for events without navigation");
      assert.equal(await badge.textContent(), "۱");
      assert.match(await drawer.locator(".notification-list > button").textContent(), /به شما واگذار کرد/);
      checks.push({ width, theme, periodicAssignmentRefreshAndBadge: true });

      rows.unshift({
        id: "login",
        entity_name: "account",
        sender: "crm:login",
        read_at: null,
        created_at: "2026-10-14",
        data: { crm_event: { kind: "login", browser: "کروم", device: "ویندوز" } },
      });
      await page.clock.fastForward(16000);
      await drawer.getByText("ورود تازه به حساب شما", { exact: true }).waitFor();
      assert.equal(await badge.textContent(), "۲");
      await drawer.locator(".notification-list > button").filter({ hasText: "ورود تازه به حساب شما" }).click();
      const modal = page.getByRole("dialog");
      await modal.getByText("ورود موفق به حساب شما با کروم در ویندوز ثبت شد.", { exact: true }).waitFor();
      assert.equal(
        await modal.getByRole("link", { name: "مشاهده حساب کاربری", exact: true }).getAttribute("href"),
        "/settings?section=profile"
      );
      await page.waitForFunction(() => document.querySelector(".topbar .notification-badge")?.textContent === "۱");
      await modal.locator("footer").getByRole("button", { name: "بستن", exact: true }).click();
      await modal.waitFor({ state: "hidden" });
      checks.push({ width, theme, loginDetailsAndReadSynchronization: true });

      failRead = true;
      await bell.click();
      await drawer.locator(".notification-list > button").click();
      await modal.getByRole("link", { name: "مشاهده کارهای من", exact: true }).waitFor();
      await page.getByText("خواندن اعلان انجام نشد", { exact: true }).waitFor();
      assert.equal(await badge.textContent(), "۱");
      await modal.locator("footer").getByRole("button", { name: "بستن", exact: true }).click();
      await modal.waitFor({ state: "hidden" });
      failRead = false;
      await bell.click();
      await drawer.locator(".notification-list > button").click();
      await modal.getByRole("link", { name: "مشاهده کارهای من", exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelectorAll(".topbar .notification-badge").length === 0);
      await modal.locator("footer").getByRole("button", { name: "بستن", exact: true }).click();
      await modal.waitFor({ state: "hidden" });
      checks.push({ width, theme, readFailurePreservesUnreadAndRetryWorks: true });

      failList = true;
      await bell.click();
      await page.clock.fastForward(2000);
      await drawer.getByRole("alert").waitFor();
      await drawer.getByRole("button", { name: "همه", exact: true }).click();
      assert.equal(await drawer.locator(".notification-list > button").count(), 3);
      failList = false;
      rows.unshift({
        id: "queued",
        entity_name: "issue",
        sender: "crm:routing:queued",
        read_at: null,
        created_at: "2026-10-14",
        data: { issue: { name: "درخواست پشتیبانی" }, crm_event: { kind: "queued" } },
      });
      await drawer.getByRole("button", { name: "تلاش دوباره", exact: true }).click();
      await drawer.getByText("کار جدید در صف نقش شما", { exact: true }).waitFor();
      assert.equal(await badge.textContent(), "۱");
      assert.equal(await drawer.getByRole("alert").count(), 0);
      checks.push({ width, theme, fetchFailureKeepsRowsAndRetryReceivesQueueEvent: true });

      failAll = true;
      await drawer.getByRole("button", { name: "خواندن همه", exact: true }).click();
      await page.getByText("خواندن اعلان‌ها انجام نشد", { exact: true }).waitFor();
      assert.equal(await badge.textContent(), "۱");
      failAll = false;
      await drawer.getByRole("button", { name: "خواندن همه", exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll(".topbar .notification-badge").length === 0);
      assert.equal(await page.locator('.main-nav a[href="/inbox"] b').count(), 0);
      assert.equal(await drawer.locator(".notification-list > button.unread").count(), 0);
      assert.equal(await drawer.evaluate((element) => element.scrollWidth > element.clientWidth + 1), false);
      await page.screenshot({ path: resolve(output, `header-${width}-${theme}.png`), fullPage: true });
      checks.push({ width, theme, readAllErrorRetryAndResponsiveLayout: true });
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, "report.json"), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, errors, output }));
} finally {
  await browser.close();
}
