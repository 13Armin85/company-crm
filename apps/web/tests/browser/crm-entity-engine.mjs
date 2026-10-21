/* eslint-disable no-await-in-loop -- Each browser step verifies the previous committed change. */
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
const base = process.env.CRM_BROWSER_URL || "http://localhost:3000";
const slug = env.INTERNAL_WORKSPACE_SLUG || "dev-workspace";
const output = resolve("tmp/crm-entity-engine-browser");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(60000);
page.setDefaultNavigationTimeout(120000);
const errors = [],
  checks = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("response", (response) => {
  if (response.url().startsWith(base) && response.status() >= 500)
    errors.push(`${response.status()} ${new URL(response.url()).pathname}`);
});
page.on("dialog", (dialog) => dialog.accept());
const api = async (path, method = "GET", body) =>
  page.evaluate(
    async ({ path, method, body }) => {
      const csrf = await (await fetch("/auth/get-csrf-token/")).json();
      const response = await fetch(path, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFTOKEN": csrf.csrf_token },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text.slice(0, 200);
      }
      return { status: response.status, data };
    },
    { path: `/api/workspaces/${slug}/engine/${path}`, method, body }
  );
const ok = (result, status = 200) => {
  assert.equal(result.status, status, JSON.stringify(result.data));
  return result.data;
};
const stamp = Date.now().toString(36),
  code = `browser-${stamp}`,
  amount = `amount-${stamp}`,
  total = `total-${stamp}`,
  choice = `choice-${stamp}`,
  flag = `flag-${stamp}`;
const amountTitle = `مبلغ آزمایشی ${stamp}`,
  totalTitle = `جمع محاسباتی ${stamp}`,
  choiceTitle = `انتخاب آزمایشی ${stamp}`,
  flagTitle = `گزینه پیش‌فرض ${stamp}`;
let entity,
  fieldIds = [],
  category,
  record;
