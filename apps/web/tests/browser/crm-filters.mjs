// Synthetic API responses isolate these checks from the user's records.
/* eslint-disable no-await-in-loop -- Each browser scenario depends on its preceding interactions; contexts run sequentially to limit memory. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(resolve(".cache/browser/node_modules/playwright/index.mjs")).href);
const base = process.env.CRM_BROWSER_URL ?? "http://localhost:3000";
const output = resolve(process.env.CRM_BROWSER_OUTPUT ?? ".cache/browser/docker-filters");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const checks = [];
const errors = [];
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tehran",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const offsetDate = (days) => new Date(Date.parse(today + "T12:00:00Z") + days * 86400000).toISOString().slice(0, 10);
const sara = { id: "sara", display_name: "سارا رضایی", email: "sara@example.com" };
const ali = { id: "ali", display_name: "علی محمدی", email: "ali@example.com" };
const projects = [
  {
    id: "sales",
    name: "پروژه فروش",
    identifier: "SALES",
    members: [sara.id],
    project_lead: sara.id,
    target_date: today,
  },
  {
    id: "support",
    name: "پروژه پشتیبانی",
    identifier: "HELP",
    members: [ali.id],
    project_lead: ali.id,
    target_date: offsetDate(1),
  },
  { id: "complete", name: "پروژه تحویل", identifier: "DONE", members: [sara.id], target_date: offsetDate(-1) },
  {
    id: "archive",
    name: "پروژه بایگانی",
    identifier: "ARCH",
    members: [sara.id],
    project_lead: sara.id,
    archived_at: today,
  },
];
const states = [
  { id: "todo", group: "unstarted", name: "برای انجام" },
  { id: "done", group: "completed", name: "انجام‌شده" },
  { id: "blocked", group: "cancelled", name: "مسدود" },
];
const issues = {
  sales: [
    {
      id: "sale-1",
      name: "پیگیری مشتری فوری",
      state: "todo",
      priority: "urgent",
      assignees: [sara],
      target_date: today,
    },
    {
      id: "sale-2",
      name: "قرارداد تکمیل‌شده",
      state: "done",
      priority: "high",
      assignees: [ali],
      target_date: offsetDate(-1),
    },
  ],
  support: [
    {
      id: "help-1",
      name: "پاسخ پشتیبانی",
      state: "todo",
      priority: "low",
      assignees: [ali],
      target_date: offsetDate(1),
    },
    {
      id: "help-2",
      name: "کار مسدود بدون مسئول",
      state: "blocked",
      priority: "high",
      assignees: [],
      target_date: offsetDate(-1),
    },
  ],
  complete: [{ id: "done-1", name: "تحویل نهایی", state: "done", priority: "medium", target_date: offsetDate(-1) }],
  archive: [
    { id: "arch-1", name: "کار بایگانی", state: "todo", priority: "urgent", assignees: [sara], target_date: today },
  ],
};
const selectMultiple = async (dialog, label, title) => {
  const field = dialog.getByRole("group", { name: new RegExp(`^${label} ·`) });
  await field.getByRole("button", { name: new RegExp(`^انتخاب ${label} ·`) }).click();
  await field.getByRole("checkbox", { name: title }).check();
  await field.getByRole("button", { name: new RegExp(`^انتخاب ${label} ·`) }).click();
};
const selectDeadline = async (page, dialog, title) => {
  await dialog.getByRole("button", { name: "باز کردن وضعیت موعد", exact: true }).click();
  await page.getByRole("option", { name: title, exact: true }).click();
};
const reset = async (page) => {
  await page.locator("main .filter-button").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "بازنشانی انتخاب‌ها", exact: true }).click();
  await dialog.getByRole("button", { name: "اعمال فیلتر", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
};
const checkDialogLayout = async (page, width, theme, name) => {
  const dialog = page.getByRole("dialog");
  assert.equal(
    await dialog.locator(".data-filter-dialog").evaluate((element) => element.scrollWidth > element.clientWidth + 1),
    false
  );
  const apply = dialog.getByRole("button", { name: "اعمال فیلتر", exact: true });
  const rect = await apply.boundingBox();
  assert(rect && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width + 1 && rect.y + rect.height <= 900);
  await page.screenshot({ path: resolve(output, `${name}-${width}-${theme}.png`), fullPage: true });
};

try {
  for (const width of [320, 1440]) {
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      context.setDefaultTimeout(60000);
      context.setDefaultNavigationTimeout(120000);
      await context.addInitScript(() => localStorage.setItem("hamkar-workspace", "filters-test"));
      await context.route(/\/(api|auth)\//, async (route) => {
        const request = route.request();
        assert.equal(request.method(), "GET", "Filtering must not write records");
        const path = new URL(request.url()).pathname;
        let data = [];
        if (path === "/api/users/me/") data = { ...sara, user_timezone: "Asia/Tehran" };
        else if (path.endsWith("/profile/")) data = { theme: { theme } };
        else if (path.endsWith("/workspaces/"))
          data = [{ id: "workspace-1", slug: "filters-test", name: "شرکت آزمایشی" }];
        else if (path.endsWith("/access/me/"))
          data = {
            permissions: ["Issue.View", "Issue.ViewAll", "Issue.Create", "Project.View", "Project.Create"],
            explanations: [],
            role_grants: [],
          };
        else if (path.endsWith("/projects/details/")) data = projects;
        else if (path.endsWith("/members/"))
          data = [sara, ali].map((member) => ({ id: `${member.id}-membership`, member, role: 15 }));
        else if (path.endsWith("/states/")) data = states;
        else if (path.endsWith("/issues/")) {
          const projectId = path.match(/\/projects\/([^/]+)\/issues\//)[1];
          data = issues[projectId].map((issue, index) => Object.assign({}, issue, { sequence_id: index + 1 }));
        } else if (path.endsWith("/tasks/"))
          data = [
            { id: "workspace-1", name: "کار مستقل بدون موعد", status: "todo", priority: "urgent", sequence_id: 1 },
          ];
        return route.fulfill({ json: data });
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(base + "/issues", { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.querySelectorAll(".issue-row").length === 7);
      assert.equal(await page.getByRole("button", { name: /پاک.*فیلتر/ }).count(), 0);
      await page.locator("main .filter-button").click();
      const dialog = page.getByRole("dialog");
      await selectMultiple(dialog, "وضعیت", "برای انجام");
      await selectMultiple(dialog, "اولویت", "فوری");
      await selectMultiple(dialog, "پروژه", /پروژه فروش/);
      // Member search works with Arabic letters as well as Persian letters.
      const responsible = dialog.getByRole("group", { name: /^مسئول ·/ });
      await responsible.getByRole("button", { name: /^انتخاب مسئول ·/ }).click();
      await responsible.getByRole("searchbox").fill("رضايي");
      assert.equal(await responsible.getByRole("checkbox").count(), 1);
      await responsible.getByRole("checkbox", { name: /سارا رضایی/ }).check();
      await responsible.getByRole("button", { name: /^انتخاب مسئول ·/ }).click();
      await selectDeadline(page, dialog, "موعد امروز");
      assert.equal(await dialog.locator("footer [role=status]").textContent(), "۱ کار مطابق انتخاب‌ها");
      assert.equal(await page.locator(".issue-row").count(), 7);
      await checkDialogLayout(page, width, theme, "issue-filters");
      await dialog.getByRole("button", { name: "اعمال فیلتر", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      assert.equal(await page.locator(".issue-row").count(), 1);
      assert.match(await page.locator(".issue-row").textContent(), /پیگیری مشتری فوری/);
      assert.equal(await page.locator("main .filter-button > span").textContent(), "۵");
      checks.push({ width, theme, combinedIssueFiltersAndPreview: true });

      await page.locator("main .filter-button").click();
      await dialog.getByRole("button", { name: "بازنشانی انتخاب‌ها", exact: true }).click();
      assert.equal(await dialog.locator("footer [role=status]").textContent(), "۷ کار مطابق انتخاب‌ها");
      await dialog.getByRole("button", { name: "انصراف", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      assert.equal(await page.locator(".issue-row").count(), 1);
      await page.getByRole("button", { name: "برد کانبان", exact: true }).click();
      assert.equal(await page.locator(".kanban-card").count(), 1);
      await page.locator("main .filter-button").click();
      // Escape discards the draft and restores focus to the filter button.
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      assert.equal(
        await page.locator("main .filter-button").evaluate((element) => element === document.activeElement),
        true
      );
      await reset(page);
      assert.equal(await page.locator(".kanban-card").count(), 7);
      checks.push({ width, theme, cancelEscapeResetAndBoardPersistence: true });

      await page.locator("main .filter-button").click();
      await selectMultiple(dialog, "پروژه", "خارج از پروژه");
      await selectMultiple(dialog, "مسئول", "بدون مسئول");
      await selectDeadline(page, dialog, "بدون موعد");
      assert.equal(await dialog.getByRole("button", { name: "موعد از تاریخ", exact: true }).isDisabled(), true);
      await dialog.getByRole("button", { name: "اعمال فیلتر", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      assert.equal(await page.locator(".kanban-card").count(), 1);
      assert.match(await page.locator(".kanban-card").textContent(), /کار مستقل بدون موعد/);
      checks.push({ width, theme, workspaceUnassignedAndNoDeadline: true });

      await page.goto(base + "/projects", { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.querySelectorAll(".page-projects .project-card").length === 3);
      await page.getByRole("button", { name: "فعال", exact: true }).click();
      assert.equal(await page.locator(".page-projects .project-card").count(), 2);
      await page.locator("main .filter-button").click();
      await selectMultiple(dialog, "اعضای پروژه", /سارا رضایی/);
      await selectMultiple(dialog, "مدیر پروژه", /سارا رضایی/);
      await dialog.getByLabel("حداقل پیشرفت (درصد)", { exact: true }).fill("50");
      await dialog.getByLabel("حداکثر پیشرفت (درصد)", { exact: true }).fill("50");
      for (const label of ["موعد از تاریخ", "موعد تا تاریخ"]) {
        await dialog.getByRole("button", { name: label, exact: true }).click();
        await page.locator(".persian-calendar").getByRole("button", { name: "امروز", exact: true }).click();
      }
      assert.equal(await dialog.locator("footer [role=status]").textContent(), "۱ پروژه مطابق انتخاب‌ها");
      await checkDialogLayout(page, width, theme, "project-filters");
      await dialog.getByRole("button", { name: "اعمال فیلتر", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      assert.equal(await page.locator(".page-projects .project-card").count(), 1);
      assert.match(await page.locator(".page-projects .project-card").textContent(), /پروژه فروش/);
      await page.getByRole("button", { name: "نمای لیست پروژه‌ها", exact: true }).click();
      assert.equal(await page.locator(".project-table tbody tr").count(), 1);
      checks.push({ width, theme, projectMemberLeadProgressDatesAndViews: true });

      await page.locator("main .filter-button").click();
      await dialog.getByLabel("حداقل پیشرفت (درصد)", { exact: true }).fill("80");
      assert.equal(await dialog.getByRole("button", { name: "اعمال فیلتر", exact: true }).isDisabled(), true);
      assert.match(await dialog.getByRole("alert").textContent(), /حداقل پیشرفت/);
      await dialog.getByRole("button", { name: "انصراف", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      assert.equal(await page.locator(".project-table tbody tr").count(), 1);
      await page.getByRole("button", { name: "تکمیل‌شده", exact: true }).click();
      await page.getByText("پروژه‌ای پیدا نشد", { exact: true }).waitFor();
      await reset(page);
      assert.equal(await page.locator(".filter-tabs .active").textContent(), "تکمیل‌شده");
      assert.equal(await page.locator(".project-table tbody tr").count(), 1);
      assert.match(await page.locator(".project-table tbody tr").textContent(), /پروژه تحویل/);
      checks.push({ width, theme, invalidProgressCancelAndResetPreserveTab: true });

      await page.getByRole("button", { name: "بایگانی‌شده", exact: true }).click();
      await page.getByPlaceholder("جستجوی پروژه...").fill("بایگانی");
      await page.locator("main .filter-button").click();
      await selectMultiple(dialog, "مدیر پروژه", /علی محمدی/);
      assert.equal(await dialog.locator("footer [role=status]").textContent(), "۰ پروژه مطابق انتخاب‌ها");
      await dialog.getByRole("button", { name: "اعمال فیلتر", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await page.getByText("پروژه‌ای پیدا نشد", { exact: true }).waitFor();
      await reset(page);
      assert.equal(await page.locator(".filter-tabs .active").textContent(), "بایگانی‌شده");
      assert.equal(await page.getByPlaceholder("جستجوی پروژه...").inputValue(), "بایگانی");
      assert.equal(await page.locator(".project-table tbody tr").count(), 1);
      checks.push({ width, theme, emptyResultsAndResetPreserveSearchAndArchivedTab: true });
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, "report.json"), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, errors, output }));
} finally {
  await browser.close();
}
