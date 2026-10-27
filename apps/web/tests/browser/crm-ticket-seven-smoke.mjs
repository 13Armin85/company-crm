/* Browser smoke check for the Docker dashboard, with screenshot evidence. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(resolve(".cache/browser/node_modules/playwright/index.mjs")).href);
const env = Object.fromEntries((await readFile(".env.dev", "utf8")).split(/\r?\n/).filter((line) => /^[A-Z_]+=/.test(line)).map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1).replace(/^(['"])(.*)\1$/, "$2")]; }));
const base = process.env.CRM_BROWSER_URL || "http://localhost:3000";
const output = resolve("tmp/ticket-7-evidence");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const errors = [];
const failures = [];
const requests = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("response", async (response) => { if (response.url().includes("dashboard")) { const item = { method: response.request().method(), url: response.url(), status: response.status(), body: (await response.text()).slice(0, 2000) }; requests.push(item); if (response.status() >= 400) failures.push(item); } });
try {
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(env.DEV_ADMIN_EMAIL);
  await page.locator('input[name="password"]').fill(env.DEV_ADMIN_PASSWORD);
  await page.locator(".auth-submit").click();
  await page.waitForURL((url) => url.pathname !== "/login");
  await page.locator(".custom-dashboard").waitFor();
  await page.screenshot({ path: resolve(output, "dashboard-initial.png"), fullPage: true });
  await page.locator(".dashboard-actions button").last().click();
  const name = `Dashboard test ${Date.now().toString(36)}`;
  await page.locator('input[aria-label="\u0646\u0627\u0645 \u062a\u0628 \u062c\u062f\u06cc\u062f"]').fill(name);
  await page.locator('button[aria-label="\u0633\u0627\u062e\u062a \u062a\u0628"]').click();
  await page.locator(".dashboard-editbar button").click();
  await page.locator(".dashboard-gallery button").first().click();
  await page.locator(".dashboard-overlay .dashboard-drawer > header button").last().click();
  requests.push({ beforeSaveButtons: await page.locator(".dashboard-actions button").allTextContents(), draftTabs: await page.locator(".dashboard-tab button[role=tab]").allTextContents() });
  const [saved] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === "PUT" && response.url().endsWith("/dashboard/")),
    page.locator(".dashboard-actions button").last().click(),
  ]);
  assert.equal(saved.status(), 200, await saved.text());
  await page.locator(".dashboard-editbar").waitFor({ state: "hidden" });
  await page.locator(".dashboard-tab.active").filter({ hasText: name }).waitFor();
  await page.screenshot({ path: resolve(output, "dashboard-before-reload.png"), fullPage: true });
  await page.reload();
  await page.locator(".dashboard-tab").filter({ hasText: name }).click();
  await page.locator(".dashboard-counter").waitFor();
  await page.screenshot({ path: resolve(output, "dashboard-persisted.png"), fullPage: true });
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.equal(failures.length, 0, JSON.stringify(failures));
  await writeFile(resolve(output, "smoke.json"), JSON.stringify({ passed: true, tab: name, screenshots: ["dashboard-initial.png", "dashboard-persisted.png"] }, null, 2));
  process.stdout.write("Dashboard browser smoke passed.\n");
} catch (error) {
  await page.screenshot({ path: resolve(output, "dashboard-failure.png"), fullPage: true }).catch(() => {});
  await writeFile(resolve(output, "smoke.json"), JSON.stringify({ passed: false, error: String(error), errors, failures, requests }, null, 2));
  throw error;
} finally { await browser.close(); }
