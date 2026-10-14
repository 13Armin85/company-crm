// Synthetic API responses only; no existing tasks are changed.
/* eslint-disable no-await-in-loop -- Status transitions and permission checks depend on preceding interactions. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(resolve(".cache/browser/node_modules/playwright/index.mjs")).href);
const base = process.env.CRM_BROWSER_URL ?? "http://localhost:3000";
const output = resolve(process.env.CRM_BROWSER_OUTPUT ?? ".cache/browser/docker-list-status");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const checks = [],
  errors = [];
const transitions = [
  ["در حال انجام", "in_progress", "started"],
  ["بازبینی", "review", "review"],
  ["انجام‌شده", "done", "completed"],
  ["مسدود", "blocked", "cancelled"],
  ["برای انجام", "todo", "unstarted"],
];
try {
  for (const width of [320, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    context.setDefaultTimeout(60000);
    context.setDefaultNavigationTimeout(120000);
    await context.addInitScript(() => localStorage.setItem("hamkar-workspace", "list-status-test"));
    const user = { id: "user-1", display_name: "سارا رضایی", user_timezone: "Asia/Tehran" };
    const task = { id: "task-1", name: "کار خارج از پروژه", status: "todo", sequence_id: 1, assignee_id: user.id };
    const issue = { id: "issue-1", name: "کار پروژه", state: "unstarted", sequence_id: 1, assignee_ids: [user.id] };
    const states = [
      { id: "unstarted", name: "Todo", group: "unstarted" },
      { id: "started", name: "In Progress", group: "started" },
      { id: "review", name: "Review", group: "started" },
      { id: "completed", name: "Done", group: "completed" },
      { id: "cancelled", name: "Blocked", group: "cancelled" },
    ];
    let failUpdate = false,
      canEditStatus = true;
    const writes = [];
    await context.route(/\/(api|auth)\//, async (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname;
      if (request.method() !== "GET") {
        assert.equal(request.method(), "PATCH");
        const payload = request.postDataJSON();
        if (failUpdate) return route.fulfill({ status: 500, json: { error: "تغییر وضعیت ذخیره نشد" } });
        if (path.endsWith("/tasks/task-1/")) {
          task.status = payload.status;
          writes.push({ scope: "workspace", status: payload.status });
        } else if (path.endsWith("/issues/issue-1/")) {
          issue.state = payload.state_id;
          writes.push({ scope: "project", state: payload.state_id });
        } else assert.fail("Unexpected mutation");
        return route.fulfill({ json: {} });
      }
      let data = [];
      if (path === "/api/users/me/") data = user;
      else if (path.endsWith("/profile/")) data = { theme: { theme: "light" } };
      else if (path.endsWith("/workspaces/"))
        data = [{ id: "workspace-1", slug: "list-status-test", name: "شرکت آزمایشی" }];
      else if (path.endsWith("/access/me/"))
        data = {
          permissions: ["Issue.View", "Issue.ViewAll", "Project.View", ...(canEditStatus ? ["Issue.Status.Edit"] : [])],
          explanations: [],
          role_grants: [],
        };
      else if (path.endsWith("/projects/details/"))
        data = [{ id: "project-1", name: "پروژه آزمایشی", identifier: "CRM", members: [user.id] }];
      else if (path.endsWith("/projects/project-1/"))
        data = { id: "project-1", name: "پروژه آزمایشی", identifier: "CRM", members: [user.id] };
      else if (path.endsWith("/members/"))
        data = path.includes("/projects/")
          ? [{ id: "project-member", member: user.id }]
          : [{ id: "member-1", member: user }];
      else if (path.endsWith("/states/")) data = states;
      else if (path.endsWith("/issues/")) data = [issue];
      else if (path.endsWith("/tasks/")) data = [task];
      return route.fulfill({ json: data });
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base + "/issues", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelectorAll(".issue-row").length === 2);
    for (const [name, scope] of [
      [task.name, "workspace"],
      [issue.name, "project"],
    ]) {
      const row = page.locator(".issue-row").filter({ has: page.getByText(name, { exact: true }) });
      const input = row.getByRole("combobox", { name: `تغییر وضعیت ${name}`, exact: true });
      for (const [label, raw, stateId] of transitions) {
        await row.getByRole("button", { name: `باز کردن تغییر وضعیت ${name}`, exact: true }).click();
        for (const option of await page.getByRole("option").all()) {
          const singleLine = await option.evaluate((element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
            return getComputedStyle(element).whiteSpace === "nowrap" && lines.size <= 1;
          });
          assert.equal(singleLine, true, "Every status option must remain on one line");
        }
        await page.getByRole("option", { name: label, exact: true }).click();
        await input.waitFor({ state: "visible" });
        await page.waitForFunction(
          ({ title, value }) => document.querySelector(`input[aria-label="تغییر وضعیت ${title}"]`)?.value === value,
          { title: name, value: label }
        );
        await page.waitForFunction(
          ({ title }) => document.querySelector(`input[aria-label="تغییر وضعیت ${title}"]`)?.disabled === false,
          { title: name }
        );
        assert.deepEqual(writes.at(-1), scope === "workspace" ? { scope, status: raw } : { scope, state: stateId });
        await page.getByText("تغییرات با موفقیت انجام شد", { exact: true }).first().waitFor();
      }
      checks.push({ width, scope, allStatusTransitionsFromList: true });
    }
    failUpdate = true;
    const taskRow = page.locator(".issue-row").filter({ has: page.getByText(task.name, { exact: true }) });
    await taskRow.getByRole("button", { name: `باز کردن تغییر وضعیت ${task.name}`, exact: true }).click();
    await page.getByRole("option", { name: "بازبینی", exact: true }).click();
    await page.getByText("تغییر وضعیت ذخیره نشد", { exact: true }).waitFor();
    await page.waitForFunction(
      () => document.querySelector('input[aria-label="تغییر وضعیت کار خارج از پروژه"]')?.value === "برای انجام"
    );
    assert.equal(task.status, "todo");
    checks.push({ width, failedSaveRollsBackStatus: true });
    failUpdate = false;
    await page.goto(base + "/my-work", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /^پیش‌رو/ }).click();
    await page.getByRole("combobox", { name: `تغییر وضعیت ${task.name}`, exact: true }).waitFor();
    await page.goto(base + "/projects/project-1?tab=issues", { waitUntil: "domcontentloaded" });
    await page.getByRole("combobox", { name: `تغییر وضعیت ${issue.name}`, exact: true }).waitFor();
    checks.push({ width, personalAndProjectListsHaveStatusControl: true });
    canEditStatus = false;
    await page.goto(base + "/issues", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelectorAll(".issue-row").length === 2);
    assert.equal(await page.locator(".issue-status-control").count(), 0);
    assert.equal(await page.locator(".issue-check:disabled").count(), 2);
    checks.push({ width, missingPermissionKeepsStatusesReadOnly: true });
    await page.screenshot({ path: resolve(output, `list-${width}.png`), fullPage: true });
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, "report.json"), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, errors }));
} finally {
  await browser.close();
}
