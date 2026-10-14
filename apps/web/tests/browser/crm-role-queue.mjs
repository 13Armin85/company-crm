// All requests use synthetic fixtures; existing tasks and queue entries are never changed.
/* eslint-disable no-await-in-loop -- Each interaction depends on the preceding queue state. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(resolve(".cache/browser/node_modules/playwright/index.mjs")).href);
const base = process.env.CRM_BROWSER_URL ?? "http://localhost:3000";
const output = resolve(process.env.CRM_BROWSER_OUTPUT ?? ".cache/browser/docker-role-queue");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const checks = [],
  errors = [];
try {
  for (const theme of ["light", "dark"]) {
    for (const width of [320, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      context.setDefaultTimeout(60000);
      context.setDefaultNavigationTimeout(120000);
      await context.addInitScript(() => localStorage.setItem("hamkar-workspace", "role-queue-test"));
      const now = Date.now();
      const makeEntry = (id, issueName, role, project, age) => ({
        id,
        issue_id: `issue-${id}`,
        issue_name: issueName,
        required_role_id: `role-${role}`,
        role_name: role === 1 ? "کارشناس پشتیبانی" : "حسابدار",
        project_id: `project-${project}`,
        project_name: project === 1 ? "ارتباط با مشتری" : "مدیریت فروش",
        rule_id: "rule-1",
        rule_name: "مسیر خدمات مشتریان",
        status: "open",
        ...(age === undefined ? {} : { created_at: new Date(now - age).toISOString() }),
      });
      let queue = [
        makeEntry("queue-1", "پيگيري درخواست کاربر ۱۲", 1, 1, 3 * 86400000),
        makeEntry("queue-2", "بررسی فاکتور", 2, 2, 3600000),
        makeEntry(
          "queue-3",
          "پاسخ به درخواست پشتیبانی مشتری درباره اتصال حساب و دریافت گزارش فروش ماهانه",
          1,
          2,
          86400000
        ),
        makeEntry("queue-4", "کار بدون تاریخ", 1, 1, undefined),
        { ...makeEntry("closed", "کار بسته‌شده", 1, 1, 1000), status: "closed" },
      ];
      let releaseClaim;
      const claimGate = new Promise((complete) => {
        releaseClaim = complete;
      });
      let claimStarted;
      const startedGate = new Promise((complete) => {
        claimStarted = complete;
      });
      let canClaim = true,
        canManage = false,
        fetchFailure = false,
        claimMode = "success";
      const writes = [];
      await context.route(/\/(api|auth)\//, async (route) => {
        const request = route.request(),
          path = new URL(request.url()).pathname;
        if (request.method() !== "GET") {
          assert.equal(request.method(), "POST");
          assert.match(path, /\/role-queue\/[^/]+\/claim\/$/);
          const id = path.split("/").at(-3);
          writes.push(id);
          if (claimMode === "hold") {
            claimStarted();
            await claimGate;
          }
          if (claimMode === "failure") return route.fulfill({ status: 500, json: { error: "دریافت کار انجام نشد" } });
          queue = queue.filter((entry) => entry.id !== id);
          if (claimMode === "conflict")
            return route.fulfill({ status: 409, json: { error: "این کار قبلاً دریافت شده است" } });
          return route.fulfill({ json: { id, status: "claimed" } });
        }
        let data = [];
        if (path === "/api/users/me/")
          data = { id: "user-1", display_name: "سارا رضایی", user_timezone: "Asia/Tehran" };
        else if (path.endsWith("/profile/")) data = { theme: { theme } };
        else if (path.endsWith("/workspaces/"))
          data = [{ id: "workspace-1", slug: "role-queue-test", name: "شرکت آزمایشی" }];
        else if (path.endsWith("/access/me/"))
          data = {
            permissions: [
              "Routing.Queue.View",
              "Routing.Queue.ViewAll",
              "Project.View",
              ...(canClaim ? ["Routing.Queue.Claim"] : []),
              ...(canManage ? ["Routing.Manage", "Routing.View"] : []),
            ],
            explanations: [],
            role_grants: [],
          };
        else if (path.endsWith("/role-queue/")) {
          if (fetchFailure) return route.fulfill({ status: 503, json: { error: "موقتاً در دسترس نیست" } });
          data = queue;
        } else if (path.endsWith("/get-csrf-token/")) data = { csrf_token: "synthetic-csrf" };
        return route.fulfill({ json: data });
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      const record = (label) => checks.push({ theme, width, label });
      const cards = page.locator(".role-queue-card");
      const waitCount = (count) =>
        page.waitForFunction((expected) => document.querySelectorAll(".role-queue-card").length === expected, count);
      const choose = async (label, option) => {
        await page.getByRole("button", { name: `باز کردن ${label}`, exact: true }).click();
        await page.getByRole("option", { name: option, exact: true }).click();
      };
      await page.goto(`${base}/routing`, { waitUntil: "domcontentloaded" });
      await waitCount(4);
      const layout = await page.evaluate(() => {
        const gridStyle = window.getComputedStyle(document.querySelector(".role-queue-grid"));
        const queueStyle = window.getComputedStyle(document.querySelector(".role-queue"));
        return {
          grid: gridStyle.display,
          columns: gridStyle.gridTemplateColumns.split(" ").length,
          radius: queueStyle.borderRadius,
        };
      });
      assert.equal(layout.grid, "grid");
      assert.equal(layout.columns, width === 320 ? 1 : 2);
      assert.equal(layout.radius, width === 320 ? "12px" : "16px");
      record("Queue styles are loaded, with one mobile column and two desktop columns");
      assert.equal(await page.getByRole("heading", { name: "صف کارهای نقش‌ها", exact: true }).count(), 1);
      assert.equal(await cards.first().locator("h3").textContent(), "پيگيري درخواست کاربر ۱۲");
      assert.equal(await page.getByText("کار بسته‌شده", { exact: true }).count(), 0);
      assert.match(await page.locator(".role-queue-summary").textContent(), /۴.*کار.*۲.*نقش.*۳ روز/);
      assert.equal(await cards.first().locator("time").count(), 1);
      record("Persian cards, roles, project, date, counts and oldest-first ordering");
      await page.getByRole("searchbox", { name: "جست‌وجو در صف کارها" }).fill("پیگیری درخواست کاربر 12");
      await waitCount(1);
      record("Persian search normalizes Arabic letters and digits");
      await page.getByRole("searchbox").fill("");
      await choose("فیلتر نقش صف", "کارشناس پشتیبانی");
      await waitCount(3);
      await choose("فیلتر پروژه صف", "مدیریت فروش");
      await waitCount(1);
      assert.match(await cards.first().textContent(), /پاسخ به درخواست پشتیبانی/);
      record("Role and project filters combine");
      await page.locator(".role-queue-results").getByRole("button", { name: "نمایش همه کارها" }).click();
      await waitCount(4);
      await page.getByLabel("ترتیب نمایش", { exact: true }).selectOption("newest");
      assert.equal(await cards.first().locator("h3").textContent(), "بررسی فاکتور");
      assert.equal(await cards.last().locator("h3").textContent(), "کار بدون تاریخ");
      record("Newest-first ordering leaves undated work last");
      await page.getByRole("searchbox").fill("عبارتی که وجود ندارد");
      await page.getByRole("heading", { name: "کاری با این مشخصات پیدا نشد" }).waitFor();
      await page.locator(".role-queue .empty-state").getByRole("button", { name: "نمایش همه کارها" }).click();
      await waitCount(4);
      record("Filtered empty state resets search and both filters");
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: resolve(output, `${theme}-${width}.png`), fullPage: true });
      record("Responsive layout fits viewport, including long task titles");

      claimMode = "hold";
      await page.getByRole("button", { name: "پذیرش کار بررسی فاکتور", exact: true }).click();
      await page.getByText("در حال دریافت…", { exact: true }).waitFor();
      assert.equal(await page.locator('.role-queue-card[aria-busy="true"]').count(), 1);
      assert.equal(await page.locator(".role-queue-card button:disabled").count(), 4);
      await startedGate;
      assert.equal(writes.length, 1);
      claimMode = "success";
      releaseClaim();
      await waitCount(3);
      assert.equal(await page.getByRole("heading", { name: "بررسی فاکتور", exact: true }).count(), 0);
      record("Single pending claim prevents duplicates and successful claim removes its card");
      claimMode = "failure";
      const claimName = "پذیرش کار پيگيري درخواست کاربر ۱۲";
      await page.getByRole("button", { name: claimName, exact: true }).click();
      await page.locator(".role-queue-claim-error").waitFor();
      assert.equal(await cards.count(), 3);
      assert.equal(await page.getByRole("button", { name: claimName, exact: true }).isEnabled(), true);
      claimMode = "success";
      await page.getByRole("button", { name: claimName, exact: true }).click();
      await waitCount(2);
      record("Failed claims retain the card and can be retried successfully");
      claimMode = "conflict";
      await page.getByRole("button", { name: "پذیرش کار کار بدون تاریخ", exact: true }).click();
      await waitCount(1);
      record("Concurrent claim conflict refreshes stale queue entries");
      canClaim = false;
      canManage = true;
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitCount(1);
      assert.equal(await page.locator(".role-queue-card button").count(), 0);
      await page.getByRole("heading", { name: "قانون‌های ارجاع", exact: true }).waitFor();
      assert(
        await page.evaluate(
          () =>
            document
              .querySelector(".role-queue")
              .compareDocumentPosition(document.querySelectorAll(".management-section")[1]) &
            Node.DOCUMENT_POSITION_FOLLOWING
        )
      );
      record("Queue precedes management rules and viewers cannot claim");
      fetchFailure = true;
      await page.getByRole("button", { name: "به‌روزرسانی صف کارها", exact: true }).click();
      await page.locator(".role-queue-error").waitFor();
      assert.equal(await cards.count(), 1);
      assert.match(await page.locator(".role-queue-error").textContent(), /اطلاعات قبلی/);
      record("Refresh failures keep cached cards visible");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator(".role-queue-error").waitFor();
      assert.equal(await page.getByRole("heading", { name: "کاری در انتظار پذیرش نیست" }).count(), 0);
      assert.equal(await page.locator(".role-queue-summary").count(), 0);
      fetchFailure = false;
      queue = [];
      await page.locator(".role-queue-error").getByRole("button", { name: "تلاش دوباره", exact: true }).click();
      await page.getByRole("heading", { name: "کاری در انتظار پذیرش نیست" }).waitFor();
      record("Initial fetch failures are distinct from empty queues and retry recovers");
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, "report.json"), JSON.stringify({ passed: true, checks, errors }, null, 2));
  console.log(`Role queue: ${checks.length} browser checks passed across 320/1440px and light/dark themes.`);
} finally {
  await browser.close();
}
