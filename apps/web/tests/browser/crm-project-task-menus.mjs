// All API writes are intercepted; production data is never modified.
/* eslint-disable no-await-in-loop -- Each viewport and interaction depends on the previous page. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(
  pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE ?? ".cache/browser/node_modules/playwright/index.mjs")).href
);
const base = process.env.CRM_BROWSER_URL ?? "http://localhost:3000";
const output = resolve(process.env.CRM_BROWSER_OUTPUT ?? "tmp/project-task-menus-browser");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CRM_BROWSER_EXECUTABLE ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const member = (id, display_name, is_active = true) => ({ id, display_name, email: `${id}@example.com`, is_active });
const creator = member("creator", "سازنده پروژه");
const lead = member("lead", "مدیر پروژه");
const current = member("current", "مسئول فعلی");
const recipient = member("recipient", "عضو مقصد");
const inactive = member("inactive", "عضو غیرفعال", false);
const outsider = member("outsider", "عضو خارج پروژه");
const administrator = member("admin", "مدیر سامانه");
const team = [creator, lead, current, recipient, inactive];
const project = {
  id: "project",
  name: "پروژه آزمایشی",
  identifier: "PRJ",
  created_by: creator.id,
  project_lead: lead.id,
  members: team.map((row) => row.id),
};
const state = { id: "todo", name: "Todo", group: "unstarted" };
let actor = creator;
let assignee = current;
const task = () => ({
  id: "project-task",
  name: "کار آزمایشی پروژه",
  project_id: project.id,
  project_detail: project,
  sequence_id: 1,
  state_detail: state,
  assignee_details: [assignee],
  created_by: creator.id,
  was_assigned_to_me: true,
});
const patches = [];
let finishStatus;
let confirmStatus;
const statusStarted = new Promise((complete) => {
  confirmStatus = complete;
});
let statusRequests = 0;
const errors = [];
const checks = [];
const actors = [creator, lead, current, administrator, outsider].filter(
  (row) => !process.env.CRM_BROWSER_ACTORS || process.env.CRM_BROWSER_ACTORS.split(",").includes(row.id)
);
try {
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem("hamkar-workspace", "test"));
  await context.route(/\/(api|auth)\//, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let data = [];
    if (path === "/auth/get-csrf-token/") data = { csrf_token: "test-token" };
    else if (request.method() !== "GET") {
      assert.equal(request.method(), "PATCH");
      assert.equal(path, "/api/workspaces/test/projects/project/issues/project-task/");
      const body = request.postDataJSON();
      if (body.state_id) {
        assert.deepEqual(body, { state_id: "done" });
        statusRequests++;
        await new Promise((complete) => {
          finishStatus = complete;
          confirmStatus();
        });
        return route.fulfill({ status: 204 });
      }
      patches.push(body);
      assert.deepEqual(body, { assignee_ids: [recipient.id] });
      assignee = recipient;
      return route.fulfill({ status: 204 });
    } else if (path === "/api/users/me/") data = actor;
    else if (path.endsWith("/workspaces/")) data = [{ id: "workspace", slug: "test", name: "شرکت" }];
    else if (path.endsWith("/profile/")) data = { theme: { theme: "light" } };
    else if (path.endsWith("/access/me/"))
      data = {
        is_admin: actor.id === administrator.id,
        permissions: [
          "Project.View",
          "Issue.View",
          "Issue.Assign",
          "Issue.Status.Edit",
          ...(actor.id === administrator.id ? ["Issue.Edit", "Issue.Delete", "Issue.ViewAll"] : []),
        ],
        explanations: [],
      };
    // Ownership in detail views comes from useProject, independently of this collection.
    else if (path.endsWith("/projects/details/")) data = [];
    else if (path.endsWith("/projects/project/")) data = project;
    else if (path.endsWith("/projects/project/members/"))
      data = team.map((row) => ({ id: `project-${row.id}`, member: row.id, role: 15 }));
    else if (path.endsWith("/members/"))
      data = [...team, outsider, administrator].map((row) => ({
        id: `workspace-${row.id}`,
        member: row,
        is_active: row.is_active,
      }));
    else if (path.endsWith("/tasks/history/")) data = { project_issues: [task()], workspace_tasks: [] };
    else if (path.endsWith("/issues/")) data = [task()];
    else if (path.endsWith("/states/")) data = [state, { id: "done", name: "Done", group: "completed" }];
    return route.fulfill({ json: data });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  page.on("pageerror", (error) => errors.push(error.message));
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    for (actor of actors) {
      for (const tab of ["overview", "issues", "board"]) {
        console.log(`Checking ${width}/${actor.id}/${tab}`);
        assignee = current;
        await page.goto(`${base}/projects/project?tab=${tab}`, { waitUntil: "domcontentloaded" });
        const item = page.locator(tab === "board" ? ".kanban-card" : ".issue-row");
        await item.filter({ hasText: "کار آزمایشی پروژه" }).waitFor();
        const trigger = item.getByRole("button", { name: "عملیات کار", exact: true });
        if (actor.id === outsider.id) {
          assert.equal(await trigger.count(), 0);
          assert.equal(await item.locator(".kanban-transfer-control").count(), 0);
          checks.push(`${width}/${actor.id}/${tab}/denied`);
          continue;
        }
        if (tab === "board") {
          assert.equal(await trigger.count(), 0);
          const field = item.locator(".kanban-transfer-control input");
          await field.waitFor();
          assert.equal(await field.inputValue(), current.display_name);
          await field.fill("عضو");
          await page.getByRole("option", { name: /عضو مقصد/ }).waitFor();
          assert.equal(await page.getByRole("option", { name: /عضو خارج پروژه/ }).count(), 0);
          assert.equal(await page.getByRole("option", { name: /عضو غیرفعال/ }).getAttribute("aria-disabled"), "true");
          assert.equal(await page.locator(".kanban-card.dragging").count(), 0);
          if (actor.id === creator.id)
            await page.screenshot({ path: resolve(output, `project-board-${width}.png`), fullPage: true });
          const response = page.waitForResponse((entry) => entry.request().method() === "PATCH");
          await page.getByRole("option", { name: /عضو مقصد/ }).click();
          await response;
          await item.locator(".issue-people").filter({ hasText: recipient.display_name }).waitFor();
          checks.push(`${width}/${actor.id}/${tab}/inline-transferred`);
          continue;
        }
        const itemBounds = await item.boundingBox();
        const triggerBounds = await trigger.boundingBox();
        const titleBounds = await item.locator(".issue-main").boundingBox();
        assert(itemBounds && triggerBounds && titleBounds);
        assert(
          triggerBounds.x >= itemBounds.x && triggerBounds.x + triggerBounds.width <= titleBounds.x,
          "the three-dot button stays inside the left side of each task item"
        );
        assert.equal(await item.locator(".kanban-transfer-control, .issue-transfer-control").count(), 0);
        await trigger.click();
        const menu = page.locator(".issue-action-menu");
        await menu.waitFor();
        assert.equal(await page.locator(".kanban-card.dragging").count(), 0, "opening a card menu must not drag it");
        if ([creator.id, lead.id].includes(actor.id))
          assert.equal(await menu.getByText("تغییر وضعیت", { exact: true }).count(), 0);
        const input = menu.getByRole("combobox", { name: "انتقال به عضو دیگر", exact: true });
        assert.equal(await input.inputValue(), current.display_name);
        await input.fill("عضو");
        await page.getByRole("option", { name: /عضو مقصد/ }).waitFor();
        assert.equal(await page.getByRole("option", { name: /عضو خارج پروژه/ }).count(), 0);
        assert.equal(await page.getByRole("option", { name: /عضو غیرفعال/ }).getAttribute("aria-disabled"), "true");
        await page.waitForTimeout(150);
        const menuBounds = await menu.boundingBox();
        const optionBounds = await menu.getByRole("listbox").boundingBox();
        assert(menuBounds && optionBounds);
        assert(menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= width + 1);
        assert(menuBounds.y >= 0 && menuBounds.y + menuBounds.height <= 901);
        assert(
          optionBounds.x >= menuBounds.x && optionBounds.x + optionBounds.width <= menuBounds.x + menuBounds.width + 1
        );
        if (actor.id === creator.id && tab === "issues")
          await page.screenshot({ path: resolve(output, `project-tasks-${width}.png`), fullPage: true });
        await input.press("Escape");
        await page.keyboard.press("Escape");
        await menu.waitFor({ state: "hidden" });
        assert.equal(await trigger.evaluate((button) => button === document.activeElement), true);
        await trigger.click();
        await menu.getByRole("combobox", { name: "انتقال به عضو دیگر", exact: true }).fill("عضو مقصد");
        const response = page.waitForResponse((row) => row.request().method() === "PATCH");
        await page.getByRole("option", { name: /عضو مقصد/ }).click();
        await response;
        await menu.waitFor({ state: "hidden" });
        await item.locator(".issue-people").filter({ hasText: recipient.display_name }).waitFor();
        checks.push(`${width}/${actor.id}/${tab}/transferred`);
      }
    }
  }
  // My Work retains transfer access without status controls for ordinary assignees.
  actor = current;
  assignee = current;
  await page.goto(`${base}/my-work`, { waitUntil: "domcontentloaded" });
  await page.locator(".issue-row").getByRole("button", { name: "عملیات کار", exact: true }).waitFor();
  await page.getByRole("button", { name: "برد کانبان", exact: true }).click();
  await page.locator(".kanban-card").getByRole("button", { name: "عملیات کار", exact: true }).click();
  const menu = page.locator(".issue-action-menu");
  await menu.getByRole("combobox", { name: "انتقال به عضو دیگر", exact: true }).waitFor();
  assert.equal(await menu.getByText("تغییر وضعیت", { exact: true }).count(), 0);
  assert.equal(await page.locator('[aria-label^="افزودن کار به"]').count(), 0);
  await page.goto(`${base}/projects/project?tab=issues`, { waitUntil: "domcontentloaded" });
  const row = page.locator(".issue-row");
  await row.getByRole("button", { name: "عملیات کار", exact: true }).click();
  const statusResponse = page.waitForResponse((response) => response.request().postDataJSON()?.state_id === "done");
  await page.locator(".issue-action-menu").getByRole("button", { name: "انجام‌شده", exact: true }).click();
  await row.locator('.issue-status-control[aria-busy="true"]').waitFor();
  assert.equal(await row.locator(".issue-status-control input").isDisabled(), true);
  await statusStarted;
  await row.getByRole("button", { name: "عملیات کار", exact: true }).click();
  assert.equal(
    await page.locator(".issue-action-menu").getByRole("button", { name: "برای انجام", exact: true }).isDisabled(),
    true
  );
  assert.equal(statusRequests, 1);
  finishStatus();
  await statusResponse;
  await row.locator('.issue-status-control[aria-busy="false"]').waitFor();
  assert.deepEqual(errors, []);
  assert.equal(patches.length, actors.filter((candidate) => candidate.id !== outsider.id).length * 6);
  console.log(
    `PASS: ${checks.length} project view checks; scoped recipients, inactive users, permissions, desktop/mobile menu bounds, transfer payloads, no card dragging and My Work regression. All writes mocked.`
  );
} catch (error) {
  await browser
    .contexts()[0]
    ?.pages()[0]
    ?.screenshot({ path: resolve(output, "failure.png"), fullPage: true });
  console.error(errors);
  throw error;
} finally {
  finishStatus?.();
  await browser.close();
}
