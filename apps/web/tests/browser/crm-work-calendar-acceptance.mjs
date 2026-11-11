/* Ticket 3 (work calendar) acceptance on the local Docker deployment.
 *
 * Manager sets "Thursday off" and "Sunday from 10:00" for an employee → labels in the
 * employee's calendar → a meeting for the employee → a colleague sees only "unavailable"
 * → the employee declares presence on a non-working day → the manager sees
 * "declared by the person" → the past meeting waits for the employee's own confirmation.
 *
 * The live server cannot time-travel, so "today" is made a non-working day with a dated
 * exception unless it already is one, and the meeting is placed a few hours ago so that it
 * has already ended ("the next day"). Run from apps/web: node tests/browser/crm-work-calendar-acceptance.mjs
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
const output = resolve("tmp/work-calendar-evidence");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const contexts = await Promise.all(
  [0, 1, 2, 3].map(() => browser.newContext({ viewport: { width: 1440, height: 1000 } }))
);
const [admin, manager, worker, coworker] = contexts;
const [adminPage, managerPage, workerPage, coworkerPage] = await Promise.all(
  contexts.map((context) => context.newPage())
);
const errors = [];
for (const page of [adminPage, managerPage, workerPage, coworkerPage]) {
  page.setDefaultTimeout(45000);
  page.on("pageerror", (error) => errors.push(error.message));
}
const checks = [];
const capture = async (step, name, page, details = {}) => {
  const screenshot = `step-${String(step).padStart(2, "0")}.png`;
  await page.screenshot({ path: resolve(output, screenshot), fullPage: true });
  checks.push({ step, name, passed: true, screenshot, details });
  await writeFile(resolve(output, "report.json"), JSON.stringify({ started_at: stamp, checks }, null, 2));
  process.stdout.write(`PASS ${step}: ${name}\n`);
};
async function request(context, path, method = "GET", data) {
  const csrf = await (await context.request.get(`${base}/auth/get-csrf-token/`)).json();
  const response = await context.request.fetch(`${base}/api/workspaces/${slug}/${path}`, {
    method,
    headers: { "X-CSRFTOKEN": csrf.csrf_token },
    ...(data === undefined ? {} : { data }),
  });
  return { status: response.status(), data: response.status() === 204 ? null : await response.json() };
}
const ok = (result, status = 200) => {
  assert.equal(result.status, status, `HTTP ${result.status}: ${JSON.stringify(result.data).slice(0, 700)}`);
  return result.data;
};
async function login(page, email, password) {
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
const tehranDate = (offsetDays = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran" }).format(new Date(Date.now() + offsetDays * 86400000));
async function pickPerson(page, name) {
  const picker = page.getByRole("combobox", { name: "انتخاب فرد" });
  await picker.click();
  await picker.fill(name);
  await page
    .getByRole("option", { name: new RegExp(name) })
    .first()
    .click();
}
const waitFor = (page, path, method = "POST") =>
  page.waitForResponse(
    (response) => response.request().method() === method && response.url().includes(`/work-calendar/${path}`)
  );

const meetingTitle = `جلسهٔ محرمانه ${stamp}`;
try {
  await login(adminPage, env.DEV_ADMIN_EMAIL, env.DEV_ADMIN_PASSWORD);
  const permissions = ok(await request(admin, "organization/permissions/"));
  const ids = (codes) => permissions.filter((item) => codes.has(item.code)).map((item) => item.id);
  const employeeCodes = new Set(["Issue.View", "WorkSchedule.ViewOwn", "WorkEvent.Create"]);
  const managerCodes = new Set([
    ...employeeCodes,
    "WorkSchedule.ViewTeam",
    "WorkSchedule.EditTeam",
    "WorkEvent.Manage",
  ]);
  const employeeRole = ok(
    await request(admin, "organization/roles/", "POST", {
      name: `WC employee ${stamp}`,
      permission_ids: ids(employeeCodes),
    }),
    201
  );
  const managerRole = ok(
    await request(admin, "organization/roles/", "POST", {
      name: `WC manager ${stamp}`,
      permission_ids: ids(managerCodes),
    }),
    201
  );
  const password = `Wc!${randomUUID()}aA`;
  async function createUser(label, role) {
    const suffix = `${stamp}-${label}`;
    const email = `${suffix}@example.test`;
    const displayName = `WC ${label} ${stamp}`;
    const row = ok(
      await request(admin, "engine/entities/user/records/", "POST", {
        values: {
          user_name: displayName,
          user_username: suffix,
          user_email: email,
          user_password: password,
          user_roles: [role.id],
        },
      }),
      201
    );
    return { ...row, email, displayName };
  }
  const employee = await createUser("employee", employeeRole);
  const colleague = await createUser("colleague", employeeRole);
  const boss = await createUser("manager", managerRole);
  ok(
    await request(admin, "organization/units/", "POST", {
      title: `واحد تقویم ${stamp}`,
      manager_id: boss.id,
      member_ids: [employee.id, colleague.id],
    }),
    201
  );

  // 1. Manager records Thursday off and Sunday from 10:00, effective today, through the weekly editor.
  await login(managerPage, boss.email, password);
  await managerPage.goto(`${base}/calendar`);
  await pickPerson(managerPage, employee.displayName);
  await managerPage.getByRole("button", { name: "ویرایش برنامهٔ هفتگی" }).click();
  const editor = managerPage.getByRole("form", { name: "ویرایش برنامهٔ هفتگی" });
  await editor.getByLabel("پنجشنبه روز کاری است").uncheck();
  await editor.getByRole("spinbutton", { name: "ساعت شروع یکشنبه" }).fill("10");
  await editor.getByRole("button", { name: "معتبر از تاریخ", exact: true }).click();
  await managerPage.locator(".persian-calendar-footer button").filter({ hasText: "امروز" }).click();
  await editor.getByLabel("دلیل یا توضیح تغییر").fill("درخواست کارمند برای پنجشنبه‌ها");
  const [saved] = await Promise.all([
    waitFor(managerPage, "schedules/"),
    editor.getByRole("button", { name: "ثبت نسخهٔ جدید برنامه" }).click(),
  ]);
  assert.equal(saved.status(), 201, await saved.text());
  const month = ok(
    await request(manager, `work-calendar/?user=${employee.id}&start=${tehranDate()}&end=${tehranDate(14)}`)
  );
  const futureThursday = month.days.find((day) => new Date(`${day.date}T12:00:00Z`).getUTCDay() === 4);
  const futureSunday = month.days.find((day) => new Date(`${day.date}T12:00:00Z`).getUTCDay() === 0);
  assert.equal(futureThursday.is_working, false);
  assert.equal(futureSunday.start, "10:00");
  await managerPage.locator(".work-chip-off").first().waitFor();
  await managerPage.locator(".work-chip-schedule").filter({ hasText: "۱۰:۰۰ تا ۱۶:۰۰" }).first().waitFor();
  await capture(1, "مدیر «پنجشنبه غیرکاری» و «یکشنبه از ۱۰» را از تاریخ مؤثر ثبت کرد", managerPage);

  // 2. The employee sees the same labels in their own calendar.
  await login(workerPage, employee.email, password);
  await workerPage.goto(`${base}/calendar`);
  await workerPage.locator(".work-chip-off").first().waitFor();
  await workerPage.locator(".work-chip-schedule").filter({ hasText: "۱۰:۰۰ تا ۱۶:۰۰" }).first().waitFor();
  await capture(2, "برچسب روز غیرکاری و ساعت ۱۰ در تقویم کارمند", workerPage);

  // Make today a non-working day if it is not already one (dated exception; the weekly schedule is unchanged).
  const today = ok(await request(worker, `work-calendar/?start=${tehranDate()}&end=${tehranDate()}`));
  if (today.presence_today.is_working_day) {
    await managerPage.getByRole("button", { name: "استثنای تاریخ‌دار" }).click();
    const form = managerPage.getByRole("form", { name: "استثنای تاریخ‌دار" });
    await form.getByRole("button", { name: "از تاریخ", exact: true }).click();
    await managerPage.locator(".persian-calendar-footer button").filter({ hasText: "امروز" }).click();
    await form.getByLabel("در این تاریخ‌ها کار می‌کند").uncheck();
    await form.getByLabel("دلیل یا توضیح").fill("روز غیرکاری برای آزمون پذیرش");
    const [exception] = await Promise.all([
      waitFor(managerPage, "exceptions/"),
      form.getByRole("button", { name: "ثبت استثنا" }).click(),
    ]);
    assert.equal(exception.status(), 201, await exception.text());
  }

  // 3. Manager creates a meeting for the employee that ended a couple of hours ago.
  const meetingStart = new Date(Date.now() - 3 * 3600000);
  const meetingDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran" }).format(meetingStart);
  const created = ok(
    await request(manager, "work-calendar/events/", "POST", {
      kind: "meeting",
      title: meetingTitle,
      description: "دستور جلسهٔ محرمانه",
      private_note: "یادداشت خصوصی",
      starts_at: meetingStart.toISOString(),
      ends_at: new Date(meetingStart.getTime() + 3600000).toISOString(),
      participant_ids: [employee.id],
    }),
    201
  );
  await managerPage.reload();
  await pickPerson(managerPage, employee.displayName);
  await managerPage.locator(".work-chip-meeting").filter({ hasText: meetingTitle }).first().waitFor();
  await capture(3, "جلسه برای کارمند در تقویم مدیر", managerPage, { event: created.event.id });

  // 4. A colleague sees only "unavailable" — no title anywhere, in the UI or the API.
  await login(coworkerPage, colleague.email, password);
  await coworkerPage.goto(`${base}/calendar`);
  await pickPerson(coworkerPage, employee.displayName);
  await coworkerPage.locator(".work-restricted-note").waitFor();
  await coworkerPage.locator(".work-chip-busy").filter({ hasText: "در دسترس نیست" }).first().waitFor();
  assert(!(await coworkerPage.content()).includes(meetingTitle), "meeting title leaked to a colleague");
  const colleagueApi = ok(
    await request(coworker, `work-calendar/?user=${employee.id}&start=${meetingDay}&end=${meetingDay}`)
  );
  for (const secret of [meetingTitle, "دستور جلسهٔ محرمانه", "یادداشت خصوصی"])
    assert(!JSON.stringify(colleagueApi).includes(secret), `${secret} leaked in API`);
  assert.equal(ok(await request(coworker, `work-calendar/events/${created.event.id}/`)).title, undefined);
  await capture(4, "همکار فقط «در دسترس نیست» را می‌بیند", coworkerPage);

  // 5. The employee declares presence on today's non-working day.
  await workerPage.reload();
  const declare = workerPage.getByRole("button", { name: "امروز در محل کار هستم" });
  await declare.waitFor();
  const [declared] = await Promise.all([waitFor(workerPage, "presence/"), declare.click()]);
  assert.equal(declared.status(), 201, await declared.text());
  await workerPage.locator(".work-presence .work-chip-presence").filter({ hasText: "اعلام‌شده توسط خود فرد" }).waitFor();
  assert.equal(
    (await request(worker, "work-calendar/presence/", "POST", {})).status,
    400,
    "second declaration must be rejected"
  );
  await capture(5, "کارمند «امروز در محل کار هستم» را زد", workerPage);

  // 6. The manager sees the self-declared label.
  await managerPage.reload();
  await pickPerson(managerPage, employee.displayName);
  await managerPage
    .locator(".calendar-grid .work-chip-presence")
    .filter({ hasText: "اعلام‌شده توسط خود فرد" })
    .first()
    .waitFor();
  await capture(6, "مدیر برچسب «اعلام‌شده توسط خود فرد» را می‌بیند", managerPage);

  // 7. The past meeting waits for the employee's own confirmation; the manager cannot confirm it.
  const managerTry = await request(manager, "work-calendar/pending/", "POST", {
    source_type: "event",
    source_id: created.event.id,
    outcome: "done",
  });
  assert.equal(managerTry.status, 403);
  assert(
    !ok(await request(manager, "work-calendar/pending/")).items.some((item) => item.source_id === created.event.id)
  );
  await workerPage.reload();
  const pending = workerPage.getByRole("region", { name: "موارد منتظر تأیید شما" });
  const item = pending.locator("li").filter({ hasText: meetingTitle });
  await item.waitFor();
  await item.getByLabel("خلاصهٔ اختیاری").fill("جلسه برگزار شد");
  await capture(7, "جلسهٔ گذشته در «موارد منتظر تأیید» کارمند", workerPage);
  const [confirmed] = await Promise.all([
    waitFor(workerPage, "pending/"),
    item.getByRole("button", { name: "انجام شد" }).click(),
  ]);
  assert.equal(confirmed.status(), 201, await confirmed.text());
  await item.waitFor({ state: "detached" });
  await capture(8, "فقط خود کارمند انجام‌شدن جلسه را تأیید کرد", workerPage);
  assert.deepEqual(errors, []);
} catch (error) {
  for (const [name, page] of [
    ["manager", managerPage],
    ["worker", workerPage],
    ["colleague", coworkerPage],
  ])
    await page.screenshot({ path: resolve(output, `failure-${name}.png`), fullPage: true }).catch(() => {});
  await writeFile(
    resolve(output, "failure.json"),
    JSON.stringify({ error: String(error), completed: checks.map((row) => row.step) }, null, 2)
  );
  throw error;
} finally {
  await browser.close();
}
