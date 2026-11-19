/* eslint-disable no-await-in-loop -- Viewport changes and assertions share one page and must run sequentially. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(resolve(".cache/browser/node_modules/playwright/index.mjs")).href);
const base = process.env.CRM_BROWSER_URL || "http://localhost:3005";
const authBase = process.env.CRM_BROWSER_AUTH_URL || "http://localhost:3000";
const entity = process.env.CRM_BROWSER_ENTITY || "customer";
const output = resolve(process.env.CRM_BROWSER_OUTPUT || "tmp/column-editor-browser");
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
const queryResponse = () =>
  page.waitForResponse((response) => new URL(response.url()).pathname.endsWith(`/entities/${entity}/query/`));
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
  const schemaResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith(`/entities/${entity}/view-schema/`)
  );
  const initialResponse = queryResponse();
  await page.goto(base + `/entities/${entity}`);
  await (await schemaResponse).json();
  assert.equal((await initialResponse).status(), 200);
  await page.getByRole("button", { name: "ستون‌ها و ترتیب", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const row = dialog.locator(".engine-column-row").first();
  await row.waitFor();
  await row.locator("summary").click();
  await row.locator('input[type="number"]').fill("240");
  await row.locator('input[type="number"]').blur();
  assert.equal(await row.locator('input[type="number"]').inputValue(), "240");
  check("column width remains editable inside its disclosure");
  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1);
    const bounds = await dialog
      .locator(".engine-column-editor")
      .evaluate((e) => ({ width: e.clientWidth, scroll: e.scrollWidth }));
    assert(bounds.scroll <= bounds.width + 1, JSON.stringify({ width, ...bounds }));
    const overlap = await row.evaluate((e) => {
      const name = e.querySelector(".engine-column-name").getBoundingClientRect();
      const actions = e.querySelector(".engine-column-actions").getBoundingClientRect();
      return (
        name.left < actions.right && name.right > actions.left && name.top < actions.bottom && name.bottom > actions.top
      );
    });
    assert(!overlap, "column title must not overlap action buttons");
    await page.screenshot({ path: resolve(output, `columns-${width}.png`) });
    check(`column controls fit at ${width}px without overlap or overflow`);
  }
  const before = await row.locator(".engine-column-name strong").textContent();
  await row.getByRole("button", { name: /به پایین/ }).click();
  assert.equal(
    await dialog.locator(".engine-column-row").nth(1).locator(".engine-column-name strong").textContent(),
    before
  );
  check("moving a column changes its actual order");
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, "results.json"), JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: resolve(output, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await context.close();
  await browser.close();
}
