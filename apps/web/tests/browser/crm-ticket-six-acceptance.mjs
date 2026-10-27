/* Real Docker acceptance evidence. Setup uses authenticated APIs; UI checks use real Chrome sessions. */
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
const { chromium } = await import(pathToFileURL(resolve(".cache/browser/node_modules/playwright/index.mjs")).href);
const compressionPackage = (await readdir("node_modules/.pnpm")).find((name) => name.startsWith("fflate@"));
const { zipSync, strToU8 } = await import(
  pathToFileURL(resolve(`node_modules/.pnpm/${compressionPackage}/node_modules/fflate/esm/index.mjs`)).href
);
const env = Object.fromEntries(
  (await readFile(".env.dev", "utf8"))
    .split(/\r?\n/)
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at), line.slice(at + 1).replace(/^(['"])(.*)\1$/, "$2")];
    })
);
const base = process.env.CRM_BROWSER_URL || "http://localhost:3000",
  slug = env.INTERNAL_WORKSPACE_SLUG || "dev-workspace",
  stamp = Date.now().toString(36);
const output = resolve("tmp/ticket-6-evidence/acceptance");
await mkdir(output, { recursive: true });
const tailOnly = process.env.T6_PART === "tail";
const previous = tailOnly ? JSON.parse(await readFile(resolve(output, "report.json"), "utf8")) : null;
const priorReportName = `report-before-${stamp}.json`;
if (previous) {
  assert.deepEqual(
    previous.checks.filter((item) => item.scenario <= 18).map((item) => item.scenario),
    Array.from({ length: 18 }, (_, index) => index + 1)
  );
  await writeFile(resolve(output, priorReportName), JSON.stringify(previous, null, 2));
}
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const admin = await browser.newContext({ viewport: { width: 1600, height: 1100 } }),
  normal = await browser.newContext({ viewport: { width: 1600, height: 1100 } }),
  second = await browser.newContext({ viewport: { width: 1600, height: 1100 } }),
  receiver = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
const adminPage = await admin.newPage(),
  page = await normal.newPage(),
  secondPage = await second.newPage(),
  receiverPage = await receiver.newPage();
const checks = previous
    ? previous.checks
        .filter((item) => item.scenario <= 18)
        .map((item) => ({
          ...item,
          run_id: item.run_id || previous.started_at,
          source_report: item.source_report || priorReportName,
        }))
    : [],
  errors = [],
  resources = [];
