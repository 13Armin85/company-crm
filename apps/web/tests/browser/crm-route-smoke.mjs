/* Local route smoke test. Run from the repository root with the dev stack running.
 * Checks loaded pages, representative detail routes, browser errors and 375px layout.
 * Results and screenshots are written under tmp/crm-ui-audit.
 */
/* eslint-disable no-await-in-loop -- Navigation and checks share one browser page and must run in order. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(resolve(".cache/browser/node_modules/playwright/index.mjs")).href);

const config = Object.fromEntries(
  (await readFile(".env.dev", "utf8"))
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^(['"])(.*)\1$/, "$2")];
    })
);
const base = process.env.CRM_BROWSER_URL || "http://localhost:3000";
const output = resolve("tmp/crm-ui-audit");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "fa-IR" });
const page = await context.newPage();
page.setDefaultTimeout(45000);
page.setDefaultNavigationTimeout(180000);
const errors = [],
  failures = [],
  results = [];
let currentRoute = "login";
page.on("pageerror", (e) => errors.push({ route: currentRoute, error: e.message }));
page.on("response", (r) => {
  if (r.url().includes("/api/") && r.status() >= 500)
    failures.push({ route: currentRoute, status: r.status(), url: new URL(r.url()).pathname });
});
try {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${base}/login`, { signal: AbortSignal.timeout(3000) });
      if (response.ok) break;
    } catch {}
    if (attempt === 59) throw new Error("Local frontend did not become ready");
    await new Promise((done) => setTimeout(done, 1500));
  }
  await page.goto(`${base}/login`);
  await page.locator("input[name=email]").fill(config.DEV_ADMIN_EMAIL);
  await page.locator("input[name=password]").fill(config.DEV_ADMIN_PASSWORD);
  await page.locator(".auth-submit").click();
  await page.waitForURL((u) => u.pathname !== "/login");
  await page.locator(".app-shell").waitFor();

  const routes = process.env.CRM_AUDIT_QUICK
    ? ["/reports", "/daily-report", "/leave-requests", "/leave-templates"]
    : [
        "/",
        "/projects",
        "/issues",
        "/my-work",
        "/inbox",
        "/calendar",
        "/workflow-inbox",
        "/team",
        "/organization",
        "/roles",
        "/routing",
        "/help",
        "/absences",
        "/leave-requests",
        "/leave-templates",
        "/signatures",
        "/portal-settings",
        "/daily-report",
        "/daily-report/team",
        "/daily-report/settings",
        "/reports",
        "/reports/source/daily_reports",
        "/reports/source/daily_report_items",
        "/settings",
        "/settings/engine",
        "/entities",
      ];
  const dynamic = new Set();
  for (const route of routes) {
    currentRoute = route;
    try {
      await page.goto(base + route);
      await page.locator(".app-shell").waitFor();
      await page
        .locator(".page-content h1, .page-content .empty-state, .page-content .error-notice")
        .first()
        .waitFor({ state: "visible", timeout: 90000 });
      await page.waitForFunction(
        () => !document.querySelector(".page-content .skeleton-row, .page-content .skeleton-card"),
        {},
        { timeout: 90000 }
      );
      const snapshot = await page.evaluate(() => ({
        title: document.querySelector("h1")?.textContent?.trim(),
        scroll: document.documentElement.scrollWidth > innerWidth + 1,
        controls: document.querySelectorAll("main input,main textarea,main select").length,
        links: [...document.querySelectorAll("main a[href]")].map((a) => a.getAttribute("href")),
        alerts: [...document.querySelectorAll("[role=alert]")].map((e) => e.textContent?.trim()),
      }));
      for (const link of snapshot.links)
        if (/^\/(projects|team|roles|leave-requests|reports\/saved|entities)\/.+/.test(link)) dynamic.add(link);
      delete snapshot.links;
      await page.screenshot({ path: resolve(output, `${route.replaceAll("/", "_") || "home"}.png`), fullPage: true });
      results.push({ route, ...snapshot });
      process.stdout.write(`PAGE ${route}: ${JSON.stringify(snapshot)}\n`);
    } catch (e) {
      results.push({ route, error: e.message });
      process.stdout.write(`FAIL ${route}: ${e.message.slice(0, 250)}\n`);
    }
  }
  if (!process.env.CRM_AUDIT_QUICK) {
    // A representative real record for every dynamic route family.
    const covered = new Set();
    for (const route of dynamic) {
      const family = route
        .split("/")
        .slice(0, route.startsWith("/reports") ? 3 : 2)
        .join("/");
      if (covered.has(family)) continue;
      covered.add(family);
      currentRoute = route;
      try {
        await page.goto(base + route);
        await page.locator(".page-content h1").first().waitFor();
        await page.waitForFunction(
          () => !document.querySelector(".page-content .skeleton-row, .page-content .skeleton-card"),
          {},
          { timeout: 90000 }
        );
        results.push({ route, title: await page.locator("h1").first().textContent() });
      } catch (e) {
        results.push({ route, error: e.message });
      }
    }
  }
  // Open the actual input form, then inspect its mobile layout.
  currentRoute = "/leave-requests/new";
  await page.goto(`${base}/leave-requests`);
  await page.getByRole("button", { name: "درخواست تازه", exact: true }).click();
  await page.locator("#leave-reason").fill("بررسی تجربهٔ کاربری فرم مرخصی");
  await page.getByRole("radio", { name: "ساعتی", exact: true }).check();
  await page.locator("#leave-start-time").fill("10:00");
  await page.locator("#leave-end-time").fill("12:00");
  await page.waitForTimeout(1200);
  results.push({ route: currentRoute, duration: await page.locator(".leave-duration").textContent() });
  await page.screenshot({ path: resolve(output, "leave-form-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  for (const route of ["/leave-requests", "/daily-report", "/reports", "/reports/source/daily_report_items"]) {
    currentRoute = route;
    await page.goto(base + route);
    await page.locator(".page-content h1").first().waitFor();
    await page.waitForFunction(
      () => !document.querySelector(".page-content .skeleton-row, .page-content .skeleton-card"),
      {},
      { timeout: 90000 }
    );
    if (route === "/leave-requests") await page.getByRole("button", { name: "درخواست تازه", exact: true }).click();
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth > innerWidth + 1,
      offenders: [...document.querySelectorAll("main *")]
        .filter((e) => e.getBoundingClientRect().right > innerWidth + 4 && getComputedStyle(e).position !== "fixed")
        .slice(0, 8)
        .map((e) => e.className),
    }));
    results.push({ route, mobile: true, ...overflow });
    await page.screenshot({ path: resolve(output, `mobile${route.replaceAll("/", "_")}.png`), fullPage: true });
  }
} finally {
  await writeFile(resolve(output, "report.json"), JSON.stringify({ results, errors, failures }, null, 2));
  await browser.close();
}
if (errors.length || failures.length || results.some((result) => result.error || result.scroll)) {
  throw new Error("Browser checks failed; see tmp/crm-ui-audit/report.json");
}
