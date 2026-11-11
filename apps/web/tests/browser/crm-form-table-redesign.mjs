/* Browser acceptance test against the local authenticated development stack. */
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
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
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const stamp = Date.now().toString(36);
const evidence = resolve("tmp/form-table-redesign");
await mkdir(evidence, { recursive: true });
const code = `ux_${stamp}`;
const firstTitle = `شماره آزمایشی ${stamp}`;
const secondTitle = `یادداشت آزمایشی ${stamp}`;
const errors = [];
const createdFields = [];
let entity;
let officialViewId;
let personalViewId;
page.on("pageerror", (error) => errors.push(error.message));
page.on("dialog", (dialog) => void dialog.accept());
page.setDefaultTimeout(30000);

async function engine(path, method = "GET", data) {
  const csrf = await (await context.request.get(`${base}/auth/get-csrf-token/`)).json();
  const response = await context.request.fetch(`${base}/api/workspaces/${slug}/engine/${path}`, {
    method,
    headers: { "X-CSRFTOKEN": csrf.csrf_token },
    ...(data === undefined ? {} : { data }),
  });
  const body = response.status() === 204 ? null : await response.json();
  assert(response.ok(), `${method} ${path}: ${JSON.stringify(body)}`);
  return body;
}

try {
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(env.DEV_ADMIN_EMAIL);
  await page.locator('input[name="password"]').fill(env.DEV_ADMIN_PASSWORD);
  await page.locator('.auth-card button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname !== "/login");
  entity = await engine("definitions/entities/", "POST", { code, title: `تجربه فرم ${stamp}`, is_active: true });
  await page.goto(`${base}/settings/engine`);
  await page.getByRole("heading", { name: "فرم و جدول کدام بخش را تنظیم می‌کنید؟" }).waitFor();
  await page.getByLabel("جستجوی بخش").fill(entity.title);
  await page
    .getByRole("navigation", { name: "انتخاب بخش" })
    .getByRole("button", { name: new RegExp(entity.title) })
    .click();
  await page
    .getByRole("navigation", { name: "انتخاب فرم یا جدول" })
    .getByRole("button", { name: /^فرم/ })
    .click();

  for (const title of [firstTitle, secondTitle]) {
    await page.getByRole("button", { name: "ساخت ورودی جدید" }).click();
    const editor = page.locator(".engine-field-drawer .engine-definition-editor");
    await editor.getByLabel("نام ورودی (همان چیزی که کاربر می‌بیند)").fill(title);
    await editor.getByRole("button", { name: "ذخیره ورودی فرم" }).click();
    await editor.waitFor({ state: "hidden" });
    await page.locator(".engine-binding").filter({ hasText: title }).waitFor();
  }
  const bindings = page.locator(".engine-design-section .engine-binding");
  assert.equal(await bindings.count(), 3);
  await page.getByRole("button", { name: `انتقال ${firstTitle} به پایین` }).focus();
  await page.keyboard.press("Enter");
  assert.equal(await bindings.nth(1).innerText(), secondTitle);
  await page.locator(".engine-binding").filter({ hasText: firstTitle }).click();
  await page.locator(".engine-binding-settings").getByLabel("پر کردن آن اجباری است").check();
  const advanced = page.locator(".engine-binding-advanced");
  await advanced.locator("summary").click();
  await advanced.getByRole("heading", { name: "مقدار اولیه" }).waitFor();
  await advanced.getByRole("heading", { name: "دسترسی به ورودی" }).waitFor();
  const autoDefault = advanced.getByRole("combobox", { name: "پر شدن خودکار هنگام ثبت رکورد جدید" });
  for (const width of [390, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await autoDefault.click();
    const menu = page.locator(".selector-single-options:visible");
    await menu.waitFor();
    const box = await menu.boundingBox();
    assert(box, `automatic default menu missing at ${width}px`);
    assert(
      box.x >= -2 && box.x + box.width <= width + 2 && box.y >= -2 && box.y + box.height <= 902,
      `automatic default menu clipped at ${width}px: ${JSON.stringify(box)}`
    );
    if (width === 390 || width === 1280)
      await page.screenshot({ path: resolve(evidence, `advanced-menu-${width}.png`) });
    if (width === 390) {
      await autoDefault.fill("امروز");
      await page.getByRole("option", { name: "امروز" }).click();
      assert.equal(await autoDefault.inputValue(), "امروز");
      await autoDefault.click();
      await page.getByRole("option", { name: "بدون مقدار اولیهٔ خودکار" }).click();
    } else {
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "hidden" });
    }
  }
  await page.getByRole("navigation", { name: "کارهای فرم" }).getByRole("button", { name: "پیش‌نمایش فرم" }).click();
  await page.getByRole("button", { name: "بررسی خطاهای فرم" }).click();
  await page.locator(".schema-field").filter({ hasText: firstTitle }).getByRole("alert").waitFor();
  await page.getByRole("button", { name: "حالت ویرایش" }).click();
  await page.getByRole("button", { name: "حالت ثبت" }).click();
  await page.getByRole("button", { name: "ذخیرهٔ پیش‌نویس" }).click();
  await page.getByRole("status").filter({ hasText: "پیش‌نویس ذخیره شد" }).waitFor();
  const draft = await engine(`forms/${code}/`);
  assert.equal(draft.published, null);
  assert.equal(draft.draft.sections[0].bindings.length, 3);

  for (const width of [390, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.getByRole("button", { name: "ذخیرهٔ پیش‌نویس" }).isVisible());
    await page.waitForFunction(() => document.documentElement.scrollWidth <= window.innerWidth + 2);
    const overflow = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      elements: [...document.querySelectorAll("body *")]
        .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 2)
        .slice(0, 12)
        .map(
          (element) =>
            `${element.tagName}.${String(element.className).slice(0, 65)}:${Math.round(element.getBoundingClientRect().right)}`
        ),
    }));
    assert(overflow.width <= width + 2, `horizontal overflow at ${width}px: ${JSON.stringify(overflow)}`);
    if (width === 390 || width === 1280)
      await page.screenshot({ path: resolve(evidence, `form-${width}.png`), fullPage: true });
  }
  await engine(`forms/${code}/`, "POST", { revision: draft.revision });
  await page.reload();
  await page
    .getByRole("navigation", { name: "انتخاب بخش" })
    .getByRole("button", { name: new RegExp(entity.title) })
    .click();
  await page
    .getByRole("navigation", { name: "انتخاب فرم یا جدول" })
    .getByRole("button", { name: /^جدول/ })
    .click();
  await page.getByRole("heading", { name: "نماهای رسمی ذخیره‌شده" }).waitFor();
  await page.getByRole("region", { name: "پیش‌نمایش ستون‌های نمای رسمی" }).waitFor();
  assert((await page.getByText("نمای شخصی هر کاربر جداگانه ذخیره می‌شود.").count()) > 0);
  const tableSort = page.getByRole("combobox", { name: "مرتب‌سازی بر اساس" });
  for (const width of [390, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await tableSort.click();
    const menu = page.locator(".selector-single-options:visible");
    await menu.waitFor();
    const box = await menu.boundingBox();
    assert(box, `table sort menu missing at ${width}px`);
    assert(
      box.x >= -2 && box.x + box.width <= width + 2 && box.y >= -2 && box.y + box.height <= 902,
      `table sort menu clipped at ${width}px: ${JSON.stringify(box)}`
    );
    assert(box.width >= Math.min(250, width - 24) - 2, `table sort menu too narrow at ${width}px: ${box.width}`);
    const columnName = await page.locator(".engine-column-row .engine-column-name").first().boundingBox();
    assert(columnName && columnName.width >= 90, `table column name cramped at ${width}px: ${columnName?.width}`);
    if (width === 390 || width === 1280) await page.screenshot({ path: resolve(evidence, `table-menu-${width}.png`) });
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.documentElement.scrollWidth <= window.innerWidth + 2);
  }
  const viewSchema = await engine(`entities/${code}/view-schema/`);
  const chosen = viewSchema.fields.find((field) => field.title === firstTitle);
  assert(chosen, "The published input should be available as a table column");
  await page.getByRole("button", { name: `مخفی کردن ${firstTitle}` }).click();
  const columnPicker = page.getByRole("combobox", { name: "افزودن ستون" });
  await columnPicker.fill(firstTitle);
  await page.getByRole("option", { name: firstTitle }).click();
  await page
    .getByRole("region", { name: "پیش‌نمایش ستون‌های نمای رسمی" })
    .getByRole("columnheader", { name: firstTitle })
    .waitFor();
  await page.getByRole("button", { name: "ذخیرهٔ نمای رسمی برای کاربران" }).click();
  await page.getByRole("status").filter({ hasText: "نمای رسمی ذخیره شد" }).waitFor();
  const official = (await engine(`entities/${code}/views/`)).results.find((view) => view.visibility === "official");
  assert(official?.definition.columns.some((column) => column.field === chosen.code));
  officialViewId = official.id;

  await page.goto(`${base}/entities/${code}`);
  await page.getByRole("combobox", { name: "نمای ذخیره‌شده" }).fill(official.name);
  await page.getByRole("option", { name: new RegExp(official.name) }).click();
  await page.getByRole("button", { name: "ساخت نمای شخصی از این نما" }).click();
  const saveView = page.locator(".engine-view-settings").last();
  await saveView.getByLabel("نام نما").fill(`نمای شخصی ${stamp}`);
  await saveView.getByRole("button", { name: "ذخیرهٔ نمای شخصی من" }).click();
  await saveView.waitFor({ state: "hidden" });
  await page.getByRole("status").filter({ hasText: "نمای شخصی من ذخیره شد" }).waitFor();
  personalViewId = (await engine(`entities/${code}/views/`)).results.find(
    (view) => view.name === `نمای شخصی ${stamp}`
  )?.id;
  assert(personalViewId, "Personal view must be saved separately from the official view");
  await page.getByRole("button", { name: "ستون‌ها و ترتیب" }).click();
  await page.getByText("مرتب‌سازی جدول من بر اساس").waitFor();
  await page.getByText("گروه‌بندی جدول من بر اساس").waitFor();
  await page.getByText("تنظیمات پیشرفتهٔ نمای شخصی").waitFor();
  assert.deepEqual(errors, []);
} catch (error) {
  console.error(
    "Browser page at failure:",
    page.url(),
    (
      await page
        .locator("body")
        .innerText()
        .catch(() => "")
    ).slice(0, 2000)
  );
  console.error("Browser errors:", errors);
  throw error;
} finally {
  if (personalViewId) await engine(`entities/${code}/views/${personalViewId}/`, "DELETE").catch(() => {});
  if (officialViewId) await engine(`entities/${code}/views/${officialViewId}/`, "DELETE").catch(() => {});
  const fields = await engine("definitions/fields/").catch(() => []);
  for (const field of fields.filter((item) => [firstTitle, secondTitle].includes(item.title))) {
    createdFields.push(field.id);
    await engine(`definitions/fields/${field.id}/`, "PATCH", { is_active: false }).catch(() => {});
  }
  if (entity) await engine(`definitions/entities/${entity.id}/`, "PATCH", { is_active: false }).catch(() => {});
  await browser.close();
}
console.log(
  `PASS form draft, keyboard order, preview errors, four widths, and official/personal distinction (${createdFields.length} test inputs)`
);
