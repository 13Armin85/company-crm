/* eslint-disable no-await-in-loop -- Each viewport is measured after resizing the same browser page. */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(resolve(".cache/browser/node_modules/playwright/index.mjs")).href);
const browser = await chromium.launch({
  executablePath: process.env.CRM_BROWSER_EXECUTABLE ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});

try {
  const page = await browser.newPage();
  for (const width of [1440, 900, 520, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(`
      <style>
        :root { --surface: white; --surface-soft: #f8fafc; --border: #cbd5e1; --accent: #2563eb;
          --text-primary: #0f172a; --text-secondary: #334155; --text-muted: #64748b;
          --engine-designer-border: #cbd5e1; --radius-sm: 6px; --radius-md: 10px;
          --radius-lg: 14px; --shadow: none; --fs-xs: 12px; --fs-md: 16px; --fs-lg: 18px; }
        body { margin: 0; font-family: sans-serif; direction: rtl; }
        .engine-workspace-main { width: min(100%, 1000px); margin: auto; }
      </style>
      <div class="engine-workspace-main"><div class="engine-designer-columns">
        <aside class="engine-library"><div class="engine-library-list"><button class="engine-library-field">
          <span>عنوان بسیار طولانی ورودی آماده برای اطلاعات تکمیلی درخواست سازمانی و مشخصات مسئول پیگیری</span>
          <small>افزودن به فرم</small><b>＋</b>
        </button></div></aside>
        <main class="engine-design-canvas"><div class="engine-design-section">
          <div class="engine-drag-item"><button class="engine-drag-handle">☰</button>
            <button class="engine-binding"><span class="engine-binding-label">عنوان بسیار طولانی ورودی چیدمان فرم برای اطلاعات تکمیلی درخواست سازمانی و مشخصات مسئول پیگیری</span></button>
            <button>↑</button><button>↓</button><button>×</button>
          </div>
        </div></main><aside class="engine-binding-settings"></aside>
      </div></div>`);
    await page.addStyleTag({ path: resolve("apps/web/styles/engine.css") });
    const result = await page.evaluate(() => {
      const library = document.querySelector(".engine-library-field");
      const libraryTitle = library.querySelector("span");
      const binding = document.querySelector(".engine-binding");
      const bindingTitle = binding.querySelector(".engine-binding-label");
      // This helper must remain inside page.evaluate so it runs in the browser context.
      // eslint-disable-next-line unicorn/consistent-function-scoping
      const fits = (title, parent) => {
        const text = document.createRange();
        text.selectNodeContents(title);
        const right = Math.max(...Array.from(text.getClientRects(), (rect) => rect.right));
        const left = Math.min(...Array.from(text.getClientRects(), (rect) => rect.left));
        const bounds = parent.getBoundingClientRect();
        return left >= bounds.left - 1 && right <= bounds.right + 1;
      };
      return {
        library: fits(libraryTitle, library),
        binding: fits(bindingTitle, binding),
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
      };
    });
    assert(result.library, `ready input title is clipped at ${width}px`);
    assert(result.binding, `form layout title is clipped at ${width}px`);
    assert(!result.overflow, `designer overflows the page at ${width}px`);
    if (process.env.CRM_FORM_SCREENSHOT && width === 375)
      await page.screenshot({ path: process.env.CRM_FORM_SCREENSHOT, fullPage: true });
  }
  console.log("PASS: form designer titles remain readable from 320px to 1440px");
} finally {
  await browser.close();
}
