// API responses and mutations are mocked so the deployed database is never changed.
/* eslint-disable no-await-in-loop -- Interactions depend on the preceding page and viewport. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(
  pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE ?? ".cache/browser/node_modules/playwright/index.mjs")).href
);
const base = process.env.CRM_BROWSER_URL ?? "http://localhost:3000";
const output = resolve(process.env.CRM_BROWSER_OUTPUT ?? "tmp/role-absence-presentation");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CRM_BROWSER_EXECUTABLE ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const user = { id: "hidden-user-id", display_name: "کاربر آزمایشی", user_timezone: "Asia/Tehran" };
const role = {
  id: "hidden-role-id",
  name: "مدیر تیم",
  system_key: "team_manager",
  description: "مدیریت تیم",
  is_active: true,
  permission_ids: [],
};
const absence = {
  id: "hidden-absence-id",
  user: user.id,
  user_name: user.display_name,
  starts_at: "2026-10-18T06:00:00Z",
  ends_at: "2026-10-18T14:00:00Z",
  reason: "مرخصی",
  current_status: "active",
  can_edit: true,
  can_end: true,
};
const mutations = [];
const errors = [];
try {
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem("hamkar-workspace", "test"));
  await context.route(/\/(api|auth)\//, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let data = [];
    if (path === "/auth/get-csrf-token/") data = { csrf_token: "test-token" };
    else if (request.method() !== "GET") {
      mutations.push({ path, method: request.method(), body: request.postDataJSON() });
      data = { ...absence, ...request.postDataJSON() };
    } else if (path === "/api/users/me/") data = user;
    else if (path.endsWith("/workspaces/")) data = [{ id: "workspace", slug: "test", name: "شرکت" }];
    else if (path.endsWith("/access/me/"))
      data = { permissions: ["Role.View", "Role.Delete", "Absence.View", "Absence.Create"], explanations: [] };
    else if (path.endsWith("/profile/")) data = { theme: { theme: "light" } };
    else if (path.endsWith("/roles/")) data = [role];
    else if (path.endsWith("/members/")) data = [{ id: "membership", member: user, is_active: true }];
    else if (path.endsWith("/absences/")) data = { absences: [absence], manageable_user_ids: [user.id] };
    return route.fulfill({ json: data });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(90000);
  page.on("pageerror", (error) => errors.push(error.message));
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(base + "/roles");
    const cell = page.locator(".role-name-cell");
    await cell.getByText(role.name, { exact: true }).waitFor();
    const name = await cell.locator("span").boundingBox();
    const note = await cell.locator("small").boundingBox();
    assert(name && note && note.y >= name.y + name.height + 2, "system notice has a separate line and visible gap");
    assert.equal(await page.getByRole("button", { name: "حذف نقش", exact: true }).count(), 0);
    assert.equal(await page.locator(".page-content").locator(".identifier-badge").count(), 0);
    await page.screenshot({ path: resolve(output, `roles-${width}.png`), fullPage: true });
    await page.goto(base + "/absences");
    await page.getByRole("cell", { name: user.display_name, exact: true }).waitFor();
    const content = page.locator(".page-content");
    assert.equal(await content.locator(".identifier-badge").count(), 0);
    const text = await content.innerText();
    assert(!text.includes(absence.id) && !text.includes(user.id) && !text.includes("شناسه"));
    const search = page.getByPlaceholder("جستجوی نام کاربر یا علت عدم حضور…");
    await search.fill("مرخصی");
    await page.getByRole("cell", { name: user.display_name, exact: true }).waitFor();
    await search.fill("نام ناموجود");
    assert.equal(await page.locator("tbody tr").count(), 0);
    await search.fill("");
    await page.getByRole("button", { name: "ویرایش", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("textarea").fill("مرخصی ویرایش‌شده");
    const response = page.waitForResponse((r) => r.request().method() === "PATCH");
    await dialog.getByRole("button", { name: "ذخیره", exact: true }).click();
    await response;
    await dialog.waitFor({ state: "hidden" });
    assert.equal(mutations.at(-1).path.endsWith(`/absences/${absence.id}/`), true);
    assert.equal(mutations.at(-1).body.reason, "مرخصی ویرایش‌شده");
    const ended = page.waitForResponse((r) => r.request().method() === "DELETE");
    await page.getByRole("button", { name: "پایان عدم حضور", exact: true }).click();
    await ended;
    assert.equal(mutations.at(-1).path.endsWith(`/absences/${absence.id}/`), true);
    await page.screenshot({ path: resolve(output, `absences-${width}.png`), fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: desktop/mobile role spacing, hidden absence IDs, search, original-ID edits and ending. All writes mocked."
  );
} finally {
  await browser.close();
}