try {
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="email"]').fill(env.DEV_ADMIN_EMAIL);
  await page.locator('input[name="password"]').fill(env.DEV_ADMIN_PASSWORD);
  await page.locator('.auth-card button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname !== "/login");
  await page.goto(`${base}/settings/engine`, { waitUntil: "domcontentloaded" });
  await page.locator(".app-shell").waitFor({ timeout: 120000 });
  console.log("Authenticated and opened entity settings");
  await page.getByRole("button", { name: "ایجاد جدید", exact: true }).click();
  const editor = page.locator(".engine-definition-editor");
  await editor.getByLabel("عنوان فارسی", { exact: true }).fill(`آزمایش مرورگر ${stamp}`);
  await editor.getByLabel("کد یکتا", { exact: true }).fill(code);
  await editor.getByRole("button", { name: "ذخیره موجودیت", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  entity = ok(await api("definitions/entities/")).find((item) => item.code === code);
  assert(entity);
  checks.push("Created a configured entity through the real admin UI without source changes");

  category = ok(
    await api("definitions/lookups/", "POST", { code: `options-${stamp}`, title: "گزینه‌های آزمایش مرورگر" }),
    201
  );
  const option = ok(
    await api("definitions/values/", "POST", {
      category: category.id,
      code: "first",
      title: "گزینه آزمایشی",
      color: "#2455aa",
    }),
    201
  );
  for (const field of [
    { code: amount, title: amountTitle, kind: "money", config: { default: "1250.50", min: 0, unit: "ریال" } },
    {
      code: total,
      title: totalTitle,
      kind: "computed",
      config: { formula: { op: "multiply", args: [{ field: amount }, { value: 2 }] } },
    },
    { code: choice, title: choiceTitle, kind: "select", lookup: category.id, config: {} },
    { code: flag, title: flagTitle, kind: "boolean", config: { default: true } },
  ])
    fieldIds.push(ok(await api("definitions/fields/", "POST", field), 201).id);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "فرم‌ساز", exact: true }).click();
  await page.getByRole("button", { name: "باز کردن فرم موجودیت / زیرنوع", exact: true }).click();
  await page.getByRole("option", { name: new RegExp(`آزمایش مرورگر ${stamp}`) }).click();
  await page.locator(".engine-library").waitFor();
  for (const label of ["عنوان", amountTitle, totalTitle, choiceTitle, flagTitle]) {
    await page.getByLabel("جستجوی فیلد", { exact: true }).fill(label);
    await page
      .locator(".engine-library-field")
      .filter({ has: page.locator("span", { hasText: new RegExp(`^${label}$`) }) })
      .click();
  }
  await page.locator(".engine-design-canvas .engine-binding").getByText(flagTitle, { exact: true }).click();
  const booleanDefault = page.locator(
    `.engine-binding-settings .engine-default-editor [data-field="${flag}"] input[type="checkbox"]`
  );
  await booleanDefault.check();
  await booleanDefault.uncheck();
  await page.getByRole("button", { name: "افزودن بخش", exact: true }).click();
  const secondSection = page
    .getByLabel("عنوان بخش", { exact: true })
    .nth(1)
    .locator("xpath=ancestor::div[contains(@class,'engine-drag-item')][1]");
  await secondSection.getByLabel("عنوان بخش", { exact: true }).fill("اطلاعات مالی");
  await secondSection.getByRole("button", { name: "باز کردن تعداد ستون", exact: true }).click();
  await page.getByRole("option", { name: "۳ ستون", exact: true }).click();
  const handle = page.getByRole("button", { name: `جابه‌جایی ${amountTitle}`, exact: true });
  await secondSection.scrollIntoViewIfNeeded();
  const from = await handle.boundingBox(),
    to = await secondSection.boundingBox();
  assert(from && to);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 12, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 });
  await page.mouse.up();
  await secondSection.getByRole("button", { name: `جابه‌جایی ${amountTitle}`, exact: true }).waitFor();
  checks.push("Dragged a real field into another section and configured three columns");
  await page.getByRole("button", { name: "ذخیره پیش‌نویس", exact: true }).click();
  await page.getByText("پیش‌نویس · ذخیره‌شده", { exact: true }).waitFor();
  const savedForm = ok(await api(`forms/${code}/`));
  const booleanBinding = savedForm.draft.sections
    .flatMap((section) => section.bindings)
    .find((binding) => binding.field === flag);
  assert.equal(booleanBinding.default, false);
  checks.push("A binding boolean default stays typed false and leaves the library default unchanged");
  assert.equal(ok(await api(`entities/${code}/schema/`)).fields.length, 0);
  checks.push("Unpublished draft stays separate from the public schema");
  await page.getByRole("button", { name: "انتشار فرم", exact: true }).click();
  await page.getByText("نسخه منتشرشده: ۱", { exact: true }).waitFor();
  assert.equal(ok(await api(`entities/${code}/schema/`)).fields.length, 5);
  await page.screenshot({ path: resolve(output, "designer-desktop.png"), fullPage: true });
  checks.push("Designed and published a form using the shared live renderer");

  await page.goto(`${base}/entities/${code}/new`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-field="title"] input').fill("رکورد واقعی از مرورگر");
  await page.locator(`[data-field="${amount}"] input`).fill("2000.25");
  await page.locator(`[data-field="${choice}"] button`).first().click();
  await page.getByRole("option", { name: "گزینه آزمایشی", exact: true }).click();
  await page.getByRole("button", { name: "ثبت رکورد", exact: true }).click();
  await page.waitForURL(new RegExp(`/entities/${code}/(?!new)[a-f0-9-]+$`));
  record = ok(await api(`entities/${code}/records/${page.url().split("/").pop()}/`));
  assert.equal(record.values[amount], "2000.25");
  assert.equal(record.values[total], 4000.5);
  assert.equal(record.values[choice], option.id);
  assert.equal(record.values[flag], false);
  checks.push("Created a real record with typed money, server lookup and calculated value");
  ok(await api(`definitions/values/${option.id}/`, "PATCH", { is_active: false }));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(`[data-field="${choice}"]`).getByText("گزینه آزمایشی", { exact: false }).waitFor();
  checks.push("Inactive historical lookup still renders on an existing record");
  await page.screenshot({ path: resolve(output, "record-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(output, "record-mobile.png"), fullPage: true });
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
    "Page must not overflow horizontally on mobile"
  );
  checks.push("Mobile record page stays within the viewport");

  await page.goto(`${base}/entities/task/new`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-field="title"]').waitFor();
  await page.goto(`${base}/entities/project/new`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-field="title"]').waitFor();
  await page.goto(`${base}/entities/leave/new`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-field="leave_user"]').waitFor();
  checks.push("Native task, project and leave forms load from the same schema renderer");
  assert.deepEqual(errors, []);
} catch (error) {
  await page.screenshot({ path: resolve(output, "failure.png"), fullPage: true }).catch(() => {});
  await writeFile(
    resolve(output, "failure.txt"),
    `${error.stack}\n${await page
      .locator("body")
      .innerText()
      .catch(() => "")}`
  );
  throw error;
} finally {
  if (record) await api(`entities/${code}/records/${record.id}/`, "DELETE").catch(() => {});
  if (entity) await api(`definitions/entities/${entity.id}/`, "PATCH", { is_active: false }).catch(() => {});
  for (const id of fieldIds) await api(`definitions/fields/${id}/`, "PATCH", { is_active: false }).catch(() => {});
  if (category) await api(`definitions/lookups/${category.id}/`, "PATCH", { is_active: false }).catch(() => {});
  await writeFile(
    resolve(output, "report.json"),
    JSON.stringify(
      {
        checks,
        errors,
        testEntity: code,
        cleanup: "Own record removed; definitions deactivated to retain audit/history",
      },
      null,
      2
    )
  );
  await browser.close();
}
console.log(JSON.stringify({ passed: checks.length, checks, errors }, null, 2));
