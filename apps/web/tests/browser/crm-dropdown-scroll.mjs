import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";

const { chromium } = await import(pathToFileURL(resolve(".cache/browser/node_modules/playwright/index.mjs")).href);
const server = await createServer({
  root: resolve("apps/web/tests/browser/fixtures/dropdown-scroll"),
  configFile: false,
  server: { host: "127.0.0.1", port: 0 },
});

let browser;
try {
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  assert(url, "Vite fixture URL is unavailable");
  browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(url);
  const columnButton = page.getByRole("button", { name: "باز کردن افزودن ستون به گروه" });
  await columnButton.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => {
    window.scrollPositions = [];
    window.scrollIntoViewCalls = 0;
    window.addEventListener("scroll", () => window.scrollPositions.push(window.scrollY), true);
    const nativeScrollIntoView = Element.prototype.scrollIntoView;
    // eslint-disable-next-line no-extend-native -- the probe counts scroll calls inside the test page only.
    Element.prototype.scrollIntoView = function (...args) {
      window.scrollIntoViewCalls += 1;
      return nativeScrollIntoView.apply(this, args);
    };
    return window.scrollY;
  });
  assert(before > 500, "The designer fixture must be scrolled before testing");
  const assertStill = async (step) => {
    const current = await page.evaluate(() => window.scrollY);
    assert.equal(current, before, `Page scrolled after ${step}`);
  };
  const assertFullWidthOption = async () => {
    const widths = await page
      .getByRole("option")
      .first()
      .evaluate((element) => ({
        option: element.getBoundingClientRect().width,
        content: element.parentElement?.getBoundingClientRect().width,
      }));
    assert(widths.content, "Option container has no width");
    assert(Math.abs(widths.option - widths.content) <= 1, `Option does not fill menu: ${JSON.stringify(widths)}`);
  };

  await columnButton.click();
  await assertFullWidthOption();
  await assertStill("opening the column menu");
  await page.getByRole("combobox", { name: "افزودن ستون به گروه" }).fill("ستون 75");
  await assertFullWidthOption();
  await assertStill("searching the column menu");
  await page.getByRole("option", { name: "ستون 75" }).click();
  await assertStill("selecting a column");
  await page.getByRole("button", { name: "باز کردن روش اجرا" }).click();
  await assertStill("opening the mode menu");
  await page.waitForTimeout(250);
  await page.getByRole("option", { name: "فقط هشدار بده" }).click();
  await assertStill("selecting a mode");
  await page.getByRole("button", { name: /انتخاب نقش‌های مجاز/ }).click();
  await assertStill("opening the multi-select menu");
  await page.keyboard.press("Tab");
  assert(
    await page
      .getByRole("searchbox", { name: "جستجو در نقش‌های مجاز" })
      .evaluate((element) => element === document.activeElement),
    "Tab should focus the multi-select search field"
  );
  await page.getByRole("checkbox", { name: "مدیر" }).check();
  await assertStill("checking a multi-select option");
  await page.getByRole("combobox", { name: "افزودن ستون به گروه" }).fill("ناموجود");
  await page.getByText("نتیجه‌ای یافت نشد.").waitFor();

  const result = await page.evaluate(() => ({
    current: window.scrollY,
    positions: window.scrollPositions,
    scrollIntoViewCalls: window.scrollIntoViewCalls,
  }));
  assert.deepEqual(pageErrors, []);
  assert.equal(result.current, before);
  assert(
    result.positions.every((position) => Math.abs(position - before) <= 2),
    JSON.stringify(result.positions)
  );
  assert.equal(result.scrollIntoViewCalls, 0);
  console.log("PASS Designer dropdowns open, search, select, and show empty results without scrolling the page.");
} finally {
  await browser?.close();
  await server.close();
}
