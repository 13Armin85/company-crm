/* eslint-disable no-await-in-loop -- Each viewport measures the same authenticated page. */
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
const output = resolve(".cache/breadcrumb-responsive");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1920, height: 900 } });
page.setDefaultTimeout(60000);
page.setDefaultNavigationTimeout(120000);
const measurements = [];
try {
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(env.DEV_ADMIN_EMAIL);
  await page.locator('input[name="password"]').fill(env.DEV_ADMIN_PASSWORD);
  await page.locator('.auth-card button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname !== "/login");
  await page.locator(".app-shell").waitFor();
  const roleListResponse = await page.request.get(`${base}/api/workspaces/${slug}/organization/roles/`);
  assert(roleListResponse.ok(), `Role list status ${roleListResponse.status()}`);
  const data = await roleListResponse.json();
  const roles = Array.isArray(data) ? data : data.results;
  console.log("Authenticated; testing existing role navigation");
  assert(roles?.length, "This read-only test requires an existing role");
  const role = roles[0];
  await page.goto(`${base}/roles/${encodeURIComponent(role.id)}/permissions`);
  await page.waitForFunction((name) => document.querySelector(".breadcrumb")?.textContent.includes(name), role.name);
  // Exercise a long database title without writing to the database.
  const longName = "نقش سازمانی پشتیبانی و مدیریت درخواست‌های مشتریان با عنوان بسیار طولانی";
  await page.route(`**/api/workspaces/${slug}/organization/roles/${role.id}/`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), name: longName } });
  });
  await page.reload();
  await page.waitForFunction((name) => document.querySelector(".breadcrumb")?.textContent.includes(name), longName);
  await page.evaluate(() => document.fonts.ready);
  const widths = [280, 320, 360, 390, 480, 640, 760, 768, 980, 1024, 1180, 1200, 1280, 1440, 1441, 1536, 1920, 2560];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    // Allow the existing sidebar margin transition and ResizeObserver to settle.
    await page.waitForTimeout(400);
    const result = await page.locator(".breadcrumb").evaluate((nav) => {
      const box = nav.getBoundingClientRect();
      const header = nav.closest("header").getBoundingClientRect();
      const items = Array.from(nav.querySelectorAll("li"), (item) => item.getBoundingClientRect());
      const current = nav.querySelector('[aria-current="page"]').getBoundingClientRect();
      const actions = document.querySelector(".shell-header-actions").getBoundingClientRect();
      const start = document.querySelector(".shell-header-start").getBoundingClientRect();
      return {
        width: innerWidth,
        visible: box.width > 0 && box.height > 0,
        singleLine: items.every((item) => Math.abs(item.top - items[0].top) <= 1),
        currentVisible: current.left >= box.left - 2 && current.right <= box.right + 2,
        insideHeader: box.left >= header.left - 1 && box.right <= header.right + 1 && box.bottom <= header.bottom + 1,
        actionsInsideHeader: actions.left >= header.left - 1 && actions.right <= header.right + 1,
        actionsSeparate: start.left >= actions.right - 1,
        insideViewport: header.left >= -1 && header.right <= innerWidth + 1,
        scrollable: nav.scrollWidth > nav.clientWidth,
      };
    });
    assert(result.visible, `Hidden breadcrumb at ${width}px`);
    assert(result.singleLine, `Wrapped breadcrumb at ${width}px`);
    assert(result.currentVisible, `Current page clipped at ${width}px`);
    assert(result.insideHeader && result.insideViewport, `Header overflow at ${width}px`);
    assert(result.actionsInsideHeader, `Header actions overflow at ${width}px`);
    assert(result.actionsSeparate, `Header controls overlap at ${width}px`);
    const homeVisible = await page.locator(".breadcrumb").evaluate((nav) => {
      nav.scrollLeft = 0;
      const box = nav.getBoundingClientRect();
      const home = nav.querySelector("li").getBoundingClientRect();
      return home.left >= box.left - 2 && home.right <= box.right + 2;
    });
    assert(homeVisible, `Cannot reach home at ${width}px`);
    await page.locator(".breadcrumb").evaluate((nav) => {
      nav.scrollLeft = -nav.scrollWidth;
    });
    if ([320, 768, 1440, 1920].includes(width)) {
      await page.locator(".shell-header").screenshot({ path: resolve(output, `${width}.png`) });
    }
    measurements.push(result);
  }
  await writeFile(resolve(output, "report.json"), JSON.stringify(measurements, null, 2));
  console.log(
    `PASS: single-line breadcrumb, current page, scrolling and header bounds at ${widths.length} viewport widths`
  );
} finally {
  await browser.close();
}
