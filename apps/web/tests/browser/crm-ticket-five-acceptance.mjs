/* Ticket 5 (ticket core and routing) acceptance on the local Docker deployment.
 *
 * Steps follow section 8.3 of the ticket. Test data (users, unit, absences, a delegate, a ticket
 * type, a whole-day working exception for the assignee) is prepared through the same APIs the pages
 * use, or through the Django shell where no API exists (absences, delegates, ticket types).
 * The live server cannot time-travel: the "overdue" ticket gets a one-minute target on a day the
 * assignee's calendar marks as fully working, then the script waits for it to pass.
 * Everything created for routing is deactivated / cancelled at the end.
 * Run from the repository root: node apps/web/tests/browser/crm-ticket-five-acceptance.mjs
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
const output = resolve("docs/evidence/ticket-5");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const names = ["admin", "employee", "colleague", "boss", "delegate", "outsider"];
const contexts = Object.fromEntries(
  await Promise.all(names.map(async (name) => [name, await browser.newContext({ viewport: { width: 1440, height: 1100 } })]))
);
const pages = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await contexts[name].newPage()])));
const errors = [];
for (const page of Object.values(pages)) {
  page.setDefaultTimeout(45000);
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
const waitFor = (page, part, method = "POST") =>
  page.waitForResponse((response) => response.request().method() === method && response.url().includes(part));
const card = (page, title) => page.locator("section.ticket-card", { has: page.getByRole("heading", { name: title }) });
const record = async (ctx, id) => ok(await request(ctx, `engine/entities/ticket/records/${id}/`));
const setStatus = async (ctx, id, status) => {
  const row = await record(ctx, id);
  return ok(
    await request(ctx, `engine/entities/ticket/records/${id}/`, "PATCH", {
      revision: row.revision,
      values: { ticket_state: status },
    })
  );
};
const core = async (ctx, id) => ok(await request(ctx, `tickets/${id}/core/`));
const cleanup = { rules: [], absences: [], exceptions: [], order: null, workflows: [] };

try {
  // ------------------------------------------------------------ setup
  await login(pages.admin, env.DEV_ADMIN_EMAIL, env.DEV_ADMIN_PASSWORD);
  const admin = contexts.admin;
  // Ticket 4 workflows own the status of new tickets; switch the active ones off for this run and restore them.
  for (const row of ok(await request(admin, "workflows/definitions/?entity=ticket")).results ?? [])
    if (row.is_active) {
      ok(await request(admin, `workflows/definitions/${row.id}/`, "PATCH", { is_active: false }));
      cleanup.workflows.push(row.id);
    }
  const permissions = ok(await request(admin, "organization/permissions/"));
  const ids = (codes) => permissions.filter((item) => codes.includes(item.code)).map((item) => item.id);
  const memberCodes = [
    "Issue.View",
    "Issue.Create",
    "Issue.Edit",
    "Issue.Status.Edit",
    "Issue.Assign",
    "Routing.View",
    "Routing.Queue.View",
    "Workflow.View",
    "Dashboard.Personal.Manage",
    "Export.Data",
    "Project.View",
    "Relation.Create",
    "Relation.Edit",
  ];
  const memberRole = ok(
    await request(admin, "organization/roles/", "POST", { name: `T5 member ${stamp}`, permission_ids: ids(memberCodes) }),
    201
  );
  const managerRole = ok(
    await request(admin, "organization/roles/", "POST", {
      name: `T5 manager ${stamp}`,
      permission_ids: ids([
        ...memberCodes,
        "Issue.ViewAll",
        "Ticket.TargetSet",
        "Routing.Manage",
        "Routing.Route",
        "Routing.Queue.ViewAll",
        "Routing.Queue.Claim",
        "WorkSchedule.ViewOwn",
        "WorkSchedule.ViewTeam",
        "WorkSchedule.EditTeam",
      ]),
    }),
    201
  );
  const password = `T5!${randomUUID()}aA`;
  async function createUser(label, role = memberRole) {
    const suffix = `${stamp}-t5-${label}`;
    const email = `${suffix}@example.test`;
    const displayName = `T5 ${label} ${stamp}`;
    const row = ok(
      await request(admin, "engine/entities/user/records/", "POST", {
        values: { user_name: displayName, user_username: suffix, user_email: email, user_password: password, user_roles: [role.id] },
      }),
      201
    );
    return { ...row, email, displayName };
  }
  const people = {
    employee: await createUser("employee"),
    colleague: await createUser("colleague"),
    boss: await createUser("manager", managerRole),
    delegate: await createUser("delegate"),
    outsider: await createUser("outsider"),
    rr1: await createUser("rr1"),
    rr2: await createUser("rr2"),
  };
  const unit = ok(
    await request(admin, "organization/units/", "POST", {
      title: `واحد تیکت ${stamp}`,
      manager_id: people.boss.id,
      member_ids: [people.employee.id, people.colleague.id, people.delegate.id, people.rr1.id, people.rr2.id],
    }),
    201
  );
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran" }).format(new Date());
  const [typeId] = shell(
    `from plane.db.models import IssueType, Workspace\nw=Workspace.objects.get(slug="${slug}")\nt=IssueType.objects.create(workspace=w, name="پشتیبانی ${stamp}")\nprint("OUT:"+str(t.id))`
  );
  shell(
    `from plane.db.models import OrganizationUnitDelegate\nOrganizationUnitDelegate.objects.create(unit_id="${unit.id}", user_id="${people.delegate.id}")\nprint("OUT:ok")`
  );
  const subtype = `issue-type-${typeId}`;
  const schema = ok(await request(admin, "engine/entities/ticket/schema/"));
  const fieldList = Array.isArray(schema.fields) ? schema.fields : Object.values(schema.fields || {});
  const customerField = fieldList.find((field) => field.relation_entity === "customer")?.code;
  // The dev workspace requires project↔customer on both sides, so new ones cannot be created one by one;
  // reuse an existing customer record and project (only memberships are added for the test users).
  const [customerId, projectId] = shell(
    `from plane.db.models import EntityRecord, Project, Workspace\nw=Workspace.objects.get(slug="${slug}")\n` +
      `c=EntityRecord.objects.filter(workspace=w, entity__code="customer", entity__parent__isnull=True, is_active=True).order_by("created_at").first()\n` +
      `p=Project.objects.filter(workspace=w, archived_at__isnull=True).order_by("created_at").first()\nprint("OUT:"+str(c.id))\nprint("OUT:"+str(p.id))`
  );
  const customer = { id: customerId };
  const project = { id: projectId };
  shell(
    `from plane.db.models import ProjectMember, Project\np=Project.objects.get(id="${project.id}")\n` +
      [people.employee, people.colleague, people.boss, people.delegate]
        .map((p) => `ProjectMember.objects.get_or_create(project=p, member_id="${p.id}", defaults={"role": 15, "workspace_id": p.workspace_id})`)
        .join("\n") +
      `\nprint("OUT:ok")`
  );
  for (const name of ["employee", "colleague", "boss", "delegate", "outsider"])
    await login(pages[name], people[name].email, password);
  const emp = contexts.employee;
  const col = contexts.colleague;
  const boss = contexts.boss;
  // The assignee works the whole day today (fast, real overdue on the live server); set by the direct manager.
  const exception = ok(
    await request(boss, "work-calendar/exceptions/", "POST", {
      user: people.employee.id,
      date_from: today,
      date_to: today,
      is_working: true,
      start: "00:00",
      end: "23:59",
      reason: `آزمون پذیرش تیکت ۵ ${stamp}`,
    }),
    201
  );
  cleanup.exceptions.push(exception.id);

  // ------------------------------------------------------------ 1. create with all ن۱ fields
  const createTicket = async (ctx, title, values = {}, extra = {}) =>
    ok(
      await request(ctx, "engine/entities/ticket/records/", "POST", {
        values: { title, priority: "high", ...values },
        ...extra,
      }),
      201
    );
  const parent = await createTicket(
    boss,
    `تیکت والد ${stamp}`,
    {
      rich_description: "<p>شرح کامل مشکل مشتری</p>",
      ticket_assignees: [people.employee.id],
      project: project.id,
      due_date: today,
      ...(customerField ? { [customerField]: customer.id } : {}),
    },
    { subtype }
  );
  const child = await createTicket(boss, `زیرتیکت ${stamp}`, {
    ticket_assignees: [people.employee.id],
    ...(customerField ? { [customerField]: customer.id } : {}),
  }, { subtype });
  await pages.employee.goto(`${base}/entities/ticket/${child.id}`);
  await card(pages.employee, "مشخصات تیکت").getByRole("button", { name: "تعیین تیکت والد" }).click();
  const parentDialog = pages.employee.locator("form.ticket-dialog");
  await parentDialog.getByRole("combobox", { name: "تیکت والد" }).fill(`تیکت والد ${stamp}`);
  await pages.employee.getByRole("option", { name: new RegExp(`تیکت والد ${stamp}`) }).first().click();
  await Promise.all([waitFor(pages.employee, "/parent/"), parentDialog.getByRole("button", { name: "ذخیره" }).click()]);
  await card(pages.employee, "مشخصات تیکت").getByRole("link", { name: `تیکت والد ${stamp}` }).waitFor();
  // ۶.۲ header: number + title, status menu, «نوع · اولویت · مشتری · پروژه · ثبت‌کننده»; tabs.
  const header = pages.employee.locator(".ticket-header");
  await header.getByRole("combobox", { name: "وضعیت" }).waitFor();
  for (const label of ["نوع", "اولویت", "مشتری", "پروژه", "ثبت‌کننده"]) await header.getByText(label, { exact: true }).waitFor();
  await pages.employee.getByRole("tab", { name: /زیرتیکت‌ها/ }).click();
  await pages.employee.locator(".ticket-children-panel").getByRole("link", { name: `تیکت والد ${stamp}` }).waitFor();
  await pages.employee.getByRole("tab", { name: /سابقه/ }).click();
  const childCard = await core(emp, child.id);
  assert.equal(childCard.details.parent.id, parent.id);
  // The customer comes from the existing relation; only viewers allowed to see that customer get its name.
  assert.equal(childCard.details.customers?.length ?? 0, 0, "employee cannot see this customer record");
  assert.ok((await core(boss, child.id)).details.customers?.length, "manager sees the linked customer");
  assert.equal(childCard.details.creator, people.boss.displayName);
  await capture(1, "تیکت با عنوان، شرح، نوع، اولویت، مسئول، ثبت‌کننده، مشتری، پروژه، سررسید و والد/فرزند ساخته شد", pages.employee, {
    customer_relation_field: customerField || null,
    parent: parent.id,
    child: child.id,
  });

  // ------------------------------------------------------------ 2. 8 working hours for the type; start; card
  await pages.boss.goto(`${base}/routing`);
  const typeRow = pages.boss.locator("li.ticket-inbox-row", { hasText: `پشتیبانی ${stamp}` });
  await typeRow.getByRole("button", { name: "تعیین مدت هدف" }).click();
  await typeRow.getByLabel("ساعت کاری").fill("8");
  await typeRow.getByLabel("دقیقهٔ کاری").fill("0");
  await typeRow.getByLabel("دلیل تغییر").fill("استاندارد پاسخ پشتیبانی");
  await Promise.all([waitFor(pages.boss, "/target/"), typeRow.getByRole("button", { name: "ذخیره" }).click()]);
  await typeRow.getByText("۸ ساعت کاری").waitFor();
  await setStatus(emp, child.id, "in_progress");
  await pages.employee.goto(`${base}/entities/ticket/${child.id}`);
  const target = card(pages.employee, "زمان هدف");
  await target.getByText("پایان تقریبی").waitFor();
  await target.getByText("برنامهٔ فرد").or(target.getByText("استثنای برنامهٔ فرد")).first().waitFor();
  await target.getByText("مانده").waitFor();
  const started = await core(emp, child.id);
  assert.equal(started.deadline.total_minutes, 480);
  assert.ok(started.deadline.target_at);
  await capture(2, "۸ ساعت کاری برای نوع؛ شروع کار؛ پایان تقریبی، منبع تقویم و زمان مانده", pages.employee, {
    target_at: started.deadline.target_at,
    calendar: started.deadline.calendar,
  });

  // ------------------------------------------------------------ 3. manager changes the target with a reason
  await pages.boss.goto(`${base}/entities/ticket/${child.id}`);
  await card(pages.boss, "زمان هدف").getByRole("button", { name: "تغییر مدت هدف" }).click();
  const targetDialog = pages.boss.locator("form.ticket-dialog");
  await targetDialog.getByLabel("مدت هدف — ساعت کاری").fill("10");
  await targetDialog.getByLabel("مدت هدف — دقیقهٔ کاری").fill("0");
  await targetDialog.getByLabel("دلیل تغییر (اجباری)").fill("دامنهٔ کار بزرگ‌تر شد");
  await Promise.all([waitFor(pages.boss, "/target/"), targetDialog.getByRole("button", { name: "ذخیره" }).click()]);
  await pages.boss.getByRole("tab", { name: "موعد" }).click();
  await pages.boss.getByText("دلیل: دامنهٔ کار بزرگ‌تر شد").waitFor();
  await pages.boss.getByText(/۸ ساعت کاری ← ۱۰ ساعت کاری/).waitFor();
  await capture(3, "تغییر مدت هدف توسط مدیر با دلیل؛ مقدار قبلی در سابقه", pages.boss);

  // ------------------------------------------------------------ 4. extension: pending → reject → again → approve
  const beforeExtension = (await core(emp, child.id)).deadline.target_at;
  await pages.employee.goto(`${base}/entities/ticket/${child.id}`);
  await card(pages.employee, "زمان هدف").getByRole("button", { name: "درخواست تمدید" }).click();
  const extDialog = pages.employee.locator("form.ticket-dialog");
  await extDialog.getByLabel("مدت اضافه — ساعت کاری").fill("1");
  await extDialog.getByLabel("دلیل (اجباری)").fill("منتظر پاسخ تأمین‌کننده");
  await extDialog.getByText(/پایان جدید در صورت تأیید/).waitFor();
  await extDialog.getByText(new RegExp(`گیرنده: ${people.boss.displayName}`)).waitFor();
  await capture(4, "پنجرهٔ تمدید با پیش‌نمایش پایان جدید و گیرنده", pages.employee, {}, "a");
  await Promise.all([waitFor(pages.employee, "/extension/"), extDialog.getByRole("button", { name: "ارسال درخواست" }).click()]);
  await card(pages.employee, "زمان هدف").getByText(new RegExp(`تمدید در انتظار تأیید ${people.boss.displayName}`)).waitFor();
  assert.equal((await core(emp, child.id)).deadline.target_at, beforeExtension, "pending extension must not move the deadline");
  await pages.boss.goto(`${base}/workflow-inbox`);
  const inboxRow = pages.boss.locator("li.ticket-inbox-row", { hasText: `زیرتیکت ${stamp}` });
  await inboxRow.getByRole("button", { name: "رد" }).click();
  await inboxRow.getByLabel("دلیل رد").fill("اولویت تأمین‌کننده نیست");
  await Promise.all([waitFor(pages.boss, "/decide/"), inboxRow.getByRole("button", { name: "ثبت رد" }).click()]);
  assert.equal((await core(emp, child.id)).deadline.target_at, beforeExtension, "rejection keeps the deadline");
  ok(await request(emp, `tickets/${child.id}/extension/`, "POST", { minutes: 60, reason: "تأمین‌کننده تأخیر داشت" }), 201);
  await pages.boss.goto(`${base}/entities/ticket/${child.id}`);
  await card(pages.boss, "زمان هدف").getByRole("button", { name: "تأیید تمدید" }).click();
  await Promise.all([
    waitFor(pages.boss, "/decide/"),
    pages.boss.locator("form.ticket-dialog").getByRole("button", { name: "تأیید" }).click(),
  ]);
  const afterExtension = (await core(emp, child.id)).deadline.target_at;
  assert.notEqual(afterExtension, beforeExtension, "approval moves the deadline");
  await pages.boss.getByRole("tab", { name: "تمدید" }).click();
  await pages.boss.getByText("رد تمدید").first().waitFor();
  await capture(4, "معلق ← ثابت؛ رد ← ثابت؛ درخواست دوباره ← تأیید ← موعد جدید", pages.boss, {
    before: beforeExtension,
    after: afterExtension,
  }, "b");

  // ------------------------------------------------------------ 5. overdue
  const late = await createTicket(col, `تیکت دیرکرد ${stamp}`, { ticket_assignees: [people.employee.id] }, { subtype });
  ok(await request(boss, `tickets/${late.id}/target/`, "POST", { minutes: 1, reason: "آزمون دیرکرد" }));
  await setStatus(emp, late.id, "in_progress");
  await new Promise((done) => setTimeout(done, 75_000));
  await pages.employee.goto(`${base}/entities/ticket/${late.id}`);
  await pages.employee.locator(".ticket-banner").waitFor();
  await pages.employee.getByRole("button", { name: "ثبت گزارش تأخیر" }).click();
  const delayDialog = pages.employee.locator("form.ticket-dialog");
  await delayDialog.getByLabel("دلیل تأخیر").fill("سامانهٔ مشتری در دسترس نبود");
  await delayDialog.getByLabel("وضعیت پیشرفت").fill("نیمی از کار انجام شده");
  // Pick «two days from now» in the Persian date-time picker of the dialog (time stays 00:00).
  const jalali = (date) =>
    Object.fromEntries(
      new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
        timeZone: "Asia/Tehran",
        day: "numeric",
        month: "long",
        year: "numeric",
      })
        .formatToParts(date)
        .map((part) => [part.type, part.value])
    );
  const nowJalali = jalali(new Date());
  const dueJalali = jalali(new Date(Date.now() + 2 * 86400_000));
  await delayDialog.getByRole("button", { name: "زمان پایان جدید", exact: true }).click();
  if (dueJalali.month !== nowJalali.month) await pages.employee.getByRole("button", { name: "ماه بعد" }).click();
  await pages.employee
    .getByRole("button", { name: `${dueJalali.day} ${dueJalali.month} ${dueJalali.year}`, exact: true })
    .click();
  await Promise.all([
    waitFor(pages.employee, "/delay-report/"),
    delayDialog.getByRole("button", { name: "ثبت گزارش" }).click(),
  ]);
  const lateCard = await core(emp, late.id);
  assert.equal(lateCard.deadline.state, "overdue");
  assert.equal(lateCard.deadline.category, "in_progress", "overdue never closes the ticket");
  await pages.employee.reload();
  await pages.employee.getByText("آخرین گزارش تأخیر").waitFor();
  await capture(5, "بنر دیرکرد و ثبت گزارش تأخیر؛ تیکت باز می‌ماند", pages.employee, {}, "a");
  await pages.employee.goto(`${base}/entities/ticket`);
  await pages.employee.getByRole("tab", { name: /عقب‌افتاده/ }).click();
  await pages.employee.getByText(`تیکت دیرکرد ${stamp}`).first().waitFor();
  await capture(5, "فیلتر «عقب‌افتاده» با شمارندهٔ سرور", pages.employee, {}, "b");
  // «همه کارها»: the same ready filter and the board grouped by the three categories (ن۶).
  await pages.employee.goto(`${base}/issues`);
  await pages.employee.getByRole("tab", { name: /عقب‌افتاده/ }).click();
  await pages.employee.getByText(`تیکت دیرکرد ${stamp}`).first().waitFor();
  await pages.employee.getByRole("button", { name: /برد کانبان/ }).click();
  for (const title of ["انجام‌نشده", "در حال انجام", "انجام‌شده"])
    await pages.employee.locator(".kanban-category-title", { hasText: title }).first().waitFor();
  await pages.employee.getByRole("tab", { name: /^همه/ }).click();
  await pages.employee.locator(".kanban-category").first().waitFor();
  await capture(5, "«همه کارها»: فیلتر آماده و کانبان گروه‌بندی‌شده با سه دستهٔ وضعیت", pages.employee, {}, "c");

  // ------------------------------------------------------------ 6. routing rules
  const existing = ok(await request(boss, "organization/routing-rules/"));
  cleanup.order = existing.map((row) => row.id);
  const rr = ok(
    await request(boss, "organization/routing-rules/", "POST", {
      name: `نوبتی ${stamp}`,
      method: "round_robin",
      member_ids: [people.rr1.id, people.rr2.id],
      conditions: { priorities: ["urgent"] },
    }),
    201
  );
  cleanup.rules.push(rr.id);
  const fixed = ok(
    await request(boss, "organization/routing-rules/", "POST", {
      name: `مدیر ثابت ${stamp}`,
      method: "user",
      target_user_id: people.boss.id,
      conditions: { priorities: ["low"] },
    }),
    201
  );
  cleanup.rules.push(fixed.id);
  ok(await request(boss, "organization/routing-rules/order/", "POST", { ids: [rr.id, fixed.id, ...cleanup.order] }));
  const routed = [];
  for (let i = 0; i < 3; i++) {
    const t = await createTicket(col, `نوبتی ${i} ${stamp}`, { priority: "urgent" }, { routing_rule_id: "auto" });
    routed.push((await record(col, t.id)).values.ticket_assignees?.[0]);
  }
  const pool = [people.rr1.id, people.rr2.id].sort();
  assert.deepEqual(
    routed.map((id) => pool.indexOf(id)),
    [routed[0] === pool[0] ? 0 : 1, routed[0] === pool[0] ? 1 : 0, routed[0] === pool[0] ? 0 : 1],
    `round-robin must alternate: ${routed}`
  );
  await pages.boss.goto(`${base}/routing`);
  await pages.boss.getByText(`نوبتی ${stamp}`).first().waitFor();
  await capture(6, "قاعدهٔ نوبتی بین دو نفر؛ سه تیکت به‌نوبت توزیع شد", pages.boss, { routed }, "a");
  const absence = (user) =>
    shell(
      `from plane.db.models import UserAbsence, Workspace\nfrom django.utils import timezone\nfrom datetime import timedelta\nw=Workspace.objects.get(slug="${slug}")\nn=timezone.now()\na=UserAbsence.objects.create(workspace=w, user_id="${user.id}", starts_at=n-timedelta(minutes=5), ends_at=n+timedelta(hours=6), status="scheduled", reason="آزمون تیکت ۵")\nprint("OUT:"+str(a.id))`
    )[0];
  cleanup.absences.push(absence(people.boss));
  const viaDelegate = await createTicket(col, `جانشین ${stamp}`, { priority: "low" }, { routing_rule_id: "auto" });
  assert.equal((await record(col, viaDelegate.id)).values.ticket_assignees?.[0], people.delegate.id, "absent person → delegate");
  cleanup.absences.push(absence(people.rr1), absence(people.rr2));
  const nobody = await createTicket(col, `بدون مسئول ${stamp}`, { priority: "urgent" }, { routing_rule_id: "auto" });
  assert.deepEqual((await record(col, nobody.id)).values.ticket_assignees ?? [], []);
  await pages.boss.goto(`${base}/routing`);
  await pages.boss.getByRole("heading", { name: `بدون مسئول ${stamp}` }).waitFor();
  await capture(6, "یک نفر غایب ← جانشین؛ همه غایب ← «بدون مسئول» و علامت مدیر", pages.boss, {
    delegate_ticket: viaDelegate.id,
    unassigned_ticket: nobody.id,
  }, "b");
  for (const id of cleanup.absences.splice(0))
    shell(`from plane.db.models import UserAbsence\nUserAbsence.objects.filter(id="${id}").update(status="cancelled")\nprint("OUT:ok")`);

  // ------------------------------------------------------------ 7. manual referral chain
  await pages.employee.goto(`${base}/entities/ticket/${parent.id}`);
  const referCard = card(pages.employee, "ارجاع");
  await referCard.getByRole("button", { name: "ارجاع", exact: true }).click();
  let dialog = pages.employee.locator("form.ticket-dialog");
  await dialog.getByRole("combobox", { name: "گیرنده" }).fill(people.colleague.displayName);
  await pages.employee.getByRole("option", { name: new RegExp(people.colleague.displayName) }).first().click();
  await dialog.getByLabel("دلیل (اجباری)").fill("تخصص این موضوع را دارد");
  await Promise.all([waitFor(pages.employee, "/refer/"), dialog.getByRole("button", { name: "ارجاع", exact: true }).click()]);
  await pages.colleague.goto(`${base}/entities/ticket/${parent.id}`);
  await card(pages.colleague, "ارجاع").getByRole("button", { name: "رد با دلیل" }).click();
  dialog = pages.colleague.locator("form.ticket-dialog");
  await dialog.getByLabel("دلیل (اجباری)").fill("این مورد مربوط به تیم من نیست");
  await Promise.all([waitFor(pages.colleague, "/respond/"), dialog.getByRole("button", { name: "رد و بازگرداندن" }).click()]);
  ok(await request(emp, `tickets/${parent.id}/refer/`, "POST", { user_id: people.colleague.id, reason: "دوباره بررسی کن" }), 201);
  await pages.colleague.goto(`${base}/entities/ticket/${parent.id}`);
  await card(pages.colleague, "ارجاع").getByRole("button", { name: "ارجاع به فرد دیگر" }).click();
  dialog = pages.colleague.locator("form.ticket-dialog");
  await dialog.getByRole("combobox", { name: "گیرنده" }).fill(people.delegate.displayName);
  await pages.colleague.getByRole("option", { name: new RegExp(people.delegate.displayName) }).first().click();
  await dialog.getByLabel("دلیل (اجباری)").fill("همکارم این کار را بهتر انجام می‌دهد");
  await Promise.all([waitFor(pages.colleague, "/respond/"), dialog.getByRole("button", { name: "ارجاع", exact: true }).click()]);
  await pages.delegate.goto(`${base}/entities/ticket/${parent.id}`);
  await Promise.all([
    waitFor(pages.delegate, "/respond/"),
    card(pages.delegate, "ارجاع").getByRole("button", { name: "پذیرش" }).click(),
  ]);
  const chain = (await core(contexts.delegate, parent.id)).referrals.filter((row) => row.outcome === "referred");
  assert.deepEqual(
    chain.map((row) => row.response),
    ["rejected", "forwarded", "accepted"]
  );
  await pages.delegate.getByRole("tab", { name: "مسئول و ارجاع" }).click();
  await pages.delegate.getByText("دلیل: این مورد مربوط به تیم من نیست").waitFor();
  await capture(7, "ارجاع دستی ← رد با دلیل ← ارجاع به فرد دیگر ← پذیرش؛ زنجیره در سابقه", pages.delegate, {
    chain: chain.map((row) => `${row.by}→${row.to}:${row.response}`),
  });

  // ------------------------------------------------------------ 8. first-contact resolution
  const contactOk = await createTicket(col, `تماس حل‌شده ${stamp}`, { ticket_assignees: [people.employee.id] });
  const contactNo = await createTicket(col, `تماس حل‌نشده ${stamp}`, { ticket_assignees: [people.employee.id] });
  for (const [ticketRow, resolved] of [
    [contactOk, true],
    [contactNo, false],
  ]) {
    if (resolved) {
      await pages.employee.goto(`${base}/entities/ticket/${ticketRow.id}`);
      await pages.employee.getByRole("button", { name: "حل در تماس" }).click();
    } else {
      // ۶.۶: the same short path from the row menu of «همه کارها».
      await pages.employee.goto(`${base}/issues`);
      await pages.employee.getByPlaceholder("جستجو در کارها...").fill(`تماس حل‌نشده ${stamp}`);
      const row = pages.employee.locator("tr", { hasText: `تماس حل‌نشده ${stamp}` }).first();
      await row.getByRole("button", { name: "عملیات کار" }).click();
      await pages.employee.getByRole("menuitem", { name: "حل در تماس" }).click();
    }
    dialog = pages.employee.locator("form.ticket-dialog");
    await dialog.getByRole("radio", { name: "تلفن" }).click();
    await dialog.getByLabel("مخاطب").fill("خانم مشتری");
    await dialog.getByLabel("خلاصهٔ گفتگو").fill(resolved ? "راه‌حل تلفنی داده شد" : "نیاز به بازدید حضوری");
    await dialog.getByRole("radio", { name: resolved ? /حل شد/ : /حل نشد/ }).click();
    await Promise.all([waitFor(pages.employee, "/contact/"), dialog.getByRole("button", { name: "ثبت تماس" }).click()]);
    const after = await core(emp, ticketRow.id).catch(() => null);
    if (resolved) assert.equal(after.deadline.category, "done", "resolved contact closes the ticket");
    await pages.employee.goto(`${base}/entities/ticket/${ticketRow.id}`);
    await pages.employee.getByRole("tab", { name: "تماس" }).click();
    await pages.employee.getByText(resolved ? "دلیل: راه‌حل تلفنی داده شد" : "دلیل: نیاز به بازدید حضوری").waitFor();
    await capture(8, resolved ? "حل شد ← تیکت بسته شد با دادهٔ تماس در سابقه" : "حل نشد ← مسیر عادی", pages.employee, {}, resolved ? "a" : "b");
  }

  // ------------------------------------------------------------ 9. a user without access sees nothing
  const outsider = contexts.outsider;
  const spec = { version: 1, type: "table", columns: [{ field: "title", width: 180 }], sort: [] };
  const listed = ok(await request(outsider, "engine/entities/ticket/query/", "POST", { definition: spec }));
  assert.ok(!JSON.stringify(listed.results).includes(stamp), "outsider list must not contain test tickets");
  const searched = ok(await request(outsider, "engine/entities/ticket/query/", "POST", { definition: spec, search: stamp }));
  assert.equal(searched.results.length, 0);
  const kanban = ok(
    await request(outsider, "engine/entities/ticket/query/", "POST", { definition: { ...spec, type: "kanban" } })
  );
  assert.ok(!JSON.stringify(kanban).includes(stamp));
  const exportJob = await request(outsider, "engine/entities/ticket/exports/", "POST", { format: "csv", definition: spec });
  assert.ok([202, 403].includes(exportJob.status), `export: ${exportJob.status}`);
  assert.equal((await request(outsider, `tickets/${parent.id}/core/`)).status, 404);
  await pages.outsider.goto(`${base}/entities/ticket`);
  await pages.outsider.getByRole("tab", { name: /همه/ }).waitFor();
  assert.equal(await pages.outsider.getByText(stamp).count(), 0);
  await capture(9, "کاربر بدون دسترسی: تیکت در فهرست، جست‌وجو، جدول و کانبان نیست", pages.outsider, {}, "a");
  await pages.outsider.goto(`${base}/entities/ticket/${parent.id}`);
  await pages.outsider
    .getByRole("heading", { name: "این رکورد پیدا نشد یا اجازهٔ دیدن آن را ندارید" })
    .first()
    .waitFor({ timeout: 60000 });
  await capture(9, "آدرس مستقیم پیام دسترسی می‌دهد", pages.outsider, {}, "b");

  // ------------------------------------------------------------ 10. close / reopen
  const numberBefore = (await record(emp, child.id)).number;
  await setStatus(emp, child.id, "done");
  assert.equal((await core(emp, child.id)).deadline.category, "done");
  await setStatus(emp, child.id, "todo");
  await setStatus(emp, child.id, "in_progress");
  const reopened = await core(emp, child.id);
  assert.equal(reopened.deadline.category, "in_progress");
  assert.equal((await record(emp, child.id)).number, numberBefore, "number must not change");
  const history = ok(await request(emp, `tickets/${child.id}/history/?kind=lifecycle`));
  assert.ok(history.some((row) => row.type === "ticket.closed") && history.some((row) => row.type === "ticket.reopened"));
  const all = ok(await request(emp, `tickets/${child.id}/history/`));
  await pages.employee.goto(`${base}/entities/ticket/${child.id}`);
  await pages.employee.getByRole("tab", { name: "بستن/بازگشایی" }).click();
  await pages.employee.getByText("بازگشایی تیکت").first().waitFor();
  await capture(10, "بستن و بازگشایی؛ سابقه کامل؛ شماره ثابت؛ دسته درست", pages.employee, {
    number: numberBefore,
    events: all.length,
  });

  // ------------------------------------------------------------ 11. dark mode and mobile width
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    colorScheme: "dark",
  });
  const mobilePage = await mobile.newPage();
  await login(mobilePage, people.employee.email, password);
  await mobilePage.goto(`${base}/entities/ticket/${late.id}`);
  await mobilePage.locator(".ticket-core").waitFor();
  await mobilePage.locator(".ticket-history .ticket-timeline").waitFor();
  await mobilePage.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await mobilePage.waitForTimeout(400);
  assert.equal(await mobilePage.evaluate(() => document.documentElement.dataset.theme), "dark");
  const overflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 2, `no horizontal scroll on mobile (overflow ${overflow}px)`);
  await capture(11, "صفحهٔ تیکت در حالت تیره و عرض موبایل", mobilePage, { overflow }, "a");
  await mobilePage.getByRole("button", { name: "حل در تماس" }).click();
  await mobilePage.locator("form.ticket-dialog").waitFor();
  await mobilePage.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await capture(11, "پنجرهٔ حل در تماس در حالت تیره و موبایل", mobilePage, {}, "b");
  await mobile.close();
  assert.deepEqual(errors, [], `page errors: ${errors.join(" | ")}`);
} catch (error) {
  checks.push({ step: "error", name: String(error?.message || error).slice(0, 2000), passed: false });
  await writeFile(resolve(output, "report.json"), JSON.stringify({ started_at: stamp, base, checks, errors }, null, 2));
  for (const [name, page] of Object.entries(pages))
    await page.screenshot({ path: resolve(output, `failure-${name}.png`), fullPage: true }).catch(() => undefined);
  throw error;
} finally {
  const adminCtx = contexts.admin;
  for (const id of cleanup.rules)
    await request(adminCtx, `organization/routing-rules/${id}/`, "PATCH", { is_active: false }).catch(() => undefined);
  if (cleanup.order?.length)
    await request(adminCtx, "organization/routing-rules/order/", "POST", {
      ids: [...cleanup.order, ...cleanup.rules],
    }).catch(() => undefined);
  for (const id of cleanup.absences)
    try {
      shell(`from plane.db.models import UserAbsence\nUserAbsence.objects.filter(id="${id}").update(status="cancelled")\nprint("OUT:ok")`);
    } catch {
      /* best effort */
    }
  for (const id of cleanup.exceptions)
    await request(contexts.boss, `work-calendar/exceptions/${id}/cancel/`, "POST", { reason: "پایان آزمون تیکت ۵" }).catch(
      () => undefined
    );
  for (const id of cleanup.workflows)
    await request(adminCtx, `workflows/definitions/${id}/`, "PATCH", { is_active: true }).catch(() => undefined);
  await browser.close();
}
