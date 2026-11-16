/* eslint-disable no-await-in-loop -- Each browser scenario and retry must finish before the next step can use its result. */
/* Ticket 8 (daily reports and saved reports) acceptance on the local Docker deployment.
 *
 * Scenario (section 4, phase 4 of the ticket): an employee builds a draft from today's recorded activity,
 * drops one suggestion and edits another, submits, then corrects; an hourly-leave day and a full-leave day;
 * cancelling the leave updates the day; an in-app reminder; the manager's team view with blockers / help;
 * a manager of another unit has no access; building, saving, re-opening and sharing a "late tickets with
 * reason" report and its CSV export; 375px mobile. Roles, users and units are created through the admin API
 * (as the organization pages do); leave rows, ticket activity and calendar events that need a past time are
 * created with the Django shell. No e-mail or SMS is sent.
 * Run from the repository root: node apps/web/tests/browser/crm-ticket-eight-acceptance.mjs
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
const output = resolve("docs/evidence/ticket-8");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const names = ["admin", "employee", "other", "manager", "otherManager"];
const contexts = Object.fromEntries(
  await Promise.all(
    names.map(async (name) => [
      name,
      await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "fa-IR" }),
    ])
  )
);
const pages = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await contexts[name].newPage()])));
const errors = [];
for (const page of Object.values(pages)) {
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(240000); // Vite dev server compiles each route on its first visit.
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
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status(), data: body };
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
const waitFor = (page, part, method = "PUT") =>
  page.waitForResponse((response) => response.request().method() === method && response.url().includes(part), {
    timeout: 180000,
  });
const noHorizontalScroll = (page) =>
  page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);

try {
  // ------------------------------------------------------------ setup (admin API, as the organization pages do)
  await login(pages.admin, env.DEV_ADMIN_EMAIL, env.DEV_ADMIN_PASSWORD);
  const admin = contexts.admin;
  const permissions = ok(await request(admin, "organization/permissions/"));
  const ids = (codes) => permissions.filter((item) => codes.has(item.code)).map((item) => item.id);
  const employeeCodes = new Set([
    "DailyReport.Submit",
    "Report.View",
    "Issue.View",
    "Issue.Create",
    "Issue.Edit",
    "Issue.Status.Edit",
    "WorkSchedule.ViewOwn",
    "LeaveRequest.Create",
    "Workflow.View",
  ]);
  const managerCodes = new Set([
    ...employeeCodes,
    "Issue.ViewAll",
    "DailyReport.Team.View",
    "Report.Team.View",
    "Report.Build",
    "Report.Share",
    "Report.Export",
  ]);
  const employeeRole = ok(
    await request(admin, "organization/roles/", "POST", {
      name: `T8 کارمند ${stamp}`,
      permission_ids: ids(employeeCodes),
    }),
    201
  );
  const managerRole = ok(
    await request(admin, "organization/roles/", "POST", {
      name: `T8 مدیر گزارش ${stamp}`,
      permission_ids: ids(managerCodes),
    }),
    201
  );
  const password = `T8!${randomUUID()}aA`;
  async function createUser(label, role) {
    const suffix = `t8-${stamp}-${label}`;
    const email = `${suffix}@example.test`;
    const displayName = `T8 ${label} ${stamp}`;
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
  const other = await createUser("other", employeeRole);
  const manager = await createUser("manager", managerRole);
  const otherManager = await createUser("manager2", managerRole);
  ok(
    await request(admin, "organization/units/", "POST", {
      title: `T8 تیم الف ${stamp}`,
      manager_id: manager.id,
      member_ids: [employee.id],
    }),
    201
  );
  ok(
    await request(admin, "organization/units/", "POST", {
      title: `T8 تیم ب ${stamp}`,
      manager_id: otherManager.id,
      member_ids: [other.id],
    }),
    201
  );

  // Data that needs a past moment or a decided state (no UI creates "approved" leave without a workflow run).
  const [today, fullLeaveDay, fullLeaveId] = shell(`
from datetime import datetime, time, timedelta
from django.utils import timezone
from plane.db.models import *
from plane.app.services import ticket_core as core
from plane.app.services.work_calendar import calendar_zone, local_today, schedule_for
ws = Workspace.objects.get(slug="${slug}")
zone = calendar_zone(ws); now = timezone.now(); today = local_today(ws)
emp = User.objects.get(email="${employee.email}"); oth = User.objects.get(email="${other.email}")
def ticket(user, name):
    issue = Issue(workspace=ws, name=name); issue.save(created_by_id=user.id)
    IssueAssignee.objects.create(issue=issue, assignee=user, workspace=ws, project=None)
    return issue
mine = ticket(emp, "T8 نصب سرور ${stamp}")
core.record(mine, emp, "ticket.category_changed", after="در حال انجام")
core.record(mine, emp, "ticket.referred")
for user, name, reason in ((emp, "T8 تیکت دیرکردهٔ تیم الف ${stamp}", "انتظار پاسخ تأمین‌کننده ${stamp}"), (oth, "T8 تیکت دیرکردهٔ تیم ب ${stamp}", "قطعی شبکه ${stamp}")):
    late = ticket(user, name)
    Issue.objects.filter(id=late.id).update(status="in_progress", target_minutes=60, target_at=now - timedelta(hours=3),
        target_anchor_at=now - timedelta(hours=5), target_started_at=now - timedelta(hours=5), target_calendar={"total": 60})
    WorkflowDelayReport.objects.create(issue=late, reporter=user, reason=reason, progress="۷۰٪", expected_at=now + timedelta(hours=4), target_at=now - timedelta(hours=3))
    WorkflowExtension.objects.create(issue=late, scope="ticket", minutes=120, requested_by=user, status="approved",
        previous_target_at=now - timedelta(hours=3), requested_target_at=now + timedelta(hours=5), reason="نیاز به قطعه")
start = max(datetime.combine(today, time(0, 1), tzinfo=zone), now - timedelta(minutes=90))
event = WorkEvent.objects.create(workspace=ws, kind="meeting", title="T8 جلسهٔ هماهنگی ${stamp}", starts_at=start, ends_at=start + timedelta(minutes=20))
WorkEventParticipant.objects.create(event=event, user=emp)
def leave(user, day, mode, starts, ends):
    row = LeaveRequest.objects.create(workspace=ws, requester=user, number="T8-${stamp}-" + mode, status="approved")
    LeaveRequestVersion.objects.create(request=row, number=1, mode=mode, start_date=day, end_date=day, starts_at=starts, ends_at=ends,
        duration_days=1 if mode == "daily" else None, duration_minutes=None if mode == "daily" else 60)
    return row
leave(emp, today, "hourly", datetime.combine(today, time(22), tzinfo=zone), datetime.combine(today, time(23), tzinfo=zone))
day = next(today - timedelta(days=n) for n in range(1, 8) if schedule_for(emp, today - timedelta(days=n), ws).working)
full = leave(emp, day, "daily", datetime.combine(day, time(0), tzinfo=zone), datetime.combine(day + timedelta(days=1), time(0), tzinfo=zone))
print("OUT:" + today.isoformat()); print("OUT:" + day.isoformat()); print("OUT:" + str(full.id))
`);

  // 1. Employee: hourly-leave banner, draft from today's activity.
  const employeePage = pages.employee;
  await login(employeePage, employee.email, password);
  await employeePage.goto(`${base}/daily-report`);
  await employeePage.getByRole("heading", { name: "گزارش کار روزانهٔ من" }).waitFor();
  await employeePage.getByText("مرخصی ساعتی تأییدشده").waitFor();
  assert.equal(await employeePage.getByText("دسته").count(), 0);
  await Promise.all([
    waitFor(employeePage, "/draft/", "GET"),
    employeePage.getByRole("button", { name: "ساخت پیش‌نویس از فعالیت‌های امروز" }).click(),
  ]);
  const cards = employeePage.getByRole("article", { name: "پیشنهاد پیش‌نویس" });
  await cards.first().waitFor();
  const suggestionCount = await cards.count();
  assert.ok(suggestionCount >= 2, `suggestions: ${suggestionCount}`);
  await capture(1, "مرخصی ساعتی فقط‌خواندنی و پیش‌نویس از فعالیت‌های امروز با منبع هر پیشنهاد", employeePage, {
    suggestionCount,
  });

  // 2. Drop the meeting suggestion, edit the ticket suggestion, add a blocker that needs help, submit.
  await cards.filter({ hasText: "جلسهٔ هماهنگی" }).getByRole("button", { name: "حذف" }).click();
  // Pin the card by position: in edit mode its text moves into a textarea (no longer matched by hasText).
  const ticketIndex = await cards.evaluateAll((els) => els.findIndex((el) => el.textContent.includes("T8 نصب سرور")));
  assert.ok(ticketIndex >= 0);
  const ticketCard = cards.nth(ticketIndex);
  await ticketCard.getByRole("button", { name: "ویرایش" }).click();
  await ticketCard.getByRole("textbox", { name: "ویرایش پیشنهاد" }).fill(`نصب سرور مشتری انجام و تحویل شد ${stamp}`);
  await ticketCard.getByRole("button", { name: "نگه‌دار" }).click();
  const blocker = employeePage.getByRole("textbox", { name: "افزودن به مانع یا نیاز به کمک" });
  await blocker.fill(`دسترسی به سرور آزمون ندارم ${stamp}`);
  await blocker.press("Enter");
  await employeePage.getByRole("region", { name: "مانع یا نیاز به کمک" }).getByLabel("نیاز به کمک دارم").check();
  const [submitted] = await Promise.all([
    waitFor(employeePage, "/daily-reports/day/"),
    employeePage.getByRole("button", { name: "ثبت گزارش" }).click(),
  ]);
  assert.equal(submitted.status(), 200, await submitted.text());
  const saved = await submitted.json();
  assert.equal(saved.report.status, "submitted");
  assert.ok(saved.report.items.some((item) => item.source_kind === "issue" && item.text.includes("تحویل شد")));
  assert.ok(!saved.report.items.some((item) => item.source_kind === "event"));
  await employeePage.locator(".dr-daybar .dr-pill").filter({ hasText: "ثبت‌شده" }).first().waitFor();
  await capture(2, "یک پیشنهاد حذف، یکی ویرایش و نگه‌داری شد؛ مانع با «نیاز به کمک»؛ گزارش ثبت شد", employeePage);

  // 3. Correction after submission → new revision in the history.
  const doneArea = employeePage.getByRole("region", { name: "انجام‌شده" }).getByRole("textbox").first();
  await doneArea.fill(`نصب سرور مشتری انجام، آزمون و تحویل شد ${stamp}`);
  const [revised] = await Promise.all([
    waitFor(employeePage, "/daily-reports/day/"),
    employeePage.getByRole("button", { name: "ثبت اصلاح" }).click(),
  ]);
  assert.equal(revised.status(), 200);
  assert.equal((await revised.json()).report.revision, saved.report.revision + 1);
  await employeePage.getByRole("button", { name: "سابقهٔ اصلاح" }).click();
  await employeePage.getByText("اصلاح پس از ثبت").waitFor();
  await capture(3, "اصلاح پس از ثبت با نسخهٔ تازه و سابقهٔ تغییر", employeePage);

  // 4. Full-leave day → "not required"; cancelling the leave is reflected immediately.
  await employeePage.goto(`${base}/daily-report?date=${fullLeaveDay}`);
  await employeePage.getByText("روز تمام‌مرخصی — گزارش لازم نیست").first().waitFor();
  await capture(4, "روز تمام‌مرخصی: گزارش لازم نیست و مرخصی فقط‌خواندنی", employeePage);
  shell(
    `from plane.db.models import LeaveRequest\nLeaveRequest.objects.filter(id="${fullLeaveId}").update(status="cancelled")\nprint("OUT:ok")`
  );
  await employeePage.reload();
  await employeePage.getByRole("heading", { name: "گزارش کار روزانهٔ من" }).waitFor();
  await employeePage.getByRole("region", { name: "انجام‌شده" }).waitFor();
  assert.equal(await employeePage.getByText("روز تمام‌مرخصی — گزارش لازم نیست").count(), 0);
  assert.equal(await employeePage.getByText("مرخصی روزانه تأییدشده").count(), 0);
  await capture(4, "پس از لغو مرخصی، روز دوباره گزارش لازم دارد (بدون همگام‌سازی)", employeePage, {}, "b");

  // 5. In-app reminder for the person who has not reported (only this person is reminded in the run).
  const [reminderResult] = shell(`
from datetime import datetime, time
from plane.app.services import daily_report_reminders as reminders
from plane.app.services.work_calendar import calendar_zone, local_today
from plane.db.models import Workspace
ws = Workspace.objects.get(slug="${slug}")
original = reminders.due_people
def only(workspace, now):
    policy, today, people = original(workspace, now)
    return policy, today, [p for p in people if p.email == "${other.email}"]
reminders.due_people = only
now = datetime.combine(local_today(ws), time(23, 30), tzinfo=calendar_zone(ws))
first = reminders.send_reminders(now=now); second = reminders.send_reminders(now=now)
print("OUT:" + str(first["sent"]) + "/" + str(second["sent"]))
`);
  assert.ok(reminderResult.startsWith("1/0") || reminderResult.endsWith("/0"), reminderResult);
  const otherPage = pages.other;
  await login(otherPage, other.email, password);
  await otherPage.goto(`${base}/inbox`);
  await otherPage.getByText("یادآوری گزارش روزانه").first().waitFor();
  await capture(5, "یادآوری درون‌برنامه‌ای (یک بار؛ اجرای دوباره اعلان تکراری نساخت)", otherPage, { reminderResult });

  // 6. Manager: team view with blockers / help, only their own team.
  const managerPage = pages.manager;
  await login(managerPage, manager.email, password);
  await managerPage.goto(`${base}/daily-report/team`);
  await managerPage.getByRole("heading", { name: "گزارش روزانهٔ تیم" }).waitFor();
  const teamTable = managerPage.getByRole("region", { name: "وضعیت گزارش روزانهٔ تیم" });
  await teamTable.getByText(employee.displayName).waitFor();
  await teamTable.getByText(`دسترسی به سرور آزمون ندارم ${stamp}`).waitFor();
  assert.equal(await teamTable.getByText(other.displayName).count(), 0);
  await capture(6, "مدیر وضعیت ثبت و «نیاز به کمک» تیم خود را می‌بیند؛ فرد تیم دیگر نیست", managerPage);

  // 7. Manager of another unit: no access to this employee's report (UI and API).
  const otherManagerPage = pages.otherManager;
  await login(otherManagerPage, otherManager.email, password);
  await otherManagerPage.goto(`${base}/daily-report?user=${employee.id}`);
  await otherManagerPage.getByText("گزارش در دسترس نیست").waitFor();
  assert.equal((await request(contexts.otherManager, `daily-reports/day/${today}/?user=${employee.id}`)).status, 404);
  const injected = ok(
    await request(contexts.otherManager, "reports/run/", "POST", {
      source: "daily_reports",
      user_id: employee.id,
      definition: { filters: [{ field: "person", op: "in", value: [employee.id] }] },
    })
  );
  assert.equal(injected.total, 0);
  await capture(7, "مدیر واحد دیگر به گزارش این کارمند دسترسی ندارد (صفحه، API و شناسهٔ تزریق‌شده)", otherManagerPage);

  // 8. Build "late tickets with reason", save, share with the manager role, reopen.
  await managerPage.goto(`${base}/reports/source/ticket_deadlines`);
  await managerPage.getByRole("region", { name: "نتیجهٔ گزارش" }).waitFor();
  await managerPage.getByRole("button", { name: "سازندهٔ گزارش" }).click();
  const builder = managerPage.getByRole("region", { name: "سازندهٔ گزارش" });
  await builder.getByRole("button", { name: "افزودن فیلتر" }).click();
  const filterRow = builder.locator(".rp-filter").first();
  await filterRow.getByRole("combobox", { name: "فیلد" }).selectOption({ label: "وضعیت موعد" });
  await filterRow.getByRole("combobox", { name: "عملگر" }).selectOption({ label: "برابر" });
  await filterRow.getByRole("combobox", { name: "مقدار" }).selectOption({ label: "دیرکرده" });
  await builder.getByRole("button", { name: "پیش‌نمایش" }).click();
  await managerPage.getByRole("region", { name: "نتیجهٔ گزارش" }).getByText(`انتظار پاسخ تأمین‌کننده ${stamp}`).waitFor();
  await builder.getByRole("textbox", { name: "نام گزارش" }).fill(`T8 دیرکردها ${stamp}`);
  await builder.getByLabel("اشتراک با نقش یا واحد").check();
  await builder.getByLabel(`T8 مدیر گزارش ${stamp}`).check();
  await Promise.all([
    managerPage.waitForURL(/\/reports\/saved\//),
    builder.getByRole("button", { name: "ذخیره به‌عنوان گزارش جدید" }).click(),
  ]);
  const savedUrl = managerPage.url();
  await managerPage.reload();
  const table = managerPage.getByRole("region", { name: "نتیجهٔ گزارش" });
  await table.getByText(`انتظار پاسخ تأمین‌کننده ${stamp}`).waitFor();
  assert.equal(await table.getByText(`قطعی شبکه ${stamp}`).count(), 0);
  await capture(8, "گزارش «تیکت‌های دیرکرده با دلیل» ساخته، ذخیره، به اشتراک گذاشته و دوباره باز شد", managerPage, {
    savedUrl,
  });

  // 9. CSV export: same rows and scope as the page.
  await managerPage.getByRole("button", { name: "خروجی CSV" }).last().click();
  const link = managerPage.getByRole("link", { name: /دریافت فایل/ });
  await link.waitFor({ timeout: 180000 });
  const href = await link.getAttribute("href");
  const file = await contexts.manager.request.get(`${base}${href}`);
  assert.equal(file.status(), 200);
  const csv = (await file.text()).replace(/^\uFEFF/, "");
  assert.ok(csv.includes(`انتظار پاسخ تأمین‌کننده ${stamp}`));
  assert.ok(!csv.includes(`قطعی شبکه ${stamp}`));
  const savedId = savedUrl.split("/").pop();
  const pageRun = ok(await request(contexts.manager, `reports/saved/${savedId}/run/`, "POST", { page_size: 200 }));
  assert.equal(csv.trim().split(/\r?\n/).length - 1, pageRun.total);
  await capture(9, "خروجی CSV با همان ردیف‌ها و دامنهٔ صفحه", managerPage, { rows: pageRun.total });

  // 10. The shared report runs in the recipient's own scope (sharing grants no data).
  await otherManagerPage.goto(savedUrl);
  const recipientTable = otherManagerPage.getByRole("region", { name: "نتیجهٔ گزارش" });
  await recipientTable.getByText(`قطعی شبکه ${stamp}`).waitFor();
  assert.equal(await recipientTable.getByText(`انتظار پاسخ تأمین‌کننده ${stamp}`).count(), 0);
  await capture(10, "گیرندهٔ اشتراک فقط دادهٔ دامنهٔ خودش را می‌بیند", otherManagerPage);

  // 11. Mobile 375px: no horizontal page scroll (tables scroll inside their region).
  for (const [page, path, suffix] of [
    [employeePage, "/daily-report", ""],
    [managerPage, new URL(savedUrl).pathname, "b"],
    [managerPage, "/daily-report/team", "c"],
  ]) {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${base}${path}`);
    await page.locator(".dr-page, .rp-page").first().waitFor();
    await page.waitForTimeout(1500);
    assert.ok(await noHorizontalScroll(page), `horizontal scroll on ${path}`);
    await capture(11, `موبایل ۳۷۵px بدون اسکرول افقی: ${path}`, page, {}, suffix);
  }
  assert.deepEqual(errors, []);
  process.stdout.write(`DONE ${checks.length} checks, ${errors.length} page errors\n`);
} catch (error) {
  for (const [name, page] of Object.entries(pages)) {
    await page.screenshot({ path: resolve(output, `failure-${name}.png`), fullPage: true }).catch(() => undefined);
  }
  await writeFile(
    resolve(output, "report.json"),
    JSON.stringify({ started_at: stamp, base, checks, errors, failure: String(error) }, null, 2)
  );
  throw error;
} finally {
  await browser.close();
}
