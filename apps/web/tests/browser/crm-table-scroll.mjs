/* eslint-disable no-await-in-loop -- Viewport changes and assertions share one page and must run sequentially. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(resolve(".cache/browser/node_modules/playwright/index.mjs")).href);
const base = process.env.CRM_BROWSER_URL || "http://localhost:3005";
const authBase = process.env.CRM_BROWSER_AUTH_URL || "http://localhost:3000";
const output = resolve(process.env.CRM_BROWSER_OUTPUT || "tmp/table-scroll-browser");
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
  for (const path of ["/daily-report/team", "/issues"]) {
    await page.goto(base + path);
    await page.setViewportSize({ width: 375, height: 900 });
    const area = page.locator(".horizontal-table-scroll[data-overflow]").first();
    await area.waitFor({ timeout: 60000 });
    await area.scrollIntoViewIfNeeded();
    const result = await area.evaluate((e) => {
      e.scrollLeft = 0;
      e.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerId: 1,
          pointerType: "mouse",
          button: 0,
          buttons: 1,
          clientX: 200,
        })
      );
      e.scrollLeft = -100;
      const nativePosition = e.scrollLeft;
      e.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, pointerId: 1, pointerType: "mouse", buttons: 1, clientX: 150 })
      );
      const afterMove = e.scrollLeft;
      e.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, pointerType: "mouse", buttons: 0 }));
      return { nativePosition, afterMove };
    });
    assert(result.nativePosition < 0, "fixture must scroll in RTL");
    assert.equal(
      result.afterMove,
      result.nativePosition,
      "table drag must not interfere with native scrollbar movement"
    );
    check(`${path}: native scrollbar position survives pointer movement and release`);
    const box = await area.boundingBox();
    await area.evaluate((e) => (e.scrollLeft = -Math.min(200, e.scrollWidth - e.clientWidth)));
    const before = await area.evaluate((e) => e.scrollLeft);
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 80));
    await page.mouse.move(5, 5);
    await page.waitForTimeout(250);
    assert.equal(await area.evaluate((e) => e.scrollLeft), before);
    await area.evaluate((e) => (e.scrollLeft = 0));
    assert.equal(await area.evaluate((e) => e.scrollLeft), 0);
    check(`${path}: mouse leave preserves position and the right edge remains reachable`);
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, "results.json"), JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  console.error(JSON.stringify(errors));
  await page.screenshot({ path: resolve(output, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await context.close();
  await browser.close();
}
