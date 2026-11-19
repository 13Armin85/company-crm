/* eslint-disable no-await-in-loop -- Viewport changes and assertions share one page and must run sequentially. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(resolve(".cache/browser/node_modules/playwright/index.mjs")).href);
const base = process.env.CRM_BROWSER_URL || "http://localhost:3005";
const authBase = process.env.CRM_BROWSER_AUTH_URL || "http://localhost:3000";
const output = resolve(process.env.CRM_BROWSER_OUTPUT || "tmp/personal-table-browser");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "fa-IR" });
const page = await context.newPage();
page.setDefaultTimeout(90000);
page.setDefaultNavigationTimeout(180000);
const checks = [],
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const check = (name) => {
  checks.push(name);
  console.log("PASS", name);
};
try {
  if (process.env.CRM_BROWSER_SESSION) {
    const auth = JSON.parse(await readFile(process.env.CRM_BROWSER_SESSION, "utf8"));
    await context.addCookies([auth.cookie]);
    const team = await context.request.get(
      `${base}/api/workspaces/${auth.workspace}/daily-reports/team/?page=1&page_size=10`
    );
    assert.equal(team.status(), 200);
    const first = await team.json();
    assert.equal(first.page_size, 10);
    assert.equal(first.people.length, Math.min(first.count, 10));
    assert.equal(
      first.count,
      Object.values(first.summary).reduce((sum, count) => sum + count, 0)
    );
    if (first.count > 10) {
      const second = await context.request.get(
        `${base}/api/workspaces/${auth.workspace}/daily-reports/team/?page=2&page_size=10`
      );
      assert.equal(second.status(), 200);
      const next = await second.json();
      assert.equal(next.page, 2);
      assert(!next.people.some((row) => first.people.some((other) => row.person.id === other.person.id)));
    }
    check("published team daily-report API remains compatible with the new web release");
  } else {
    const env = Object.fromEntries(
      (await readFile(".env.dev", "utf8"))
        .split(/\r?\n/)
        .filter((line) => /^[A-Z_]+=/.test(line))
        .map((line) => {
          const at = line.indexOf("=");
          return [line.slice(0, at), line.slice(at + 1).replace(/^(['"])(.*)\1$/, "$2")];
        })
    );
    assert.equal((await context.request.get(authBase + "/auth/get-csrf-token/")).status(), 200);
    await page.goto(authBase + "/login");
    await page.locator('input[name="email"]').fill(env.DEV_ADMIN_EMAIL);
    await page.locator('input[name="password"]').fill(env.DEV_ADMIN_PASSWORD);
    await page.locator(".auth-submit").click();
    await page.locator(".app-shell").waitFor();
  }
  await page.goto(base + "/issues");
  const entry = page.locator('a.surface-table-action[href*="layout=table"]').first();
  await entry.waitFor();
  const href = await entry.getAttribute("href");
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname.endsWith("/query/") && r.request().method() === "POST"
  );
  await entry.click();
  await page.waitForURL(base + href);
  const result = await response;
  assert.equal(result.status(), 200);
  assert.equal(result.request().postDataJSON().definition.type, "table");
  await page.getByRole("grid").waitFor();
  assert.equal(await page.locator(".surface-work-table").count(), 0);
  assert.equal(await page.locator(".surface-table-wrap .engine-view-controls").count(), 0);
  assert.equal(await page.locator(".engine-view-controls").count(), 1);
  check("My Table opens a standalone table page and loads server records without nesting the old page");
  await page.reload();
  await page.getByRole("grid").waitFor();
  check("refresh keeps the standalone table route and renderer");
  await page.setViewportSize({ width: 375, height: 900 });
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1);
  await page.screenshot({ path: resolve(output, "mobile.png") });
  check("the independent table stays inside the mobile viewport");
  await page.goBack();
  await page.locator(".surface-work-table").waitFor();
  assert.equal(await page.locator(".engine-view-controls").count(), 0);
  check("browser back restores the original task table");
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, "results.json"), JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: resolve(output, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await context.close();
  await browser.close();
}
