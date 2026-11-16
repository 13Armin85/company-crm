import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(resolve(".cache/browser/node_modules/playwright/index.mjs")).href);
const base = process.env.CRM_BROWSER_URL || "http://localhost:3005";
const authBase = process.env.CRM_BROWSER_AUTH_URL || "http://localhost:3000";
const output = resolve(process.env.CRM_BROWSER_OUTPUT || "tmp/team-pagination-browser");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "fa-IR" });
const page = await context.newPage();
page.setDefaultTimeout(90000);
page.setDefaultNavigationTimeout(180000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const checks = [];
const check = (name) => {
  checks.push(name);
  console.log("PASS", name);
};
async function result(action, expected) {
  const received = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname.endsWith("/daily-reports/team/") &&
      Object.entries(expected).every(([key, value]) => url.searchParams.get(key) === String(value))
    );
  });
  await action();
  const response = await received;
  assert.equal(response.status(), 200);
  const body = await response.json();
  await page.waitForFunction(
    ({ size, id }) => {
      const rows = document.querySelectorAll(".dr-table tbody tr");
      return rows.length === size && (!id || rows[0]?.querySelector("a")?.href.includes(`user=${id}`));
    },
    { size: body.people.length, id: body.people[0]?.person.id }
  );
  await page.waitForFunction(() => !document.querySelector('.page-content [aria-busy="true"]'));
  assert.equal(await page.locator(".dr-table tbody tr").count(), body.people.length);
  return body;
}
try {
  const env = Object.fromEntries(
    (await readFile(".env.dev", "utf8"))
      .split(/\r?\n/)
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1).replace(/^(['"])(.*)\1$/, "$2")];
      })
  );
  const ready = await context.request.get(authBase + "/auth/get-csrf-token/");
  assert.equal(ready.status(), 200, "The local API must be ready before exercising login.");
  await page.goto(authBase + "/login");
  await page.locator('input[name="email"]').fill(env.DEV_ADMIN_EMAIL);
  await page.locator('input[name="password"]').fill(env.DEV_ADMIN_PASSWORD);
  await page.locator(".auth-submit").click();
  await page.locator(".app-shell").waitFor();
  const initial = await result(() => page.goto(base + "/daily-report/team"), { page: 1, filter: "all" });
  assert(initial.count > 10, "This acceptance fixture needs a team with more than ten members.");
  const first = await result(() => page.locator(".table-pagination-size select").selectOption("10"), {
    page: 1,
    page_size: 10,
    filter: "all",
  });
  assert.equal(first.people.length, 10);
  const second = await result(() => page.getByRole("button", { name: "صفحه بعد", exact: true }).click(), {
    page: 2,
    page_size: 10,
    filter: "all",
  });
  assert.deepEqual(second.summary, first.summary);
  assert(!second.people.some((row) => first.people.some((other) => row.person.id === other.person.id)));
  check("next page requests a new server slice without duplicate people or changing team summary");
  const filtered = await result(() => page.getByRole("tab", { name: "ثبت‌شده", exact: true }).click(), {
    page: 1,
    page_size: 10,
    filter: "submitted",
  });
  assert(filtered.people.every((row) => ["submitted", "late"].includes(row.status)));
  assert.equal(filtered.count, first.summary.submitted + first.summary.late);
  assert.deepEqual(filtered.summary, first.summary);
  check("status filtering runs on the server, resets the page and retains whole-team counts");
  // A recently visited page can be served from the query cache without a new request.
  await page.getByRole("tab", { name: "همه", exact: true }).click();
  await page.waitForFunction(
    (id) => document.querySelector(".dr-table tbody tr a")?.href.includes(`user=${id}`),
    first.people[0].person.id
  );
  const last = await result(() => page.getByRole("button", { name: "صفحه آخر", exact: true }).click(), {
    page: first.pages,
    page_size: 10,
  });
  assert.equal(last.page, last.pages);
  assert(await page.getByRole("button", { name: "صفحه بعد", exact: true }).isDisabled());
  check("last page displays the final slice and disables next");
  await page.getByRole("button", { name: "روز", exact: true }).click();
  const changedDay = await result(
    () => page.locator('.persian-calendar-grid button[aria-pressed="false"]').first().click(),
    { page: 1, page_size: 10, filter: "all" }
  );
  assert.notEqual(changedDay.date, last.date);
  check("changing the report date resets the page and fetches the chosen day");
  const large = await result(() => page.locator(".table-pagination-size select").selectOption("100"), {
    page: 1,
    page_size: 100,
  });
  assert.equal(large.people.length, Math.min(100, first.count));
  check("changing page size resets to page one and fetches the selected size");
  await page.screenshot({ path: resolve(output, "desktop.png") });
  await page.setViewportSize({ width: 375, height: 900 });
  await page.locator(".table-pagination-size select").selectOption("10");
  await page.waitForFunction(() => document.querySelectorAll(".dr-table tbody tr").length === 10);
  await page.screenshot({ path: resolve(output, "mobile.png") });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  check("mobile view keeps pagination inside the viewport");
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, "results.json"), JSON.stringify({ checks, errors }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
