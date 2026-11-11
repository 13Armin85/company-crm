/* Browser check for the published absence form. The test only reads data. */
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
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
const evidence = resolve("tmp/absence-form-redesign");
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.setDefaultTimeout(30000);

try {
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(env.DEV_ADMIN_EMAIL);
  await page.locator('input[name="password"]').fill(env.DEV_ADMIN_PASSWORD);
  await page.locator('.auth-card button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname !== "/login");
  await page.goto(`${base}/absences`);
  await page.getByRole("button", { name: "ثبت عدم حضور", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator(".schema-field").first().waitFor();
  const fields = await dialog.locator(".schema-field").evaluateAll((nodes) =>
    nodes.map((node) => ({ code: node.getAttribute("data-field"), label: node.querySelector("label")?.textContent }))
  );
  console.log(JSON.stringify({ fields }));
  for (const width of [1280, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator(".access-modal:visible").waitFor();
    await page.screenshot({ path: resolve(evidence, `dialog-${width}.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2), false);
  }
  assert.deepEqual(errors, []);
  console.log("PASS absence form opens at 390, 768 and 1280px without page overflow");
} finally {
  await browser.close();
}
