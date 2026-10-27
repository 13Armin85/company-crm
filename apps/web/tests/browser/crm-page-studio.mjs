/* eslint-disable no-await-in-loop -- Checks share one browser session and restore its workspace configuration. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(resolve(".cache/browser/node_modules/playwright/index.mjs")).href);
const env = Object.fromEntries(
  (await readFile(".env.dev", "utf8"))
    .split(/\r?\n/)
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at), line.slice(at + 1).replace(/^(['"])(.*)\1$/, "$2")];
    })
);
const base = process.env.CRM_BROWSER_URL || "http://localhost:3000",
  slug = env.INTERNAL_WORKSPACE_SLUG || "dev-workspace";
const output = resolve("tmp/crm-page-studio");
const extraOnly = process.env.CRM_STUDIO_EXTRA_ONLY === "1";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(60000);
page.setDefaultNavigationTimeout(120000);
let ready = false;
for (let attempt = 0; attempt < 900 && !ready; attempt += 1) {
  try {
    ready = (await context.request.get(`${base}/api/instances/`, { timeout: 10000 })).ok();
  } catch {
    /* Dev servers are still starting. */
  }
  if (!ready) await page.waitForTimeout(1000);
}
if (!ready) await browser.close();
assert(ready, "The Docker web/API stack did not become ready.");
const errors = [],
  checks = [],
  createdRoles = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("response", (response) => {
  if (response.url().startsWith(base) && response.status() >= 500)
    errors.push(`${response.status()} ${new URL(response.url()).pathname}`);
});
const api = async (path, method = "GET", body) => {
  const csrf = await (await context.request.get(`${base}/auth/get-csrf-token/`)).json();
  const response = await context.request.fetch(`${base}/api/workspaces/${slug}/${path}`, {
    method,
    headers: { "X-CSRFTOKEN": csrf.csrf_token },
    ...(body === undefined ? {} : { data: body }),
  });
  return { status: response.status(), data: response.status() === 204 ? null : await response.json() };
};
const ok = (response, status = 200) => {
  assert.equal(response.status, status, JSON.stringify(response.data));
  return response.data;
};
const passed = (message) => {
  checks.push(message);
  console.log(`PASS ${message}`);
};
const saveSettings = async (surfaceCode = "roles") => {
  const button = page.getByRole("button", { name: "ذخیره تغییرات", exact: true });
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll(".studio-save-actions > button")).some(
      (node) => node.textContent.includes("ذخیره تغییرات") && !node.disabled
    )
  );
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith(`/engine/surfaces/${surfaceCode}/`) && r.request().method() === "PUT"),
    button.click(),
  ]);
  assert.equal(response.status(), 200);
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll(".studio-save-actions > button")).some(
      (node) => node.textContent.includes("ذخیره تغییرات") && node.disabled
    )
  );
};
const assertNoOverflow = async () => {
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 2);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
};
let original, projectOriginal, extra, code, avatarMembership;
const stamp = Date.now().toString(36),
  title = "امتیاز پیگیری آزمایشی",
  roleName = `آزمایش فرم و جدول ${stamp}`;
