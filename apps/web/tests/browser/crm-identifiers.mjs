/* eslint-disable no-await-in-loop -- Browser steps depend on the preceding interaction and viewport. */
// Browser checks use synthetic records and never write to the user's API.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(resolve(".cache/browser/node_modules/playwright/index.mjs")).href);
const base = process.env.CRM_BROWSER_URL ?? "http://localhost:3000";
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const id = "0231611b-04f3-4d58-beb6-ffb09951d9af";
const projectId = "0791611b-04f3-4d58-beb6-ffb09951d9af";
const taskId = "0851611b-04f3-4d58-beb6-ffb09951d9af";
const roleId = "0971611b-04f3-4d58-beb6-ffb09951d9af";
const unitId = "1131611b-04f3-4d58-beb6-ffb09951d9af";
const member = { id, display_name: "کاربر آزمایشی", email: "identifier@example.com" };
const project = { id: projectId, name: "پروژه آزمایشی", identifier: "PRJ000001" };
const roles = [{ id: roleId, name: "نقش آزمایشی", description: "", is_active: true, permission_ids: [] }];
const units = [
  { id: "root-unit", title: "واحد والد", is_active: true, member_ids: [] },
  { id: unitId, title: "واحد زیرمجموعه", parent_id: "root-unit", is_active: true, member_ids: [] },
];
const permissions = [
  "User.View",
  "Role.View",
  "OrganizationUnit.View",
  "Issue.View",
  "Issue.ViewAll",
  "Issue.Create",
  "Project.View",
  "Project.Create",
  "Project.Edit",
];
const errors = [];
let createdPayload;

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  context.setDefaultTimeout(60000);
  context.setDefaultNavigationTimeout(120000);
  await context.addInitScript(() => {
    localStorage.setItem("hamkar-workspace", "identifier-test");
    const copy = document.execCommand.bind(document);
    document.execCommand = (command, ...args) => {
      if (command === "copy") globalThis.__copiedIdentifier = document.activeElement?.value;
      return copy(command, ...args);
    };
  });
  await context.route(/\/(api|auth)\//, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let data = [];
    let status = 200;
    if (request.method() === "POST") {
      assert(path.endsWith("/projects/"), "Only the mocked project create may write");
      createdPayload = request.postDataJSON();
      data = { ...project, name: createdPayload.name };
      status = 201;
    } else {
      assert.equal(request.method(), "GET");
      if (path === "/api/users/me/") data = member;
      else if (path.endsWith("/get-csrf-token/")) data = { csrf_token: "synthetic-token" };
      else if (path.endsWith("/profile/")) data = { theme: { theme: "light" } };
      else if (path.endsWith("/workspaces/"))
        data = [{ id: "workspace", slug: "identifier-test", name: "شرکت آزمایشی" }];
      else if (path.endsWith("/access/me/")) data = { permissions, explanations: [], role_grants: [] };
      else if (path.endsWith("/projects/details/") || path.endsWith("/projects/")) data = [project];
      else if (path.endsWith(`/projects/${projectId}/`)) data = project;
      else if (path.endsWith("/members/")) data = [{ id: "membership", member, role: 20 }];
      else if (path.endsWith("/organization/roles/")) data = roles;
      else if (path.endsWith("/organization/units/")) data = units;
      else if (path.endsWith("/tasks/"))
        data = [
          {
            id: taskId,
            name: "کار خارج از پروژه",
            sequence_id: 12,
            assignee_id: id,
            assignee_detail: member,
            status: "todo",
            priority: "medium",
          },
        ];
    }
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(`${base}/projects`);
  const projectCopy = page.getByRole("button", { name: "کپی شناسه پروژه: PRJ000001", exact: true }).first();
  await projectCopy.click();
  assert.equal(
    await page.evaluate(() =>
      navigator.clipboard?.readText ? navigator.clipboard.readText() : globalThis.__copiedIdentifier
    ),
    "PRJ000001"
  );
  await page.getByText("شناسه کپی شد.", { exact: true }).first().waitFor();
  assert.equal(new URL(page.url()).pathname, "/projects", "Copy must not navigate");

  await page.getByRole("button", { name: "ایجاد", exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal.getByRole("button", { name: "پروژه", exact: true }).click();
  assert.equal(await modal.locator('input[dir="ltr"]').count(), 0, "Project identifiers are generated on the server");
  await modal.locator("input").first().fill("پروژه خودکار");
  await Promise.all([
    page.waitForResponse(
      (response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/projects/")
    ),
    modal.getByRole("button", { name: "ایجاد پروژه", exact: true }).click(),
  ]);
  await modal.waitFor({ state: "hidden" });
  assert.equal(createdPayload.name, "پروژه خودکار");
  assert.equal("identifier" in createdPayload, false);
  assert.equal("id" in createdPayload, false);

  await page.goto(`${base}/team`);
  await page.locator("main .search-box input").fill(id.toUpperCase());
  await page.getByRole("button", { name: `کپی شناسه کاربر: ${id}`, exact: true }).click();
  assert.equal(
    await page.evaluate(() =>
      navigator.clipboard?.readText ? navigator.clipboard.readText() : globalThis.__copiedIdentifier
    ),
    id
  );
  await page.getByText("شناسه کپی شد.", { exact: true }).first().waitFor();

  await page.goto(`${base}/organization`);
  await page.locator("main .search-box input").fill(unitId);
  await page.getByRole("button", { name: `کپی شناسه واحد: ${unitId}`, exact: true }).waitFor();
  assert.equal(await page.locator("main .org-node").count(), 2, "Search keeps the ancestor of the matched unit");

  await page.goto(`${base}/issues`);
  await page.locator("main .search-box input").fill("team - ۱۲");
  await page.getByRole("button", { name: "کپی شناسه کار: TEAM-12", exact: true }).waitFor();

  for (const query of ["team - ۱۲", roleId, unitId, id]) {
    await page.locator(".global-search").click();
    const input = page.locator(".command-input input");
    await input.fill(query);
    const result = page
      .locator(".command-results button")
      .filter({ hasText: query === "team - ۱۲" ? "TEAM-12" : query });
    await result.first().waitFor();
    await page.keyboard.press("Escape");
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: [
        "copy without navigation",
        "server generated project payload",
        "user UUID search and copy",
        "nested unit UUID search",
        "Persian task reference",
        "global identifier search",
      ],
    })
  );
  await context.close();
} finally {
  await browser.close();
}