const startedAt = new Date().toISOString();
for (const target of [adminPage, page, secondPage, receiverPage]) {
  target.setDefaultTimeout(60000);
  target.setDefaultNavigationTimeout(120000);
  target.on("pageerror", (error) => errors.push(error.message));
  target.on("dialog", (dialog) => {
    if (dialog.type() === "beforeunload") void dialog.accept();
  });
}
async function request(context, path, method = "GET", data) {
  const csrf = await (await context.request.get(`${base}/auth/get-csrf-token/`, { maxRetries: 3 })).json();
  const response = await context.request.fetch(`${base}/api/workspaces/${slug}/${path}`, {
    method,
    headers: { "X-CSRFTOKEN": csrf.csrf_token },
    ...(data === undefined ? {} : { data }),
  });
  return { status: response.status(), data: response.status() === 204 ? null : await response.json() };
}
const engine = (context, path, method = "GET", data) => request(context, `engine/${path}`, method, data);
function ok(response, status = 200) {
  assert.equal(response.status, status, JSON.stringify(response.data));
  return response.data;
}
async function login(target, email, password) {
  await target.goto(`${base}/login`);
  await target.locator('input[name="email"]').fill(email);
  await target.locator('input[name="password"]').fill(password);
  await target.locator(".auth-submit").click();
  await target.waitForURL((url) => url.pathname !== "/login");
  await target.locator(".app-shell").waitFor();
}
async function capture(number, name, target = page, details = {}) {
  const screenshot = `scenario-${String(number).padStart(2, "0")}.png`;
  await target.screenshot({ path: resolve(output, screenshot), fullPage: true });
  checks.push({ scenario: number, name, status: "passed", screenshot, details, run_id: stamp });
  await writeFile(
    resolve(output, "report.json"),
    JSON.stringify(
      {
        scope: "Isolated sample ticket/customer entities using the real shared engine, plus the native user form.",
        checks,
        errors,
        resources,
      },
      null,
      2
    )
  );
  console.log(`PASS ${number}: ${name}`);
}
async function choose(target, label, title) {
  if (label === "موجودیت" || label === "فرم موجودیت") {
    const navigation = target.getByRole("navigation", { name: "انتخاب موجودیت" });
    const entry = navigation.getByRole("button", { name: new RegExp(`^${title}(?:\\s|$)`) });
    await entry.click();
    return;
  }
  const input = target.getByRole("combobox", { name: label, exact: true });
  await input.fill(title);
  await target.getByRole("option").filter({ hasText: title }).first().click();
}
async function publish(entity, layout) {
  const form = ok(await engine(admin, `forms/${entity.code}/`));
  const draft = ok(await engine(admin, `forms/${entity.code}/`, "PUT", { revision: form.revision, draft: layout }));
  return ok(await engine(admin, `forms/${entity.code}/`, "POST", { revision: draft.revision }));
}
async function entity(kind, title, definitions = []) {
  const value = ok(
    await engine(admin, "definitions/entities/", "POST", {
      code: `t6a-${stamp}-${kind}`,
      title: `${title} آزمون ۶ ${stamp}`,
      numbering: { prefix: "TEST", padding: 4 },
    }),
    201
  );
  value.fields = [];
  for (const definition of definitions) {
    value.fields.push(
      ok(
        await engine(admin, "definitions/fields/", "POST", {
          ...definition,
          code: `t6a-${stamp}-${kind}-${definition.code}`,
        }),
        201
      )
    );
  }
  await publish(value, {
    tabs: [],
    sections: [
      {
        id: "main",
        title: "مشخصات",
        columns: 2,
        bindings: [{ field: "title" }, ...value.fields.map((field) => ({ field: field.code }))],
      },
    ],
  });
  resources.push({ type: "entity", id: value.id, code: value.code });
  return value;
}
async function create(target, values, context = normal, expected = 201) {
  return ok(await engine(context, `entities/${target.code}/records/`, "POST", { values }), expected);
}
async function get(target, id, context = normal) {
  return ok(await engine(context, `entities/${target.code}/records/${id}/`));
}
async function edit(target, id, values, context = normal, expected = 200) {
  const current = await get(target, id, context);
  return ok(
    await engine(context, `entities/${target.code}/records/${id}/`, "PATCH", { revision: current.revision, values }),
    expected
  );
}
const spec = (...fields) => ({
  version: 1,
  type: "table",
  columns: fields.map((field) => ({ field, width: 180 })),
  sort: [],
  filter: null,
  group: null,
});
async function defaultView(target, definition, name, context = normal) {
  const view = ok(
    await engine(context, `entities/${target.code}/views/`, "POST", { name, definition, visibility: "personal" }),
    201
  );
  ok(await engine(context, `entities/${target.code}/views/${view.id}/`, "PATCH", { is_default: true }));
  return view;
}
async function table(target, clientPage = page) {
  await clientPage.goto(`${base}/entities/${target.code}`);
  await clientPage.locator(".engine-view-controls").waitFor();
  await clientPage.getByRole("grid", { name: "رکوردها" }).waitFor();
}
async function relation(left, right, kind, leftTitle, rightTitle, on_delete = "block") {
  return ok(
    await engine(admin, "relations/", "POST", {
      left_entity: left.code,
      right_entity: right.code,
      kind,
      left_title: leftTitle,
      right_title: rightTitle,
      on_delete,
    }),
    201
  );
}
function workbook(headers, rows) {
  const escape = (text) =>
    String(text ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  const column = (index) => {
    let name = "";
    for (index++; index; index = Math.floor((index - 1) / 26))
      name = String.fromCharCode(65 + ((index - 1) % 26)) + name;
    return name;
  };
  const sheet = [headers, ...rows]
    .map(
      (row, index) =>
        `<row r="${index + 1}">${row.map((value, j) => `<c r="${column(j)}${index + 1}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`).join("")}</row>`
    )
    .join("");
  const files = {
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    "_rels/.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml":
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`,
  };
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)]))));
}
async function importUI(target, headers, rows) {
  await table(target);
  await page.getByRole("button", { name: "ورود Excel", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "acceptance.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: workbook(headers, rows),
  });
  const response = page.waitForResponse(
    (response) => response.url().endsWith(`/entities/${target.code}/import/`) && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "ورود داده‌ها", exact: true }).click();
  return ok({ status: (await response).status(), data: await (await response).json() });
}
let response,
  task,
  amount,
  status,
  record,
  customer,
  national,
  phone,
  firstCustomer,
  personal,
  role,
  adminRole,
  profile,
  numbered,
  numberRule,
  loginEmail,
  loginPassword;
try {
  await login(adminPage, env.DEV_ADMIN_EMAIL, env.DEV_ADMIN_PASSWORD);
  const permissions = ok(await request(admin, "organization/permissions/"));
  const codes = [
    "Issue.View",
    "Issue.ViewAll",
    "Issue.Create",
    "Issue.Edit",
    "Issue.Delete",
    "View.Personal.Create",
    "View.Personal.Share",
    "Relation.View",
    "Relation.Create",
    "Relation.Edit",
    "User.View",
    "OrganizationUnit.View",
  ];
  role = ok(
    await request(admin, "organization/roles/", "POST", {
      name: `آزمون ۶ ${stamp}`,
      permission_ids: permissions.filter((item) => codes.includes(item.code)).map((item) => item.id),
    }),
    201
  );
  adminRole = ok(await request(admin, "organization/roles/")).find((item) => item.system_key === "admin");
  loginEmail = `t6a-${stamp}@example.test`;
  loginPassword = `T6!${randomUUID()}aA9`;
  const user = ok(
    await engine(admin, "entities/user/records/", "POST", {
      values: {
        user_name: `کاربر آزمون ۶ ${stamp}`,
        user_username: `t6a-${stamp}`,
        user_email: loginEmail,
        user_password: loginPassword,
        user_roles: [role.id],
      },
    }),
    201
  );
  const receiverUser = ok(
    await engine(admin, "entities/user/records/", "POST", {
      values: {
        user_name: `گیرنده آزمون ۶ ${stamp}`,
        user_username: `t6b-${stamp}`,
        user_email: `t6b-${stamp}@example.test`,
        user_password: loginPassword,
        user_roles: [role.id],
      },
    }),
    201
  );
  resources.push({ type: "user", id: user.id }, { type: "user", id: receiverUser.id }, { type: "role", id: role.id });
  task = await entity("ticket", "تیکت", [
    { code: "amount", title: "مبلغ آزمایشی", kind: "money", config: { required: true } },
    { code: "status", title: "وضعیت آزمایشی", kind: "short_text", config: { default: "باز" } },
  ]);
  [amount, status] = task.fields;
  customer = await entity("customer", "مشتری", [
    { code: "national", title: "کد ملی آزمایشی", kind: "short_text" },
    { code: "phone", title: "تلفن مشتری", kind: "phone" },
  ]);
  [national, phone] = customer.fields;
  const contracts = await entity("contract", "قرارداد", [
    { code: "buyer", title: "مشتری قرارداد", kind: "relation", relation_entity: customer.id },
    { code: "number", title: "شماره قرارداد", kind: "short_text" },
  ]);
  const contractBuyer = contracts.fields[0],
    contractNumber = contracts.fields[1];
  const official = ok(
    await engine(admin, `entities/${task.code}/views/`, "POST", {
      name: "جدول رسمی آزمون",
      visibility: "official",
      default_roles: [role.id],
      definition: spec("title", amount.code, status.code),
    }),
    201
  );
  await login(page, loginEmail, loginPassword);
  record = await create(task, { title: "تیکت نمونه آزمون ۶", [amount.code]: 120 });
  if (!tailOnly) {
    await table(task);
    await page.getByRole("button", { name: "ستون‌ها و ترتیب", exact: true }).click();
    const columns = page.locator(".engine-column-row");
    assert.equal(await columns.count(), 3);
    await columns.nth(2).dragTo(columns.nth(0));
    await page.getByRole("button", { name: "بستن تنظیمات", exact: true }).click();
    await page.getByRole("button", { name: "جدول من", exact: true }).click();
    await page.getByLabel("نام نما", { exact: true }).fill("جدول من آزمون ۶");
    await page.getByRole("button", { name: "ذخیره نما", exact: true }).click();
    await page.getByRole("button", { name: "☆ پیش‌فرض من", exact: true }).click();
    await page.reload();
    await page.getByRole("button", { name: "★ پیش‌فرض من", exact: true }).waitFor();
    let listing = ok(await engine(normal, `entities/${task.code}/views/`));
    personal = listing.results.find((item) => item.id === listing.default_id);
    assert.equal(personal.definition.columns.length, 3);
    assert.notDeepEqual(
      personal.definition.columns.map((column) => column.field),
      official.definition.columns.map((column) => column.field)
    );
    await capture(1, "ساخت، جابه‌جایی سه ستون و ماندگاری جدول شخصی کاربر عادی", page, {
      view_id: personal.id,
      columns: personal.definition.columns,
    });
    await login(secondPage, loginEmail, loginPassword);
    await table(task, secondPage);
    await secondPage.getByRole("button", { name: "★ پیش‌فرض من", exact: true }).waitFor();
    assert.equal(ok(await engine(second, `entities/${task.code}/views/`)).default_id, personal.id);
    await capture(2, "بازیابی همان جدول در نشست مستقل مرورگر دوم", secondPage);
    async function amountAccess(roles) {
      const form = ok(await engine(admin, `forms/${task.code}/`));
      const layout = structuredClone(form.published);
      for (const section of layout.sections)
        for (const binding of section.bindings) if (binding.field === amount.code) binding.view_roles = roles;
      await publish(task, layout);
    }
    await amountAccess([adminRole.id]);
    await page.reload();
    await page.getByRole("grid", { name: "رکوردها" }).waitFor();
    assert.equal(await page.locator(".schema-grid-column-title").filter({ hasText: amount.title }).count(), 0);
    await capture(3, "حذف بدون خطای ستون مبلغ پس از بستن دسترسی فیلد");
    await amountAccess([adminRole.id, role.id]);
    await page.reload();
    await page.getByRole("button", { name: "بازگشت به جدول رسمی", exact: true }).click();
    await page.locator(".schema-grid-column-title").filter({ hasText: amount.title }).waitFor();
    await capture(4, "بازگشت به جدول رسمی با یک کلیک");
    const shared = ok(
      await engine(admin, `entities/${task.code}/views/`, "POST", {
        name: "جدول اشتراکی نقش آزمون",
        visibility: "shared",
        recipients: { roles: [role.id] },
        definition: spec("title", amount.code, status.code),
      }),
      201
    );
    await amountAccess([adminRole.id]);
    await login(receiverPage, `t6b-${stamp}@example.test`, loginPassword);
    await table(task, receiverPage);
    await choose(receiverPage, "نمای ذخیره‌شده", "جدول اشتراکی نقش آزمون");
    assert(
      !ok(await engine(receiver, `entities/${task.code}/views/`))
        .results.find((item) => item.id === shared.id)
        .definition.columns.some((column) => column.field === amount.code)
    );
    assert.equal(await receiverPage.locator(".schema-grid-column-title").filter({ hasText: amount.title }).count(), 0);
    await capture(5, "اشتراک با نقش و اعمال دسترسی مستقل گیرنده", receiverPage);
    await amountAccess([adminRole.id, role.id]);
    await adminPage.goto(`${base}/settings/engine`);
    await adminPage.getByRole("navigation", { name: "انتخاب موجودیت" }).waitFor();
    const surfaces = ok(await engine(admin, "surfaces/")).results;
    assert(!surfaces.some((item) => ["profile", "security", "workspace", "appearance"].includes(item.code)));
    assert.equal(await adminPage.getByText("پروفایل من", { exact: true }).count(), 0);
    await capture(6, "فهرست فرم‌ها فقط شامل ایجاد و ویرایش موجودیت‌هاست", adminPage);
    await choose(adminPage, "فرم موجودیت", "کاربر");
    await adminPage.getByRole("button", { name: "چیدمان فرم", exact: false }).click();
    await adminPage.locator(".engine-binding").first().waitFor();
    await adminPage.locator(".engine-binding").filter({ hasText: "نام کاربری" }).click();
    assert(await adminPage.getByRole("checkbox", { name: "مخفی", exact: true }).isDisabled());
    await capture(7, "قفل‌بودن نام کاربری در فرم کاربر", adminPage);
    ok(
      await engine(admin, `entities/${customer.code}/unique-rules/`, "POST", {
        title: "کد ملی یکتا",
        fields: [national.code],
      }),
      201
    );
    firstCustomer = await create(customer, {
      title: "مشتری اول",
      [national.code]: "۱۲۳۴۵",
      [phone.code]: "02111111111",
    });
    await page.goto(`${base}/entities/${customer.code}/new`);
    await page.getByRole("textbox", { name: "عنوان", exact: true }).fill("مشتری تکراری");
    await page.getByRole("textbox", { name: national.title, exact: true }).fill("۱۲۳۴۵");
    response = page.waitForResponse(
      (item) => item.url().endsWith(`/entities/${customer.code}/records/`) && item.request().method() === "POST"
    );
    await page.getByRole("button", { name: "ثبت", exact: true }).click();
    assert.equal((await response).status(), 400);
    await page.getByRole("link", { name: "مشاهده رکورد موجود", exact: true }).waitFor();
    await capture(8, "مسدودسازی کد ملی تکراری همراه لینک مشتری قبلی");
    await page.getByRole("textbox", { name: national.title, exact: true }).fill("12345");
    response = page.waitForResponse(
      (item) => item.url().endsWith(`/entities/${customer.code}/records/`) && item.request().method() === "POST"
    );
    await page.getByRole("button", { name: "ثبت", exact: true }).click();
    assert.equal((await response).status(), 400);
    await capture(9, "یکسان‌بودن ارقام فارسی و انگلیسی در تشخیص تکرار");
    const otherCustomer = await create(customer, { title: "مشتری دوم", [national.code]: "67890" });
    ok(
      await engine(admin, `entities/${contracts.code}/unique-rules/`, "POST", {
        title: "مشتری و قرارداد",
        fields: [contractBuyer.code, contractNumber.code],
      }),
      201
    );
    for (const [buyer, number] of [
      [firstCustomer.id, "111"],
      [firstCustomer.id, "222"],
      [otherCustomer.id, "111"],
    ])
      await create(contracts, {
        title: `قرارداد ${number}`,
        [contractBuyer.code]: buyer,
        [contractNumber.code]: number,
      });
    const composite = await create(
      contracts,
      { title: "ترکیب تکراری", [contractBuyer.code]: firstCustomer.id, [contractNumber.code]: "111" },
      normal,
      400
    );
    await table(contracts);
    await capture(10, "یکتایی ترکیب دو ستون و مجازبودن تکرار هر ستون به‌تنهایی", page, { rejection: composite });
    const imported = await importUI(
      contracts,
      ["title", contractBuyer.code, contractNumber.code],
      [
        ["قرارداد تکراری", firstCustomer.id, "111"],
        ["قرارداد تازه", otherCustomer.id, "333"],
      ]
    );
    assert.equal(imported.rejected_count, 1);
    assert.equal(imported.success_count, 1);
    await page.locator(".engine-view-drawer .engine-view-rule").filter({ hasText: "رد شد" }).waitFor();
    await capture(11, "رد ردیف تکراری Excel و ثبت علت و لینک در گزارش", page, { report: imported });
    const bypass = await engine(normal, `entities/${customer.code}/records/`, "POST", {
      values: { title: "ارسال مستقیم API", [national.code]: "12345" },
    });
    assert.equal(bypass.status, 400);
    assert(bypass.data.duplicates[0].record_url.endsWith(firstCustomer.id));
    await page.goto(`${base}/entities/${customer.code}/${firstCustomer.id}`);
    await page.locator(".engine-record-form").waitFor();
    await capture(12, "رد ثبت تکراری مستقیم API بدون تکیه بر UI", page, {
      status: bypass.status,
      response: bypass.data,
    });
    const duplicated = await entity("duplicates", "داده دارای تکرار");
    await create(duplicated, { title: "تکرار قبلی" });
    await create(duplicated, { title: "تکرار قبلی" });
    await adminPage.goto(`${base}/settings/engine`);
    await choose(adminPage, "موجودیت", duplicated.title);
    await adminPage.getByRole("button", { name: "قواعد ثبت", exact: false }).click();
    await adminPage.getByLabel("نام گروه یکتا", { exact: true }).fill("قاعده روی داده قدیمی");
    await choose(adminPage, "افزودن ستون به گروه", "عنوان");
    await adminPage.getByRole("button", { name: "ثبت گروه یکتا", exact: true }).click();
    await adminPage.getByRole("button", { name: "اول رفع کنم", exact: true }).waitFor();
    await adminPage.getByRole("button", { name: "فقط برای رکوردهای جدید اعمال شود", exact: true }).waitFor();
    await capture(13, "نمایش تکرارهای موجود و دو انتخاب پیش از فعال‌کردن قاعده", adminPage);
    await adminPage.getByRole("button", { name: "فقط برای رکوردهای جدید اعمال شود", exact: true }).click();
    await adminPage.getByRole("button", { name: "اول رفع کنم", exact: true }).waitFor({ state: "detached" });
    await create(duplicated, { title: "تکرار قبلی" }, normal, 400);
    numbered = await entity("numbered", "شماره تیکت");
    const numberCode = `t6a-${stamp}-serial`;
    numberRule = ok(
      await engine(admin, `entities/${numbered.code}/numbering-rules/`, "POST", {
        field: numberCode,
        title: "شماره تیکت",
        prefix: "TT",
        start: 1921,
        padding: 0,
      }),
      201
    );
    const numberedRows = [];
    for (let i = 0; i < 3; i++) numberedRows.push(await create(numbered, { title: `تیکت شماره ${i + 1}` }));
    assert.deepEqual(
      numberedRows.map((row) => row.values[numberCode]),
      ["TT1921", "TT1922", "TT1923"]
    );
    await table(numbered);
    await capture(14, "تخصیص TT1921، TT1922 و TT1923 طبق قالب تأییدشده");
    ok(await engine(normal, `entities/${numbered.code}/records/${numberedRows[1].id}/`, "DELETE"), 204);
    const fourth = await create(numbered, { title: "پس از حذف" });
    assert.equal(fourth.values[numberCode], "TT1924");
    await table(numbered);
    await capture(15, "استفاده‌نشدن دوباره از شماره حذف‌شده و تخصیص TT1924");
    const concurrent = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        create(numbered, { title: `ثبت همزمان ${index + 1}` }, index % 2 ? second : normal)
      )
    );
    assert.equal(new Set(concurrent.map((row) => row.values[numberCode])).size, 10);
    await table(numbered);
    await capture(16, "ده ثبت همزمان از دو نشست مرورگر بدون شماره تکراری", page, {
      numbers: concurrent.map((row) => row.values[numberCode]),
    });
    ok(await engine(admin, `entities/${numbered.code}/numbering-rules/${numberRule.id}/`, "PATCH", { prefix: "SP" }));
    const changedPrefix = await create(numbered, { title: "پیشوند تازه" });
    assert(changedPrefix.values[numberCode].startsWith("SP"));
    assert.equal((await get(numbered, numberedRows[0].id)).values[numberCode], "TT1921");
    await table(numbered);
    await capture(17, "تغییر پیشوند فقط برای رکوردهای جدید و حفظ شماره‌های قبلی");
    await adminPage.goto(`${base}/settings/engine`);
    await choose(adminPage, "موجودیت", numbered.title);
    await adminPage.getByRole("button", { name: "قواعد ثبت", exact: false }).click();
    await adminPage.getByRole("button", { name: "تنظیمات", exact: true }).click();
    await adminPage.getByLabel("شروع توالی", { exact: true }).fill("1900");
    await adminPage.getByRole("button", { name: "ذخیره تنظیمات شماره‌گذاری", exact: true }).click();
    await adminPage.getByRole("alert").filter({ hasText: "شروع توالی باید" }).first().waitFor();
    await capture(18, "رد شروع توالی کوچک‌تر از آخرین شماره استفاده‌شده", adminPage);
  } else {
    firstCustomer = await create(customer, {
      title: "مشتری اول",
      [national.code]: "۱۲۳۴۵",
      [phone.code]: "02111111111",
    });
  }
  const oldEntity = await entity("backfill", "شماره‌دهی سوابق");
  const oldRecords = [await create(oldEntity, { title: "قدیمی اول" }), await create(oldEntity, { title: "قدیمی دوم" })];
  await adminPage.goto(`${base}/settings/engine`);
  await choose(adminPage, "موجودیت", oldEntity.title);
  await adminPage.getByRole("button", { name: "قواعد ثبت", exact: false }).click();
  await adminPage.getByLabel("عنوان ستون", { exact: true }).fill("شماره سوابق");
  const backfillCode = `t6a-${stamp}-oldnumber`;
  await adminPage.getByLabel("کد انگلیسی ستون", { exact: true }).fill(backfillCode);
  await adminPage.getByLabel("پیشوند", { exact: true }).fill("BK");
  await adminPage.getByLabel("شروع توالی", { exact: true }).fill("100");
  await adminPage.getByRole("button", { name: "پیش‌نمایش شماره‌دهی", exact: true }).click();
  await adminPage.getByRole("button", { name: "تأیید و ایجاد ستون", exact: true }).waitFor();
  await adminPage.screenshot({ path: resolve(output, "scenario-19-preview.png"), fullPage: true });
  adminPage.once("dialog", (dialog) => dialog.accept());
  response = adminPage.waitForResponse(
    (item) =>
      item.url().endsWith(`/entities/${oldEntity.code}/numbering-rules/`) &&
      item.request().method() === "POST" &&
      item.status() === 201
  );
  await adminPage.getByRole("button", { name: "تأیید و ایجاد ستون", exact: true }).click();
  await response;
  assert.deepEqual(
    await Promise.all(oldRecords.map(async (row) => (await get(oldEntity, row.id)).values[backfillCode])),
    ["BK100", "BK101"]
  );
  await table(oldEntity);
  await capture(19, "پیش‌نمایش شماره‌دهی سوابق به ترتیب ایجاد و اجرای موفق پس از تأیید", page, {
    numbers: ["BK100", "BK101"],
    preview_screenshot: "scenario-19-preview.png",
  });
  ok(await engine(admin, `definitions/fields/${amount.id}/`, "PATCH", { hidden_from_form: true }));
  await page.goto(`${base}/entities/${task.code}/new`);
  await page.locator(".engine-record-form").waitFor();
  assert.equal(await page.getByRole("textbox", { name: amount.title, exact: true }).count(), 0);
  await create(task, { title: "ثبت بدون فیلد اجباری مخفی" });
  assert.equal((await get(task, record.id)).values[amount.code], "120");
  await capture(20, "مخفی‌شدن ورودی و حفظ داده قبلی بدون مسدودشدن ایجاد رکورد");
  const hiddenWrite = await engine(normal, `entities/${task.code}/records/`, "POST", {
    values: { title: "تلاش مقداردهی فیلد مخفی", [amount.code]: 999 },
  });
  assert.equal(hiddenWrite.status, 403);
  const hiddenImport = await importUI(task, ["title", amount.code, status.code], [["ورود با ستون مخفی", 999, "باز"]]);
  assert.equal(hiddenImport.success_count, 1);
  assert(hiddenImport.results[0].warnings.length);
  assert.equal((await get(task, hiddenImport.results[0].id)).values[amount.code], null);
  await page.getByText(/نادیده گرفته شد/).waitFor();
  await capture(21, "رد مقدار فیلد مخفی در API و نادیده‌گرفتن همراه هشدار در Excel", page, {
    api_status: hiddenWrite.status,
    import: hiddenImport,
  });
  const blockedDelete = await engine(admin, `definitions/fields/${amount.id}/`, "DELETE");
  assert.equal(blockedDelete.status, 400);
  const unused = ok(
    await engine(admin, "definitions/fields/", "POST", {
      code: `t6a-${stamp}-empty`,
      title: "فیلد خالی آزمون",
      kind: "short_text",
    }),
    201
  );
  ok(await engine(admin, `definitions/fields/${unused.id}/`, "DELETE"), 204);
  await adminPage.goto(`${base}/settings/engine`);
  await choose(adminPage, "موجودیت", task.title);
  await adminPage.getByRole("button", { name: "قواعد ثبت", exact: false }).click();
  await choose(adminPage, "فیلد", `${amount.title} · ${amount.code}`);
  await adminPage.getByRole("button", { name: "حذف کامل فیلد", exact: true }).waitFor();
  await adminPage.waitForFunction(() =>
    Array.from(document.querySelectorAll("button")).some(
      (button) => button.textContent.trim() === "حذف کامل فیلد" && button.disabled
    )
  );
  await capture(22, "مسدودبودن حذف فیلد دارای داده با شمارش و امکان حذف فیلد خالی", adminPage, {
    blocked: blockedDelete.data,
    empty_field_deleted: true,
  });
  adminPage.once("dialog", (dialog) => dialog.accept());
  response = adminPage.waitForResponse(
    (item) => item.url().endsWith(`/definitions/fields/${amount.id}/`) && item.request().method() === "PATCH"
  );
  await adminPage.getByRole("button", { name: "فعال در فرم", exact: true }).click();
  assert.equal((await response).status(), 200);
  await page.goto(`${base}/entities/${task.code}/new`);
  await page.getByRole("textbox", { name: amount.title, exact: true }).waitFor();
  await capture(23, "بازگشت ورودی پس از فعال‌کردن دوباره فیلد");
  ok(
    await engine(admin, `entities/${task.code}/presentation/`, "PUT", {
      summary: [{ field: "title" }, { field: amount.code }, { field: status.code }],
    })
  );
  await table(task);
  await page
    .locator(`tbody tr[data-entry-key="row:${record.id}"] td`)
    .last()
    .click({ position: { x: 80, y: 10 } });
  await page.getByRole("heading", { name: "خلاصه اطلاعات", exact: true }).waitFor();
  await page.locator(".engine-record-drawer .engine-record-summary small").filter({ hasText: amount.title }).waitFor();
  await capture(24, "بازشدن خلاصه با ستون‌های انتخاب‌شده توسط ادمین");
  await page.getByRole("button", { name: "ویرایش", exact: true }).click();
  await page
    .locator(".engine-record-drawer")
    .getByRole("textbox", { name: "عنوان", exact: true })
    .fill("عنوان اصلاح‌شده آزمون ۶");
  await page.getByRole("button", { name: "ذخیره تغییرات", exact: true }).click();
  await page.locator(".engine-record-drawer .engine-record-form").waitFor({ state: "detached" });
  await page.locator(".engine-record-drawer header").getByRole("button", { name: "بستن", exact: true }).click();
  await page.getByRole("link", { name: "عنوان اصلاح‌شده آزمون ۶", exact: true }).waitFor();
  record = await get(task, record.id);
  assert.equal(record.title, "عنوان اصلاح‌شده آزمون ۶");
  await capture(25, "ویرایش خلاصه و به‌روزرسانی جدول بدون بارگذاری مجدد");
  await page
    .locator(`tbody tr[data-entry-key="row:${record.id}"] td`)
    .last()
    .click({ position: { x: 80, y: 10 } });
  await page.getByRole("button", { name: "ویرایش", exact: true }).click();
  await page
    .locator(".engine-record-drawer")
    .getByRole("textbox", { name: "عنوان", exact: true })
    .fill("تغییر ذخیره‌نشده");
  let confirmed = false;
  page.once("dialog", async (dialog) => {
    confirmed = dialog.message().includes("ذخیره‌نشده");
    await dialog.dismiss();
  });
  await page.locator(".engine-record-drawer header").getByRole("button", { name: "بستن", exact: true }).click();
  assert(confirmed);
  await capture(26, "نمایش تأیید تغییر ذخیره‌نشده و حفظ ویرایش با انصراف");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(".engine-record-drawer header").getByRole("button", { name: "بستن", exact: true }).click();
  await page.locator('tbody input[type="checkbox"]').first().check();
  assert.equal(await page.locator(".engine-record-drawer").count(), 0);
  await page.getByRole("link", { name: record.title, exact: true }).click();
  await page.waitForURL((url) => url.pathname.endsWith(record.id));
  assert.equal(await page.locator(".engine-record-drawer").count(), 0);
  await capture(27, "بازنشدن پنل با تیک انتخاب و کلیک لینک داخل سلول");
  const customerTickets = await relation(customer, task, "one_to_many", "تیکت‌های مشتری", "مشتری تیکت");
  await edit(task, record.id, { [customerTickets.right_field]: firstCustomer.id });
  const related = ok(
    await engine(normal, `entities/${customer.code}/records/${firstCustomer.id}/related/${customerTickets.left_field}/`)
  );
  assert(related.results.some((row) => row.id === record.id));
  await page.goto(`${base}/entities/${customer.code}/${firstCustomer.id}`);
  await page.getByRole("button", { name: /^تیکت‌های مشتری.*▾$/ }).click();
  await page
    .locator('section[aria-label="رکوردهای مرتبط"] table')
    .getByRole("link", { name: record.title, exact: true })
    .waitFor();
  await capture(28, "ارتباط مشتری و چند تیکت و نمایش دوطرفه رکوردها");
  profile = await entity("profile", "پروفایل تکمیلی");
  const oneToOne = await relation(task, profile, "one_to_one", "پروفایل تیکت", "تیکت پروفایل");
  const profileRecord = await create(profile, { title: "پروفایل یکتا" });
  await edit(task, record.id, { [oneToOne.left_field]: profileRecord.id });
  await page.goto(`${base}/entities/${task.code}/new`);
  await page.getByRole("textbox", { name: "عنوان", exact: true }).fill("تلاش اتصال دوم");
  await page.getByRole("textbox", { name: amount.title, exact: true }).fill("1");
  await page.getByRole("button", { name: "پروفایل تیکت", exact: true }).click();
  await page.getByRole("option").filter({ hasText: profileRecord.title }).click();
  response = page.waitForResponse(
    (item) => item.url().endsWith(`/entities/${task.code}/records/`) && item.request().method() === "POST"
  );
  await page.getByRole("button", { name: "ثبت", exact: true }).click();
  assert.equal((await response).status(), 400);
  await page.getByRole("alert").filter({ hasText: "قانون تعداد ارتباط" }).first().waitFor();
  await capture(29, "رد اتصال دو رکورد به یک مقصد در ارتباط یک‌به‌یک");
  const users = ok(await engine(admin, "catalog/")).entities.find((item) => item.code === "user");
  const team = await relation(task, users, "many_to_many", "کاربران تیکت", "تیکت‌های مرتبط کاربر", "detach");
  await page.goto(`${base}/entities/${task.code}/${record.id}`);
  await page.getByRole("button", { name: /^کاربران تیکت.*▾$/ }).click();
  const teamSection = page
    .locator('section[aria-label="رکوردهای مرتبط"] > section')
    .filter({ hasText: "کاربران تیکت" });
  for (const target of [user, receiverUser]) {
    await teamSection.getByRole("button", { name: "کاربران تیکت", exact: true }).click();
    await teamSection.getByRole("textbox", { name: "جستجوی کاربران تیکت", exact: true }).fill(target.title);
    const option = teamSection.getByRole("option").filter({ hasText: target.title });
    await option.click();
    await teamSection.locator(".schema-picker-panel").getByRole("button", { name: "بستن", exact: true }).click();
    const attachButton = teamSection.getByRole("button", { name: "اتصال رکورد موجود", exact: true });
    await page.screenshot({ path: resolve(output, "scenario-30-before-attach.png"), fullPage: true });
    assert.equal(await attachButton.isDisabled(), false, "انتخاب‌گر باید شناسهٔ کاربر را به دکمهٔ اتصال منتقل کند");
    await attachButton.click();
    await teamSection.getByRole("button", { name: "اتصال رکورد موجود", exact: true }).waitFor();
    await page.waitForFunction(
      (count) =>
        Array.from(document.querySelectorAll('section[aria-label="رکوردهای مرتبط"] > section'))
          .find((section) => section.textContent.includes("کاربران تیکت"))
          ?.querySelectorAll("tbody tr").length === count,
      target.id === user.id ? 1 : 2
    );
  }
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('section[aria-label="رکوردهای مرتبط"] > section'))
        .find((section) => section.textContent.includes("کاربران تیکت"))
        ?.querySelectorAll("tbody tr").length === 2
  );
  page.once("dialog", (dialog) => dialog.accept());
  await teamSection.getByRole("button", { name: "جدا کردن", exact: true }).first().click();
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('section[aria-label="رکوردهای مرتبط"] > section'))
        .find((section) => section.textContent.includes("کاربران تیکت"))
        ?.querySelectorAll("tbody tr").length === 1
  );
  await capture(30, "اتصال چند کاربر و جداکردن در ارتباط چندبه‌چند");
  const lookup = ok(
    await engine(admin, `entities/${task.code}/lookup-columns/`, "POST", {
      title: "تلفن خواندنی مشتری",
      path: `${customerTickets.right_field}.${phone.code}`,
      aggregation: "single",
    }),
    201
  );
  await edit(customer, firstCustomer.id, { [phone.code]: "02122222222" });
  await defaultView(task, spec("title", lookup.field), "جدول تلفن مشتری");
  await table(task);
  await page.getByText("02122222222", { exact: true }).waitFor();
  await capture(31, "به‌روزرسانی زنده مقدار خواندنی با تغییر تلفن مشتری");
  const city = await entity("city", "شهر"),
    company = await entity("company", "شرکت");
  const customerCompany = await relation(customer, company, "many_to_one", "شرکت مشتری", "مشتریان شرکت"),
    companyCity = await relation(company, city, "many_to_one", "شهر شرکت", "شرکت‌های شهر");
  const cityRecord = await create(city, { title: "تهران" }),
    companyRecord = await create(company, { title: "شرکت نمونه" });
  await edit(company, companyRecord.id, { [companyCity.left_field]: cityRecord.id });
  await edit(customer, firstCustomer.id, { [customerCompany.left_field]: companyRecord.id });
  const path = `${customerTickets.right_field}.${customerCompany.left_field}.${companyCity.left_field}.title`;
  const deepDefinition = {
    ...spec("title", path),
    sort: [{ field: path, direction: "asc" }],
    filter: { field: path, op: "eq", value: "تهران" },
  };
  const deepView = await defaultView(task, deepDefinition, "مسیر سه‌سطحی شهر شرکت مشتری");
  const deep = ok(await engine(normal, `entities/${task.code}/query/`, "POST", { view_id: deepView.id }));
  assert.equal(deep.count, 1);
  assert.deepEqual(deep.results[0].values[path].flat(Infinity), ["تهران"]);
  await table(task);
  await page.getByText("تهران", { exact: true }).waitFor();
  await capture(32, "ستون سه‌سطحی شهر شرکت مشتری همراه فیلتر و مرتب‌سازی سمت سرور", page, { path, matched: deep.count });
  await page.goto(`${base}/entities/${customer.code}/${firstCustomer.id}`);
  await page.locator(".engine-record-form").waitFor();
  page.once("dialog", (dialog) => dialog.accept());
  response = page.waitForResponse(
    (item) =>
      item.url().includes(`/entities/${customer.code}/records/${firstCustomer.id}/`) &&
      item.request().method() === "DELETE"
  );
  await page.getByRole("button", { name: "حذف", exact: true }).click();
  assert.equal((await response).status(), 400);
  await page
    .getByText(/این رکورد ارتباط فعال دارد/)
    .first()
    .waitFor();
  await page.screenshot({ path: resolve(output, "scenario-33-delete-blocked.png"), fullPage: true });
  const cityForm = ok(await engine(admin, `forms/${city.code}/`));
  const cityLayout = structuredClone(cityForm.published);
  for (const section of cityLayout.sections)
    for (const binding of section.bindings) if (binding.field === "title") binding.view_roles = [adminRole.id];
  await publish(city, cityLayout);
  await page.goto(`${base}/entities/${task.code}`);
  await page.getByText("رکوردی یافت نشد", { exact: true }).waitFor();
  await page.locator(".engine-filter-chip").click();
  await page.getByRole("grid", { name: "رکوردها" }).waitFor();
  assert.equal(await page.locator(".schema-grid-column-title").filter({ hasText: "شهر شرکت" }).count(), 0);
  const redacted = ok(await engine(normal, `entities/${task.code}/views/`)).results.find(
    (item) => item.id === deepView.id
  );
  assert(!redacted.definition.columns.some((column) => column.field === path));
  await capture(33, "مسدودبودن حذف مشتری دارای تیکت و حذف ستون رابطه‌ای خارج از دسترسی", page, {
    delete_status: 400,
    restricted_column_removed: true,
  });
  assert.deepEqual(
    checks.map((check) => check.scenario).sort((a, b) => a - b),
    Array.from({ length: 33 }, (_, index) => index + 1)
  );
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator("tbody tr[data-entry-key] td")
    .last()
    .click({ position: { x: 80, y: 10 } });
  await page.locator(".engine-record-drawer").waitFor();
  assert(Math.abs((await page.locator(".engine-record-drawer").boundingBox()).width - 390) < 2);
  await page.screenshot({ path: resolve(output, "mobile-summary.png"), fullPage: true });
} catch (error) {
  await page.screenshot({ path: resolve(output, "failure-normal.png"), fullPage: true }).catch(() => {});
  await adminPage.screenshot({ path: resolve(output, "failure-admin.png"), fullPage: true }).catch(() => {});
  console.error(String(error.message).split("Call log:")[0].trim());
  console.error(
    String(error.stack)
      .split("\n")
      .filter((line) => line.includes("crm-ticket-six-acceptance.mjs:"))
      .join("\n")
  );
  process.exitCode = 1;
} finally {
  for (const resource of resources.filter((item) => item.type === "user")) {
    try {
      const result = await engine(admin, `entities/user/records/${resource.id}/`, "DELETE");
      resource.membership_removed = result.status === 204;
    } catch {
      resource.membership_removed = false;
    }
  }
  await writeFile(
    resolve(output, "report.json"),
    JSON.stringify(
      {
        scope:
          "Real local Docker; isolated sample entities; independent browser sessions. Only listed passed scenarios were executed.",
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        checks,
        errors,
        resources,
        earlier_run: previous
          ? { started_at: previous.started_at, resources: previous.resources, report: priorReportName }
          : null,
      },
      null,
      2
    )
  );
  const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
  await writeFile(
    resolve(output, "index.html"),
    `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><title>شواهد پذیرش تیکت ۶</title><style>body{font-family:Tahoma,sans-serif;max-width:1100px;margin:40px auto;line-height:1.9;background:#f8fafc;color:#172033}table{width:100%;border-collapse:collapse;background:white}td,th{padding:12px;border:1px solid #cbd5e1;text-align:right}a{color:#4338ca}.passed{color:#15803d}.pending{color:#92400e}</style><h1>شواهد پذیرش تیکت ۶</h1><p>${checks.length} از ۳۳ سناریو با موفقیت ثبت شده است. ${escape(startedAt)}</p><p>اجرای واقعی روی Docker محلی، با موجودیت‌های نمونه مجزای موتور مشترک و فرم بومی کاربر. نشست دوم مرورگر context مستقل است. فقط ردیف‌های موفق، شاهد اجرای این نوبت هستند.</p><p><a href="report.json">گزارش ماشینی و جزئیات پاسخ API</a></p><table><thead><tr><th>سناریو</th><th>نتیجه</th><th>شرح و تصویر</th></tr></thead><tbody>${Array.from(
      { length: 33 },
      (_, index) => {
        const check = checks.find((item) => item.scenario === index + 1);
        return `<tr><td>${index + 1}</td><td class="${check ? "passed" : "pending"}">${check ? "موفق" : "تکمیل نشده"}</td><td>${check ? `<a href="${check.screenshot}">${escape(check.name)}</a>` : "در گزارش این اجرا موفق ثبت نشده است."}</td></tr>`;
      }
    ).join("")}</tbody></table></html>`
  );
  await browser.close();
}
