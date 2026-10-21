/* eslint-disable no-await-in-loop -- Measures committed server responses in sequence. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const cache = resolve("apps/api/.pytest_cache"),
  output = resolve("tmp/crm-entity-views-performance");
const ready = JSON.parse(await readFile(resolve(cache, "entity-view-live-ready.json"), "utf8"));
const { chromium } = await import(pathToFileURL(resolve(".cache/browser/node_modules/playwright/index.mjs")).href);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addCookies([{ name: ready.cookie_name, value: ready.cookie_value, url: "http://localhost:3000" }]);
// Forward to the live pytest Django server, backed by its isolated PostgreSQL DB.
// Responses are returned unchanged; this is a network bridge, not a mock API.
await context.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) {
    url.host = "127.0.0.1:8001";
    const headers = await route.request().allHeaders();
    delete headers.host;
    const response = await route.fetch({ url: url.href, headers, timeout: 120000 });
    console.log(`HTTP ${route.request().method()} ${url.pathname} ${response.status()}`);
    await route.fulfill({ response });
  } else await route.continue();
});
const page = await context.newPage();
page.setDefaultTimeout(120000);
const errors = [],
  report = { rows: 10000, scenarios: [], errors, passed: false };
page.on("pageerror", (error) => errors.push(error.message));
page.on("requestfailed", (request) =>
  console.log(`NETWORK ${new URL(request.url()).pathname} ${request.failure()?.errorText}`)
);
page.on("response", async (response) => {
  if (response.status() >= 400) {
    const detail = `${response.status()} ${new URL(response.url()).pathname}: ${(await response.text().catch(() => "")).slice(0, 300)}`;
    console.log(detail);
  }
});
const root = `/api/workspaces/${ready.slug}/engine/entities/${ready.code}`;
const post = async (path, body) =>
  page.evaluate(
    async ({ path, body }) => {
      const csrf = await (await fetch("/auth/get-csrf-token/")).json();
      const result = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRFTOKEN": csrf.csrf_token },
        body: JSON.stringify(body),
      });
      return { status: result.status, data: await result.json() };
    },
    { path: root + path, body }
  );
try {
  const account = await context.request.get("http://127.0.0.1:8001/api/users/me/", {
    headers: { Cookie: `${ready.cookie_name}=${ready.cookie_value}` },
    timeout: 120000,
  });
  assert.equal(account.status(), 200, "The isolated browser account must be authenticated before navigation");
  await page.goto(`http://localhost:3000/entities/${ready.code}`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.getByText("۱۰٬۰۰۰ رکورد مجاز", { exact: false }).waitFor();
  await page.locator(".schema-data-grid tbody tr").first().waitFor();
  assert((await page.locator(".schema-data-grid tbody tr").count()) < 50);
  const columns = ["title", "amount", "due"].map((field) => ({ field, width: 190 }));
  const scenarios = [
    {
      name: "filter_sort_group",
      columns,
      sort: [
        { field: "amount", direction: "desc" },
        { field: "title", direction: "asc" },
      ],
      group: "urgent",
      filter: {
        op: "and",
        rules: [
          { field: "amount", op: "gte", value: "200000" },
          {
            op: "or",
            rules: [
              { field: "urgent", op: "eq", value: true },
              { field: "due", op: "lt", value: "2026-11-01" },
            ],
          },
        ],
      },
    },
    {
      name: "relation_path",
      columns: [...columns, { field: "company.region", width: 200 }],
      sort: [
        { field: "company.region", direction: "asc" },
        { field: "amount", direction: "desc" },
      ],
      filter: { field: "company.region", op: "eq", value: "تهران" },
    },
    {
      name: "pagination",
      columns,
      sort: [
        { field: "due", direction: "asc" },
        { field: "amount", direction: "desc" },
      ],
    },
  ];
  for (const scenario of scenarios) {
    const definition = { version: 1, type: "table", ...scenario };
    delete definition.name;
    const saved = await post("/views/", { name: `Browser ${scenario.name}`, visibility: "personal", definition });
    assert.equal(saved.status, 201, JSON.stringify(saved.data));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".schema-data-grid tbody tr").first().waitFor();
    await page.getByRole("button", { name: "باز کردن نمای ذخیره‌شده", exact: true }).click();
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith(`${ready.code}/query/`) && response.request().postDataJSON()?.view_id === saved.data.id
    );
    const start = performance.now();
    await page.getByRole("option", { name: `Browser ${scenario.name} · شخصی`, exact: true }).click();
    const response = await responsePromise;
    const payload = await response.json(),
      received = performance.now();
    assert.equal(response.status(), 200, JSON.stringify(payload));
    await page.locator(".schema-data-grid tbody").getByText(payload.results[0].title, { exact: true }).waitFor();
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    const painted = performance.now();
    report.scenarios.push({
      name: scenario.name,
      count: payload.count,
      fetched: payload.results.length,
      dom_rows: await page.locator(".schema-data-grid tbody tr").count(),
      request_to_response_ms: Math.round(received - start),
      response_to_paint_ms: Math.round(painted - received),
      total_ms: Math.round(painted - start),
    });
    assert.equal(payload.results.length, 100);
    assert.equal(
      payload.count,
      scenario.name === "relation_path" ? 3400 : scenario.name === "filter_sort_group" ? 5520 : 10000
    );
    assert((await page.locator(".schema-data-grid tbody tr").count()) < 50);
    if (scenario.name === "pagination") {
      const nextResponse = page.waitForResponse(
        (response) => response.url().endsWith(`${ready.code}/query/`) && response.request().postDataJSON()?.page === 2
      );
      await page.getByRole("button", { name: "بعدی", exact: true }).click();
      const second = await (await nextResponse).json();
      assert.equal(second.page, 2);
      assert.equal(second.count, 10000);
      assert(second.results.every((row) => !payload.results.some((first) => first.id === row.id)));
      await page.locator(".schema-data-grid tbody").getByText(second.results[0].title, { exact: true }).waitFor();
    }
  }
  await page.screenshot({ path: resolve(output, "ten-thousand-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 2, undefined, {
    timeout: 10000,
  });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
  await page.screenshot({ path: resolve(output, "ten-thousand-mobile.png"), fullPage: true });
  assert.deepEqual(errors, []);
  report.passed = true;
} catch (error) {
  report.failure = error.stack;
  await writeFile(resolve(output, "failure.txt"), await page.locator("body").innerText());
  await writeFile(
    resolve(output, "layout.json"),
    JSON.stringify(
      await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
        elements: [...document.querySelectorAll("body *")]
          .filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width && (r.right > innerWidth + 1 || r.left < -1) && !e.closest(".schema-data-grid table");
          })
          .map((e) => ({ tag: e.tagName, class: String(e.className), rect: e.getBoundingClientRect().toJSON() }))
          .slice(0, 30),
      })),
      null,
      2
    )
  );
  await page.screenshot({ path: resolve(output, "failure.png"), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  await writeFile(
    resolve(cache, "entity-view-live-done.json"),
    JSON.stringify({ passed: report.passed, failure: report.failure })
  );
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
