import { useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { PAGE_SIZES } from "./table-query";
import { toFa } from "./utils";

/** Page numbers around the current page, with gaps marked by null. */
export function pageWindow(page: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);
  const around = [page - 1, page, page + 1].filter((value) => value > 1 && value < pages);
  const list: (number | null)[] = [1];
  if (around[0] > 2) list.push(null);
  list.push(...around);
  if (around[around.length - 1] < pages - 1) list.push(null);
  list.push(pages);
  return list;
}

export function TablePagination({
  page,
  pages,
  count,
  pageSize,
  onPage,
  onPageSize,
  loading = false,
  label = "ردیف",
}: {
  page: number;
  pages: number;
  count: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  loading?: boolean;
  label?: string;
}) {
  const [jump, setJump] = useState("");
  if (!count) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(count, page * pageSize);
  const go = (next: number) => onPage(Math.min(pages, Math.max(1, next)));
  const numbers = pageWindow(page, pages);
  const gapKeys = ["gap-start", "gap-end"];
  const items = numbers.map((value) => ({
    value,
    key: value === null ? (gapKeys.shift() ?? "gap") : `page-${value}`,
  }));
  return (
    <nav className="table-pagination" aria-label="صفحه‌بندی جدول" aria-busy={loading}>
      <p className="table-pagination-summary" role="status">
        نمایش <b>{toFa(from)}</b> تا <b>{toFa(to)}</b> از <b>{toFa(count)}</b> {label}
      </p>
      <div className="table-pagination-pages">
        <button type="button" aria-label="صفحه اول" title="صفحه اول" disabled={page <= 1} onClick={() => go(1)}>
          <ChevronsRight size={15} aria-hidden="true" />
        </button>
        <button type="button" aria-label="صفحه قبل" title="صفحه قبل" disabled={page <= 1} onClick={() => go(page - 1)}>
          <ChevronRight size={15} aria-hidden="true" />
        </button>
        {items.map(({ value, key }) =>
          value === null ? (
            <span key={key} className="table-pagination-gap" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              type="button"
              key={key}
              className={value === page ? "is-current" : ""}
              aria-current={value === page ? "page" : undefined}
              aria-label={`صفحه ${toFa(value)}`}
              onClick={() => go(value)}
            >
              {toFa(value)}
            </button>
          )
        )}
        <button
          type="button"
          aria-label="صفحه بعد"
          title="صفحه بعد"
          disabled={page >= pages}
          onClick={() => go(page + 1)}
        >
          <ChevronLeft size={15} aria-hidden="true" />
        </button>
        <button type="button" aria-label="صفحه آخر" title="صفحه آخر" disabled={page >= pages} onClick={() => go(pages)}>
          <ChevronsLeft size={15} aria-hidden="true" />
        </button>
      </div>
      <div className="table-pagination-tools">
        {pages > 7 && (
          <form
            className="table-pagination-jump"
            onSubmit={(event) => {
              event.preventDefault();
              const target = Number(jump.replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))));
              if (Number.isInteger(target) && target >= 1) go(target);
              setJump("");
            }}
          >
            <label>
              <span>برو به</span>
              <input
                inputMode="numeric"
                value={jump}
                onChange={(event) => setJump(event.target.value)}
                aria-label="شماره صفحه"
              />
            </label>
          </form>
        )}
        <label className="table-pagination-size">
          <span>در هر صفحه</span>
          <select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {toFa(size)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </nav>
  );
}