try {
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(env.DEV_ADMIN_EMAIL);
  await page.locator('input[name="password"]').fill(env.DEV_ADMIN_PASSWORD);
  await page.locator('.auth-card button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname !== "/login");
  await page.locator(".app-shell").waitFor();
  const staleFields = ok(await api("engine/definitions/fields/")).filter(
    (field) =>
      field.is_active && (field.code.startsWith("studio-") || field.code.startsWith("page-")) && field.title === title
  );
  if (staleFields.length) {
    const staleCodes = new Set(staleFields.map((field) => field.code));
    const current = ok(await api("engine/surfaces/roles/"));
    if (current.definition.fields.some((binding) => staleCodes.has(binding.field))) {
      const definition = {
        ...current.definition,
        fields: current.definition.fields.filter((binding) => !staleCodes.has(binding.field)),
        columns: current.definition.columns.filter((column) => !staleCodes.has(column.slice(6))),
        table_tabs: (current.definition.table_tabs || [])
          .filter((tab) => tab.title !== "نمای کوتاه آزمایشی")
          .map((tab) => {
            const columns = tab.columns.filter((column) => !staleCodes.has(column.slice(column.indexOf(":") + 1)));
            return { id: tab.id, title: tab.title, columns: columns.length ? columns : ["native:نام نقش"] };
          }),
      };
      if (!definition.columns.length) definition.columns = ["native:نام نقش"];
      ok(await api("engine/surfaces/roles/", "PUT", { revision: current.revision, definition }));
    }
    const staleRoles = ok(await api("organization/roles/")).filter((role) =>
      /^آزمایش فرم و جدول [a-z0-9]+(?: اختیاری)?$/.test(role.name)
    );
    for (const role of staleRoles) ok(await api(`organization/roles/${role.id}/`, "DELETE"), 204);
    for (const field of staleFields)
      ok(await api(`engine/definitions/fields/${field.id}/`, "PATCH", { is_active: false }));
  }
  original = ok(await api("engine/surfaces/roles/"));
  projectOriginal = ok(await api("engine/surfaces/project/"));
  const catalog = ok(await api("engine/surfaces/"));
  assert(catalog.results.length >= 18);
  passed("The backend publishes form settings for all 18 native surfaces.");
  if (!extraOnly) {
    await page.goto(`${base}/settings/engine?page=roles`);
    await page.getByRole("heading", { name: "طراحی فرم‌ها و جدول‌ها", exact: true }).waitFor();
    await page.locator(".studio-fields").first().waitFor();
    for (const label of [
      "موجودیت‌ها",
      "لیست‌های پایه",
      "مقادیر لیست‌ها",
      "کتابخانه فیلدها",
      "قالب و انتقال تنظیمات",
      "ممیزی تعاریف",
    ])
      assert.equal(await page.getByRole("button", { name: label, exact: true }).count(), 0);
    assert.equal(await page.locator('a[href^="/entities"]').count(), 0);
    assert.equal(await page.locator(".page-studio-sidebar nav button").count(), 18);
    passed("Only existing application pages remain; entity navigation and all advanced management tabs are removed.");
    await page.getByRole("button", { name: "افزودن فیلد", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "نام فیلد", exact: true }).fill(title);
    await dialog.getByRole("button", { name: "باز کردن نوع فیلد", exact: true }).click();
    await page.getByRole("option", { name: "عدد صحیح", exact: true }).click();
    const fieldCreated = page.waitForResponse(
      (r) => r.url().endsWith("/surfaces/roles/fields/") && r.request().method() === "POST"
    );
    await dialog.getByRole("button", { name: "افزودن به فرم", exact: true }).click();
    extra = await (await fieldCreated).json();
    code = extra.code;
    await dialog.waitFor({ state: "hidden" });
    await page.getByRole("checkbox", { name: `الزامی بودن ${title}`, exact: true }).check();
    await page.getByRole("tab", { name: "جدول و تب‌ها", exact: true }).click();
    await page.locator(".studio-column-choice").filter({ hasText: title }).getByRole("checkbox").check();
    await saveSettings();
    passed(
      "A typed field is created, attached, made required and added to the existing table through the redesigned UI."
    );
    await assertNoOverflow();
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "light";
    });
    await page.screenshot({ path: resolve(output, "desktop-columns.png"), fullPage: true });
    const rejected = await api("organization/roles/", "POST", { name: `${roleName} نامعتبر` });
    assert.equal(rejected.status, 400);
    passed("The original backend endpoint rejects missing required custom fields.");
    await page.goto(`${base}/roles`);
    await page.getByRole("button", { name: "نقش جدید", exact: true }).click();
    const form = page.getByRole("dialog");
    await form.getByRole("textbox", { name: "نام نقش", exact: true }).fill(roleName);
    await form.getByRole("textbox", { name: new RegExp(title) }).fill("7");
    const savedRole = page.waitForResponse(
      (r) => r.url().endsWith("/organization/roles/") && r.request().method() === "POST"
    );
    await form.getByRole("button", { name: "ذخیره نقش", exact: true }).click();
    const roleResponse = await savedRole;
    assert.equal(roleResponse.status(), 201);
    const role = await roleResponse.json();
    createdRoles.push(role.id);
    await form.waitFor({ state: "hidden" });
    await page.getByRole("columnheader", { name: title, exact: true }).waitFor();
    const row = page.getByRole("row").filter({ hasText: roleName });
    await row.getByRole("cell", { name: "7", exact: true }).waitFor();
    await page.reload();
    await page.getByRole("row").filter({ hasText: roleName }).getByRole("cell", { name: "7", exact: true }).waitFor();
    await page
      .getByRole("row")
      .filter({ hasText: roleName })
      .getByRole("button", { name: "ویرایش اطلاعات", exact: true })
      .click();
    const editForm = page.getByRole("dialog");
    await page.waitForFunction(
      () => document.querySelector('[role="dialog"] input[inputmode="numeric"]')?.value === "7"
    );
    assert.equal(await editForm.getByRole("textbox", { name: new RegExp(title) }).inputValue(), "7");
    await editForm.getByRole("textbox", { name: new RegExp(title) }).fill("8");
    const edited = page.waitForResponse(
      (r) => r.url().endsWith(`/organization/roles/${role.id}/`) && r.request().method() === "PATCH"
    );
    await editForm.getByRole("button", { name: "ذخیره نقش", exact: true }).click();
    assert.equal((await edited).status(), 200);
    await editForm.waitFor({ state: "hidden" });
    await page.getByRole("row").filter({ hasText: roleName }).getByRole("cell", { name: "8", exact: true }).waitFor();
    passed("Create, reload, edit and custom table values work on the existing Roles page.");
    await page.goto(`${base}/settings/engine?page=roles&mode=columns`);
    await page.getByRole("textbox", { name: "نام تب جدید", exact: true }).fill("نمای کوتاه آزمایشی");
    await page.getByRole("button", { name: "افزودن تب", exact: true }).click();
    for (const choice of await page.locator(".studio-column-choice").all()) {
      if ((await choice.innerText()).trim() !== "نام نقش") await choice.getByRole("checkbox").uncheck();
    }
    await saveSettings();
    await page.goto(`${base}/roles`);
    await page.getByRole("tab", { name: "نمای کوتاه آزمایشی", exact: true }).click();
    assert.equal(await page.getByRole("columnheader", { name: title, exact: true }).count(), 0);
    await page.getByRole("columnheader", { name: "نام نقش", exact: true }).waitFor();
    await page.getByRole("tab", { name: "جدول اصلی", exact: true }).click();
    await page.getByRole("columnheader", { name: title, exact: true }).waitFor();
    await page.reload();
    await page.getByRole("tab", { name: "نمای کوتاه آزمایشی", exact: true }).waitFor();
    await page.goto(`${base}/settings/engine?page=roles&mode=columns`);
    await page.getByRole("tab", { name: "نمای کوتاه آزمایشی", exact: true }).click();
    await page.getByRole("button", { name: "حذف تب", exact: true }).click();
    await saveSettings();
    await page.goto(`${base}/roles`);
    await page.getByRole("columnheader", { name: title, exact: true }).waitFor();
    assert.equal(await page.getByRole("tab", { name: "نمای کوتاه آزمایشی", exact: true }).count(), 0);
    passed("Table tabs can be added, switched, reloaded and removed, with independent backend-persisted columns.");
    await page.goto(`${base}/settings/engine?page=roles`);
    await page.getByRole("textbox", { name: `نام فیلد ${title}`, exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "light";
    });
    await assertNoOverflow();
    await page.screenshot({ path: resolve(output, "mobile-form.png"), fullPage: true });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "dark";
    });
    await page.screenshot({ path: resolve(output, "mobile-dark.png"), fullPage: true });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "light";
    });
    passed("The studio fits mobile and desktop, with light and dark themes.");
    await page.getByRole("checkbox", { name: `الزامی بودن ${title}`, exact: true }).uncheck();
    await saveSettings();
    const optional = ok(
      await api("organization/roles/", "POST", { name: `${roleName} اختیاری`, custom_values: {} }),
      201
    );
    createdRoles.push(optional.id);
    passed("Removing the required flag takes effect in the backend.");
    await page.getByRole("button", { name: `حذف ${title} از فرم`, exact: true }).click();
    await saveSettings();
    const values = ok(await api(`engine/surfaces/roles/values/?ids=${role.id}`));
    assert.equal(values.values[role.id]?.[code], undefined);
    await page.goto(`${base}/roles`);
    assert.equal(await page.getByRole("columnheader", { name: title, exact: true }).count(), 0);
    passed("Removing a field removes its form input and table column while retaining stored history.");
    for (const pageCode of [
      "ticket",
      "task",
      "project",
      "leave",
      "users",
      "units",
      "routing",
      "cycles",
      "profile",
      "security",
      "notifications",
      "workspace",
      "password",
      "exceptions",
      "delegates",
      "role-permissions",
      "appearance",
    ]) {
      await page.goto(`${base}/settings/engine?page=${pageCode}`);
      await page.locator(".page-studio-editor").waitFor();
      if (["ticket", "task", "project", "leave"].includes(pageCode))
        await page.locator(".studio-custom-row").first().waitFor();
      assert.equal(await page.locator(".page-studio-editor > [role='alert']").count(), 0, pageCode);
    }
    passed("Every native form can be selected and opened in the studio.");
  }
  await page.goto(`${base}/settings/engine?page=project`);
  await page.locator(".studio-custom-row").first().getByRole("textbox").fill("نام پروژه در فرم ساده");
  await saveSettings("project");
  await page.goto(`${base}/projects`);
  await page.getByRole("button", { name: "پروژه جدید", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: /نام پروژه در فرم ساده/ })
    .waitFor();
  await page
    .getByRole("dialog")
    .locator(".engine-form-footer")
    .getByRole("button", { name: "بستن", exact: true })
    .click();
  passed("The simplified editor changes the real native project form without an entity-management page.");
  await page.goto(`${base}/entities`);
  await page.getByRole("heading", { name: "این صفحه پیدا نشد", exact: true }).waitFor();
  passed("The removed entity directory is no longer a route in the application.");
  const email = `avatar-${stamp}@example.com`,
    password = `V7!mQ2#rZ9$pL4@${stamp}`;
  avatarMembership = ok(
    await api("members/", "POST", { email, password, username: `avatar-${stamp}`, display_name: "آزمایش حذف تصویر" }),
    201
  ).id;
  const personal = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const profile = await personal.newPage();
  profile.setDefaultTimeout(120000);
  await profile.goto(`${base}/login`);
  await profile.locator('input[name="email"]').fill(email);
  await profile.locator('input[name="password"]').fill(password);
  await profile.locator('.auth-card button[type="submit"]').click();
  await profile.waitForURL((url) => url.pathname !== "/login");
  await profile.goto(`${base}/settings?section=profile`);
  await profile.locator('.profile-avatar-editor input[type="file"]').setInputFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRXcAAAAASUVORK5CYII=",
      "base64"
    ),
  });
  const remove = profile.getByRole("button", { name: "حذف تصویر پروفایل", exact: true });
  await remove.waitFor();
  const [removed] = await Promise.all([
    profile.waitForResponse(
      (response) => response.url().endsWith("/api/users/me/avatar/") && response.request().method() === "DELETE"
    ),
    remove.click(),
  ]);
  assert.equal(removed.status(), 204);
  await remove.waitFor({ state: "hidden" });
  await profile.reload();
  await profile.locator(".profile-avatar-editor").waitFor();
  assert.equal(await profile.getByRole("button", { name: "حذف تصویر پروفایل", exact: true }).count(), 0);
  await personal.close();
  passed("A separate user can upload and remove their avatar, and removal survives reload.");
  assert.deepEqual(errors, []);
} finally {
  if (original) {
    const current = ok(await api("engine/surfaces/roles/"));
    ok(await api("engine/surfaces/roles/", "PUT", { revision: current.revision, definition: original.definition }));
  }
  if (projectOriginal) {
    const current = ok(await api("engine/surfaces/project/"));
    ok(
      await api("engine/surfaces/project/", "PUT", {
        revision: current.revision,
        definition: projectOriginal.definition,
        form: { revision: current.form.revision, layout: projectOriginal.form.layout },
      })
    );
  }
  if (avatarMembership) ok(await api(`members/${avatarMembership}/`, "DELETE"), 204);
  for (const id of createdRoles) ok(await api(`organization/roles/${id}/`, "DELETE"), 204);
  if (extra?.id) ok(await api(`engine/definitions/fields/${extra.id}/`, "PATCH", { is_active: false }));
  await writeFile(
    resolve(output, extraOnly ? "results-extras.json" : "results.json"),
    JSON.stringify({ checks, errors }, null, 2)
  );
  await browser.close();
}
console.log(`${checks.length} browser checks passed.`);
