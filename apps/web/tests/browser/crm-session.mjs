/* eslint-disable no-await-in-loop -- Browser steps depend on the preceding interaction and viewport. */
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(
  pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE ?? ".cache/browser/node_modules/playwright/index.mjs")).href
);
const base = process.env.CRM_BROWSER_URL ?? "http://127.0.0.1:3000";
const canonical = process.env.CRM_BROWSER_CANONICAL_URL ?? "http://localhost:3000";
const output = resolve(process.env.CRM_BROWSER_OUTPUT ?? "tmp/crm-session-browser");
const settings = Object.fromEntries(
  (await readFile(".env.dev", "utf8"))
    .split(/\r?\n/)
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1).replace(/^(['"])(.*)\1$/, "$2")];
    })
);
assert(settings.DEV_ADMIN_EMAIL && settings.DEV_ADMIN_PASSWORD, "Local development credentials are required");

const redirect = await fetch(base + "/projects?view=calendar", { redirect: "manual" });
assert.equal(redirect.status, 302);
assert.equal(redirect.headers.get("location"), canonical + "/projects?view=calendar");

const checks = ["Loopback alias redirects before authentication and preserves the path/query"];
const errors = [];
const browser = await chromium.launch({
  executablePath: process.env.CRM_BROWSER_EXECUTABLE ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
try {
  for (const withoutAbortAny of [false, true]) {
    const mode = withoutAbortAny ? "fallback cancellation" : "native cancellation";
    const context = await browser.newContext();
    if (withoutAbortAny)
      await context.addInitScript(() =>
        Object.defineProperty(AbortSignal, "any", { value: undefined, configurable: true })
      );
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(120000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.url().startsWith(canonical) && response.status() >= 500)
        errors.push(`${response.status()} ${new URL(response.url()).pathname}`);
    });
    await page.goto(base + "/projects", { waitUntil: "domcontentloaded" });
    await page.waitForURL(canonical + "/login");
    await page.locator('.auth-card button[type="submit"]:enabled').waitFor();
    assert.equal(await page.locator(".app-shell").count(), 0);
    checks.push(`${mode}: unauthenticated alias URL reaches the canonical login form`);

    await page.locator('input[name="email"]').fill(settings.DEV_ADMIN_EMAIL);
    await page.locator('input[name="password"]').fill(settings.DEV_ADMIN_PASSWORD);
    await page.locator('.auth-card button[type="submit"]').click();
    await page.locator(".app-shell").waitFor({ state: "visible" });
    await page.goto(base + "/projects", { waitUntil: "domcontentloaded" });
    await page.locator(".app-shell").waitFor({ state: "visible" });
    assert.equal(new URL(page.url()).origin, canonical);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".app-shell").waitFor({ state: "visible" });
    checks.push(`${mode}: login and reload preserve the real server session`);

    const sessionRoute = /\/api\/users\/me\/$/;
    await context.route(sessionRoute, (route) => route.abort("failed"));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByRole("alert").filter({ hasText: "تأیید نشست انجام نشد" }).waitFor();
    assert.equal(await page.locator(".app-shell").isVisible(), false);
    await context.unroute(sessionRoute);
    await page.getByRole("button", { name: "تلاش دوباره", exact: true }).click();
    await page.locator(".app-shell").waitFor({ state: "visible" });
    checks.push(`${mode}: failed verification hides private content and retry recovers`);

    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await page.locator(".app-shell").waitFor({ state: "visible" });
    checks.push(`${mode}: a restored page verifies the session before revealing content`);

    const status = await page.evaluate(async () => {
      const csrf = await (await fetch("/auth/get-csrf-token/")).json();
      const response = await fetch("/auth/sign-out/", {
        method: "POST",
        headers: { "X-CSRFTOKEN": csrf.csrf_token },
        credentials: "include",
      });
      return response.status;
    });
    assert.equal(status, 200);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForURL(canonical + "/login");
    await page.locator('.auth-card button[type="submit"]:enabled').waitFor();
    assert.equal(await page.locator(".app-shell").count(), 0);
    await page.goto(base + "/calendar", { waitUntil: "domcontentloaded" });
    await page.waitForURL(canonical + "/login");
    checks.push(`${mode}: expired server session redirects to login and denies private navigation`);
    await context.close();
    console.log(`Passed browser session checks with ${mode}`);
  }
  assert.deepEqual(errors, []);
  await mkdir(output, { recursive: true });
  const result = { passed: checks.length, checks, errors };
  await writeFile(resolve(output, "report.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
