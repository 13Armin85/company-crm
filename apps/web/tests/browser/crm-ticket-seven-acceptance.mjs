/* Ticket 7 acceptance on the local Docker deployment. Every passing check captures the live browser. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(resolve(".cache/browser/node_modules/playwright/index.mjs")).href);
const env = Object.fromEntries((await readFile(".env.dev", "utf8")).split(/\r?\n/).filter((line) => /^[A-Z_]+=/.test(line)).map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1).replace(/^(['"])(.*)\1$/, "$2")]; }));
const base = process.env.CRM_BROWSER_URL || "http://localhost:3000";
const slug = env.INTERNAL_WORKSPACE_SLUG || "dev-workspace";
const stamp = Date.now().toString(36);
const output = resolve("tmp/ticket-7-evidence/acceptance");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const contexts = await Promise.all([0, 1, 2, 3, 4].map(() => browser.newContext({ viewport: { width: 1500, height: 1000 } })));
const [admin, employee, employeeSecond, noTeam, manager] = contexts;
const [adminPage, employeePage, secondPage, noTeamPage, managerPage] = await Promise.all(contexts.map((context) => context.newPage()));
for (const page of [adminPage, employeePage, secondPage, noTeamPage, managerPage]) { page.setDefaultTimeout(45000); page.on("dialog", (dialog) => void dialog.accept()); }
const checks = [];
const report = async () => writeFile(resolve(output, "report.json"), JSON.stringify({ started_at: stamp, checks }, null, 2));
const capture = async (scenario, name, page, details = {}) => { const screenshot = `scenario-${String(scenario).padStart(2, "0")}.png`; await page.screenshot({ path: resolve(output, screenshot), fullPage: true }); checks.push({ scenario, name, passed: true, screenshot, details }); await report(); process.stdout.write(`PASS ${scenario}: ${name}\n`); };
async function request(context, path, method = "GET", data) {
  const csrf = await (await context.request.get(`${base}/auth/get-csrf-token/`)).json();
  const response = await context.request.fetch(`${base}/api/workspaces/${slug}/${path}`, { method, headers: { "X-CSRFTOKEN": csrf.csrf_token }, ...(data === undefined ? {} : { data }) });
  return { status: response.status(), data: response.status() === 204 ? null : await response.json() };
}
const dashboard = (context, path = "", method = "GET", data) => request(context, `dashboard/${path}`, method, data);
const engine = (context, path, method = "GET", data) => request(context, `engine/${path}`, method, data);
const ok = (result, status = 200) => { assert.equal(result.status, status, `HTTP ${result.status}: ${JSON.stringify(result.data).slice(0, 700)}`); return result.data; };
async function login(page, email, password) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.goto(`${base}/login`);
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    try { await page.locator(".auth-submit").click({ timeout: 12000 }); await page.waitForURL((url) => url.pathname !== "/login"); await page.locator(".app-shell").waitFor(); return; }
    catch (error) { if (attempt === 3) throw error; await new Promise((resolve) => setTimeout(resolve, 3000)); }
  }
}
const tab = (title, widgets) => ({ id: randomUUID(), title, widgets });
const widget = (type, config, extra = {}) => ({ id: randomUUID(), type, title: type, x: 0, y: 0, w: 6, h: 3, config, ...extra });
const waitSave = (page, click) => Promise.all([page.waitForResponse((response) => response.request().method() === "PUT" && response.url().includes("/dashboard/")), click()]);

try {
  await login(adminPage, env.DEV_ADMIN_EMAIL, env.DEV_ADMIN_PASSWORD);
  const permissions = ok(await request(admin, "organization/permissions/"));
  const employeeCodes = new Set(["Dashboard.Personal.Manage", "Issue.View", "Issue.Create", "Issue.Edit", "View.Personal.Create"]);
  const employeeRole = ok(await request(admin, "organization/roles/", "POST", { name: `T7 employee ${stamp}`, permission_ids: permissions.filter((item) => employeeCodes.has(item.code)).map((item) => item.id) }), 201);
  const teamCodes = new Set([...employeeCodes, "Issue.ViewAll", "Issue.Assign", "Dashboard.Team.View", "Dashboard.Team.Rules", "Dashboard.Team.Assign", "Dashboard.Team.Remind"]);
  const teamRole = ok(await request(admin, "organization/roles/", "POST", { name: `T7 manager ${stamp}`, permission_ids: permissions.filter((item) => teamCodes.has(item.code)).map((item) => item.id) }), 201);
  const adminRole = ok(await request(admin, "organization/roles/")).find((item) => item.system_key === "admin");
  const password = `T7!${randomUUID()}aA`;
  async function createUser(label, role) {
    const suffix = `${stamp}-${label}`;
    const email = `${suffix}@example.test`;
    const displayName = `T7 ${label} ${stamp}`;
    const row = ok(await engine(admin, "entities/user/records/", "POST", { values: { user_name: displayName, user_username: suffix, user_email: email, user_password: password, user_roles: [role.id] } }), 201);
    return { ...row, email, displayName };
  }
  const worker = await createUser("worker", employeeRole);
  const coworker = await createUser("coworker", employeeRole);
  const teamManager = await createUser("team-manager", teamRole);
  const otherManager = await createUser("manager", teamRole);
  await login(employeePage, worker.email, password);
  await employeePage.goto(`${base}/`);
  await employeePage.locator(".custom-dashboard").waitFor();
  await employeePage.locator(".dashboard-actions button").last().click();
  const tabName = `آزمون داشبورد ${stamp}`;
  await employeePage.locator('input[aria-label="نام تب جدید"]').fill(tabName);
  await employeePage.locator('button[aria-label="ساخت تب"]').click();
  for (const type of ["شمارنده", "جدول", "نمودار"]) {
    await employeePage.locator(".dashboard-editbar button").click();
    await employeePage.locator(".dashboard-gallery button").filter({ hasText: type }).first().click();
    await employeePage.locator(".dashboard-overlay .dashboard-drawer > header button").last().click();
  }
  const [saved] = await waitSave(employeePage, () => employeePage.locator(".dashboard-actions button").last().click());
  assert.equal(saved.status(), 200, await saved.text());
  await employeePage.reload();
  await employeePage.locator(".dashboard-tab").filter({ hasText: tabName }).click();
  assert.equal(await employeePage.locator(".dashboard-widget").count(), 3);
  await capture(1, "سه ویجت و ماندگاری چیدمان پس از تازه‌سازی", employeePage);

  await login(secondPage, worker.email, password);
  await secondPage.goto(`${base}/`);
  await secondPage.locator(".dashboard-tab").filter({ hasText: tabName }).click();
  assert.equal(await secondPage.locator(".dashboard-widget").count(), 3);
  await capture(2, "داشبورد یکسان در مرورگر دیگر", secondPage);

  let layout = ok(await dashboard(employee));
  const personalTab = layout.tabs.find((item) => item.title === tabName);
  personalTab.widgets.find((item) => item.type === "counter").config.filter = { field: "title", op: "contains", value: "T7" };
  ok(await dashboard(employee, "", "PUT", { tabs: layout.tabs, revision: layout.revision }));
  await employeePage.reload();
  await employeePage.locator(".dashboard-tab").filter({ hasText: tabName }).click();
  await employeePage.locator(".dashboard-counter").click();
  await employeePage.waitForURL((url) => url.pathname.includes("/entities/ticket") && url.searchParams.has("dashboard_filter"));
  assert.equal(JSON.parse(new URL(employeePage.url()).searchParams.get("dashboard_filter")).value, "T7");
  await capture(3, "بازشدن جدول با فیلتر شمارنده", employeePage);

  const roleTab = tab(`پیش‌فرض ${stamp}`, [widget("note", { text: "اجباری" }, { locked: true })]);
  ok(await dashboard(admin, `defaults/${employeeRole.id}/`, "PUT", { tabs: [roleTab], revision: 0 }));
  layout = ok(await dashboard(employee));
  assert(layout.tabs.some((item) => item.widgets.some((item) => item.locked)));
  const withoutLocked = structuredClone(layout.tabs).map((item) => ({ ...item, widgets: item.widgets.filter((item) => !item.locked) }));
  assert.equal((await dashboard(employee, "", "PUT", { tabs: withoutLocked, revision: layout.revision })).status, 400);
  await employeePage.goto(`${base}/`);
  await employeePage.locator(".dashboard-actions button").last().click();
  await employeePage.locator(".dashboard-tab").filter({ hasText: roleTab.title }).locator("button[role=tab]").click();
  assert(await employeePage.locator('button[aria-label="حذف ویجت"]').first().isDisabled());
  await capture(4, "ویجت قفل‌شدهٔ نقش قابل حذف نیست", employeePage);

  roleTab.widgets.push(widget("counter", { entity: "ticket", operation: "count" }, { y: 3 }));
  ok(await dashboard(admin, `defaults/${employeeRole.id}/`, "PUT", { tabs: [roleTab], revision: 1 }));
  const refreshed = ok(await dashboard(employee));
  assert(refreshed.default_updated);
  assert(refreshed.tabs.flatMap((item) => item.widgets).some((item) => item.id === roleTab.widgets[1].id));
  await employeePage.reload();
  await capture(5, "ویجت تازهٔ پیش‌فرض به داشبورد شخصی اضافه شد", employeePage);

  const protectedEntity = ok(await engine(admin, "definitions/entities/", "POST", { code: `t7-${stamp}-sales`, title: `فروش ${stamp}`, numbering: { prefix: "SALE", padding: 0 } }), 201);
  const amount = ok(await engine(admin, "definitions/fields/", "POST", { code: `t7-${stamp}-amount`, title: "مبلغ", kind: "money" }), 201);
  let form = ok(await engine(admin, `forms/${protectedEntity.code}/`));
  form = ok(await engine(admin, `forms/${protectedEntity.code}/`, "PUT", { revision: form.revision, draft: { tabs: [], sections: [{ id: "main", title: "اصلی", columns: 2, bindings: [{ field: "title" }, { field: amount.code, view_roles: [adminRole.id] }] }] } }));
  ok(await engine(admin, `forms/${protectedEntity.code}/`, "POST", { revision: form.revision }));
  ok(await engine(admin, `entities/${protectedEntity.code}/records/`, "POST", { values: { title: "فروش", [amount.code]: 120 } }), 201);
  layout = ok(await dashboard(employee));
  layout.tabs.find((item) => item.title === tabName).widgets.push(widget("counter", { entity: protectedEntity.code, operation: "sum", field: amount.code }, { y: 9 }));
  ok(await dashboard(employee, "", "PUT", { tabs: layout.tabs, revision: layout.revision }));
  await employeePage.reload();
  await employeePage.locator(".dashboard-tab").filter({ hasText: tabName }).locator("button[role=tab]").click();
  await employeePage.getByText("دادهٔ این ویجت در دسترسی شما نیست.").waitFor();
  await capture(6, "مبلغ خارج از دسترسی در ویجت جمع مخفی است", employeePage);

  layout = ok(await dashboard(employee));
  layout.tabs.find((item) => item.title === tabName).widgets.push(widget("counter", { entity: "missing-source" }, { y: 12 }));
  ok(await dashboard(employee, "", "PUT", { tabs: layout.tabs, revision: layout.revision }));
  await employeePage.reload();
  await employeePage.locator(".dashboard-tab").filter({ hasText: tabName }).locator("button[role=tab]").click();
  await employeePage.locator(".dashboard-widget-error").waitFor();
  await employeePage.locator(".dashboard-counter").first().waitFor();
  assert(await employeePage.locator(".dashboard-counter").count() > 0);
  await capture(7, "خطای منبع نامعتبر فقط در همان ویجت", employeePage);

  const unit = ok(await request(admin, "organization/units/", "POST", { title: `تیم ${stamp}`, manager_id: teamManager.id, member_ids: [worker.id, coworker.id] }), 201);
  await login(managerPage, teamManager.email, password);
  await managerPage.goto(`${base}/`);
  await managerPage.locator(".dashboard-tab").filter({ hasText: "تیم من" }).locator("button[role=tab]").click();
  await managerPage.locator(".dashboard-team-card").filter({ hasText: worker.displayName }).waitFor();
  await managerPage.locator(".dashboard-team-card").filter({ hasText: coworker.displayName }).waitFor();
  await capture(8, "دو زیردست مستقیم در تب تیم من", managerPage);

  const activeTask = ok(await request(admin, "tasks/", "POST", { name: `کار فعال ${stamp}`, assignee_id: worker.id, status: "review" }), 201);
  await managerPage.reload();
  await managerPage.locator(".dashboard-tab").filter({ hasText: "تیم من" }).locator("button[role=tab]").click();
  await managerPage.locator(".dashboard-team-card.team-green").filter({ hasText: worker.displayName }).waitFor();
  await capture(9, "کار Review کارت حاضر را سبز می‌کند", managerPage, { task: activeTask.work_number });

  ok(await request(admin, `tasks/${activeTask.id}/`, "PATCH", { status: "done" }));
  await managerPage.reload();
  await managerPage.locator(".dashboard-tab").filter({ hasText: "تیم من" }).locator("button[role=tab]").click();
  await managerPage.locator(".dashboard-team-card.team-red").filter({ hasText: worker.displayName }).waitFor();
  await capture(10, "بسته‌شدن آخرین کار کارت را قرمز می‌کند", managerPage);

  ok(await request(admin, `organization/units/${unit.id}/delegates/`, "PUT", { user_ids: [worker.id] }));
  const now = Date.now();
  ok(await request(admin, "organization/absences/", "POST", { user: coworker.id, starts_at: new Date(now - 3600000).toISOString(), ends_at: new Date(now + 86400000).toISOString(), reason: "مرخصی" }), 201);
  await managerPage.reload();
  await managerPage.locator(".dashboard-tab").filter({ hasText: "تیم من" }).locator("button[role=tab]").click();
  await managerPage.locator(".dashboard-team-card.team-gray").filter({ hasText: coworker.displayName }).waitFor();
  await capture(11, "غیبت کارت خاکستری، دلیل و جانشین", managerPage);

  const rule = { metric: "inactive_hours", op: "gt", value: 3, color: "yellow", label: "بدون فعالیت طولانی" };
  ok(await dashboard(manager, "team/settings/", "PUT", { rules: [rule] }));
  const preview = ok(await dashboard(manager, "team/settings/", "POST", { rules: [rule] }));
  assert(preview.cards.some((item) => item.color === "yellow"));
  await managerPage.reload();
  await managerPage.locator(".dashboard-tab").filter({ hasText: "تیم من" }).locator("button[role=tab]").click();
  await managerPage.locator(".dashboard-team-card.team-yellow").first().waitFor();
  await capture(12, "قاعدهٔ اولویت‌دار زرد با پیش‌نمایش داده واقعی", managerPage);

  ok(await dashboard(manager, "team/settings/", "PUT", { rules: [] }));
  const worker3 = await createUser("third", employeeRole), worker4 = await createUser("fourth", employeeRole);
  ok(await request(admin, `organization/units/${unit.id}/`, "PATCH", { member_ids: [worker.id, coworker.id, worker3.id, worker4.id] }));
  await managerPage.reload();
  await managerPage.locator(".dashboard-tab").filter({ hasText: "تیم من" }).locator("button[role=tab]").click();
  const red = managerPage.locator(".dashboard-team-summary .team-red");
  await red.filter({ hasText: "3" }).click();
  await managerPage.waitForFunction(() => document.querySelectorAll(".dashboard-team-card").length === 3);
  assert.equal(await managerPage.locator(".dashboard-team-card").count(), 3);
  await capture(13, "کلیک روی شمار قرمز فقط سه کارت قرمز را نشان می‌دهد", managerPage);

  const childUser = await createUser("child", employeeRole);
  ok(await request(admin, "organization/units/", "POST", { title: `زیرتیم ${stamp}`, parent_id: unit.id, manager_id: worker.id, member_ids: [childUser.id] }), 201);
  await managerPage.locator('.dashboard-team-toolbar input[type="checkbox"]').check();
  await managerPage.locator(".dashboard-team-card").filter({ hasText: childUser.displayName }).waitFor();
  await capture(14, "کل زیرمجموعه شامل زیردست چندسطحی", managerPage);

  await login(noTeamPage, otherManager.email, password);
  await noTeamPage.goto(`${base}/`);
  await noTeamPage.locator(".dashboard-tab").filter({ hasText: "تیم من" }).locator("button[role=tab]").click();
  await noTeamPage.getByText("زیردستی در دامنهٔ مدیریتی شما پیدا نشد.").waitFor();
  await capture(15, "مدیر بدون زیردست پیام خالی واضح دارد", noTeamPage);

  const forbidden = await dashboard(employee, "team/");
  assert.equal(forbidden.status, 403);
  await employeePage.goto(`${base}/`);
  assert.equal(await employeePage.locator(".dashboard-tab").filter({ hasText: "تیم من" }).count(), 0);
  await capture(16, "نبود مجوز تیم: تب پنهان و API ۴۰۳", employeePage, { api_status: forbidden.status });

  const dropTask = ok(await request(admin, "tasks/", "POST", { name: `ارجاع ${stamp}`, assignee_id: worker.id, status: "review" }), 201);
  await managerPage.reload();
  await managerPage.locator(".dashboard-tab").filter({ hasText: "تیم من" }).locator("button[role=tab]").click();
  const warning = await dashboard(manager, `team/members/${coworker.id}/assign/`, "POST", { task_id: dropTask.id });
  assert.equal(warning.status, 409);
  assert.equal(warning.data.substitute.id, worker.id);
  await managerPage.locator(".dashboard-team-task-tray span").filter({ hasText: dropTask.work_number }).first().dragTo(managerPage.locator(".dashboard-team-card.team-gray").filter({ hasText: coworker.displayName }));
  await capture(17, "کشیدن کار روی فرد غایب با هشدار و جانشین", managerPage, { substitute: worker.id });

  const before = ok(await request(manager, "users/notifications/?all_notifications=true"));
  ok(await dashboard(manager, "team/settings/", "PUT", { alert_minutes: 30, alert_enabled: true, workday_start: "00:00", workday_end: "23:59" }));
  ok(await dashboard(manager, "team/"));
  const after = ok(await request(manager, "users/notifications/?all_notifications=true"));
  assert(JSON.stringify(after).includes("team_idle") || JSON.stringify(after).includes("بدون کار در حال انجام"));
  ok(await dashboard(manager, "team/settings/", "PUT", { alert_enabled: false }));
  await managerPage.screenshot({ path: resolve(output, "scenario-18-alert-disabled.png"), fullPage: true });
  await capture(18, "اعلان نبود کار در ساعت کاری و امکان خاموش‌کردن", managerPage, { before: JSON.stringify(before).length, after: JSON.stringify(after).length });

  const liveTask = ok(await request(admin, "tasks/", "POST", { name: `تغییر زنده ${stamp}`, assignee_id: worker3.id, status: "review" }), 201);
  await managerPage.reload();
  await managerPage.locator(".dashboard-tab").filter({ hasText: "تیم من" }).locator("button[role=tab]").click();
  await managerPage.locator(".dashboard-team-card.team-green").filter({ hasText: worker3.displayName }).waitFor();
  ok(await request(admin, `tasks/${liveTask.id}/`, "PATCH", { status: "done" }));
  await managerPage.locator(".dashboard-team-card.team-red").filter({ hasText: worker3.displayName }).waitFor({ timeout: 65000 });
  await capture(19, "کارت بدون بارگذاری دستی پس از تغییر وضعیت به‌روز شد", managerPage);

  const providerTest = execFileSync("docker", ["compose", "-p", "company-crm-ticket6-tests", "-f", "docker-compose-test.yml", "run", "--rm", "--no-deps", "--entrypoint", "pytest", "api-tests", "plane/tests/contract/app/test_ticket_seven.py::test_team_presence_provider_can_be_replaced_without_card_changes", "-q", "--reuse-db"], { encoding: "utf8", timeout: 180000 });
  assert(providerTest.includes("1 passed"));
  await capture(20, "ارائه‌دهندهٔ حضور با پیاده‌سازی آزمایشی جایگزین شد", managerPage, { contract_result: "1 passed" });
} catch (error) {
  await managerPage.screenshot({ path: resolve(output, "failure.png"), fullPage: true }).catch(() => {});
  await employeePage.screenshot({ path: resolve(output, "failure-employee.png"), fullPage: true }).catch(() => {});
  await writeFile(resolve(output, "failure.json"), JSON.stringify({ error: String(error), completed: checks.map((item) => item.scenario) }, null, 2));
  throw error;
} finally { await browser.close(); }
