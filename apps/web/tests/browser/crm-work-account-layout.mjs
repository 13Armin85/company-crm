/* eslint-disable no-await-in-loop -- Viewport, search and account-status checks operate in order on the same browser page. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(resolve(".cache/browser/node_modules/playwright/index.mjs")).href);
const base = process.env.CRM_BROWSER_URL || "http://localhost:3005";
const authBase = process.env.CRM_BROWSER_AUTH_URL || "http://localhost:3000";
const output = resolve(process.env.CRM_BROWSER_OUTPUT || "tmp/ui-lists/after");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "fa-IR" });
if (process.env.CRM_BROWSER_SESSION) {
  const auth = JSON.parse(await readFile(process.env.CRM_BROWSER_SESSION, "utf8"));
  await context.addCookies([auth.cookie]);
}
const page = await context.newPage();
page.setDefaultTimeout(90000);
page.setDefaultNavigationTimeout(180000);
const errors = [],
  failures = [],
  checks = [];
let authenticated = Boolean(process.env.CRM_BROWSER_SESSION);
page.on("pageerror", (error) => errors.push(error.message));
page.on("response", (response) => {
  if (authenticated && response.status() >= 400 && !response.url().includes("favicon"))
    failures.push({ url: new URL(response.url()).pathname, status: response.status() });
});
const check = (name) => {
  checks.push(name);
  console.log("PASS", name);
};
async function noOverflow() {
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1, undefined, {
    timeout: 10000,
  });
}
async function aligned(table) {
  const result = await table.evaluate((tableElement) => {
    const headers = [...tableElement.querySelectorAll("thead th")].map((e) => e.getBoundingClientRect());
    return [...tableElement.querySelectorAll("tbody tr")].every((row) =>
      [...row.cells].every((cell, i) => {
        const box = cell.getBoundingClientRect(),
          header = headers[i];
        return (
          getComputedStyle(cell).display === "table-cell" &&
          Math.abs(box.x - header.x) < 2 &&
          Math.abs(box.width - header.width) < 2
        );
      })
    );
  });
  assert(result, "Table cells must align with headers, including actions");
}
async function navigate(path, table) {
  await page.goto(base + path);
  await page.locator(".page-content h1").waitFor();
  await page
    .locator(table + " tbody tr")
    .first()
    .waitFor();
  await page.waitForFunction(() => !document.querySelector(".page-content .skeleton-row"));
  await noOverflow();
  await aligned(page.locator(table));
}
try {
  if (!process.env.CRM_BROWSER_SESSION) {
    const env = Object.fromEntries(
      (await readFile(".env.dev", "utf8"))
        .split(/\r?\n/)
        .filter((l) => /^[A-Z_]+=/.test(l))
        .map((l) => {
          const at = l.indexOf("=");
          return [l.slice(0, at), l.slice(at + 1).replace(/^(['"])(.*)\1$/, "$2")];
        })
    );
    await page.goto(authBase + "/login");
    await page.locator('input[name="email"]').fill(env.DEV_ADMIN_EMAIL);
    await page.locator('input[name="password"]').fill(env.DEV_ADMIN_PASSWORD);
    await page.locator(".auth-submit").click();
    await page.locator(".app-shell").waitFor();
    authenticated = true;
  }
  for (const [path, name] of [
    ["/issues", "issues"],
    ["/my-work", "my-work"],
  ]) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await navigate(path, ".surface-work-table");
    await page.screenshot({ path: resolve(output, name + "-desktop.png") });
    check(name + " desktop rows align with readable titles and actions");
    for (const width of [1024, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await noOverflow();
      const table = page.locator(".surface-work-table");
      const columns = await table.locator("thead th").count();
      for (let i = 0; i < columns; i++)
        assert(
          await table
            .locator("thead th")
            .nth(i)
            .evaluate((e) => getComputedStyle(e).display !== "none")
        );
      await aligned(table);
      const scroll = page.locator(".horizontal-table-scroll").first();
      assert(await scroll.evaluate((e) => e.scrollWidth > e.clientWidth));
      await scroll.focus();
      await page.keyboard.press("ArrowLeft");
      assert(Math.abs(await scroll.evaluate((e) => e.scrollLeft)) > 0);
      await page.screenshot({ path: resolve(output, `${name}-${width}.png`) });
      check(`${name} at ${width}px keeps every chosen column and scrolls horizontally`);
    }
    if (path === "/issues") {
      await page.getByPlaceholder("جستجوی عنوان، شناسه یا فرستنده…").fill("هیچ کاری با این عنوان وجود ندارد ۹۸۷۶۵۴");
      await page.getByText("کاری پیدا نشد", { exact: true }).waitFor();
      assert.equal(await page.locator(".surface-work-table tbody tr").count(), 0);
      await page.getByPlaceholder("جستجوی عنوان، شناسه یا فرستنده…").fill("");
      await page.locator(".surface-work-table tbody tr").first().waitFor();
      check("task search updates results and recovers after clearing");
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await navigate("/portal-settings?section=accounts", ".portal-accounts-table");
  await page.screenshot({ path: resolve(output, "accounts-desktop.png") });
  check("customer account cells and action buttons align with all six headers");
  const firstUsername = await page.locator(".portal-account-username").first().innerText();
  const firstName = await page.locator(".portal-account-person strong").first().innerText();
  await page.getByPlaceholder("جستجوی نام، نام کاربری یا مشتری…").fill(firstUsername);
  assert.equal(await page.locator(".portal-accounts-table tbody tr").count(), 1);
  assert((await page.locator(".portal-accounts-table").innerText()).includes(firstName));
  await page.getByPlaceholder("جستجوی نام، نام کاربری یا مشتری…").fill("حسابی وجود ندارد ۹۸۷۶۵۴");
  await page.getByText("حسابی با این مشخصات پیدا نشد", { exact: true }).waitFor();
  await page.getByRole("button", { name: "پاک‌کردن فیلترها", exact: true }).click();
  await page.locator(".portal-accounts-table tbody tr").first().waitFor();
  check("customer account search finds usernames, handles empty results and clears filters");
  for (const status of ["active", "inactive", "pending", "locked"]) {
    await page.getByLabel("وضعیت حساب", { exact: true }).selectOption(status);
    await page.waitForFunction(
      (expectedStatus) =>
        [...document.querySelectorAll(".portal-account-status")].every((e) =>
          e.classList.contains("is-" + expectedStatus)
        ),
      status
    );
    const badges = page.locator(".portal-account-status");
    for (let i = 0; i < (await badges.count()); i++)
      assert((await badges.nth(i).getAttribute("class")).includes("is-" + status));
  }
  await page.getByLabel("وضعیت حساب", { exact: true }).selectOption("all");
  check("account status filters keep active, pending, locked and inactive results separate");
  await page.setViewportSize({ width: 375, height: 812 });
  await noOverflow();
  await aligned(page.locator(".portal-accounts-table"));
  await page.screenshot({ path: resolve(output, "accounts-mobile.png"), fullPage: true });
  const scroller = page.locator(".horizontal-table-scroll").first();
  await scroller.scrollIntoViewIfNeeded();
  await scroller.focus();
  await page.keyboard.press("ArrowLeft");
  assert(Math.abs(await scroller.evaluate((e) => e.scrollLeft)) > 0);
  await page.locator(".portal-account-create summary").click();
  await noOverflow();
  for (const input of await page.locator(".portal-admin-form input,.portal-admin-form select").all()) {
    const box = await input.boundingBox();
    assert(box && box.x >= 0 && box.x + box.width <= 376);
  }
  await page.locator(".portal-account-create").scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, "account-form-mobile.png"), fullPage: true });
  check("customer account table scrolls on mobile and creation fields fit the screen");
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
} catch (error) {
  await page.screenshot({ path: resolve(output, "failure.png"), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await writeFile(resolve(output, "report.json"), JSON.stringify({ checks, errors, failures }, null, 2));
  await browser.close();
}
