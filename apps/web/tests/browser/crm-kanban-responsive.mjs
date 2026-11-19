/* eslint-disable no-await-in-loop -- Responsive checks resize the same browser page sequentially. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(resolve(".cache/browser/node_modules/playwright/index.mjs")).href);
const base = process.env.CRM_BROWSER_URL || "http://localhost:3005";
const output = resolve(process.env.CRM_BROWSER_OUTPUT || "tmp/kanban-responsive-browser");
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
    await context.addCookies([JSON.parse(await readFile(process.env.CRM_BROWSER_SESSION, "utf8")).cookie]);
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
    await page.goto("http://localhost:3000/login");
    await page.locator('input[name="email"]').fill(env.DEV_ADMIN_EMAIL);
    await page.locator('input[name="password"]').fill(env.DEV_ADMIN_PASSWORD);
    await page.locator(".auth-submit").click();
    await page.locator(".app-shell").waitFor();
  }
  await page.goto(base + "/issues");
  await page.locator(".view-switcher button").last().click();
  const board = page.locator(".kanban-board");
  await board.waitFor();
  for (const width of [1440, 1024, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1);
    const metrics = await board.evaluate((e) => {
      const b = e.getBoundingClientRect();
      return {
        width: e.clientWidth,
        scroll: e.scrollWidth,
        columns: [...e.querySelectorAll(".kanban-column")].map((c) => {
          const r = c.getBoundingClientRect();
          return {
            left: r.left,
            right: r.right,
            width: r.width,
            inside: r.left >= b.left - 1 && r.right <= b.right + 1,
          };
        }),
      };
    });
    assert.equal(metrics.columns.length, 5);
    assert(metrics.scroll <= metrics.width + 1, JSON.stringify(metrics));
    assert(
      metrics.columns.every((c) => c.inside && c.width > 150),
      JSON.stringify(metrics)
    );
    await page.screenshot({ path: resolve(output, `board-${width}.png`) });
    check(`all five columns fit without horizontal scrolling at ${width}px`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const card = board.locator(".kanban-card:not(.is-locked)").first();
  await card.scrollIntoViewIfNeeded();
  const source = await card.locator("xpath=ancestor::section[1]").getAttribute("data-status");
  const destination = await board
    .locator(".kanban-column")
    .evaluateAll(
      (cols, sourceStatus) =>
        cols.find((c) => c.getAttribute("data-status") !== sourceStatus).getAttribute("data-status"),
      source
    );
  const drop = board.locator(`[data-status="${destination}"]`);
  let mutation = null;
  await page.route("**/api/**", async (route) => {
    if (route.request().method() === "PATCH") {
      mutation = { url: route.request().url(), body: route.request().postDataJSON() };
      await route.abort();
    } else await route.continue();
  });
  const c = await card.boundingBox(),
    d = await drop.boundingBox();
  await page.mouse.move(c.x + c.width / 2, c.y + 40);
  await page.mouse.down();
  await page.mouse.move(d.x + d.width / 2, d.y + 75, { steps: 20 });
  await page.waitForFunction(() => !!document.querySelector(".kanban-column.is-over"));
  assert.equal(await board.locator(".is-over").getAttribute("data-status"), destination);
  await page.mouse.up();
  await page.waitForTimeout(1000);
  assert(mutation, "drop must send a status update");
  const statusValues = {
    Todo: "todo",
    "In Progress": "in_progress",
    Review: "review",
    Done: "done",
    Blocked: "blocked",
  };
  assert.equal(mutation.body.status, statusValues[destination]);
  check("the highlighted destination matches the dropped column and sends a status update");
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, "results.json"), JSON.stringify({ checks, errors, mutation }, null, 2));
} catch (error) {
  await page.screenshot({ path: resolve(output, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await context.close();
  await browser.close();
}
