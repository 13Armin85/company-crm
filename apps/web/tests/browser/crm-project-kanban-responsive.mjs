/* eslint-disable no-await-in-loop -- Each viewport is measured after resizing the same page. */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(resolve(".cache/browser/node_modules/playwright/index.mjs")).href);
const assets = resolve("apps/web/build/client/assets");
const files = await readdir(assets);
const css = await Promise.all(
  ["index-", "workspace-"].map(async (prefix) => {
    const name = files.find((file) => file.startsWith(prefix) && file.endsWith(".css"));
    assert(name, `Missing ${prefix} stylesheet`);
    return readFile(resolve(assets, name), "utf8");
  })
);
const columns = (count) =>
  `<div class="kanban-category"><h2 class="kanban-category-title">گروه</h2><div class="kanban-category-columns">${Array.from(
    { length: count },
    (_, index) =>
      `<section class="kanban-column"><header><span>وضعیت ${index + 1}</span></header><div><article class="kanban-card"><h3>کار نمونه</h3></article></div></section>`
  ).join("")}</div></div>`;
const boardMarkup = (count) => `<div class="kanban-board kanban-board-grouped">${columns(count)}</div>`;
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});

try {
  const page = await browser.newPage();
  await page.setContent(
    `<!doctype html><html dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.join("\n")}</style><style>body{min-width:320px}.page-content{padding:24px 28px}.page-content>*{max-width:1600px;margin-inline:auto}</style></head><body><main class="page-content"><section class="panel work-list-panel" data-board="all">${boardMarkup(5)}</section><section class="panel work-list-panel" data-board="project">${boardMarkup(8)}</section><section class="panel my-work-content" data-board="mine">${boardMarkup(5)}</section></main></body></html>`
  );

  for (const width of [1440, 1024, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const metrics = await page.evaluate(() => ({
      pageWidth: document.documentElement.scrollWidth,
      viewport: innerWidth,
      boards: [...document.querySelectorAll("[data-board]")].map((section) => {
        const board = section.querySelector(".kanban-board");
        const bounds = board.getBoundingClientRect();
        return {
          name: section.dataset.board,
          width: board.clientWidth,
          scrollWidth: board.scrollWidth,
          display: getComputedStyle(board).display,
          columns: [...board.querySelectorAll(".kanban-column")].map((column) => {
            const rect = column.getBoundingClientRect();
            return { width: rect.width, inside: rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 };
          }),
        };
      }),
    }));
    assert(metrics.pageWidth <= metrics.viewport + 1, JSON.stringify(metrics));
    for (const boardMetrics of metrics.boards) {
      assert.equal(boardMetrics.display, "grid", JSON.stringify(metrics));
      assert(boardMetrics.scrollWidth <= boardMetrics.width + 1, JSON.stringify(metrics));
      assert(
        boardMetrics.columns.every((column) => column.inside && column.width >= 180),
        JSON.stringify(metrics)
      );
    }
    assert.equal(metrics.boards[1].columns.length, 8);
    console.log(`PASS all Kanban boards fit at ${width}px`);
  }
} finally {
  await browser.close();
}
