/* Browser evidence against the real local Docker API; no mocked responses. */
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
const output = resolve("tmp/ticket-6-evidence/browser");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(60000);
page.setDefaultNavigationTimeout(120000);
const checks = [],
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const stamp = Date.now().toString(36);
const code = `t6-${stamp}`;
async function api(path, method = "GET", data) {
  const csrf = await (await context.request.get(`${base}/auth/get-csrf-token/`)).json();
  const response = await context.request.fetch(`${base}/api/workspaces/${slug}/engine/${path}`, {
    method,
    headers: { "X-CSRFTOKEN": csrf.csrf_token },
    ...(data === undefined ? {} : { data }),
  });
  return { status: response.status(), data: response.status() === 204 ? null : await response.json() };
}
function ok(response, status = 200) {
  assert.equal(response.status, status, JSON.stringify(response.data));
  return response.data;
}
async function passed(name) {
  const file = `${String(checks.length + 1).padStart(2, "0")}.png`;
  await page.screenshot({ path: resolve(output, file), fullPage: true });
  checks.push({ name, screenshot: file });
  console.log(`PASS ${name}`);
}
async function login(target, email, password) {
  await target.goto(`${base}/login`);
  await target.locator('input[name="email"]').fill(email);
  await target.locator('input[name="password"]').fill(password);
  await target.locator('.auth-card button[type="submit"]').click();
  await target.waitForURL((url) => url.pathname !== "/login");
  await target.locator(".app-shell").waitFor();
}
let entity, field, record, view;
try {
  let ready = false;
  for (let attempt = 0; attempt < 90 && !ready; attempt += 1) {
    try {ready = (await context.request.get(`${base}/api/instances/`, {timeout: 5000})).ok();} catch { /* Development processes are still starting. */ }
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  assert(ready, "The Docker frontend did not become ready.");
  await login(page, env.DEV_ADMIN_EMAIL, env.DEV_ADMIN_PASSWORD);
  entity = ok(
    await api("definitions/entities/", "POST", {
      code,
      title: `آزمون تیکت ۶ ${stamp}`,
      numbering: { prefix: "TEST", padding: 4 },
    }),
    201
  );
  field = ok(
    await api("definitions/fields/", "POST", { code: `amount-${stamp}`, title: "مبلغ آزمایشی", kind: "money" }),
    201
  );
  const layout = {
    tabs: [],
    sections: [{ id: "main", title: "مشخصات", columns: 2, bindings: [{ field: "title" }, { field: field.code }] }],
  };
  const draft = ok(await api(`forms/${code}/`, "PUT", { revision: 0, draft: layout }));
  ok(await api(`forms/${code}/`, "POST", { revision: draft.revision }));
  record = ok(
    await api(`entities/${code}/records/`, "POST", { values: { title: "رکورد نمونه برای خلاصه", [field.code]: 120 } }),
    201
  );
  await page.goto(`${base}/entities/${code}`);
  await page.getByRole("grid", { name: "رکوردها" }).waitFor();
  await page.getByText("رکورد نمونه برای خلاصه", { exact: true }).waitFor();
  await passed("The new entity renders real records through the shared query layer.");
  await page.getByRole("button", { name: "جدول من", exact: true }).click();
  await page.getByLabel("نام نما", { exact: true }).fill("جدول شخصی آزمون ۶");
  await page.getByRole("button", { name: "ذخیره نما", exact: true }).click();
  await page.getByRole("button", { name: "☆ پیش‌فرض من", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "★ پیش‌فرض من", exact: true }).waitFor();
  const listing = ok(await api(`entities/${code}/views/`));
  view = listing.results.find((item) => item.id === listing.default_id);
  assert.equal(view.name, "جدول شخصی آزمون ۶");
  await passed("Personal view and its default survive a real browser reload.");
  await page
    .locator("tbody tr[data-entry-key]")
    .first()
    .locator("td")
    .last()
    .click({ position: { x: 12, y: 12 } });
  await page.getByRole("heading", { name: "خلاصه اطلاعات", exact: true }).waitFor();
  await passed("Clicking a noninteractive row cell opens the summary drawer.");
  await page.getByRole("button", { name: "ویرایش", exact: true }).click();
  const titleInput = page.locator(".engine-record-drawer input").first();
  await titleInput.fill("تغییر ذخیره‌نشده");
  let discardDialog = false;
  page.once("dialog", async (dialog) => {
    discardDialog = dialog.message().includes("ذخیره‌نشده");
    await dialog.dismiss();
  });
  await page.locator(".engine-record-drawer header").getByRole("button", { name: "بستن", exact: true }).click();
  assert(discardDialog);
  await page.getByRole("heading", { name: "خلاصه اطلاعات", exact: true }).waitFor();
  await passed("Closing a dirty drawer prompts and cancelling preserves the edit.");
  await page.getByRole("button", { name: "ذخیره تغییرات", exact: true }).click();
  await page.locator(".engine-record-drawer .engine-record-form").waitFor({ state: "detached" });
  await page.locator(".engine-record-drawer header").getByRole("button", { name: "بستن", exact: true }).click();
  await page.getByText("تغییر ذخیره‌نشده", { exact: true }).waitFor();
  await passed("Saving in the drawer updates the table without a page reload.");
  await page.locator('tbody input[type="checkbox"]').first().check();
  await page.waitForTimeout(250);
  assert.equal(await page.getByRole("heading", { name: "خلاصه اطلاعات", exact: true }).count(), 0);
  await passed("Row selection does not open the summary drawer.");
  ok(await api(`definitions/fields/${field.id}/`, "PATCH", { hidden_from_form: true }));
  await page.goto(`${base}/entities/${code}/new`);
  await page.locator(".engine-record-form").waitFor();
  assert.equal(await page.getByLabel("مبلغ آزمایشی", { exact: true }).count(), 0);
  const rejected = await api(`entities/${code}/records/`, "POST", { values: { title: "تلاش API", [field.code]: 99 } });
  assert.equal(rejected.status, 403);
  await passed("A retired form input disappears and direct API writes are rejected.");
  await page.goto(`${base}/entities/${code}`);
  await page.locator(".schema-grid-column-title").filter({hasText: "مبلغ آزمایشی"}).waitFor();
  await passed("The retired field and its old values remain in the table.");
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator("tbody tr[data-entry-key]")
    .first()
    .locator("td")
    .last()
    .click({ position: { x: 12, y: 12 } });
  const drawer = page.locator(".engine-record-drawer");
  await drawer.waitFor();
  const bounds = await drawer.boundingBox();
  assert(Math.abs(bounds.width - 390) < 2);
  await passed("The summary drawer uses the full mobile viewport width.");
  assert.deepEqual(errors, []);
} catch (error) {
  await page.screenshot({ path: resolve(output, "failure.png"), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await writeFile(
    resolve(output, "report.json"),
    JSON.stringify(
      {
        scope: "Preliminary real-browser checks; this report does not claim all 33 acceptance scenarios.",
        checks,
        errors,
        entity,
        field,
        record,
        view,
      },
      null,
      2
    )
  );
  await browser.close();
}
