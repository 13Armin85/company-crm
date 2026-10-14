/* eslint-disable no-await-in-loop -- Browser steps depend on the preceding interaction and viewport. */
// Synthetic API fixtures only: this script never changes existing users or data.
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const { chromium } = await import(
  pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE ?? ".cache/browser/node_modules/playwright/index.mjs")).href
);
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.CRM_BROWSER_URL ?? "http://127.0.0.1:3003";
const browserScope = process.env.CRM_BROWSER_SCOPE ?? "all";
assert(["all", "behavior"].includes(browserScope), "CRM_BROWSER_SCOPE must be all or behavior");
const output = pathToFileURL(
  resolve(process.env.CRM_BROWSER_OUTPUT ?? `.cache/browser/${browserScope === "behavior" ? "behavior" : "results"}`) +
    "/"
);
await mkdir(output, { recursive: true });
const permissions = [
  "User.View",
  "User.Create",
  "User.Edit",
  "User.Delete",
  "User.ChangePassword",
  "User.Role.Assign",
  "Role.View",
  "Role.Create",
  "Role.Edit",
  "Role.Disable",
  "Role.Delete",
  "Role.Permission.Assign",
  "Permission.View",
  "OrganizationUnit.View",
  "OrganizationUnit.Create",
  "OrganizationUnit.Edit",
  "OrganizationUnit.Disable",
  "OrganizationUnit.Delete",
  "OrganizationUnit.Member.Manage",
  "OrganizationUnit.Manager.Assign",
  "OrganizationUnit.Delegate.Manage",
  "Access.UserException.View",
  "Access.UserException.Manage",
  "Access.EffectivePermission.View",
  "Absence.View",
  "Absence.Create",
  "Absence.Edit",
  "Absence.End",
  "Absence.ManageAll",
  "Routing.View",
  "Routing.Manage",
  "Routing.Queue.View",
  "Issue.View",
  "Issue.Create",
  "Project.View",
  "Project.Create",
  "Project.Edit",
  "Project.Member.Manage",
  "Workspace.Edit",
];
const catalog = permissions.map((code, i) => ({
  id: `permission-${i}`,
  code,
  name: "",
  category: code.split(".")[0],
  description: "",
  is_active: true,
}));
const roles = Array.from({ length: 80 }, (_, i) => ({
  id: `role-${i + 1}`,
  name: `نقش ${i + 1}`,
  description: "نقش آزمایشی",
  permission_ids: ["permission-0"],
  is_active: true,
  user_count: 1,
}));
const units = Array.from({ length: 80 }, (_, i) => ({
  id: `unit-${i + 1}`,
  title: `واحد ${i + 1}`,
  parent_id: null,
  manager_id: null,
  member_ids: [],
  is_active: true,
}));
const members = Array.from({ length: 80 }, (_, i) => ({
  id: `membership-${i + 1}`,
  is_active: true,
  organization_roles: [roles[i]],
  member: {
    id: `user-${i + 1}`,
    display_name: `کاربر ${i + 1}`,
    email: `member-${i + 1}@example.com`,
    user_timezone: "Asia/Tehran",
  },
}));
const projects = Array.from({ length: 80 }, (_, i) => ({
  id: `project-${i + 1}`,
  name: `پروژه ${i + 1}`,
  identifier: `P${i + 1}`,
  target_date: "2026-03-21",
}));
const state = {
  userId: "user-1",
  userStatus: 200,
  timeZone: "Asia/Tehran",
  userName: "کاربر آزمایشی",
  signedIn: true,
  theme: "light",
  density: "comfortable",
  allowDelegation: true,
};
const writes = [];
const errors = [];
const browser = await chromium.launch({
  ...(process.env.CRM_BROWSER_EXECUTABLE
    ? { executablePath: process.env.CRM_BROWSER_EXECUTABLE }
    : { executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" }),
  headless: true,
  ignoreDefaultArgs: ["--disable-back-forward-cache"],
});
const context = await browser.newContext();
context.setDefaultNavigationTimeout(120000);
await context.addInitScript(() => {
  if (location.origin !== "null") localStorage.setItem("hamkar-workspace", "ticket-test");
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) sessionStorage.setItem("ticket-three-bfcache", "restored");
  });
});
await context.route(/\/(api|auth)\//, async (route) => {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  const method = request.method();
  let data = [];
  if (path === "/api/users/me/")
    return route.fulfill({
      status: state.signedIn ? state.userStatus : 401,
      json: state.signedIn
        ? { id: state.userId, display_name: state.userName, email: "test@example.com", user_timezone: state.timeZone }
        : {},
    });
  if (path.endsWith("sign-in/")) {
    state.signedIn = true;
    state.userId = "user-2";
    state.userName = "حساب دوم";
    return route.fulfill({ status: 302, headers: { location: base + "/team" }, body: "" });
  }
  if (path.endsWith("sign-out/")) {
    state.signedIn = false;
    return route.fulfill({ json: {} });
  }
  if (path.endsWith("get-csrf-token/")) return route.fulfill({ json: { csrf_token: "browser-test-csrf" } });
  if (method !== "GET") {
    const body = request.postDataJSON();
    // Never record account creation bodies, passwords or authentication tokens.
    if (!path.endsWith("members/")) writes.push({ path, method, body });
    if (path.includes("/roles/") && method === "PATCH") {
      const row = roles.find((item) => path.includes(`/${item.id}/`));
      if (row) Object.assign(row, body);
      data = row ?? {};
    } else if (path.includes("/units/") && method === "PATCH") {
      const row = units.find((item) => path.includes(`/${item.id}/`));
      if (row) Object.assign(row, body);
      data = row ?? {};
    } else data = { id: "created-test", ...body };
    return route.fulfill({ status: method === "DELETE" ? 204 : 200, ...(method === "DELETE" ? {} : { json: data }) });
  }
  if (path.endsWith("/workspaces/")) data = [{ id: "workspace-test", slug: "ticket-test", name: "شرکت آزمایشی" }];
  else if (path.endsWith("/profile/"))
    data = { theme: { theme: state.theme, hamkar_density: state.density }, last_workspace_id: "workspace-test" };
  else if (path.endsWith("/access/me/"))
    data = { permissions: state.accessPermissions ?? permissions, explanations: [], role_grants: [] };
  else if (path.endsWith("/members/"))
    data = path.includes("/projects/")
      ? members
          .slice(0, 2)
          .map((row) => ({ id: `project-${row.id}`, member: row.member.id, role: 15, is_active: true }))
      : members;
  else if (path.endsWith("/projects/") || path.endsWith("/projects/details/")) data = projects;
  else if (/\/projects\/[^/]+\/$/.test(path)) data = projects.find((row) => path.includes(`/${row.id}/`));
  else if (path.endsWith("/organization/permissions/")) data = catalog;
  else if (path.endsWith("/organization/roles/")) data = roles;
  else if (/\/organization\/roles\/[^/]+\/$/.test(path)) data = roles.find((item) => path.includes(`/${item.id}/`));
  else if (path.endsWith("/organization/units/")) data = units;
  else if (path.endsWith("/organization/users/user-1/"))
    data = {
      id: "user-1",
      display_name: "کاربر 1",
      email: "member-1@example.com",
      username: "test-user",
      is_active: true,
      role_ids: ["role-1"],
      unit_ids: ["unit-1"],
    };
  else if (path.endsWith("effective-permissions/"))
    data = {
      permissions: ["Role.View"],
      role_grants: [
        {
          id: "permission-0",
          code: "User.View",
          category: "User",
          name: "مشاهده کاربران",
          role_ids: ["role-1", "role-2"],
          role_names: ["نقش 1", "نقش 2"],
        },
      ],
      explanations: [
        {
          id: "permission-0",
          code: "User.View",
          name: "مشاهده کاربران",
          category: "User",
          granted: false,
          source: "user_deny",
          has_conflict: true,
        },
      ],
    };
  else if (path.endsWith("/exceptions/"))
    data = [
      {
        id: "exception-1",
        permission: "permission-0",
        permission_code: "User.View",
        effect: "ALLOW",
        is_active: true,
        starts_at: "2026-01-01T00:00:00Z",
        ends_at: "2030-01-01T00:00:00Z",
      },
    ];
  else if (path.endsWith("/absences/"))
    data = {
      absences: [],
      manageable_user_ids: members.map((row) => row.member.id),
      delegations: state.allowDelegation
        ? [
            {
              unit_id: "unit-1",
              user_name: "جانشین آزمایشی",
              manager_name: "مدیر آزمایشی",
              unit_name: "واحد 1",
              ends_at: "2030-01-01T00:00:00Z",
            },
          ]
        : [],
    };
  else if (path.endsWith("/delegates/")) data = { delegates: [], active_delegation: null };
  return route.fulfill({ json: data ?? {} });
});
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));
const go = async (path) => {
  const delay = Number(process.env.CRM_BROWSER_NAVIGATION_DELAY_MS ?? 0);
  if (delay > 0) await new Promise((complete) => setTimeout(complete, delay));
  console.log("Checking", path, state.theme);
  await page.goto(base + path, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.locator(".app-shell").waitFor({ timeout: 60000 });
};
const results = [];
try {
  if (browserScope === "all")
    for (const width of [320, 390, 768, 1440])
      for (const theme of ["light", "dark"]) {
        state.theme = theme;
        await page.setViewportSize({ width, height: 900 });
        await go("/team");
        await page.getByRole("button", { name: "ساخت کاربر جدید", exact: true }).click();
        const modal = page.getByRole("dialog");
        await modal.getByRole("button", { name: /^انتخاب نقش‌ها/ }).click();
        await modal.getByRole("searchbox").fill("نقش 80");
        const option = modal.getByRole("checkbox");
        await option.focus();
        await option.press("Space");
        assert.equal(await option.isChecked(), true);
        await modal.getByRole("searchbox").fill("نقش 1");
        assert.match(await modal.locator(".selector-selected").first().textContent(), /نقش 80/);
        const checkboxBox = await modal.getByRole("checkbox").first().boundingBox();
        assert(checkboxBox.width <= 20 && checkboxBox.height <= 20);
        await page.keyboard.press("Escape");
        assert.equal(await modal.count(), 1);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        assert.equal(overflow, false, `horizontal overflow at ${width}/${theme}`);
        await page.screenshot({
          path: new URL(`team-${width}-${theme}.png`, output).pathname.replace(/^\//, ""),
          fullPage: false,
        });
        results.push({ width, theme, form: "create-user", horizontalOverflow: overflow, checkbox: checkboxBox });
        await modal.getByRole("button", { name: "بستن", exact: true }).click();
      }

  roles[79].is_active = false;
  roles[0].permission_ids.push("permission-legacy");
  const checkLayout = async (form, scope = page) => {
    await scope.locator("input:visible,button:visible,textarea:visible,select:visible").first().waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(
      overflow,
      false,
      `horizontal overflow: ${form}/${state.theme}/${state.density}/${page.viewportSize().width}`
    );
    const yearInput = scope.locator(".persian-calendar-header input");
    if (await yearInput.count())
      assert(
        await yearInput.evaluate((node) => {
          const style = getComputedStyle(node);
          return node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) >= 32;
        }),
        `${form}: calendar year is readable`
      );
    if (await page.getByRole("dialog").count()) {
      const dialog = page.getByRole("dialog");
      const rect = (await dialog.locator(".create-modal").count())
        ? await dialog.locator(".create-modal").boundingBox()
        : await page.locator(".create-modal").boundingBox();
      if (rect)
        assert(
          rect.width <= page.viewportSize().width && rect.height <= page.viewportSize().height,
          `${form}: dialog bounds`
        );
      const actions = scope.locator("footer button");
      if (await actions.count()) {
        await actions.last().scrollIntoViewIfNeeded();
        const box = await actions.last().boundingBox();
        assert(box.y >= 0 && box.y + box.height <= page.viewportSize().height + 1, `${form}: footer reachable`);
      }
      await page.waitForFunction(
        () => [...document.querySelectorAll('[role="dialog"]')].some((node) => node.contains(document.activeElement)),
        { timeout: 5000 }
      );
      await page.keyboard.press("Tab");
      assert(
        await dialog.evaluate((node) => node.contains(document.activeElement)),
        `${form}: focus remains in dialog`
      );
    }
    if (
      (page.viewportSize().width === 320 && state.theme === "dark") ||
      (page.viewportSize().width === 1440 && state.theme === "light" && state.density === "comfortable")
    )
      await page.screenshot({
        path: new URL(
          `${form}-${page.viewportSize().width}-${state.theme}-${state.density}.png`,
          output
        ).pathname.replace(/^\//, ""),
      });
    results.push({
      width: page.viewportSize().width,
      theme: state.theme,
      density: state.density,
      form,
      horizontalOverflow: overflow,
    });
  };
  if (browserScope === "all")
    for (const density of ["comfortable", "compact"])
      for (const width of [320, 390, 768, 1440])
        for (const theme of ["light", "dark"]) {
          Object.assign(state, { density, theme });
          await page.setViewportSize({ width, height: 900 });
          await go("/team");
          await page.getByRole("button", { name: "ساخت کاربر جدید", exact: true }).click();
          await page
            .getByRole("dialog")
            .getByRole("button", { name: /^انتخاب نقش‌ها/ })
            .click();
          await page.getByRole("dialog").getByRole("searchbox").fill("نقش ۸۰");
          assert.equal(await page.getByRole("dialog").getByRole("checkbox").count(), 0);
          await page.getByRole("dialog").getByText("نتیجه‌ای یافت نشد.", { exact: true }).waitFor();
          await page.keyboard.press("Escape");
          await checkLayout("create-user", page.getByRole("dialog"));
          await page.getByRole("dialog").getByRole("button", { name: "بستن", exact: true }).click();
          await page.getByRole("button", { name: "عملیات کاربر 1", exact: true }).click();
          await page.getByRole("menuitem", { name: "تغییر رمز عبور", exact: true }).click();
          await checkLayout("member-password", page.getByRole("dialog"));
          await page.getByRole("dialog").getByRole("button", { name: "بستن", exact: true }).click();
          await go("/team/user-1");
          await page.getByRole("heading", { name: "اطلاعات حساب", exact: true }).waitFor();
          await checkLayout("user-profile");
          await checkLayout("direct-permission", page.locator(".user-access-panel form"));
          await go("/organization");
          await page.getByRole("button", { name: "واحد جدید", exact: true }).click();
          await checkLayout("organization-unit", page.getByRole("dialog"));
          await page.getByRole("dialog").getByRole("button", { name: "بستن", exact: true }).click();
          await go("/roles");
          await page.getByRole("button", { name: "نقش جدید", exact: true }).click();
          await checkLayout("role-metadata", page.getByRole("dialog"));
          await page.getByRole("dialog").getByRole("button", { name: "بستن", exact: true }).click();
          await go("/roles/role-1/permissions");
          await page.getByRole("heading", { name: "نقش 1", exact: true }).waitFor();
          await checkLayout("role-permissions");
          await go("/routing");
          await page.getByRole("button", { name: "قانون جدید", exact: true }).click();
          await checkLayout("routing", page.getByRole("dialog"));
          await page.getByRole("button", { name: "انصراف", exact: true }).click();
          await go("/absences");
          await page.getByRole("button", { name: "ثبت عدم حضور", exact: true }).click();
          await checkLayout("absence", page.getByRole("dialog"));
          await page.getByRole("button", { name: "شروع", exact: true }).click();
          await checkLayout("absence-calendar", page.getByRole("dialog"));
          await page.keyboard.press("Escape");
          await page.getByRole("dialog").getByRole("button", { name: "بستن", exact: true }).click();
          await page.getByRole("button", { name: "ایجاد", exact: true }).click();
          await checkLayout("quick-issue", page.getByRole("dialog"));
          await page.getByRole("button", { name: "پروژه", exact: true }).click();
          await checkLayout("quick-project", page.getByRole("dialog"));
          await page.getByRole("dialog").getByRole("button", { name: "بستن", exact: true }).click();
          await go("/projects/project-1?tab=settings");
          await page.locator(".project-settings-form").waitFor();
          await checkLayout("project-settings", page.locator(".project-settings-form"));
          await page.getByRole("button", { name: "تاریخ پایان", exact: true }).click();
          await checkLayout("project-calendar", page.locator(".project-settings-form"));
          await page.keyboard.press("Escape");
          await page.getByRole("button", { name: "چرخه‌ها", exact: true }).click();
          await checkLayout("cycle", page.locator(".cycle-form"));
          await go("/settings?section=security");
          await checkLayout("account-password", page.locator(".security-form"));
        }

  await page.setViewportSize({ width: 390, height: 900 });
  members[78].is_active = false;
  state.accessPermissions = ["OrganizationUnit.View", "OrganizationUnit.Manager.Assign"];
  await go("/organization");
  await page.locator(".org-node").nth(1).getByTitle("ویرایش", { exact: true }).click();
  let managerModal = page.getByRole("dialog");
  assert.equal(await managerModal.getByLabel("عنوان واحد", { exact: true }).isDisabled(), true);
  assert.equal(await managerModal.getByRole("combobox", { name: "واحد بالادستی", exact: true }).isDisabled(), true);
  await managerModal.getByRole("combobox", { name: "مدیر فعلی", exact: true }).fill("member-80");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const managerSaved = page.waitForResponse(
    (response) => response.url().endsWith("/units/unit-2/") && response.request().method() === "PATCH"
  );
  await managerModal.getByRole("button", { name: "ذخیره واحد", exact: true }).click();
  await managerSaved;
  assert.deepEqual(writes.findLast((row) => row.path.endsWith("/units/unit-2/"))?.body, { manager_id: "user-80" });
  results.push({ unitManagerPermission: "independent form controls and manager-only PATCH" });
  state.accessPermissions = undefined;
  await go("/organization");
  await page.getByRole("button", { name: "واحد جدید", exact: true }).click();
  let modal = page.getByRole("dialog");
  await modal.getByRole("combobox", { name: "مدیر فعلی" }).fill("member-79");
  assert.equal(await modal.getByRole("option").getAttribute("aria-disabled"), "true");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await modal.getByRole("combobox", { name: "مدیر فعلی" }).fill("member-80");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  assert.equal(await modal.getByRole("combobox", { name: "مدیر فعلی" }).inputValue(), "کاربر 80");
  await modal.getByRole("button", { name: "بستن", exact: true }).click();
  await page.locator(".org-node").first().getByRole("button", { name: "غیرفعال کردن", exact: true }).click();
  await page.locator(".org-node").first().getByRole("button", { name: "فعال کردن", exact: true }).waitFor();
  assert.deepEqual(writes.find((row) => row.path.endsWith("/units/unit-1/"))?.body, { is_active: false });
  await go("/roles");
  await page.getByRole("button", { name: "نقش جدید", exact: true }).click();
  modal = page.getByRole("dialog");
  assert.equal(await modal.locator(".compact-selector").count(), 0);
  await modal.getByRole("button", { name: "بستن", exact: true }).click();
  assert.equal(await page.getByText("کاتالوگ مجوزها").count(), 0);
  await go("/roles/role-1/permissions");
  await page.getByRole("searchbox").fill("مجوز قدیمی یا غیرفعال");
  assert.equal(await page.getByRole("checkbox").isChecked(), true);
  assert.equal(await page.getByRole("checkbox").isDisabled(), false);
  await page.getByRole("checkbox").uncheck();
  await page.getByRole("button", { name: "بازگردانی تغییرات", exact: true }).click();
  await page.getByRole("searchbox").fill("حذف نقش");
  await page.getByRole("checkbox").first().check();
  await page.getByRole("searchbox").fill("کاربران");
  const roleSaved = page.waitForResponse(
    (response) => response.url().endsWith("/roles/role-1/") && response.request().method() === "PATCH"
  );
  await page.getByRole("button", { name: "ذخیره مجوزها" }).click();
  await roleSaved;
  assert(writes.findLast((row) => row.path.endsWith("/roles/role-1/"))?.body.permission_ids.includes("permission-10"));
  assert(
    writes.findLast((row) => row.path.endsWith("/roles/role-1/"))?.body.permission_ids.includes("permission-legacy")
  );
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
  await page.locator(".app-shell").waitFor();
  state.accessPermissions = ["Role.View"];
  await go("/roles/role-1/permissions");
  assert.equal(await page.getByRole("button", { name: "ذخیره مجوزها", exact: true }).count(), 0);
  assert.equal(await page.getByRole("checkbox").first().isDisabled(), true);
  state.accessPermissions = ["Role.Permission.Assign"];
  await go("/roles/role-1/permissions");
  await page.getByRole("button", { name: "ذخیره مجوزها", exact: true }).waitFor();
  assert.equal(await page.getByRole("checkbox").first().isDisabled(), false);
  state.accessPermissions = undefined;
  results.push({ rolePermissionRoute: "read-only view and independent assign-only access after direct refresh" });
  await go("/team/user-1");
  await page.getByRole("heading", { name: "مجوزهای ناشی از نقش‌ها" }).waitFor();
  await page
    .locator(".user-access-panel")
    .filter({ hasText: /نقش 1، نقش 2/ })
    .waitFor();
  assert.match(await page.locator(".user-access-panel").textContent(), /نقش 1، نقش 2/);
  assert.equal(await page.locator('input[type="datetime-local"]').count(), 0);
  const directForm = page.locator(".user-access-panel form");
  assert.equal(await directForm.locator(".persian-datetime-picker").count(), 0);
  await directForm.getByRole("combobox", { name: "مجوز", exact: true }).fill("حذف نقش");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const directSaved = page.waitForResponse(
    (response) => response.url().endsWith("/exceptions/") && response.request().method() === "POST"
  );
  await directForm.getByRole("button", { name: "افزودن دسترسی", exact: true }).click();
  await directSaved;
  assert.deepEqual(writes.findLast((row) => row.path.endsWith("/exceptions/"))?.body, {
    permission: "permission-10",
    effect: "ALLOW",
  });
  await directForm.getByRole("combobox", { name: "مجوز", exact: true }).fill("مشاهده کاربران");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await directForm.getByRole("combobox", { name: "نوع اثر", exact: true }).selectOption("DENY");
  assert.equal(await directForm.getByRole("button", { name: "افزودن دسترسی", exact: true }).isDisabled(), true);
  await directForm.getByRole("checkbox", { name: "اثر منع را تأیید می‌کنم", exact: true }).check();
  assert.equal(await directForm.getByRole("button", { name: "افزودن دسترسی", exact: true }).isDisabled(), false);
  results.push({ ordinaryDirectPermission: "permission/effect only; no date controls; DENY requires confirmation" });
  await page.getByRole("button", { name: "ویرایش دسترسی", exact: true }).click();
  const exceptionSaved = page.waitForResponse(
    (response) => response.url().includes("/exceptions/exception-1/") && response.request().method() === "PATCH"
  );
  await page.getByRole("button", { name: "ذخیره دسترسی", exact: true }).click();
  await exceptionSaved;
  assert(!("starts_at" in (writes.findLast((row) => row.path.includes("/exceptions/"))?.body ?? {})));
  await go("/absences");
  assert.equal(await page.getByText("جانشینی‌های فعال").count(), 0);
  await page.getByRole("button", { name: "ثبت عدم حضور", exact: true }).click();
  modal = page.getByRole("dialog");
  await modal.getByRole("combobox", { name: "کاربر", exact: true }).fill("member-80");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await modal.getByRole("button", { name: "شروع", exact: true }).click();
  await modal.getByRole("button", { name: "امروز", exact: true }).click();
  await modal.getByRole("button", { name: "پایان", exact: true }).click();
  await modal.getByRole("button", { name: "ماه بعد", exact: true }).click();
  await modal.locator(".persian-calendar-grid button").first().click();
  const absenceSaved = page.waitForResponse(
    (response) => response.url().endsWith("/absences/") && response.request().method() === "POST"
  );
  await modal.getByRole("button", { name: "ذخیره", exact: true }).click();
  await absenceSaved;
  const absence = writes.findLast((row) => row.path.endsWith("/absences/"));
  assert.match(absence.body.starts_at, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  results.push({
    absencePayload: absence.body,
    rolePermissions: "preserved hidden selection",
    unitToggle: "only is_active",
    timedException: "bounds omitted",
  });
  // Enter Gregorian year/hour digits against Persian labels and reject a DST gap.
  state.timeZone = "America/Los_Angeles";
  await go("/absences");
  await page.getByRole("button", { name: "ثبت عدم حضور", exact: true }).click();
  modal = page.getByRole("dialog");
  await modal.getByRole("button", { name: "شروع", exact: true }).click();
  await modal.getByRole("combobox", { name: "سال", exact: true }).fill("1404");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await modal.getByRole("combobox", { name: "ماه", exact: true }).selectOption("12");
  await modal.getByRole("button", { name: "۱۷ اسفند ۱۴۰۴", exact: true }).click();
  const hour = modal.getByRole("spinbutton", { name: "ساعت شروع", exact: true });
  await hour.fill("02");
  await hour.press("Tab");
  await modal.getByText("زمان انتخاب‌شده معتبر یا در بازهٔ مجاز نیست.", { exact: true }).waitFor();
  assert.equal(await modal.getByLabel("شروع اعتبارسنجی").evaluate((node) => node.validity.customError), true);
  assert.equal(await modal.locator("form").evaluate((node) => node.checkValidity()), false);
  assert.equal(await hour.inputValue(), "۰۲");
  await hour.fill("03");
  await hour.press("Tab");
  assert.equal(await modal.getByText("زمان انتخاب‌شده معتبر یا در بازهٔ مجاز نیست.", { exact: true }).count(), 0);
  await modal.getByRole("button", { name: "بستن", exact: true }).click();
  results.push({
    daylightSavingGap: "invalid submission blocked; corrected hour retains day",
    digitSearch: "English/Persian year and hour",
  });
  state.timeZone = "Asia/Tehran";
  const chooseDate = async (scope, label, day) => {
    await scope.getByRole("button", { name: label, exact: true }).click();
    await scope.getByRole("combobox", { name: "سال", exact: true }).fill("1403");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await scope.getByRole("combobox", { name: "ماه", exact: true }).selectOption("1");
    await scope.getByRole("button", { name: `${day} فروردین ۱۴۰۳`, exact: true }).click();
  };
  await go("/projects/project-1?tab=settings");
  await page.getByRole("button", { name: "ایجاد", exact: true }).click();
  modal = page.getByRole("dialog");
  await modal.getByRole("textbox", { name: "عنوان", exact: true }).fill("آزمون تاریخ روزانه");
  await modal.getByRole("combobox", { name: "پروژه", exact: true }).fill("پروژه 80");
  await modal.getByRole("option", { name: "پروژه 80", exact: true }).waitFor();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  assert.equal(await modal.getByRole("combobox", { name: "پروژه", exact: true }).inputValue(), "پروژه 80");
  await modal.getByRole("combobox", { name: "مسئول مستقیم", exact: true }).fill("کاربر 2");
  await modal.getByRole("option").filter({ hasText: "member-2@example.com" }).waitFor();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await chooseDate(modal, "تاریخ پایان", "۱");
  assert.equal(await modal.getByRole("combobox", { name: "پروژه", exact: true }).inputValue(), "پروژه 80");
  assert.equal(
    writes.filter((row) => row.path.endsWith("/issues/") || row.path.endsWith("/tasks/")).length,
    0,
    "date selection must not submit the create form"
  );
  const issueSaved = page.waitForResponse(
    (response) => response.url().endsWith("/issues/") && response.request().method() === "POST"
  );
  await modal.getByRole("button", { name: "ایجاد کار", exact: true }).click();
  await issueSaved;
  assert.equal(writes.findLast((row) => row.path.endsWith("/issues/"))?.body.target_date, "2024-03-20");
  const settings = page.locator(".project-settings-form");
  await chooseDate(settings, "تاریخ پایان", "۱");
  const projectSaved = page.waitForResponse(
    (response) => response.url().endsWith("/projects/project-1/") && response.request().method() === "PATCH"
  );
  await settings.getByRole("button", { name: "ذخیره تغییرات", exact: true }).click();
  await projectSaved;
  assert.equal(writes.findLast((row) => row.path.endsWith("/projects/project-1/"))?.body.target_date, "2024-03-20");
  await page.getByRole("button", { name: "چرخه‌ها", exact: true }).click();
  const cycle = page.locator(".cycle-form");
  await cycle.getByRole("textbox", { name: "نام چرخه" }).fill("چرخه آزمون تاریخ");
  await chooseDate(cycle, "شروع", "۱");
  await chooseDate(cycle, "پایان", "۲");
  const cycleSaved = page.waitForResponse(
    (response) => response.url().endsWith("/cycles/") && response.request().method() === "POST"
  );
  await cycle.getByRole("button", { name: "ساخت چرخه", exact: true }).click();
  await cycleSaved;
  const cycleBody = writes.findLast((row) => row.path.endsWith("/cycles/"))?.body;
  assert.equal(cycleBody.start_date, "2024-03-20");
  assert.equal(cycleBody.end_date, "2024-03-21");
  results.push({ dateOnlyPayloads: "issue, project and cycle Gregorian dates without timezone shift" });
  // Failed verification hides content while preserving the live server session.
  await go("/team");
  await page.getByRole("button", { name: "ساخت کاربر جدید", exact: true }).click();
  await page.getByRole("dialog").getByLabel("نام نمایشی").fill("پیش‌نویس ماندگار");
  state.userStatus = 403;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.getByRole("button", { name: "تلاش دوباره", exact: true }).waitFor();
  assert.equal(await page.locator(".app-shell").isVisible(), false);
  assert(!page.url().endsWith("/login"));
  state.userStatus = 200;
  await page.getByRole("button", { name: "تلاش دوباره", exact: true }).click();
  await page.locator(".app-shell").waitFor();
  await page.getByRole("dialog").getByLabel("نام نمایشی").waitFor();
  assert.equal(await page.getByRole("dialog").getByLabel("نام نمایشی").inputValue(), "پیش‌نویس ماندگار");
  await page.getByRole("dialog").getByRole("button", { name: "بستن", exact: true }).click();
  // Verify the BFCache event path synchronously hides a captured private page.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  assert.equal(await page.evaluate(() => document.documentElement.dataset.crmSessionHidden), "true");
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await page.locator(".app-shell").waitFor();
  results.push({
    verification403: "session and form draft retained; retry recovers",
    bfcache: "persisted pagehide/pageshow event path",
  });
  const second = await context.newPage();
  await second.bringToFront();
  await second.goto(base + "/team");
  await second.locator(".app-shell").waitFor();
  await page.bringToFront();
  await go("/settings?section=profile");
  await page
    .getByRole("button", { name: /خروج از حساب/ })
    .first()
    .click();
  await page.getByRole("button", { name: "خروج", exact: true }).click();
  await page.waitForURL("**/login");
  await second.waitForURL("**/login");
  await page.waitForLoadState("networkidle");
  for (let i = 0; i < 3; i++) {
    await page.goBack({ waitUntil: "domcontentloaded" });
    await page.waitForURL("**/login");
    assert.equal(await page.locator(".app-shell").count(), 0);
  }
  await page.goForward({ waitUntil: "domcontentloaded" });
  assert.equal(await page.locator(".app-shell").count(), 0);
  await page.goto(base + "/team");
  await page.waitForURL("**/login");
  assert.equal(await page.locator(".app-shell").count(), 0);
  results.push({ history: "back/forward/direct URL protected", secondTab: "protected" });
  // Exercise a real document history restore, including BFCache when Chrome uses it.
  state.signedIn = true;
  await go("/team");
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => sessionStorage.removeItem("ticket-three-bfcache"));
  await page.goto("about:blank");
  state.signedIn = false;
  await page.goBack();
  await page.waitForURL("**/login");
  assert.equal(await page.locator(".app-shell").count(), 0);
  results.push({
    documentHistoryRestore: "protected",
    bfcacheObserved: await page.evaluate(() => sessionStorage.getItem("ticket-three-bfcache") === "restored"),
  });
  // Sign in through the public form as another account; previous drafts stay absent.
  await page.getByLabel("ایمیل یا نام کاربری").fill("second@example.com");
  await page.getByLabel("رمز عبور", { exact: true }).fill("SyntheticPassword!2026");
  await page.getByRole("button", { name: /ورود/ }).click();
  await page.waitForURL("**/team");
  await page.locator(".app-shell").waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0);
  await page.getByRole("button", { name: "ساخت کاربر جدید", exact: true }).click();
  assert.equal(await page.getByRole("dialog").getByLabel("نام نمایشی").inputValue(), "");
  await page.getByRole("dialog").getByRole("button", { name: "بستن", exact: true }).click();
  results.push({ nextAccount: "login form, no restored drafts" });
  await page.getByRole("button", { name: "ساخت کاربر جدید", exact: true }).click();
  await page.getByRole("dialog").getByLabel("نام نمایشی").fill("پیش‌نویس حساب قبلی");
  state.userId = "user-3";
  state.userName = "حساب سوم";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForURL(base + "/");
  await page.locator(".app-shell").waitFor();
  assert.equal(state.signedIn, true);
  assert.equal(await page.getByRole("dialog").count(), 0);
  await go("/team");
  await page.getByRole("button", { name: "ساخت کاربر جدید", exact: true }).click();
  assert.equal(await page.getByRole("dialog").getByLabel("نام نمایشی").inputValue(), "");
  await page.getByRole("dialog").getByRole("button", { name: "بستن", exact: true }).click();
  results.push({ changedSessionIdentity: "old drafts discarded and new server account retained" });
  assert.deepEqual(errors, []);
  await writeFile(
    new URL("report.json", output),
    JSON.stringify({ scope: browserScope, results, errors, passed: true }, null, 2)
  );
  console.log(JSON.stringify({ scope: browserScope, checks: results.length, errors, passed: true }));
} catch (error) {
  await writeFile(
    new URL("report.json", output),
    JSON.stringify({ scope: browserScope, results, errors, passed: false }, null, 2)
  );
  await page.screenshot({ path: new URL("failure.png", output).pathname.replace(/^\//, ""), fullPage: false });
  console.error(error);
  console.error("Page errors:", errors);
  console.error(
    "Mutation paths:",
    writes.map(({ path, method }) => ({ path, method }))
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
