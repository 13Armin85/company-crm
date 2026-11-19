import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(resolve(".cache/browser/node_modules/playwright/index.mjs")).href);
const base = process.env.CRM_BROWSER_URL || "http://localhost:3005";
const output = resolve(process.env.CRM_BROWSER_OUTPUT || "tmp/kanban-routing-browser");
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
  await page.getByRole("button", { name: "برد کانبان", exact: true }).click();
  const board = page.getByRole("region", { name: "برد کانبان کارها", exact: true });
  await board.waitFor();
  assert(await board.evaluate((e) => e.scrollWidth > e.clientWidth));
  await page.getByRole("button", { name: "→ ستون‌های سمت چپ", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".kanban-board").scrollLeft < -50);
  check("desktop navigation scrolls readable columns inside the board");
  await board.evaluate((e) => {
    e.scrollLeft = 0;
    e.scrollTop = 0;
  });
  await board.scrollIntoViewIfNeeded();
  const card = board.locator(".kanban-card:not(.is-locked)").first();
  await card.waitFor();
  const c = await card.boundingBox(),
    area = await board.boundingBox();
  await page.mouse.move(c.x + c.width / 2, c.y + 45);
  await page.mouse.down();
  await page.mouse.move(area.x + 12, Math.max(area.y + 60, Math.min(c.y + 45, area.y + area.height - 40)), {
    steps: 15,
  });
  await page.waitForFunction(() => document.querySelector(".kanban-board").scrollLeft < -80);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  check("dragging a card near the edge scrolls the board automatically and Escape cancels safely");
  await page.setViewportSize({ width: 375, height: 900 });
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1);
  const reachable = await board.evaluate((e) => {
    e.scrollLeft = -e.scrollWidth;
    const col = e.querySelector(".kanban-category:last-child .kanban-column:last-child").getBoundingClientRect();
    const b = e.getBoundingClientRect();
    return col.left >= b.left - 1 && col.right <= b.right + 1;
  });
  assert(reachable);
  await page.screenshot({ path: resolve(output, "kanban-mobile.png") });
  check("the last column is reachable on mobile without page overflow");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base + "/routing");
  await page.getByRole("button", { name: "قاعدهٔ جدید", exact: true }).click();
  const dialog = page.getByRole("dialog");
  assert.equal(await dialog.locator("form > header").evaluate((e) => getComputedStyle(e).display), "block");
  assert(!(await dialog.locator(".routing-extra").evaluate((e) => e.open)));
  await dialog.getByRole("button", { name: "ذخیره قاعده", exact: true }).click();
  assert(await dialog.getByRole("alert").isVisible());
  await dialog.getByRole("button", { name: "باز کردن روش انتخاب مقصد", exact: true }).click();
  await page.getByRole("option", { name: "فرد ثابت", exact: true }).click();
  assert.equal(await dialog.getByRole("combobox", { name: "نقش لازم", exact: true }).count(), 0);
  assert.equal(await dialog.getByRole("combobox", { name: "واحد اعضا", exact: true }).count(), 0);
  await dialog.getByRole("button", { name: "باز کردن فرد ثابت", exact: true }).click();
  await page.getByRole("option").first().click();
  await dialog.getByLabel("نام قاعده", { exact: true }).fill("آزمون فرم ارجاع " + Date.now());
  await dialog.getByRole("checkbox", { name: "قاعده فعال باشد", exact: true }).uncheck();
  await page.setViewportSize({ width: 375, height: 900 });
  await page.waitForFunction(() => {
    const form = document.querySelector(".routing-rule-editor");
    return form && form.scrollWidth <= form.clientWidth + 1;
  });
  await page.screenshot({ path: resolve(output, "routing-mobile.png") });
  const saved = page.waitForResponse(
    (r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/organization/routing-rules/")
  );
  await dialog.getByRole("button", { name: "ذخیره قاعده", exact: true }).click();
  const response = await saved;
  assert.equal(response.status(), 201);
  const row = await response.json();
  assert.equal(row.method, "user");
  assert.equal(row.is_active, false);
  assert.equal(row.unit_id, null);
  assert.equal(row.required_role_id, null);
  assert.deepEqual(row.member_ids, []);
  const deleted = await page.evaluate(
    async (url) => {
      const csrf = await fetch("/auth/get-csrf-token/").then((r) => r.json());
      return (await fetch(url, { method: "DELETE", headers: { "X-CSRFTOKEN": csrf.csrf_token } })).status;
    },
    response.url() + row.id + "/"
  );
  assert.equal(deleted, 204);
  check("the simple form validates required fields and saves an inactive test rule with only its relevant destination");
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, "results.json"), JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: resolve(output, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await context.close();
  await browser.close();
}
