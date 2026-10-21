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
const output = resolve("tmp/crm-entity-views-browser");
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
  code = `view-browser-${stamp}`;
const keys = {
  amount: `amount-${stamp}`,
  phase: `phase-${stamp}`,
  due: `due-${stamp}`,
  flag: `flag-${stamp}`,
  related: `related-${stamp}`,
};
const names = {
  amount: "مبلغ مرورگر",
  phase: "مرحله مرورگر",
  due: "موعد مرورگر",
  flag: "گزینه مرورگر",
  related: "ارتباط مرورگر",
};
let entity,
  category,
  fieldIds = [],
  records = [],
  savedIds = [],
  lastQuery;
page.on("request", (request) => {
  if (request.url().endsWith(`/entities/${code}/query/`) && request.method() === "POST")
    lastQuery = request.postDataJSON();
});
const passed = (value) => {
  checks.push(value);
  console.log("PASS " + value);
};
const choose = async (label, option, scope = page) => {
  await scope
    .getByRole("button", { name: `باز کردن ${label}`, exact: true })
    .first()
    .click();
  await page.getByRole("option", { name: option, exact: true }).click();
};
const waitFor = async (predicate, message, timeout = 60000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(message);
};
try {
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="email"]').fill(env.DEV_ADMIN_EMAIL);
  await page.locator('input[name="password"]').fill(env.DEV_ADMIN_PASSWORD);
  await page.locator('.auth-card button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname !== "/login");
  await page.locator(".app-shell").waitFor({ timeout: 120000 });
  entity = ok(await api("definitions/entities/", "POST", { code, title: `نماهای مرورگر ${stamp}` }), 201);
  category = ok(await api("definitions/lookups/", "POST", { code: `phase-${stamp}`, title: "مرحله آزمایشی نما" }), 201);
  const options = [];
  for (const [key, title, color] of [
    ["open", "باز آزمایشی", "#2563eb"],
    ["done", "انجام‌شده آزمایشی", "#16a34a"],
  ])
    options.push(ok(await api("definitions/values/", "POST", { category: category.id, code: key, title, color }), 201));
  for (const field of [
    { code: keys.amount, title: names.amount, kind: "money", config: { min: 0, unit: "ریال" } },
    { code: keys.phase, title: names.phase, kind: "select", lookup: category.id, config: {} },
    { code: keys.due, title: names.due, kind: "date", config: {} },
    { code: keys.flag, title: names.flag, kind: "boolean", config: {} },
    { code: keys.related, title: names.related, kind: "relation", relation_entity: entity.id, config: {} },
  ])
    fieldIds.push(ok(await api("definitions/fields/", "POST", field), 201).id);
  const form = ok(await api(`forms/${code}/`));
  const draft = {
    tabs: [],
    sections: [
      {
        id: "main",
        title: "اطلاعات",
        columns: 2,
        bindings: ["title", ...Object.values(keys)].map((field) => ({ field })),
      },
    ],
  };
  const saved = ok(await api(`forms/${code}/`, "PUT", { revision: form.revision, draft }));
  ok(await api(`forms/${code}/`, "POST", { revision: saved.revision, change_note: "آزمایش واقعی پنج نما" }));
  for (let i = 0; i < 50; i++)
    records.push(
      ok(
        await api(`entities/${code}/records/`, "POST", {
          values: {
            title: `درخواست مرورگر ${i}`,
            [keys.amount]: String(1000 + i * 10),
            [keys.phase]: options[i % 2].id,
            [keys.due]: "2026-10-19",
            [keys.flag]: i % 2 === 0,
          },
        }),
        201
      )
    );
  console.log("Created 50 real records using the published field/form engine");
  const relatedRecord = records.at(-1);
  ok(
    await api(`entities/${code}/records/${relatedRecord.id}/`, "PATCH", {
      revision: relatedRecord.revision,
      values: { [keys.related]: records[0].id },
    })
  );
  await page.goto(`${base}/entities/${code}`, { waitUntil: "domcontentloaded" });
  await page.locator(".schema-data-grid tbody tr").first().waitFor();
  await page.getByText("۵۰ رکورد مجاز", { exact: false }).waitFor();
  assert((await page.locator(".schema-data-grid tbody tr").count()) < 50, "Virtual grid should keep the DOM bounded");
  passed("Real server page, totals and virtual DOM render through the common engine");

  const previewButton = page.getByRole("button", { name: "اطلاعات رکورد مرتبط", exact: true }).first();
  await previewButton.hover();
  const relatedPanel = page.getByRole("dialog", { name: "اطلاعات رکورد مرتبط", exact: true });
  await relatedPanel.getByText("درخواست مرورگر 0", { exact: true }).waitFor();
  assert.equal(
    await relatedPanel.evaluate((element) => element.parentElement === document.body),
    true,
    "Relation preview must escape the table's clipping container"
  );
  await relatedPanel.hover();
  assert.equal(
    await relatedPanel.getByRole("link", { name: "باز کردن جزئیات", exact: true }).getAttribute("href"),
    `/entities/${code}/${records[0].id}`
  );
  await relatedPanel.getByRole("button", { name: "بستن اطلاعات رکورد مرتبط", exact: true }).click();
  await previewButton.focus();
  await previewButton.press("Enter");
  await relatedPanel.waitFor();
  await relatedPanel.press("Escape");
  await relatedPanel.waitFor({ state: "hidden" });
  assert.equal(
    await previewButton.evaluate((element) => element === document.activeElement),
    true,
    "Closing the information panel must restore keyboard focus to its trigger"
  );
  await page.locator(".schema-data-grid").evaluate((grid) => {
    grid.scrollLeft = 0;
  });
  passed("Relation information opens outside clipped cells with hover, keyboard and a direct record link");

  const resizer = page.getByRole("button", { name: `تغییر عرض ${names.amount}`, exact: true });
  const box = await resizer.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 55, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await waitFor(
    () => lastQuery?.definition.columns.find((c) => c.field === keys.amount)?.width > 180,
    "Column width was not committed"
  );
  await page.getByRole("button", { name: "ستون‌ها و ترتیب", exact: true }).click();
  const drawer = page.locator(".engine-view-drawer");
  const amountSettings = drawer.locator(".engine-column-row").filter({ hasText: names.amount });
  await choose("پین ستون", "چپ", amountSettings);
  await drawer.getByRole("button", { name: `مخفی کردن ${keys.flag}`, exact: true }).click();
  await drawer.getByRole("button", { name: "بستن تنظیمات", exact: true }).click();
  await waitFor(
    () =>
      lastQuery?.definition.columns.find((c) => c.field === keys.amount)?.pin === "left" &&
      !lastQuery.definition.columns.some((c) => c.field === keys.flag),
    "Column configuration did not reach the API"
  );
  passed("Resizing, pinning and hiding columns change the validated server definition");

  const last = records.at(-1);
  const row = page
    .locator(".schema-data-grid tbody tr")
    .filter({ has: page.getByText("درخواست مرورگر 49", { exact: true }) });
  await row.getByRole("button", { name: `ویرایش ${names.amount}`, exact: true }).click();
  const inline = page.locator(".engine-inline-panel");
  await inline.locator(`[data-field="${keys.amount}"] input`).fill("-1");
  await inline.getByRole("button", { name: "ذخیره", exact: true }).click();
  await inline.getByRole("alert").first().waitFor();
  assert.equal(ok(await api(`entities/${code}/records/${last.id}/`)).values[keys.amount], "1490");
  await inline.locator(`[data-field="${keys.amount}"] input`).fill("1750.75");
  await inline.getByRole("button", { name: "ذخیره", exact: true }).click();
  await inline.waitFor({ state: "hidden" });
  assert.equal(ok(await api(`entities/${code}/records/${last.id}/`)).values[keys.amount], "1750.75");
  passed("Inline edit shows validation at the field, preserves rejected values and commits valid money");

  for (const record of records.slice(-2))
    await page.getByRole("checkbox", { name: `انتخاب رکورد ${record.id}`, exact: true }).check();
  await page.getByRole("button", { name: "عملیات روی ۲ رکورد این صفحه", exact: true }).click();
  await choose("فیلد تغییر گروهی", names.flag, drawer);
  await choose(names.flag, "بله", drawer);
  await drawer.getByRole("button", { name: "تغییر فیلد", exact: true }).click();
  await waitFor(
    async () => (await drawer.getByRole("status").count()) === 2,
    "Bulk result was not reported per record"
  );
  for (const record of records.slice(-2))
    assert.equal(ok(await api(`entities/${code}/records/${record.id}/`)).values[keys.flag], true);
  await drawer.getByRole("button", { name: "بستن تنظیمات", exact: true }).click();
  passed("Bulk editing selects actual page records and reports each validated update");

  await page.getByRole("button", { name: "فیلتر پیشرفته", exact: true }).click();
  await drawer.getByRole("button", { name: "افزودن شرط", exact: true }).click();
  await choose("فیلد شرط", names.amount, drawer);
  await choose("عملگر", "بزرگ‌تر / بعد از", drawer);
  await drawer.locator(`[data-field="${keys.amount}"] input`).fill("1200");
  await drawer.getByRole("button", { name: "گروه تو‌در‌تو", exact: true }).click();
  await drawer.getByRole("button", { name: "گروه تو‌در‌تو", exact: true }).click();
  await choose("ترکیب", "حداقل یکی (یا)", drawer.locator("fieldset.engine-rule-group").first());
  await drawer.getByRole("button", { name: "نمایش نتیجه", exact: true }).click();
  await waitFor(
    () => lastQuery?.definition.filter?.op === "or" && lastQuery.definition.filter.rules?.[0]?.op === "and",
    "Nested AND/OR filter was not sent"
  );
  await page.getByText("۲۹ رکورد مجاز", { exact: false }).waitFor();
  passed("The advanced UI builds nested AND/OR and the server filters the complete dataset");

  await page.getByRole("button", { name: "ذخیره نمای جدید", exact: true }).click();
  await drawer.getByLabel("نام نما", { exact: true }).fill(`نمای شخصی مرورگر ${stamp}`);
  await drawer.getByRole("button", { name: "ذخیره نما", exact: true }).click();
  await drawer.waitFor({ state: "hidden" });
  const view = ok(await api(`entities/${code}/views/`)).results.find((v) => v.name === `نمای شخصی مرورگر ${stamp}`);
  assert(view);
  savedIds.push(view.id);
  assert.equal(view.visibility, "personal");
  assert.equal(view.definition.filter.op, "or");
  await page.reload({ waitUntil: "domcontentloaded" });
  await choose("نمای ذخیره‌شده", "نمای شخصی مرورگر · شخصی");
  await page.getByText("۲۹ رکورد مجاز", { exact: false }).waitFor();
  passed("Personal views persist JSON column/filter settings and can be reloaded");

  await page.getByRole("button", { name: "ظاهر و خلاصه رسمی", exact: true }).click();
  await drawer.getByRole("button", { name: "افزودن قاعده", exact: true }).click();
  await choose("فیلد شرط", names.amount, drawer);
  await choose("عملگر", "بزرگ‌تر / بعد از", drawer);
  await drawer.locator(`[data-field="${keys.amount}"] input`).fill("1200");
  await drawer.getByRole("button", { name: "ذخیره تنظیمات رسمی", exact: true }).click();
  await drawer.waitFor({ state: "hidden" });
  await waitFor(async () => {
    const styles = await page
      .locator(".schema-data-grid tbody tr")
      .evaluateAll((rows) => rows.map((r) => r.style.backgroundColor));
    return styles.includes("rgb(254, 226, 226)");
  }, "Official rule did not style table rows");
  passed("The official no-code condition editor applies server-evaluated appearance");

  await choose("نوع نما", "کانبان");
  await choose("محور کانبان", names.phase);
  await page.locator(".engine-kanban-view .engine-view-card").first().waitFor();
  const firstCard = page.locator(".engine-kanban-view .engine-view-card").filter({ hasText: "درخواست مرورگر 49" });
  const destination = page
    .locator(".engine-kanban-view > section")
    .filter({ has: page.getByRole("heading", { name: "باز آزمایشی", exact: true }) });
  await firstCard.dragTo(destination.getByRole("heading", { name: "باز آزمایشی", exact: true }));
  await waitFor(
    async () => ok(await api(`entities/${code}/records/${last.id}/`)).values[keys.phase] === options[0].id,
    "Kanban move did not update the selected lookup field"
  );
  passed("Kanban is driven by the selected lookup and drag persists through the record validator");
  await choose("نوع نما", "تقویم");
  await choose("محور تاریخ تقویم", names.due);
  await page.locator(".engine-calendar-grid .engine-view-card").first().waitFor();
  assert((await page.locator(".engine-calendar-grid").getByText("درخواست مرورگر 49", { exact: true }).count()) > 0);
  await page.screenshot({ path: resolve(output, "calendar.png"), fullPage: true });
  passed("Calendar uses the selected custom date and a Persian month");
  for (const kind of ["کارت", "لیست فشرده"]) {
    await choose("نوع نما", kind);
    await page.getByText("درخواست مرورگر 49", { exact: true }).first().waitFor();
  }
  passed("Cards and compact list consume the same server definition and official appearance");

  await page.getByRole("button", { name: "خروجی", exact: true }).click();
  await drawer.getByRole("button", { name: "درخواست اکسل", exact: true }).click();
  await drawer.getByRole("link", { name: "دانلود", exact: true }).first().waitFor({ timeout: 120000 });
  const href = await drawer.getByRole("link", { name: "دانلود", exact: true }).first().getAttribute("href");
  const download = await context.request.get(new URL(href, base).href);
  assert.equal(download.status(), 200);
  assert.equal((await download.body()).subarray(0, 2).toString(), "PK");
  passed("A real Celery XLSX export becomes downloadable through the authorized endpoint");
  await drawer.getByRole("button", { name: "بستن تنظیمات", exact: true }).click();
  await page.screenshot({ path: resolve(output, "desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await choose("نوع نما", "جدول");
  await page.locator(".schema-data-grid tbody tr").first().waitFor();
  const pinnedCells = page.locator(".schema-data-grid tbody tr").first().locator("td");
  const assertOpaquePins = async () => {
    const colors = await pinnedCells.evaluateAll((cells) =>
      cells
        .filter((cell) => getComputedStyle(cell).position === "sticky")
        .map((cell) => getComputedStyle(cell).backgroundColor)
    );
    assert.equal(colors.length, 1, "Narrow screens keep only selection fixed so pinned sides cannot cover the content");
    assert(
      colors.every((color) => color !== "transparent" && color !== "rgba(0, 0, 0, 0)"),
      "Pinned cells must cover the text scrolling underneath them"
    );
  };
  await page.locator('.schema-data-grid[data-pins-suspended="true"]').waitFor();
  await assertOpaquePins();
  await page.locator(".schema-data-grid").evaluate((grid) => {
    grid.scrollLeft = -150;
  });
  await assertOpaquePins();
  await page.locator(".schema-data-grid").evaluate((grid) => {
    grid.scrollLeft = 0;
  });
  await page.screenshot({ path: resolve(output, "mobile.png"), fullPage: true });
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
    "The view must not overflow the mobile page"
  );
  passed("The connected mobile view scrolls internally, suspends overlapping pins and keeps selection opaque");
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
  for (const id of savedIds) await api(`entities/${code}/views/${id}/`, "DELETE").catch(() => {});
  if (records.length)
    await api(`entities/${code}/bulk/`, "POST", { ids: records.map((r) => r.id).reverse(), operation: "delete" }).catch(
      () => {}
    );
  if (entity) await api(`definitions/entities/${entity.id}/`, "PATCH", { is_active: false }).catch(() => {});
  for (const id of fieldIds) await api(`definitions/fields/${id}/`, "PATCH", { is_active: false }).catch(() => {});
  if (category) await api(`definitions/lookups/${category.id}/`, "PATCH", { is_active: false }).catch(() => {});
  await writeFile(
    resolve(output, "report.json"),
    JSON.stringify(
      { checks, errors, testEntity: code, cleanup: "Own records removed; definitions deactivated for audit/history" },
      null,
      2
    )
  );
  await browser.close();
}
console.log(JSON.stringify({ passed: checks.length, checks, errors }, null, 2));
