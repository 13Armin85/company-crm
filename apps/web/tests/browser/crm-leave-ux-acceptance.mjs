/* Local browser acceptance: calendar, invalid hours, draft, unsaved edits, save,
 * Word sample download, preview readiness and cancellation. No signature is applied.
 * Run from the repository root with the local Docker stack running.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(resolve(".cache/browser/node_modules/playwright/index.mjs")).href);
const config = Object.fromEntries(
  (await readFile(".env.dev", "utf8"))
    .split(/\r?\n/)
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at), line.slice(at + 1).replace(/^(['"])(.*)\1$/, "$2")];
    })
);
const base = process.env.CRM_BROWSER_URL || "http://localhost:3000";
const slug = config.INTERNAL_WORKSPACE_SLUG || "dev-workspace";
const output = resolve("tmp/leave-ux-acceptance");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "fa-IR" });
const page = await context.newPage();
page.setDefaultTimeout(60000);
page.setDefaultNavigationTimeout(180000);
const checks = [],
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
let created;
let createdTemplate;
async function request(path, method = "GET", data) {
  const csrf = await (await context.request.get(`${base}/auth/get-csrf-token/`)).json();
  return context.request.fetch(`${base}/api/workspaces/${slug}/leave/${path}`, {
    method,
    headers: { "X-CSRFTOKEN": csrf.csrf_token },
    ...(data ? { data } : {}),
  });
}
const check = (name, details = {}) => {
  checks.push({ name, ...details });
  process.stdout.write(`PASS ${name}\n`);
};
try {
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(config.DEV_ADMIN_EMAIL);
  await page.locator('input[name="password"]').fill(config.DEV_ADMIN_PASSWORD);
  await page.locator(".auth-submit").click();
  await page.waitForURL((url) => url.pathname !== "/login");
  await page.locator(".app-shell").waitFor();
  await page.goto(`${base}/leave-requests`);
  await page.getByRole("button", { name: "درخواست تازه", exact: true }).click();
  await page.getByRole("radio", { name: "ساعتی", exact: true }).check();
  await page.locator("#leave-start-date").click();
  await page.getByRole("button", { name: "ماه بعد", exact: true }).click();
  await page.getByRole("button", { name: "ماه بعد", exact: true }).click();
  await page.locator(".persian-calendar-grid button").filter({ hasText: /^۸$/ }).click();
  await page.locator("#leave-start-time").fill("10:00");
  await page.locator("#leave-end-time").fill("09:00");
  await page.getByRole("button", { name: "ذخیرهٔ پیش‌نویس و رفتن به پیش‌نمایش", exact: true }).click();
  assert.equal(await page.locator('#leave-end-time[aria-invalid="true"]').count(), 1);
  check("invalid end time has an accessible field error");
  await page.locator("#leave-end-time").fill("12:00");
  // If the chosen day is a weekly holiday, select the next day using the same calendar.
  await page.waitForTimeout(1500);
  if (await page.locator(".leave-form .leave-error").count()) {
    await page.locator("#leave-start-date").click();
    await page.locator(".persian-calendar-grid button").filter({ hasText: /^۹$/ }).click();
    await page.locator("#leave-end-date").click();
    await page.locator(".persian-calendar-grid button").filter({ hasText: /^۹$/ }).click();
  }
  await page.waitForFunction(() => document.querySelector(".leave-duration")?.textContent?.includes("۲ ساعت"));
  const reason = `بررسی رابط مرخصی ${Date.now()}`;
  await page.locator("#leave-reason").fill(reason);
  await page.screenshot({ path: resolve(output, "new-request.png"), fullPage: true });
  const saving = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/leave/requests/")
  );
  await page.getByRole("button", { name: "ذخیرهٔ پیش‌نویس و رفتن به پیش‌نمایش", exact: true }).click();
  const createdResponse = await saving;
  assert.equal(createdResponse.status(), 201, await createdResponse.text());
  created = await createdResponse.json();
  await page.waitForURL(`**/leave-requests/${created.id}`);
  await page.locator('form[aria-label="ویرایش درخواست"]').waitFor();
  check("hourly draft is saved and opens its detail page", { duration: created.current.duration_text });
  const edited = `${reason}؛ توضیح ویرایش‌شده`;
  await page.locator("#leave-reason").fill(edited);
  await page.getByRole("status").filter({ hasText: "تغییرات هنوز ذخیره نشده‌اند" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "ثبت امضا و ارسال برای تأیید", exact: true }).isEnabled(), false);
  await page.getByText("پیش از امضا، تغییرات فرم را ذخیره کنید.", { exact: true }).waitFor();
  check("unsaved changes are explained and block signing");
  const updating = page.waitForResponse(
    (response) => response.request().method() === "PATCH" && response.url().includes(`/leave/requests/${created.id}/`)
  );
  await page.getByRole("button", { name: "ذخیره و ساخت دوبارهٔ پیش‌نمایش", exact: true }).click();
  assert.equal((await updating).status(), 200);
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('[role="status"]')].some((node) =>
        node.textContent?.includes("تغییرات هنوز ذخیره نشده‌اند")
      )
  );
  const saved = await (await request(`requests/${created.id}/`)).json();
  assert.equal(saved.current.reason, edited);
  check("edited form is persisted and the dirty warning clears");
  const preview = await request(`requests/${created.id}/preview/`);
  if (preview.ok()) {
    const data = await preview.json();
    assert.ok(data.html.includes(edited));
    assert.ok(!data.html.includes("{{"));
    check("Word preview contains saved data and no unfilled tokens");
  } else {
    const templates = await (await request("templates/")).json();
    assert.equal(templates.has_active, false);
    check("missing active Word template is explicitly reported", { configurationRequired: true });
  }
  const sample = await request("templates/sample/");
  assert.equal(sample.status(), 200);
  await writeFile(resolve(output, "leave-sample.docx"), await sample.body());
  check("sample Word template downloads successfully");
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: resolve(output, "detail-mobile.png"), fullPage: true });
  const layout = await page.evaluate(() => ({
    width: innerWidth,
    actual: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll("main *")]
      .filter((node) => {
        const box = node.getBoundingClientRect();
        return (box.right > innerWidth + 1 || box.left < -1) && getComputedStyle(node).position !== "fixed";
      })
      .slice(0, 10)
      .map((node) => ({ tag: node.tagName, class: String(node.className), width: node.getBoundingClientRect().width })),
  }));
  assert.ok(layout.actual <= layout.width + 1, JSON.stringify(layout));
  check("request detail fits a 375px mobile viewport");
  await page.locator("#leave-cancel-reason").fill("پایان بررسی خودکار رابط کاربری");
  const cancelling = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().includes(`/leave/requests/${created.id}/cancel/`)
  );
  await page.getByRole("button", { name: "لغو درخواست", exact: true }).click();
  assert.equal((await cancelling).status(), 200);
  const cancelled = await (await request(`requests/${created.id}/`)).json();
  assert.equal(cancelled.status, "cancelled");
  check("cancellation is saved and removes the test draft from active requests");
  const before = await (await request("templates/")).json();
  const activeBefore = before.versions.find((version) => version.status === "active")?.id;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/leave-templates`);
  const adding = page.waitForResponse(
    (result) => result.request().method() === "POST" && new URL(result.url()).pathname.endsWith("/leave/templates/")
  );
  await page.getByRole("button", { name: "افزودن قالب آمادهٔ فارسی", exact: true }).click();
  const added = await adding;
  assert.equal(added.status(), 201, await added.text());
  createdTemplate = await added.json();
  assert.deepEqual(createdTemplate.issues, []);
  assert.equal(createdTemplate.can_activate, true);
  const after = await (await request("templates/")).json();
  assert.equal(after.versions.find((version) => version.status === "active")?.id, activeBefore);
  await page.getByRole("button", { name: "افزودن قالب آمادهٔ فارسی", exact: true }).waitFor();
  await page
    .getByLabel("انتخاب فایل Word قالب مرخصی", { exact: true })
    .setInputFiles(resolve(output, "leave-sample.docx"));
  await page.getByText("leave-sample.docx", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "بارگذاری و بررسی", exact: true }).isEnabled(), true);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(1000);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  check("ready Persian Word template is valid and awaits administrator activation");
  await page.screenshot({ path: resolve(output, "ready-template-mobile.png"), fullPage: true });
  assert.deepEqual(errors, []);
} finally {
  if (createdTemplate)
    await request(`templates/${createdTemplate.id}/`, "PATCH", {
      deprecate: true,
      note: "نسخهٔ بررسی خودکار رابط کاربری",
    });
  if (created) {
    const row = await (await request(`requests/${created.id}/`)).json();
    if (row.actions?.can_cancel)
      await request(`requests/${created.id}/cancel/`, "POST", { revision: row.revision, reason: "پایان بررسی خودکار" });
  }
  await writeFile(resolve(output, "report.json"), JSON.stringify({ checks, errors }, null, 2));
  await browser.close();
}
