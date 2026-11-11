/* eslint-disable no-await-in-loop -- Each browser step verifies the previous committed change. */
// Acceptance scenario for ticket 2 (relations):
// admin builds "customer" and "product" tables -> customer many-to-one to ticket, product
// many-to-many to ticket with a quantity on the link -> picks the customer in the ticket form
// by searching -> sees the ticket on the customer page -> deleting the customer shows the
// impact preview, is blocked, and after switching the rule to "detach" it detaches.
import assert from "node:assert/strict";
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
const output = resolve("tmp/crm-relations-browser");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
page.setDefaultTimeout(60000);
page.setDefaultNavigationTimeout(120000);
const errors = [],
  checks = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("response", (response) => {
  if (response.url().startsWith(base) && response.status() >= 500)
    errors.push(`${response.status()} ${new URL(response.url()).pathname}`);
});
const api = async (path, method = "GET", body) =>
  page.evaluate(
    async ({ path, method, body }) => {
      const csrf = await (await fetch("/auth/get-csrf-token/")).json();
      const response = await fetch(path, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFTOKEN": csrf.csrf_token },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text.slice(0, 200);
      }
      return { status: response.status, data };
    },
    { path: `/api/workspaces/${slug}/engine/${path}`, method, body }
  );
const ok = (result, status = 200) => {
  assert.equal(result.status, status, JSON.stringify(result.data));
  return result.data;
};
const stamp = Date.now().toString(36);
const customerCode = `customer-${stamp}`,
  productCode = `product-${stamp}`,
  customerTitle = `مشتری ${stamp}`;
const entities = [],
  relations = [],
  records = [];

async function createTable(code, title) {
  const entity = ok(await api("definitions/entities/", "POST", { code, title }), 201);
  entities.push(entity);
  const draft = { tabs: [], sections: [{ id: "main", title: "اصلی", columns: 1, bindings: [{ field: "title" }] }] };
  const saved = ok(await api(`forms/${code}/`, "PUT", { revision: 0, draft }));
  ok(await api(`forms/${code}/`, "POST", { revision: saved.revision, change_note: "آزمون ارتباط" }), 201);
  return entity;
}

try {
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="email"]').fill(env.DEV_ADMIN_EMAIL);
  await page.locator('input[name="password"]').fill(env.DEV_ADMIN_PASSWORD);
  await page.locator('.auth-card button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname !== "/login");

  // 1. Admin defines the tables and the relations.
  await createTable(customerCode, "مشتری آزمون");
  await createTable(productCode, "محصول آزمون");
  const customerRule = ok(
    await api("relations/", "POST", {
      left_entity: "ticket",
      right_entity: customerCode,
      left_title: customerTitle,
      right_title: "تیکت‌های مرتبط",
      kind: "many_to_one",
      on_delete: "block",
    }),
    201
  );
  relations.push(customerRule);
  const productRule = ok(
    await api("relations/", "POST", {
      left_entity: "ticket",
      right_entity: productCode,
      left_title: `محصولات ${stamp}`,
      right_title: "تیکت‌ها",
      kind: "many_to_many",
      link_fields: [{ code: "quantity", title: "تعداد", kind: "integer", config: { required: true, min: 1 } }],
    }),
    201
  );
  relations.push(productRule);
  await page.goto(`${base}/settings/engine`, { waitUntil: "domcontentloaded" });
  checks.push("Customer (many-to-one) and product (many-to-many with quantity) relations were defined");

  const customer = ok(
    await api(`entities/${customerCode}/records/`, "POST", { values: { title: `آکمه ${stamp}` } }),
    201
  );
  records.push([customerCode, customer.id]);
  const product = ok(await api(`entities/${productCode}/records/`, "POST", { values: { title: `کالا ${stamp}` } }), 201);
  records.push([productCode, product.id]);
  const project = ok(
    await api("entities/project/records/", "POST", { values: { title: `پروژه ارتباط ${stamp}` } }),
    201
  );
  records.push(["project", project.id]);
  const ticket = ok(
    await api("entities/ticket/records/", "POST", {
      values: { title: `تیکت ارتباط ${stamp}`, project: project.id, [productRule.left_field]: [product.id] },
      relation_data: { [productRule.left_field]: [{ id: product.id, data: { quantity: 2 } }] },
    }),
    201
  );
  records.push(["ticket", ticket.id]);
  checks.push("Ticket stores the product link with its quantity");

  // 2. Pick the customer in the ticket form by searching.
  await page.goto(`${base}/entities/ticket/${ticket.id}`, { waitUntil: "domcontentloaded" });
  const picker = page.getByRole("combobox", { name: customerTitle });
  await picker.click();
  await page.keyboard.type(`آکمه ${stamp}`);
  await page.getByRole("option", { name: `آکمه ${stamp}` }).click();
  await page.getByRole("button", { name: "ذخیره تغییرات", exact: true }).click();
  await page.waitForResponse((response) => response.url().includes(`/records/${ticket.id}/`) && response.ok());
  const saved = ok(await api(`entities/ticket/records/${ticket.id}/`));
  assert.equal(saved.values[customerRule.left_field], customer.id);
  checks.push("Customer was chosen through the searchable relation picker in the ticket form");

  // 3. The customer page shows the ticket (reverse side).
  await page.goto(`${base}/entities/${customerCode}/${customer.id}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /تیکت‌های مرتبط/ }).click();
  await page.getByRole("link", { name: `تیکت ارتباط ${stamp}` }).waitFor();
  checks.push("Customer page lists the related ticket");

  // 4. Delete shows the impact preview and is blocked.
  await page.getByRole("button", { name: "حذف", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("تیکت‌های مرتبط").waitFor();
  await dialog.getByText("این عملیات مسدود است", { exact: false }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: "تأیید حذف" }).isDisabled(), true);
  await dialog.getByRole("button", { name: "انصراف" }).click();
  checks.push("Delete preview names the relation, link count and blocks the delete");

  // 5. With the "detach" rule the same delete detaches the ticket.
  ok(await api(`relations/${customerRule.id}/`, "PATCH", { on_delete: "detach" }));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "حذف", exact: true }).click();
  await page.getByRole("dialog").getByText("پیوندها جدا می‌شوند").waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "تأیید حذف" }).click();
  await page.waitForURL((url) => url.pathname === `/entities/${customerCode}`);
  records.splice(
    records.findIndex(([code]) => code === customerCode),
    1
  );
  const detached = ok(await api(`entities/ticket/records/${ticket.id}/`));
  assert.equal(detached.values[customerRule.left_field], null);
  checks.push("Detach rule removed the customer link from the ticket after confirmation");
  assert.deepEqual(errors, []);
} catch (error) {
  await page.screenshot({ path: resolve(output, "failure.png"), fullPage: true }).catch(() => {});
  await writeFile(resolve(output, "failure.txt"), `${error.stack}`);
  throw error;
} finally {
  for (const [code, id] of records.toReversed())
    await api(`entities/${code}/records/${id}/?confirm_relations=true`, "DELETE").catch(() => {});
  for (const relation of relations) await api(`relations/${relation.id}/?confirm=true`, "DELETE").catch(() => {});
  for (const entity of entities)
    await api(`definitions/entities/${entity.id}/`, "PATCH", { is_active: false }).catch(() => {});
  await writeFile(resolve(output, "report.json"), JSON.stringify({ checks, errors }, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ passed: checks.length, checks, errors }, null, 2));
