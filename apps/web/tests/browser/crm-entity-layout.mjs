/* eslint-disable no-await-in-loop -- Theme and viewport checks share a committed server fixture. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(resolve(".cache/browser/node_modules/playwright/index.mjs")).href);
const env = Object.fromEntries(
  (await readFile(".env.dev", "utf8"))
    .split(/\r?\n/)
    .filter((s) => /^[A-Z_]+=/.test(s))
    .map((s) => {
      const at = s.indexOf("=");
      return [s.slice(0, at), s.slice(at + 1).replace(/^(['"])(.*)\1$/, "$2")];
    })
);
const base = process.env.CRM_BROWSER_URL || "http://localhost:3000";
const slug = env.INTERNAL_WORKSPACE_SLUG || "dev-workspace";
const output = resolve("tmp/crm-entity-layout-browser");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();
page.setDefaultTimeout(60000);
page.setDefaultNavigationTimeout(120000);
const errors = [],
  checks = [],
  measurements = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (r) => {
  if (r.url().startsWith(base) && r.status() >= 500) errors.push(`${r.status()} ${new URL(r.url()).pathname}`);
});
const api = async (endpoint, verb = "GET", payload) =>
  page.evaluate(
    async ({ path, method, body }) => {
      const csrf = await (await fetch("/auth/get-csrf-token/")).json();
      const response = await fetch(path, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFTOKEN": csrf.csrf_token },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, data: response.status === 204 ? null : await response.json() };
    },
    { path: `/api/workspaces/${slug}/engine/${endpoint}`, method: verb, body: payload }
  );
const ok = (r, status = 200) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  return r.data;
};
const passed = (text) => {
  checks.push(text);
  console.log("PASS " + text);
};
const choose = async (label, option) => {
  await page
    .getByRole("button", { name: `باز کردن ${label}`, exact: true })
    .first()
    .click();
  await page.getByRole("option", { name: option, exact: true }).click();
};
const noPageOverflow = async () => {
  // The existing application shell animates its sidebar margin at breakpoints.
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 2, null, { timeout: 3000 });
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2),
    "Horizontal overflow must stay inside the table"
  );
};
const contrast = (foreground, background) => {
  const luminance = (color) =>
    color
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map(Number)
      .map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      })
      .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
  const a = luminance(foreground),
    b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
const stamp = Date.now().toString(36),
  code = `layout-${stamp}`;
const longTitle = "درخواست بررسی و تأیید اطلاعات کامل واحد سازمانی با توضیحات طولانی و جزئیات مورد نیاز برای تصمیم‌گیری "
  .repeat(2)
  .trim();
let entity,
  view,
  fieldIds = [],
  records = [];
const originalTheme = { value: "light" };
let loggedIn = false;
const setTheme = async (theme) => {
  const current = await page.locator("html").getAttribute("data-theme");
  if (current !== theme) {
    const persisted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/users/me/profile/") && response.request().method() === "PATCH" && response.ok()
    );
    await page.getByRole("button", { name: "تغییر پوسته", exact: true }).click();
    await persisted;
  }
  await page.waitForFunction((expectedTheme) => document.documentElement.dataset.theme === expectedTheme, theme);
};
try {
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(env.DEV_ADMIN_EMAIL);
  await page.locator('input[name="password"]').fill(env.DEV_ADMIN_PASSWORD);
  await page.locator('.auth-card button[type="submit"]').click();
  await page.waitForURL((u) => u.pathname !== "/login");
  await page.locator(".app-shell").waitFor({ timeout: 120000 });
  loggedIn = true;
  console.log("Setup: authenticated application loaded");
  originalTheme.value = (await page.locator("html").getAttribute("data-theme")) || "light";
  entity = ok(
    await api("definitions/entities/", "POST", {
      code,
      title: "فرم بررسی درخواست‌ها",
      description: "ثبت، مشاهده و پیگیری درخواست‌های واحدهای سازمانی با اطلاعات کامل",
    }),
    201
  );
  const defs = [
    { code: `amount-${stamp}`, title: "مبلغ کل درخواست به ریال", kind: "money", config: { unit: "ریال" } },
    { code: `due-${stamp}`, title: "تاریخ پایان بررسی درخواست", kind: "date", config: {} },
    { code: `flag-${stamp}`, title: "نیازمند تأیید مسئول واحد", kind: "boolean", config: {} },
    { code: `note-${stamp}`, title: "توضیحات تکمیلی", kind: "long_text", config: {} },
    { code: `file-${stamp}`, title: "پیوست درخواست", kind: "file", config: {} },
  ];
  for (const field of defs) fieldIds.push(ok(await api("definitions/fields/", "POST", field), 201).id);
  const form = ok(await api(`forms/${code}/`));
  const saved = ok(
    await api(`forms/${code}/`, "PUT", {
      revision: form.revision,
      draft: {
        tabs: [],
        sections: [
          {
            id: "main",
            title: "اطلاعات درخواست",
            columns: 3,
            bindings: ["title", ...defs.map((f) => f.code)].map((field) => ({ field })),
          },
        ],
      },
    })
  );
  ok(await api(`forms/${code}/`, "POST", { revision: saved.revision, change_note: "آزمایش چیدمان واکنش‌گرا" }));
  for (let i = 0; i < 24; i++)
    records.push(
      ok(
        await api(`entities/${code}/records/`, "POST", {
          values: {
            title: i === 23 ? longTitle : `درخواست بررسی اطلاعات واحد سازمانی شماره ${(i + 1).toLocaleString("fa-IR")}`,
            [defs[0].code]: 1250000 + i * 100,
            [defs[1].code]: "2026-10-25",
            [defs[2].code]: i % 2 === 0,
          },
        }),
        201
      )
    );
  const schema = ok(await api(`entities/${code}/view-schema/`));
  const definition = {
    ...schema.definition,
    type: "table",
    columns: [
      { field: "title", width: 280, pin: "right" },
      ...defs.slice(0, 3).map((f, i) => ({ field: f.code, width: 210, ...(i === 2 ? { pin: "left" } : {}) })),
    ],
  };
  view = ok(
    await api(`entities/${code}/views/`, "POST", { name: "نمای بررسی درخواست‌ها", visibility: "personal", definition }),
    201
  );
  console.log("Setup: independent form, published layout, records and saved view created");
  for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`${base}/entities`);
    await page.locator(".engine-entity-cards").waitFor();
    await setTheme(theme);
    assert(
      !/[a-z]/i.test(await page.locator(".engine-directory").innerText()),
      "Directory must use Persian titles without generated English fixture suffixes"
    );
    await page.getByPlaceholder("جستجوی نام یا توضیحات فرم…").fill("بررسی درخواست‌ها");
    assert.equal(await page.locator(".engine-entity-card").count(), 1);
    await page.getByRole("button", { name: "فرم‌های اصلی", exact: true }).click();
    await page.getByRole("heading", { name: "فرمی پیدا نشد", exact: true }).waitFor();
    await page.getByRole("button", { name: "فرم‌های سفارشی", exact: true }).click();
    await page.locator(".engine-entity-card").waitFor();
    await page.getByPlaceholder("جستجوی نام یا توضیحات فرم…").fill("");
    await page.getByRole("button", { name: "همه فرم‌ها", exact: true }).click();
    await noPageOverflow();
    await page.screenshot({ path: resolve(output, `catalog-${theme}-desktop.png`), fullPage: true });
    passed(`${theme}: searchable Persian catalog and category/empty states`);
    for (const width of [1440, 1024, 768, 390, 360, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await noPageOverflow();
      const cards = await page
        .locator(".engine-entity-card")
        .evaluateAll((items) =>
          items.map((item) => ({ width: item.clientWidth, overflow: item.scrollWidth > item.clientWidth + 1 }))
        );
      assert(
        cards.every((card) => card.width >= 190 && !card.overflow),
        "Catalog cards must fit the available width without clipped content"
      );
      if (width === 390)
        await page.screenshot({ path: resolve(output, `catalog-${theme}-mobile.png`), fullPage: true });
    }
    passed(`${theme}: catalog cards fit desktop, tablet and narrow mobile widths`);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`${base}/entities/${code}`);
    await page.locator(".schema-data-grid").waitFor();
    await choose("نمای ذخیره‌شده", "نمای بررسی درخواست‌ها · شخصی");
    await page.locator(".schema-data-grid th").filter({ hasText: defs[2].title }).waitFor();
    await page.waitForFunction(
      () => document.querySelector(".schema-data-grid th:last-child")?.style.position === "sticky"
    );
    for (const width of [1920, 1440, 1024, 768, 390, 360, 320]) {
      await page.setViewportSize({ width, height: width < 500 ? 900 : 1080 });
      await page.waitForTimeout(150);
      await noPageOverflow();
      const metrics = await page.locator(".schema-data-grid").evaluate((el, expectedTitle) => {
        const row = [...el.querySelectorAll("tbody tr:not([aria-hidden])")].find((item) =>
          item.textContent.includes(expectedTitle)
        );
        const cells = [...row.children],
          last = cells.at(-1).getBoundingClientRect(),
          first = cells[0].getBoundingClientRect();
        const th = el.querySelector("th:nth-child(2)"),
          header = th.querySelector(".schema-grid-column-title");
        return {
          container: el.clientWidth,
          scroll: el.scrollWidth,
          tracks: cells.reduce((n, c) => n + c.getBoundingClientRect().width, 0),
          suspended: el.dataset.pinsSuspended === "true",
          sticky: cells.filter((c) => getComputedStyle(c).position === "sticky").length,
          selectionRight: first.right,
          lastLeft: last.left,
          background: getComputedStyle(el).backgroundColor,
          text: getComputedStyle(el).color,
          headerClipped: header.scrollHeight > th.clientHeight,
          rowHeight: row.getBoundingClientRect().height,
          clippedCells: cells.filter((cell) => cell.scrollHeight > cell.clientHeight + 1).length,
          titleClamp: getComputedStyle(row.querySelector(".engine-view-cell > a")).webkitLineClamp,
        };
      }, longTitle);
      assert(!metrics.headerClipped, "Column headings must remain fully readable");
      assert.equal(metrics.clippedCells, 0, "Natural row height must show the complete contents of every cell");
      assert.equal(metrics.titleClamp, "none", "Long record titles must not be line clamped");
      assert(metrics.rowHeight > 64, "A long title must expand its row instead of being clipped");
      if (width >= 1440) {
        assert(
          Math.abs(metrics.tracks - metrics.container) < 3,
          "Desktop columns must fill the entire available width"
        );
        assert.equal(metrics.sticky, 3);
      }
      if (width <= 390) {
        assert(metrics.suspended);
        assert.equal(metrics.sticky, 1);
        assert(metrics.scroll > metrics.container);
      }
      assert.equal(metrics.background, theme === "dark" ? "rgb(21, 24, 30)" : "rgb(255, 255, 255)");
      assert(
        contrast(metrics.text, metrics.background) >= 4.5,
        "Default table text must remain readable in both themes"
      );
      measurements.push({ theme, width, ...metrics });
      if ([1920, 390].includes(width))
        await page.screenshot({ path: resolve(output, `table-${theme}-${width}.png`), fullPage: true });
      passed(`${theme}: ${width}px table width, headings, theme and safe pinning`);
    }
    await page.setViewportSize({ width: 1440, height: 1080 });
    await page.locator(".schema-data-grid").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await page.getByText("درخواست بررسی اطلاعات واحد سازمانی شماره ۱", { exact: true }).waitFor();
    assert(
      (await page.locator(".schema-data-grid tbody tr[data-entry-key]").count()) <= 32,
      "Virtual rows must remain bounded after scrolling past long content"
    );
    await page.locator(".schema-data-grid").evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.getByText(longTitle, { exact: true }).waitFor();
    passed(`${theme}: variable-height virtual rows reach both ends of the page`);
    const resizer = page.getByRole("button", { name: `تغییر عرض ${defs[0].title}`, exact: true });
    await resizer.focus();
    await page.keyboard.press("ArrowLeft");
    await page.locator('.schema-data-grid tbody input[type="checkbox"]').first().check();
    await page.getByRole("button", { name: "عملیات روی ۱ رکورد این صفحه", exact: true }).waitFor();
    await page.getByRole("button", { name: "ستون‌ها و ترتیب", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    const panel = await page
      .locator(".engine-view-drawer")
      .evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, width: el.getBoundingClientRect().width }));
    assert.equal(panel.bg, theme === "dark" ? "rgb(21, 24, 30)" : "rgb(255, 255, 255)");
    assert(panel.width <= 1440);
    await page.keyboard.press("Escape");
    passed(`${theme}: keyboard resizing, selection and themed settings drawer`);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.getByRole("button", { name: "ستون‌ها و ترتیب", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    assert(
      await page.locator(".engine-view-drawer").evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      "Mobile settings must not overflow horizontally"
    );
    await page.keyboard.press("Escape");
    passed(`${theme}: settings drawer fits a narrow viewport`);
    await page.goto(`${base}/entities/${code}/new`);
    await page.locator(".engine-record-form .schema-form").waitFor();
    for (const width of [1920, 1440, 1024, 768, 390, 360, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await noPageOverflow();
      assert(!/[a-z]/i.test(await page.locator(".breadcrumb").innerText()));
      const form = await page.locator(".engine-record-form").evaluate((el) => {
        const fields = [...el.querySelectorAll(".schema-field")];
        const grid = el.querySelector(".schema-grid");
        const input = el.querySelector('.schema-field input:not([type="checkbox"]):not([type="file"])');
        return {
          columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
          width: el.clientWidth,
          clipped: fields.filter((field) => field.scrollWidth > field.clientWidth + 1).length,
          inputText: getComputedStyle(input).color,
          inputBackground: getComputedStyle(input).backgroundColor,
          fileLabel: el.querySelector(".schema-file-upload").innerText,
          longFieldWidth: el.querySelector(".schema-field-long_text").clientWidth,
          gridWidth: grid.clientWidth,
        };
      });
      assert.equal(form.clipped, 0, "Labels, date controls and inputs must fit their form fields");
      assert.equal(
        form.columns,
        form.width <= 520 ? 1 : form.width <= 760 ? 2 : 3,
        "Columns must adapt to the actual form width"
      );
      assert.equal(form.longFieldWidth, form.gridWidth, "Long text fields must have the full available width");
      assert(
        contrast(form.inputText, form.inputBackground) >= 4.5,
        "Default form inputs must be readable in both themes"
      );
      assert.equal(form.fileLabel, "انتخاب و بارگذاری فایل", "The upload control must have a Persian label");
      if (width === 1440) {
        await page.getByRole("textbox", { name: "عنوان", exact: true }).fill("درخواست آزمایشی ثبت و ویرایش");
      }
      await page.screenshot({ path: resolve(output, `form-${theme}-${width}.png`), fullPage: true });
    }
    // Save a real form and reopen it to cover the same layout while editing.
    await page.getByRole("button", { name: "ثبت رکورد", exact: true }).click();
    await page.waitForURL((url) => url.pathname.startsWith(`/entities/${code}/`) && !url.pathname.endsWith("/new"));
    const createdId = new URL(page.url()).pathname.split("/").at(-1);
    records.push({ id: createdId });
    await page.getByRole("button", { name: "ذخیره تغییرات", exact: true }).waitFor();
    await page.getByRole("textbox", { name: "عنوان", exact: true }).fill("درخواست ویرایش‌شده با فرم فارسی");
    await page.getByRole("button", { name: "ذخیره تغییرات", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector(".page-header h1")?.textContent === "درخواست ویرایش‌شده با فرم فارسی"
    );
    await noPageOverflow();
    passed(`${theme}: connected record form and Persian navigation at desktop/mobile sizes`);
  }
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
  if (loggedIn) await setTheme(originalTheme.value).catch(() => {});
  if (view) await api(`entities/${code}/views/${view.id}/`, "DELETE").catch(() => {});
  if (records.length)
    await api(`entities/${code}/bulk/`, "POST", { ids: records.map((r) => r.id), operation: "delete" }).catch(() => {});
  if (entity) await api(`definitions/entities/${entity.id}/`, "PATCH", { is_active: false }).catch(() => {});
  for (const id of fieldIds) await api(`definitions/fields/${id}/`, "PATCH", { is_active: false }).catch(() => {});
  await writeFile(resolve(output, "report.json"), JSON.stringify({ checks, errors, measurements }, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ passed: checks.length, errors }, null, 2));
