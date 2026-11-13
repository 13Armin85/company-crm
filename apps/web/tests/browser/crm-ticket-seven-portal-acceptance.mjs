/* Ticket 7 (customer portal and correspondence) acceptance on the local Docker deployment.
 *
 * File name: crm-ticket-seven-acceptance.mjs already belongs to the dashboard suite of an earlier
 * "ticket 7" numbering, so this script is crm-ticket-seven-portal-acceptance.mjs.
 *
 * Scenario (section 4, phase 4 of the ticket): customer login → request with a file → internal triage →
 * customer reply + internal note → the customer sees only the reply → quote → revision request → version 2
 * → approval → completion → feedback; customer B opening customer A's URL; 375px mobile; logout and
 * session expiry. Accounts are created through the internal API (as the settings page does); the set-up
 * link is used in the browser. Active ticket workflows are switched off for the run and restored; the
 * portal accounts created here are deactivated at the end. No e-mail or SMS is sent.
 * Run from the repository root: node apps/web/tests/browser/crm-ticket-seven-portal-acceptance.mjs
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
const stamp = Date.now().toString(36);
const output = resolve("docs/evidence/ticket-7");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const names = ["admin", "alice", "bob"];
const contexts = Object.fromEntries(
  await Promise.all(
    names.map(async (name) => [name, await browser.newContext({ viewport: { width: 1440, height: 1000 } })])
  )
);
const pages = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await contexts[name].newPage()])));
const errors = [];
for (const page of Object.values(pages)) {
  page.setDefaultTimeout(60000);
  // The local stack is a Vite dev server: the first visit of each route compiles it on demand.
  page.setDefaultNavigationTimeout(240000);
  page.on("pageerror", (error) => errors.push(error.message));
}
const checks = [];
const capture = async (step, name, page, details = {}, suffix = "") => {
  const screenshot = `step-${String(step).padStart(2, "0")}${suffix}.png`;
  await page.screenshot({ path: resolve(output, screenshot), fullPage: true });
  checks.push({ step, name, passed: true, screenshot, details });
  await writeFile(resolve(output, "report.json"), JSON.stringify({ started_at: stamp, base, checks, errors }, null, 2));
  process.stdout.write(`PASS ${step}${suffix}: ${name}\n`);
};
async function request(context, path, method = "GET", data) {
  const csrf = await (await context.request.get(`${base}/auth/get-csrf-token/`)).json();
  const response = await context.request.fetch(`${base}/api/workspaces/${slug}/${path}`, {
    method,
    headers: { "X-CSRFTOKEN": csrf.csrf_token },
    ...(data === undefined ? {} : { data }),
  });
  const text = await response.text();
  return { status: response.status(), data: text ? JSON.parse(text) : null };
}
const ok = (result, status = 200) => {
  assert.equal(result.status, status, `HTTP ${result.status}: ${JSON.stringify(result.data).slice(0, 900)}`);
  return result.data;
};
const shell = (code) =>
  execFileSync("docker", ["exec", "company-crm-local-api-1", "python", "manage.py", "shell", "-c", code], {
    encoding: "utf8",
  })
    .split("\n")
    .filter((line) => line.startsWith("OUT:"))
    .map((line) => line.slice(4));
async function staffLogin(page, email, password) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.goto(`${base}/login`);
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    try {
      await page.locator(".auth-submit").click({ timeout: 12000 });
      await page.waitForURL((url) => url.pathname !== "/login");
      await page.locator(".app-shell").waitFor();
      return;
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((done) => setTimeout(done, 3000));
    }
  }
}
async function portalLogin(page, username, password) {
  await page.goto(`${base}/portal/login`);
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "ورود", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/portal");
  await page.getByRole("heading", { name: "درخواست‌های من" }).waitFor();
}
const waitFor = (page, part, method = "POST") =>
  page.waitForResponse((response) => response.request().method() === method && response.url().includes(part), {
    timeout: 180000,
  });
const noHorizontalScroll = (page) =>
  page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);
const cleanup = { accounts: [], workflows: [] };
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const password = `Portal!${stamp}Aa9`;

try {
  // ------------------------------------------------------------ setup (internal API, as the settings page does)
  await staffLogin(pages.admin, env.DEV_ADMIN_EMAIL, env.DEV_ADMIN_PASSWORD);
  const admin = contexts.admin;
  for (const row of ok(await request(admin, "workflows/definitions/?entity=ticket")).results ?? [])
    if (row.is_active) {
      ok(await request(admin, `workflows/definitions/${row.id}/`, "PATCH", { is_active: false }));
      cleanup.workflows.push(row.id);
    }
  const options = ok(await request(admin, "portal/accounts/options/"));
  assert.ok(options.customer.length >= 2, "at least two customer records are needed");
  const [customerA, customerB] = options.customer;
  const alice = ok(
    await request(admin, "portal/accounts/", "POST", {
      username: `alice-${stamp}`,
      display_name: `مشتری الف ${stamp}`,
      customer_record_id: customerA.id,
    }),
    201
  );
  const bob = ok(
    await request(admin, "portal/accounts/", "POST", {
      username: `bob-${stamp}`,
      display_name: `مشتری ب ${stamp}`,
      customer_record_id: customerB.id,
    }),
    201
  );
  cleanup.accounts.push(alice.id, bob.id);
  // Internal settings page lists the accounts.
  await pages.admin.goto(`${base}/portal-settings`);
  await pages.admin.getByRole("heading", { name: "حساب‌های درگاه" }).waitFor();
  await pages.admin.getByText(`alice-${stamp}`).waitFor();
  await capture(0, "صفحهٔ تنظیمات «درگاه مشتری»: حساب‌ها، نگاشت وضعیت، کانال‌های غیرفعال", pages.admin);

  // ------------------------------------------------------------ 1. set-up link and customer login
  for (const [who, account] of [
    ["alice", alice],
    ["bob", bob],
  ]) {
    const page = pages[who];
    await page.goto(`${base}${account.setup.path}`);
    await page.getByLabel("گذرواژهٔ جدید").fill(password);
    await page.getByLabel("تکرار گذرواژه").fill(password);
    await Promise.all([
      waitFor(page, "/api/portal/v1/auth/setup/"),
      page.getByRole("button", { name: "ثبت گذرواژه" }).click(),
    ]);
    await page.getByRole("heading", { name: "گذرواژه ثبت شد" }).waitFor();
    if (who === "alice") await capture(1, "تعیین گذرواژه با پیوند یک‌بارمصرف", page);
    await portalLogin(page, account.username, password);
  }
  await capture(1, "ورود مشتری الف؛ فهرست خالی درخواست‌ها", pages.alice, {}, "b");

  // ------------------------------------------------------------ 2. request with a file
  const a = pages.alice;
  await a.getByRole("link", { name: "ثبت درخواست جدید" }).click();
  await a.getByLabel("موضوع").fill(`خرابی چاپگر ${stamp}`);
  await a.getByLabel("شرح درخواست").fill("چاپگر طبقهٔ دوم هنگام چاپ دورو کاغذ گیر می‌کند.");
  await a.locator('input[type="file"]').setInputFiles({ name: "printer.png", mimeType: "image/png", buffer: PNG });
  const [created] = await Promise.all([
    waitFor(a, "/api/portal/v1/requests/"),
    a.getByRole("button", { name: "ثبت درخواست" }).click(),
  ]);
  const request1 = await created.json();
  assert.equal(created.status(), 201);
  await a.waitForURL(`**/portal/requests/${request1.id}`);
  await a.getByText("printer.png").waitFor();
  assert.equal(request1.status.title, "ثبت‌شده");
  await capture(2, "ثبت درخواست با فایل؛ وضعیت مشتری «ثبت‌شده»", a, { number: request1.number });

  // ------------------------------------------------------------ 3. internal triage on the ticket page
  const s = pages.admin;
  await s.goto(`${base}/entities/ticket/${request1.id}`);
  await s.getByRole("tab", { name: /مکاتبات/ }).click();
  await s.getByText("درخواست درگاه — در انتظار تریاژ").waitFor();
  await capture(3, "تب «مکاتبات» تیکت داخلی با نوار تریاژ", s);
  await Promise.all([
    waitFor(s, `/tickets/${request1.id}/portal/triage/`),
    s.getByRole("button", { name: "تأیید و ورود به جریان کار" }).click(),
  ]);
  await s.getByText("درخواست درگاه — در انتظار تریاژ").waitFor({ state: "detached" });
  await capture(3, "تأیید درخواست (ورود به جریان کار)", s, {}, "b");

  // ------------------------------------------------------------ 4. internal note (default) + customer reply
  const secret = `یادداشت محرمانهٔ ${stamp}`;
  const composer = s.locator("form.portal-composer");
  assert.equal(await composer.getByRole("radio", { name: /یادداشت داخلی/ }).getAttribute("aria-checked"), "true");
  await composer.locator("textarea").fill(secret);
  await Promise.all([
    waitFor(s, "/portal/messages/"),
    composer.getByRole("button", { name: "ثبت یادداشت داخلی" }).click(),
  ]);
  await s.locator(".portal-message.is-note", { hasText: secret }).waitFor();
  await composer.getByRole("radio", { name: /پاسخ به مشتری/ }).click();
  await composer.locator("textarea").fill("سلام؛ کارشناس فردا مراجعه می‌کند.");
  await Promise.all([
    waitFor(s, "/portal/messages/"),
    composer.getByRole("button", { name: "ارسال برای مشتری" }).click(),
  ]);
  await s.getByText("سلام؛ کارشناس فردا مراجعه می‌کند.").waitFor();
  await capture(4, "یادداشت داخلی (پیش‌فرض) و پاسخ به مشتری با نشان متمایز", s);

  // ------------------------------------------------------------ 5. the customer sees only the reply
  await a.reload();
  await a.getByText("سلام؛ کارشناس فردا مراجعه می‌کند.").waitFor();
  const body = await a.content();
  assert.ok(!body.includes(secret), "internal note leaked to the portal page");
  const raw = await (await contexts.alice.request.get(`${base}/api/portal/v1/requests/${request1.id}/`)).text();
  assert.ok(!raw.includes(secret) && !raw.includes("INTERNAL"), "internal note leaked to the portal API");
  await capture(5, "مشتری فقط پاسخ را می‌بیند (یادداشت داخلی نه در صفحه نه در پاسخ خام API)", a);

  // ------------------------------------------------------------ 6. quote → revision → version 2 → approval
  const quotes = s.locator("section.portal-quotes");
  await quotes.getByRole("button", { name: "ساخت برآورد" }).click();
  await quotes.getByLabel("مبلغ (ریال)").fill("12000000");
  await quotes.getByLabel("شرح اقلام").fill("تعویض غلتک و سرویس کامل");
  await Promise.all([
    waitFor(s, `/tickets/${request1.id}/quotes/`),
    quotes.getByRole("button", { name: "ساخت پیش‌نویس" }).click(),
  ]);
  await quotes.getByRole("button", { name: "ارسال برای مشتری" }).click();
  await quotes.getByText("ارسال‌شده به مشتری").waitFor();
  await capture(6, "ساخت و ارسال برآورد نسخهٔ ۱", s);
  await a.reload();
  const card1 = a.locator("article.portal-quote").first();
  await card1.getByRole("button", { name: "درخواست اصلاح" }).click();
  await card1.locator("textarea").fill("لطفاً هزینهٔ سرویس را جدا کنید.");
  await Promise.all([waitFor(a, "/decision/"), card1.getByRole("button", { name: "ارسال درخواست اصلاح" }).click()]);
  await a.getByText("درخواست اصلاح", { exact: true }).first().waitFor();
  await capture(6, "مشتری درخواست اصلاح ثبت کرد", a, {}, "b");
  await s.reload();
  await s.getByRole("tab", { name: /مکاتبات/ }).click();
  await quotes.getByRole("button", { name: "نسخهٔ جدید" }).click();
  await quotes.getByLabel("مبلغ (ریال)").fill("9500000");
  await Promise.all([
    waitFor(s, `/tickets/${request1.id}/quotes/`),
    quotes.getByRole("button", { name: "ساخت پیش‌نویس" }).click(),
  ]);
  await quotes.getByRole("button", { name: "ارسال برای مشتری" }).click();
  await quotes.getByText(/نسخهٔ ۲/).waitFor();
  await capture(6, "نسخهٔ ۲ برآورد ساخته و ارسال شد", s, {}, "c");
  await a.reload();
  const card2 = a.locator("article.portal-quote", { hasText: "نسخهٔ ۲" });
  await card2.getByRole("button", { name: "تأیید برآورد" }).click();
  await card2.getByRole("button", { name: "ادامه" }).click();
  await card2.getByText("با تأیید، این نسخهٔ برآورد قطعی می‌شود").waitFor();
  await capture(6, "تأیید دومرحله‌ای برآورد", a, {}, "d");
  await Promise.all([waitFor(a, "/decision/"), card2.getByRole("button", { name: "بله، ثبت قطعی" }).click()]);
  await card2.getByText("تأییدشده").waitFor();
  assert.equal(await card2.getByRole("button", { name: "بله، ثبت قطعی" }).count(), 0, "decision form stayed open");
  await capture(6, "برآورد نسخهٔ ۲ تأیید شد", a, {}, "e");

  // ------------------------------------------------------------ 7. completion and feedback
  const coreCard = ok(await request(admin, `tickets/${request1.id}/core/`));
  const done = coreCard.status.options.find((item) => item.category === "done");
  const record = ok(await request(admin, `engine/entities/ticket/records/${request1.id}/`));
  ok(
    await request(admin, `engine/entities/ticket/records/${request1.id}/`, "PATCH", {
      revision: record.revision,
      values: { [coreCard.status.field]: done.id },
    })
  );
  await a.reload();
  await a.getByText("انجام‌شده").first().waitFor();
  await a.getByRole("radio", { name: /۵ از ۵/ }).click();
  await a.locator("form.portal-feedback textarea").fill("سریع و دقیق بود.");
  await Promise.all([waitFor(a, "/feedback/"), a.getByRole("button", { name: "ثبت بازخورد" }).click()]);
  await a.getByText("بازخورد شما ثبت شد").waitFor();
  await capture(7, "پایان کار و ثبت بازخورد ۵ از ۵", a);
  await s.reload();
  await s.getByRole("tab", { name: /مکاتبات/ }).click();
  await s.getByRole("heading", { name: "بازخورد مشتری" }).waitFor();
  await capture(7, "بازخورد در صفحهٔ تیکت داخلی", s, {}, "b");

  // ------------------------------------------------------------ 8. customer B on customer A's URL
  const b = pages.bob;
  await b.goto(`${base}/portal/requests/${request1.id}`);
  await b.getByText("بازگشت به درخواست‌ها").waitFor();
  const probe = await contexts.bob.request.get(`${base}/api/portal/v1/requests/${request1.id}/`);
  assert.equal(probe.status(), 404);
  const fileId = request1.messages[0].files[0].id;
  assert.equal((await contexts.bob.request.get(`${base}/api/portal/v1/files/${fileId}/`)).status(), 404);
  assert.equal((await contexts.alice.request.get(`${base}/api/portal/v1/files/${fileId}/`)).status(), 200);
  await capture(8, "مشتری ب با نشانی درخواست مشتری الف: «پیدا نشد» (۴۰۴)", b);

  // ------------------------------------------------------------ 9. portal ↔ internal isolation
  assert.equal(
    (await contexts.alice.request.get(`${base}/api/workspaces/${slug}/tickets/${request1.id}/core/`)).status() >= 401,
    true
  );
  assert.equal((await contexts.admin.request.get(`${base}/api/portal/v1/requests/`)).status(), 401);
  await a.goto(`${base}/issues`);
  await a.waitForURL((url) => url.pathname === "/login");
  await capture(9, "نشست درگاه وارد اپ داخلی نمی‌شود (هدایت به ورود داخلی)", a);

  // ------------------------------------------------------------ 10. mobile 375px
  await a.setViewportSize({ width: 375, height: 812 });
  await a.goto(`${base}/portal`);
  await a.getByRole("heading", { name: "درخواست‌های من" }).waitFor();
  assert.ok(await noHorizontalScroll(a), "horizontal scroll on the list at 375px");
  await capture(10, "فهرست درخواست‌ها در عرض ۳۷۵ پیکسل بدون اسکرول افقی", a);
  await a.goto(`${base}/portal/requests/${request1.id}`);
  await a.getByText("گفت‌وگو").waitFor();
  assert.ok(await noHorizontalScroll(a), "horizontal scroll on the request at 375px");
  await capture(10, "صفحهٔ درخواست در عرض ۳۷۵ پیکسل", a, {}, "b");
  await a.setViewportSize({ width: 1440, height: 1000 });

  // ------------------------------------------------------------ 11. logout and session expiry
  await a.goto(`${base}/portal`);
  await Promise.all([waitFor(a, "/api/portal/v1/auth/logout/"), a.getByRole("button", { name: "خروج" }).click()]);
  await a.waitForURL((url) => url.pathname === "/portal/login");
  assert.equal((await contexts.alice.request.get(`${base}/api/portal/v1/requests/`)).status(), 401);
  await capture(11, "خروج صریح؛ نشست در سرور باطل شد", a);
  await portalLogin(a, alice.username, password);
  shell(
    `from datetime import timedelta\nfrom django.utils import timezone\nfrom plane.db.models import PortalSession\nn=PortalSession.objects.filter(account__username="${alice.username}", revoked_at__isnull=True).update(last_seen_at=timezone.now()-timedelta(hours=2))\nprint("OUT:"+str(n))`
  );
  await a.goto(`${base}/portal/requests/${request1.id}`);
  await a.waitForURL((url) => url.pathname === "/portal/login");
  await a.getByText("نشست شما به پایان رسیده است").waitFor();
  await capture(11, "انقضای نشست بی‌کاری؛ پیام و بازگشت به ورود", a, {}, "b");

  const audit = shell(
    `from plane.db.models import PortalAuditLog\nprint("OUT:"+str(PortalAuditLog.objects.filter(username="${alice.username}").count()))`
  );
  checks.push({
    step: 12,
    name: "لاگ ممیزی برای فراخوانی‌های مشتری الف",
    passed: Number(audit[0]) > 10,
    details: { rows: audit[0] },
  });
  assert.ok(Number(audit[0]) > 10);
  process.stdout.write(`PASS 12: audit rows ${audit[0]}\n`);
  assert.deepEqual(errors, [], `page errors: ${errors.join(" | ")}`);
} finally {
  for (const id of cleanup.accounts)
    await request(contexts.admin, `portal/accounts/${id}/`, "PATCH", { is_active: false });
  for (const id of cleanup.workflows)
    await request(contexts.admin, `workflows/definitions/${id}/`, "PATCH", { is_active: true });
  await writeFile(resolve(output, "report.json"), JSON.stringify({ started_at: stamp, base, checks, errors }, null, 2));
  await browser.close();
}
