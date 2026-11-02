import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TablePagination, pageWindow } from "./table-pagination";

describe("table pagination", () => {
  it("lists every page when there are only a few", () => {
    expect(pageWindow(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("keeps the first, last and neighbouring pages with gaps between", () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, null, 20]);
    expect(pageWindow(10, 20)).toEqual([1, null, 9, 10, 11, null, 20]);
    expect(pageWindow(20, 20)).toEqual([1, null, 19, 20]);
  });

  it("summarises the visible range and marks the current page", () => {
    const html = renderToStaticMarkup(
      <TablePagination page={2} pages={4} count={80} pageSize={25} onPage={vi.fn()} onPageSize={vi.fn()} label="کار" />
    );
    expect(html).toContain("۲۶");
    expect(html).toContain("۵۰");
    expect(html).toContain("۸۰");
    expect(html).toContain('aria-current="page"');
  });

  it("renders nothing for an empty table", () => {
    expect(
      renderToStaticMarkup(
        <TablePagination page={1} pages={1} count={0} pageSize={25} onPage={vi.fn()} onPageSize={vi.fn()} />
      )
    ).toBe("");
  });
});
