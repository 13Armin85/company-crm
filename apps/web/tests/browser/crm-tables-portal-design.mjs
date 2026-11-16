/* eslint-disable no-await-in-loop -- Browser navigation, readiness retries and revision-checked writes depend on preceding actions. */
/* Local acceptance: publish report columns, edit a form hint, drag an RTL table,
 * submit a real customer request and find/respond to it in the staff inbox.
 * Presentation settings are restored; the test account is disabled and its request closed.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
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
const output = resolve("tmp/tables-portal-design");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "fa-IR" });
const customerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "fa-IR" });
const page = await context.newPage(),
  customer = await customerContext.newPage();
for (const item of [page, customer]) {
  item.setDefaultTimeout(60000);
  item.setDefaultNavigationTimeout(180000);
}
const errors = [],
  checks = [],
  snapshots = new Map();
for (const item of [page, customer]) item.on("pageerror", (error) => errors.push(error.message));
const check = (name) => {
  checks.push(name);
  process.stdout.write(`PASS ${name}\n`);
};
const ok = async (response, status = 200) => {
  assert.equal(response.status(), status, `${response.status()}: ${(await response.text()).slice(0, 500)}`);
  return response.json();
};
async function api(path, method = "GET", data) {
  const csrf = await (await context.request.get(`${base}/auth/get-csrf-token/`)).json();
  return context.request.fetch(`${base}/api/workspaces/${slug}/${path}`, {
    method,
    headers: { "X-CSRFTOKEN": csrf.csrf_token },
    ...(data ? { data } : {}),
  });
}
const surface = (code) => `engine/surfaces/${code}/`;
async function change(code, update) {
  const current = await ok(await api(surface(code)));
  if (!snapshots.has(code)) snapshots.set(code, structuredClone(current.definition));
  return ok(
    await api(surface(code), "PUT", {
      revision: current.revision,
      definition: update(structuredClone(current.definition)),
    })
  );
}
async function noOverflow(item) {
  // Resizing triggers the shell's margin animation; inspect the settled mobile layout.
  await item
    .waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1, undefined, { timeout: 5000 })
    .catch(() => {});
  if (!(await item.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))) {
    const elements = await item.evaluate(() =>
      [...document.querySelectorAll("body *")]
        .filter((element) => {
          const box = element.getBoundingClientRect();
          return (
            box.width > 0 &&
            (box.right > innerWidth + 1 || box.left < -1) &&
            !element.closest(".horizontal-table-scroll")
          );
        })
        .map((element) => ({
          tag: element.tagName,
          className: element.className,
          box: element.getBoundingClientRect().toJSON(),
        }))
        .slice(0, 50)
    );
    await writeFile(resolve(output, "overflow.json"), JSON.stringify(elements, null, 2));
  }
  assert(
    await item.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    "Page overflows horizontally"
  );
}
let account, requestId;
try {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const ready = await fetch(`${base}/api/instances/`, { signal: AbortSignal.timeout(3000) });
      if (ready.ok) break;
    } catch {}
    if (attempt === 59) throw new Error("Local API did not become ready");
    await new Promise((done) => setTimeout(done, 1500));
  }
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(env.DEV_ADMIN_EMAIL);
  await page.locator('input[name="password"]').fill(env.DEV_ADMIN_PASSWORD);
  await page.locator(".auth-submit").click();
  await page.locator(".app-shell").waitFor();
  const catalog = await ok(await api("engine/surfaces/"));
  for (const code of [
    "report-daily_report_items",
    "leave-requests",
    "profile",
    "security",
    "portal-requests",
    "portal-customer-request",
    "work-event-form",
  ])
    assert(
      catalog.results.some((item) => item.code === code),
      `Designer missing ${code}`
    );
  check("business tables and forms are present in the designer catalog");

  const reports = await ok(await api("reports/sources/"));
  const source = reports.sources.find((item) => item.code === "daily_report_items");
  assert(source);
  const fields = ["text", "person", "date"].map((key) => source.fields.find((item) => item.key === key));
  // Resolve field names from the catalog, rather than relying on seeded fixture identifiers.
  const selected = fields.every(Boolean) ? fields : source.fields.slice(0, 3);
  await change("report-daily_report_items", (definition) => ({
    ...definition,
    columns: selected.map((field) => `native:${field.label}`),
  }));
  await page.goto(`${base}/settings/engine?page=report-daily_report_items&mode=columns`);
  await page.locator(".studio-column-order").first().waitFor();
  await page
    .locator(".studio-column-order")
    .first()
    .getByRole("button", { name: "انتقال ستون به پایین", exact: true })
    .click();
  const saved = page.waitForResponse(
    (response) => response.request().method() === "PUT" && response.url().includes(surface("report-daily_report_items"))
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "ذخیرهٔ تغییرات صفحه", exact: true }).click();
  assert.equal((await saved).status(), 200);
  check("report columns can be reordered and published from the real designer");
  await page.goto(`${base}/reports/source/daily_report_items`);
  await page.locator(".rp-table tbody tr").first().waitFor();
  const headers = await page.locator(".rp-table thead th").allTextContents();
  assert.deepEqual(
    headers.map((value) => value.trim()),
    [selected[1].label, selected[0].label, selected[2].label]
  );
  await page.screenshot({ path: resolve(output, "report-desktop.png"), fullPage: true });
  check("published report columns are read back and applied to real report data");

  await page.setViewportSize({ width: 375, height: 812 });
  const scroller = page.locator(".rp-table").locator("..");
  await page.waitForFunction(() => {
    const table = document.querySelector(".rp-table");
    return table?.parentElement.scrollWidth > table?.parentElement.clientWidth;
  });
  await noOverflow(page);
  await scroller.scrollIntoViewIfNeeded();
  const box = await scroller.boundingBox();
  assert(box);
  await page.mouse.move(box.x + 35, box.y + 25);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 25, { steps: 12 });
  await page.mouse.up();
  assert(Math.abs(await scroller.evaluate((element) => element.scrollLeft)) > 10);
  await scroller.focus();
  const before = await scroller.evaluate((element) => element.scrollLeft);
  await page.keyboard.press("ArrowRight");
  assert((await scroller.evaluate((element) => element.scrollLeft)) !== before);
  await page.screenshot({ path: resolve(output, "report-mobile.png"), fullPage: true });
  check("wide RTL reports scroll by mouse drag and keyboard without widening the page");

  await change("leave-requests", (definition) => ({
    ...definition,
    native: {
      ...definition.native,
      reason: {
        ...definition.native.reason,
        title: "توضیح درخواست آزمایشی",
        placeholder: "دلیل مرخصی را اینجا بنویسید",
        help_text: "این راهنما از طراح فرم خوانده شده است",
      },
    },
  }));
  await page.goto(`${base}/leave-requests`);
  await page.getByRole("button", { name: "درخواست تازه", exact: true }).click();
  await page.getByPlaceholder("دلیل مرخصی را اینجا بنویسید").waitFor();
  await page.locator("#leave-reason").fill("اطلاعات فرم حفظ می‌شود");
  assert.equal(await page.locator("#leave-reason").inputValue(), "اطلاعات فرم حفظ می‌شود");
  await page.getByText("این راهنما از طراح فرم خوانده شده است", { exact: true }).waitFor();
  await noOverflow(page);
  check("native form labels, placeholders and help are applied without breaking the input");

  const options = await ok(await api("portal/accounts/options/"));
  assert(options.customer.length, "The local test workspace needs at least one customer record");
  const stamp = Date.now().toString(36),
    password = `Qa!${randomUUID()}aA`;
  account = await ok(
    await api("portal/accounts/", "POST", {
      username: `qa.${stamp}`,
      display_name: `آزمون رابط ${stamp}`,
      customer_record_id: options.customer[0].id,
    }),
    201
  );
  const token = new URL(`${base}${account.setup.path}`).searchParams.get("token");
  await ok(await customerContext.request.post(`${base}/api/portal/v1/auth/setup/`, { data: { token, password } }));
  await customer.goto(`${base}/portal/login`);
  await customer.locator('input[name="username"]').fill(account.username);
  await customer.locator('input[name="password"]').fill(password);
  await customer.getByRole("button", { name: "ورود", exact: true }).click();
  await customer.waitForURL((url) => url.pathname === "/portal");
  await customer.getByRole("link", { name: "ثبت درخواست جدید", exact: true }).click();
  const subject = `آزمون طراحی درگاه ${stamp}`,
    description = "بررسی ثبت واقعی درخواست مشتری و نمایش آن در بخش پیگیری داخلی.";
  await customer.locator('input[maxlength="200"]').fill(subject);
  await customer.locator('textarea[maxlength="5000"]').fill(description);
  const submitted = customer.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().endsWith("/portal/v1/requests/")
  );
  await customer.getByRole("button", { name: "ثبت درخواست", exact: true }).click();
  const created = await ok(await submitted, 201);
  requestId = created.id;
  await customer.getByRole("heading", { name: subject, exact: true }).waitFor();
  check("customer logs in and submits a real request through the redesigned form");

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/portal-settings`);
  await page.getByPlaceholder("موضوع، شمارهٔ درخواست یا نام ثبت‌کننده").fill(stamp);
  await page.getByRole("button", { name: "جست‌وجو", exact: true }).click();
  await page.getByRole("link", { name: subject, exact: true }).click();
  await page.getByRole("heading", { name: subject, exact: true }).waitFor();
  await page.getByText(description, { exact: true }).waitFor();
  await page.getByRole("radio", { name: "پاسخ به مشتری", exact: true }).click();
  const reply = "درخواست آزمایشی شما دریافت شد و نمایش مکاتبات بررسی شد.";
  await page.locator(".portal-composer textarea").fill(reply);
  const replied = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().includes(`/tickets/${requestId}/portal/messages/`)
  );
  await page.getByRole("button", { name: "ارسال برای مشتری", exact: true }).click();
  assert.equal((await replied).status(), 201);
  await customer.reload();
  await customer.getByText(reply, { exact: true }).waitFor();
  check("staff finds the customer request, opens the conversation and sends a visible reply");
  await customer.goto(`${base}/portal`);
  await customer.getByText(subject, { exact: true }).waitFor();
  await customer.screenshot({ path: resolve(output, "customer-desktop.png"), fullPage: true });
  await customer.setViewportSize({ width: 375, height: 812 });
  await noOverflow(customer);
  await customer.screenshot({ path: resolve(output, "customer-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${base}/portal-settings`);
  await page.locator(".portal-inbox").waitFor();
  await page.locator(".portal-inbox-table tbody tr").first().waitFor();
  await noOverflow(page);
  await page.screenshot({ path: resolve(output, "staff-mobile.png"), fullPage: true });
  check("customer and staff portal layouts fit a 375px screen");
  assert.deepEqual(errors, []);
} catch (error) {
  await page.screenshot({ path: resolve(output, "failure-staff.png"), fullPage: true }).catch(() => {});
  await customer.screenshot({ path: resolve(output, "failure-customer.png"), fullPage: true }).catch(() => {});
  throw error;
} finally {
  const cleanup = [];
  for (const [code, definition] of snapshots) {
    try {
      const current = await ok(await api(surface(code)));
      await ok(await api(surface(code), "PUT", { revision: current.revision, definition }));
    } catch (error) {
      cleanup.push(`Presentation restore ${code}: ${error.message}`);
    }
  }
  if (requestId) {
    try {
      await ok(
        await api(`tickets/${requestId}/portal/triage/`, "POST", {
          action: "reject",
          message: "درخواست آزمایشی بررسی رابط کاربری بسته شد.",
        })
      );
    } catch (error) {
      cleanup.push(`Close test request: ${error.message}`);
    }
  }
  if (account) {
    try {
      await ok(await api(`portal/accounts/${account.id}/`, "PATCH", { is_active: false }));
    } catch (error) {
      cleanup.push(`Disable test account: ${error.message}`);
    }
  }
  await writeFile(resolve(output, "report.json"), JSON.stringify({ checks, errors, cleanup }, null, 2));
  await browser.close();
  assert.deepEqual(cleanup, [], "Some QA settings or fixtures could not be restored");
}
