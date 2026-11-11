/* Ticket 4 (workflow engine) acceptance on the local Docker deployment.
 *
 * 1. The admin builds a workflow in the designer by clicking: adds an approval step, «بررسی
 *    مشکلات» shows the errors, the buttons are wired in the UI, then «امتحان مسیر» and «انتشار».
 * 2. An employee registers a ticket; the direct manager sends it back with a reason (visible in
 *    history); the employee fixes and resubmits; the manager approves. Another ticket is rejected
 *    with a reason.
 * 3. A "waiting for customer" pause shows in the history.
 * 4. The employee requests an extension; the direct manager approves it; the old deadline stays.
 * 5. A simple ticket is closed by recording a contact; another one moves to the standard path.
 * 6. Publishing a new version does not change an active record's path; the admin then moves it to
 *    the new version from the record panel after a preview.
 *
 * The live server cannot time-travel: deadlines are a few working minutes. Step 1 is built by
 * clicking in the designer; the richer graphs of the later steps are prepared through the same API
 * the designer page uses. Definitions created here are
 * deactivated at the end so the dev workspace's new tickets are not affected.
 * Run from the repository root: node apps/web/tests/browser/crm-workflow-acceptance.mjs
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
const output = resolve("tmp/workflow-evidence");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const contexts = await Promise.all(
  [0, 1, 2].map(() => browser.newContext({ viewport: { width: 1440, height: 1100 } }))
);
const [admin, , worker] = contexts;
const [adminPage, managerPage, workerPage] = await Promise.all(contexts.map((context) => context.newPage()));
const errors = [];
for (const page of [adminPage, managerPage, workerPage]) {
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
  assert.equal(result.status, status, `HTTP ${result.status}: ${JSON.stringify(result.data).slice(0, 900)}`);
  return result.data;
};
async function login(page, email, password) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      // Vite dev may reload the first page load; every step of the login is retried.
      await page.goto(`${base}/login`);
      await page.locator('input[name="email"]').fill(email, { timeout: 12000 });
      await page.locator('input[name="password"]').fill(password, { timeout: 12000 });
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
const settle = async (page) => {
  // Vite dev can finish compiling after the first paint; wait until the panel is interactive.
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByRole("region", { name: "گردش‌کار" }).waitFor();
};
const panelOf = (page) => page.getByRole("region", { name: "گردش‌کار" });
const timelineOf = (page) => page.getByRole("list", { name: "سابقهٔ گردش‌کار" });

const touched = [];
async function definitionFor(kind, title, graph, settings = {}) {
  // Re-use the definition of a previous run: a new draft replaces its graph.
  const existing = ok(await request(admin, "workflows/definitions/?entity=ticket")).results.find(
    (row) => row.kind === kind
  );
  let definition = existing;
  if (!definition)
    definition = ok(
      await request(admin, "workflows/definitions/", "POST", { entity: "ticket", kind, title, settings }),
      201
    );
  else
    ok(
      await request(admin, `workflows/definitions/${definition.id}/`, "PATCH", {
        is_active: true,
        title,
        // Clear settings a person may have set on dev (e.g. «فرد رکورد») so the scenario is predictable.
        settings: { subject_field: null, instance_target_minutes: null, ...settings },
      })
    );
  touched.push(definition.id);
  definition = ok(await request(admin, `workflows/definitions/${definition.id}/`));
  let draft = definition.versions.find((row) => row.status === "draft");
  if (!draft) draft = ok(await request(admin, `workflows/definitions/${definition.id}/versions/`, "POST", {}), 201);
  if (graph) ok(await request(admin, `workflows/versions/${draft.id}/`, "PUT", { graph }));
  return { definition, draft };
}
const publishDraft = async (draft) => ok(await request(admin, `workflows/versions/${draft.id}/publish/`, "POST", {}));
const deactivate = async (kind) => {
  const row = ok(await request(admin, "workflows/definitions/?entity=ticket")).results.find(
    (item) => item.kind === kind
  );
  if (row) ok(await request(admin, `workflows/definitions/${row.id}/`, "PATCH", { is_active: false }));
};

const step = (code, title, type, status, assignee = { type: "subject" }, extra = {}) => ({
  code,
  title,
  type,
  status_code: status,
  assignee,
  ...extra,
});
const move = (code, from, to, kind, label, extra = {}) => ({ code, from, to, kind, label, ...extra });
const standardGraph = (reviewTitle = "تأیید مدیر مستقیم") => ({
  steps: [
    step("request", "ثبت", "start", "todo"),
    step(
      "work",
      "انجام کار",
      "normal",
      "in_progress",
      { type: "subject" },
      { target_minutes: 30, pause: { customer: true } }
    ),
    step("review", reviewTitle, "approval", "review", { type: "direct_manager" }),
    step("done", "انجام شد", "end", "done", { type: "none" }),
    step("rejected", "رد شد", "end", "blocked", { type: "none" }),
  ],
  transitions: [
    move("start_work", "request", "work", "advance", "شروع کار"),
    move("send", "work", "review", "advance", "ارسال برای تأیید"),
    move("approve", "review", "done", "approve", "تأیید"),
    move("send_back", "review", "work", "return", "بازگشت برای اصلاح"),
    move("reject", "review", "rejected", "reject", "رد"),
  ],
});

try {
  await login(adminPage, env.DEV_ADMIN_EMAIL, env.DEV_ADMIN_PASSWORD);
  const permissions = ok(await request(admin, "organization/permissions/"));
  const ids = (codes) => permissions.filter((item) => codes.has(item.code)).map((item) => item.id);
  const codes = new Set([
    "Issue.View",
    "Issue.Create",
    "Issue.Status.Edit",
    "Issue.Assign",
    "Workflow.View",
    "Dashboard.Personal.Manage",
  ]);
  const role = ok(
    await request(admin, "organization/roles/", "POST", { name: `WF member ${stamp}`, permission_ids: ids(codes) }),
    201
  );
  const password = `Wf!${randomUUID()}aA`;
  async function createUser(label) {
    const suffix = `${stamp}-wf-${label}`;
    const email = `${suffix}@example.test`;
    const displayName = `WF ${label} ${stamp}`;
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
  const employee = await createUser("employee");
  const colleague = await createUser("colleague");
  const boss = await createUser("manager");
  ok(
    await request(admin, "organization/units/", "POST", {
      title: `واحد گردش‌کار ${stamp}`,
      manager_id: boss.id,
      member_ids: [employee.id, colleague.id],
    }),
    201
  );
  await deactivate("fast_path");

  // 1. Designer: the admin adds an approval step and wires its buttons by clicking.
  const prepared = await definitionFor("standard", "گردش‌کار ساده", {
    steps: [step("start", "ثبت", "start", "todo"), step("end", "پایان", "end", "done", { type: "none" })],
    transitions: [move("submit", "start", "end", "advance", "ارسال")],
  });
  await adminPage.goto(`${base}/settings/engine`);
  await adminPage
    .getByRole("navigation", { name: "انتخاب بخش" })
    .getByRole("button", { name: /کارها/ })
    .first()
    .click();
  await adminPage
    .getByRole("button", { name: /گردش‌کار/ })
    .first()
    .click();
  const designer = adminPage.locator(".workflow-designer");
  await designer.waitFor();
  const choose = async (scope, label, option) => {
    await scope.getByRole("combobox", { name: label }).first().click();
    await adminPage.getByRole("option", { name: option, exact: true }).click();
  };
  await designer.getByRole("button", { name: "یک تأیید", exact: true }).click();
  await designer.locator("details.workflow-test summary").filter({ hasText: "امتحان و بررسی" }).click();
  const [checked] = await Promise.all([
    waitFor(adminPage, "/validate/"),
    designer.getByRole("button", { name: "بررسی مشکلات", exact: true }).click(),
  ]);
  assert.equal(checked.status(), 200);
  await designer.locator(".workflow-card.is-approval .workflow-card-problem").waitFor();
  await capture(1, "مرحلهٔ تأیید با کلیک اضافه شد و «بررسی مشکلات» خطای فارسی را کنار همان مرحله نشان داد", adminPage);
  // Wire the buttons in the UI: approval → end, and start → approval.
  const approvalButtons = designer.getByRole("region", { name: "دکمه‌های تأیید" });
  await approvalButtons.getByRole("button", { name: "افزودن دکمه" }).click();
  await choose(approvalButtons, "کار به کدام مرحله برود؟", "پایان");
  await designer.locator(".workflow-card.is-start .workflow-card-toggle").click();
  await choose(designer.getByRole("region", { name: "دکمه‌های ثبت" }), "کار به کدام مرحله برود؟", "تأیید");
  await Promise.all([
    waitFor(adminPage, "/validate/"),
    designer.getByRole("button", { name: "بررسی مشکلات", exact: true }).click(),
  ]);
  await designer.getByText("همه‌چیز درست است؛ مشکلی پیدا نشد.").waitFor();
  await Promise.all([
    waitFor(adminPage, "/simulate/"),
    designer.getByRole("button", { name: "امتحان مسیر", exact: true }).click(),
  ]);
  await designer.getByRole("table", { name: "نتیجهٔ آزمایش" }).waitFor();
  await capture(2, "دکمه‌ها در رابط وصل شدند؛ «بررسی» بدون خطا و «امتحان» مسیر و مسئول هر مرحله را نشان داد", adminPage);
  const [published] = await Promise.all([
    waitFor(adminPage, "/publish/"),
    designer.getByRole("button", { name: "انتشار برای همه", exact: true }).click(),
  ]);
  assert.equal(published.status(), 200, await published.text());
  await designer.getByText(/این نسخه منتشر شده و فقط قابل مشاهده است/).waitFor();
  const built = ok(await request(admin, `workflows/definitions/${prepared.definition.id}/`)).versions.find(
    (row) => row.status === "published"
  ).graph;
  const approvalStep = built.steps.find((row) => row.type === "approval");
  assert.equal(approvalStep?.assignee.type, "direct_manager");
  assert.ok(built.transitions.some((row) => row.from === "start" && row.to === approvalStep.code));
  assert.ok(built.transitions.some((row) => row.from === approvalStep.code && row.to === "end"));
  await capture(3, "نسخهٔ ساخته‌شده در رابط منتشر شد و فقط‌خواندنی است", adminPage, {
    definition: prepared.definition.id,
  });

  // Richer standard path (prepared through the designer API) for the employee scenarios.
  const standard = await definitionFor("standard", "گردش‌کار تأیید کار", standardGraph());
  await publishDraft(standard.draft);

  // 2–4. Employee registers a ticket; return with reason; pause; extension; resubmit; approve.
  await login(workerPage, employee.email, password);
  const ticket = ok(
    await request(worker, "engine/entities/ticket/records/", "POST", {
      values: { title: `درخواست تجهیزات ${stamp}`, ticket_assignees: [colleague.id] },
    }),
    201
  );
  const recordUrl = `${base}/entities/ticket/${ticket.id}`;
  await workerPage.goto(recordUrl);
  await settle(workerPage);
  const workerPanel = panelOf(workerPage);
  await workerPanel.waitFor();
  await Promise.all([
    waitFor(workerPage, "/transition/"),
    workerPanel.getByRole("button", { name: "شروع کار" }).click(),
  ]);
  await workerPanel.getByText("انجام کار").first().waitFor();

  // 3. Waiting for the customer.
  await workerPanel.getByRole("button", { name: "توقف", exact: true }).click();
  await workerPanel.getByLabel("دلیل (الزامی)").fill("منتظر پاسخ مشتری دربارهٔ مشخصات");
  await Promise.all([waitFor(workerPage, "/pause/"), workerPanel.getByRole("button", { name: "ثبت توقف" }).click()]);
  await timelineOf(workerPage).getByText("منتظر پاسخ مشتری دربارهٔ مشخصات").waitFor();
  await capture(4, "توقف «در انتظار پاسخ مشتری» در سابقه دیده می‌شود", workerPage);
  await workerPanel.getByRole("button", { name: "ازسرگیری" }).click();
  await workerPanel.getByLabel("دلیل (الزامی)").fill("مشتری پاسخ داد");
  await Promise.all([
    waitFor(workerPage, "/resume/"),
    workerPanel.getByRole("button", { name: "ازسرگیری" }).last().click(),
  ]);
  await timelineOf(workerPage).getByText("مشتری پاسخ داد").waitFor();

  // 4. Extension request by the assignee, approved by the direct manager.
  const before = ok(await request(worker, `workflows/records/ticket/${ticket.id}/`)).instance.run;
  await workerPanel.getByRole("button", { name: "درخواست تمدید" }).click();
  await workerPanel.getByLabel("دلیل تمدید").fill("نیاز به هماهنگی با تأمین‌کننده");
  await Promise.all([
    waitFor(workerPage, "/extension/"),
    workerPanel.getByRole("button", { name: "ارسال درخواست تمدید" }).click(),
  ]);
  await workerPanel.getByText(/در انتظار تأیید مدیر مستقیم است/).waitFor();
  await login(managerPage, boss.email, password);
  await managerPage.goto(`${base}/workflow-inbox`);
  await managerPage
    .getByRole("region", { name: "درخواست‌های تمدید برای تأیید" })
    .getByText(`درخواست تجهیزات ${stamp}`)
    .waitFor();
  await managerPage.goto(recordUrl);
  await settle(managerPage);
  const managerPanel = panelOf(managerPage);
  await Promise.all([
    waitFor(managerPage, "/decide/"),
    managerPanel.getByRole("button", { name: "تأیید تمدید" }).click(),
  ]);
  await timelineOf(managerPage).getByText("تأیید تمدید").first().waitFor();
  const after = ok(await request(worker, `workflows/records/ticket/${ticket.id}/`)).instance;
  assert.ok(Date.parse(after.run.target_at) > Date.parse(before.target_at));
  assert.ok(
    after.timeline.some(
      (row) => row.kind === "extension_approved" && row.data.previous_target_text === before.target_text
    )
  );
  await timelineOf(managerPage)
    .getByText(new RegExp(`مهلت قبلی: ${before.target_text}`))
    .first()
    .waitFor();
  await capture(5, "مدیر مستقیم تمدید را تأیید کرد و مهلت قبلی در سابقه ماند", managerPage);

  // 2. Send for approval; the manager sends it back with a reason; fix; resubmit; approve.
  await workerPage.reload();
  await Promise.all([
    waitFor(workerPage, "/transition/"),
    workerPanel.getByRole("button", { name: "ارسال برای تأیید" }).click(),
  ]);
  await managerPage.reload();
  await managerPanel.getByRole("button", { name: "بازگشت برای اصلاح" }).click();
  await managerPanel.getByLabel("دلیل (الزامی)").fill("مشخصات فنی کامل نیست");
  await Promise.all([
    waitFor(managerPage, "/transition/"),
    managerPanel.getByRole("button", { name: "بازگشت برای اصلاح" }).last().click(),
  ]);
  await timelineOf(managerPage).getByText("دلیل: مشخصات فنی کامل نیست").waitFor();
  await capture(6, "مدیر مستقیم کار را با دلیل برگرداند و دلیل در سابقه دیده می‌شود", managerPage);
  await workerPage.reload();
  await Promise.all([
    waitFor(workerPage, "/transition/"),
    workerPanel.getByRole("button", { name: "ارسال برای تأیید" }).click(),
  ]);
  await managerPage.reload();
  await Promise.all([
    waitFor(managerPage, "/transition/"),
    managerPanel.getByRole("button", { name: "تأیید", exact: true }).click(),
  ]);
  await managerPanel.getByText("پایان‌یافته").waitFor();
  await capture(7, "پس از اصلاح و ارسال دوباره، مدیر مستقیم تأیید کرد", managerPage);

  // 2b. Another request is rejected with a reason.
  const refused = ok(
    await request(worker, "engine/entities/ticket/records/", "POST", {
      values: { title: `خرید صندلی ${stamp}`, ticket_assignees: [colleague.id] },
    }),
    201
  );
  for (const transition of ["start_work", "send"]) {
    const current = ok(await request(worker, `workflows/records/ticket/${refused.id}/`)).instance;
    ok(
      await request(worker, `workflows/runs/${current.id}/transition/`, "POST", {
        transition,
        revision: current.revision,
        reason: "",
      })
    );
  }
  await managerPage.goto(`${base}/entities/ticket/${refused.id}`);
  await settle(managerPage);
  await managerPanel.getByRole("button", { name: "رد", exact: true }).click();
  await managerPanel.getByLabel("دلیل (الزامی)").fill("بودجهٔ این فصل تمام شده است");
  await Promise.all([
    waitFor(managerPage, "/transition/"),
    managerPanel.getByRole("button", { name: "رد", exact: true }).last().click(),
  ]);
  await timelineOf(managerPage).getByText("دلیل: بودجهٔ این فصل تمام شده است").waitFor();
  await managerPanel.getByText("پایان‌یافته").waitFor();
  await capture(8, "درخواست دیگر با دلیل رد شد و دلیل در سابقه دیده می‌شود", managerPage);

  // 5. Fast path: contact resolution, and conversion to the standard path.
  const fast = await definitionFor("fast_path", "مسیر کوتاه پشتیبانی", null);
  await publishDraft(fast.draft);
  const simple = ok(
    await request(worker, "engine/entities/ticket/records/", "POST", {
      values: { title: `فراموشی رمز ${stamp}`, ticket_assignees: [colleague.id] },
    }),
    201
  );
  await workerPage.goto(`${base}/entities/ticket/${simple.id}`);
  await settle(workerPage);
  await workerPanel.getByRole("button", { name: "ثبت تماس و حل" }).click();
  const contact = workerPage.getByRole("form", { name: "ثبت تماس و حل" });
  await contact.getByLabel("مخاطب").fill("آقای رضایی");
  await contact.getByRole("button", { name: "زمان تماس", exact: true }).click();
  await workerPage.locator(".persian-calendar-footer button").filter({ hasText: "امروز" }).click();
  await contact.getByLabel("خلاصهٔ گفتگو").fill("رمز عبور فراموش شده بود");
  await contact.getByLabel("نتیجه").fill("رمز بازنشانی شد");
  await Promise.all([
    waitFor(workerPage, "/contact-resolve/"),
    contact.getByRole("button", { name: "ثبت تماس و حل" }).click(),
  ]);
  await timelineOf(workerPage)
    .getByText(/تماس تلفن با آقای رضایی/)
    .waitFor();
  await workerPanel.getByText("پایان‌یافته").waitFor();
  // The record's own status (summary and form) follows the workflow without a reload.
  await workerPage.waitForFunction(() =>
    [...document.querySelectorAll(".engine-record-card input")].some((input) => input.value === "انجام‌شده")
  );
  await capture(9, "تیکت ساده با ثبت تماس در یک گام حل شد و تماس در سابقه آمد", workerPage);

  const hard = ok(
    await request(worker, "engine/entities/ticket/records/", "POST", {
      values: { title: `قطعی شبکه ${stamp}`, ticket_assignees: [colleague.id] },
    }),
    201
  );
  await workerPage.goto(`${base}/entities/ticket/${hard.id}`);
  await settle(workerPage);
  await workerPanel.getByRole("button", { name: "انتقال به مسیر عادی" }).click();
  await workerPanel.getByLabel("دلیل (الزامی)").fill("در تماس حل نشد");
  await Promise.all([
    waitFor(workerPage, "/to-standard/"),
    workerPanel.getByRole("button", { name: "انتقال", exact: true }).click(),
  ]);
  await timelineOf(workerPage).getByText("انتقال به مسیر عادی").waitFor();
  await workerPanel.getByText("گردش‌کار تأیید کار").waitFor();
  await capture(10, "تیکت دیگر به مسیر عادی منتقل شد و سابقه حفظ شد", workerPage);

  // 6. A new standard version does not change the active record's path.
  const active = ok(await request(worker, `workflows/records/ticket/${hard.id}/`)).instance;
  const next = await definitionFor("standard", "گردش‌کار تأیید کار", standardGraph("بررسی سرپرست"));
  await publishDraft(next.draft);
  await workerPage.reload();
  await workerPanel
    .getByText(new RegExp(`نسخهٔ ${active.version.number.toLocaleString("fa-IR")}`))
    .first()
    .waitFor();
  const still = ok(await request(worker, `workflows/records/ticket/${hard.id}/`)).instance;
  assert.equal(still.version.id, active.version.id);
  assert.ok(still.steps.some((row) => row.title === "تأیید مدیر مستقیم"));
  await capture(11, "انتشار نسخهٔ جدید مسیر رکورد فعال را عوض نکرد", workerPage, {
    active_version: active.version.number,
  });

  // 6b. The admin moves the active record to the new version from its panel, after a preview.
  await adminPage.goto(`${base}/entities/ticket/${hard.id}`);
  await settle(adminPage);
  const adminPanel = panelOf(adminPage);
  const newNumber = `نسخهٔ ${(active.version.number + 1).toLocaleString("fa-IR")}`;
  await adminPanel.getByRole("button", { name: `انتقال به ${newNumber}` }).click();
  await adminPanel.getByLabel("پیش‌نمایش انتقال").waitFor();
  await adminPanel.getByLabel("دلیل (الزامی)").fill("یکسان‌سازی با نسخهٔ جدید");
  await Promise.all([
    waitFor(adminPage, "/migrate/"),
    adminPanel.getByRole("button", { name: "انتقال به نسخهٔ جدید" }).click(),
  ]);
  await timelineOf(adminPage).getByText("دلیل: یکسان‌سازی با نسخهٔ جدید").waitFor();
  const moved = ok(await request(admin, `workflows/records/ticket/${hard.id}/`)).instance;
  assert.equal(moved.version.number, active.version.number + 1);
  await capture(12, "مدیر پس از پیش‌نمایش، رکورد فعال را از پنل به نسخهٔ جدید منتقل کرد", adminPage, {
    from: active.version.number,
    to: moved.version.number,
  });
  assert.deepEqual(errors, []);
} catch (error) {
  for (const [name, page] of [
    ["admin", adminPage],
    ["manager", managerPage],
    ["worker", workerPage],
  ])
    await page.screenshot({ path: resolve(output, `failure-${name}.png`), fullPage: true }).catch(() => {});
  await writeFile(
    resolve(output, "failure.json"),
    JSON.stringify(
      {
        error: String(error),
        completed: checks.map((row) => row.step),
        urls: { admin: adminPage.url(), manager: managerPage.url(), worker: workerPage.url() },
      },
      null,
      2
    )
  );
  throw error;
} finally {
  // Keep the dev workspace's new tickets free of these test workflows.
  await deactivate("fast_path").catch(() => {});
  await deactivate("standard").catch(() => {});
  await browser.close();
}
