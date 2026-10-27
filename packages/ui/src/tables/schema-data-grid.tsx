import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

export interface SchemaGridColumn {
  field: string;
  title: string;
  width: number;
  pin?: "right" | "left" | "";
}
export interface SchemaDataGridProps<T extends { id: string }> {
  columns: SchemaGridColumn[];
  rows: T[];
  selected: string[];
  onSelect: (ids: string[]) => void;
  onColumnsChange: (columns: SchemaGridColumn[]) => void;
  renderCell: (row: T, column: SchemaGridColumn) => ReactNode;
  rowStyle?: (row: T) => CSSProperties;
  cellStyle?: (row: T, column: SchemaGridColumn) => CSSProperties;
  groupKey?: (row: T) => string;
  groupLabel?: (key: string) => ReactNode;
  renderFooter?: (column: SchemaGridColumn) => ReactNode;
  height?: number;
  onRowClick?: (row: T) => void;
}

/** Virtual DOM rows complement server pagination; they never replace it. */
export function SchemaDataGrid<T extends { id: string }>({
  columns,
  rows,
  selected,
  onSelect,
  onColumnsChange,
  renderCell,
  rowStyle,
  cellStyle,
  groupKey,
  groupLabel,
  renderFooter,
  onRowClick,
  height = 640,
}: SchemaDataGridProps<T>) {
  const [scroll, setScroll] = useState(0),
    [drag, setDrag] = useState("");
  const [resizing, setResizing] = useState<Record<string, number>>({});
  const container = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [rowHeights, setRowHeights] = useState<Record<string, number>>({});
  const rowIdentity = rows.map((row) => row.id).join(",");
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setContainerWidth(element.clientWidth));
    observer.observe(element);
    setContainerWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);
  const ordered = [
    ...columns.filter((c) => c.pin === "right"),
    ...columns.filter((c) => !c.pin),
    ...columns.filter((c) => c.pin === "left"),
  ];
  const minimumWidth = (column: SchemaGridColumn) => resizing[column.field] || column.width;
  const totalWidth = ordered.reduce((total, column) => total + minimumWidth(column), 0);
  // Expand the actual tracks as well as the table, so cells and sticky offsets
  // agree when a desktop has more space than the saved minimum widths.
  const scale = totalWidth ? Math.max(1, (containerWidth - 44) / totalWidth) : 1;
  const width = (column: SchemaGridColumn) => minimumWidth(column) * scale;
  const pinnedWidth = ordered.filter((column) => column.pin).reduce((total, column) => total + width(column), 0);
  const pinsSuspended =
    containerWidth > 0 && columns.length > 1 && pinnedWidth + 44 > containerWidth - Math.min(160, containerWidth * 0.4);
  const overflowing = containerWidth > 0 && totalWidth + 44 > containerWidth + 1;
  const template = `44px ${ordered.map((c) => `${width(c)}px`).join(" ")}`;
  const entries: { row: T; group?: string; key: string }[] = [];
  rows.forEach((row, index) => {
    const key = groupKey?.(row);
    if (groupKey && (index === 0 || key !== groupKey(rows[index - 1])))
      entries.push({ row, group: key || "null", key: `group:${key}:${row.id}` });
    entries.push({ row, key: `row:${row.id}` });
  });
  // Measure natural row heights so wrapping never hides data. Keep the window
  // bounded even when a page contains long text, multiple badges or groups.
  const offsets = [0];
  for (const entry of entries) offsets.push(offsets[offsets.length - 1] + (rowHeights[entry.key] || 64));
  const first = entries.findIndex((_, index) => offsets[index + 1] > scroll);
  const start = Math.max(0, (first < 0 ? entries.length - 1 : first) - 5);
  let end = start;
  while (end < entries.length && offsets[end] < scroll + height) end++;
  end = Math.min(entries.length, end + 6);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver((observations) => {
      setRowHeights((previous) => {
        let next = previous;
        for (const { target } of observations) {
          const key = (target as HTMLElement).dataset.entryKey;
          const measured = Math.ceil(target.getBoundingClientRect().height);
          if (key && measured > 0 && previous[key] !== measured) {
            if (next === previous) next = { ...previous };
            next[key] = measured;
          }
        }
        return next;
      });
    });
    element.querySelectorAll("tbody tr[data-entry-key]").forEach((row) => observer.observe(row));
    return () => observer.disconnect();
  }, [rows, start, end]);
  useEffect(() => {
    if (container.current) container.current.scrollTop = 0;
    setScroll(0);
    setRowHeights({});
  }, [rowIdentity]);
  const style: CSSProperties = {
    gridTemplateColumns: template,
    minWidth: 44 + totalWidth,
  };
  const pinned = (
    column: SchemaGridColumn,
    cellAppearance: CSSProperties = {},
    background = "var(--grid-row-bg, var(--schema-grid-background))"
  ): CSSProperties => {
    if (!column.pin || pinsSuspended) return cellAppearance;
    const peers = ordered.filter((c) => c.pin === column.pin),
      index = peers.findIndex((c) => c.field === column.field);
    const offset = (column.pin === "right" ? peers.slice(0, index) : peers.slice(index + 1)).reduce(
      (n, c) => n + width(c),
      0
    );
    return {
      ...cellAppearance,
      position: "sticky",
      [column.pin]: offset + (column.pin === "right" ? 44 : 0),
      zIndex: 2,
      // Undefined conditional cell colors must not erase the sticky cell's
      // opaque background and reveal text scrolling underneath it.
      backgroundColor: cellAppearance.backgroundColor || background,
    };
  };
  return (
    <div className="schema-grid-frame">
      <div
        ref={container}
        className="schema-data-grid"
        data-pins-suspended={pinsSuspended || undefined}
        role="region"
        aria-label="جدول داده‌ها"
        tabIndex={0}
        dir="rtl"
        style={{ maxHeight: `min(${height}px, 70dvh)` }}
        onScroll={(event) => setScroll(event.currentTarget.scrollTop)}
      >
        <table role="grid" aria-label="رکوردها" aria-rowcount={rows.length} style={{ minWidth: style.minWidth }}>
          <thead>
            <tr style={style}>
              <th className="schema-grid-selection">
                <input
                  aria-label="انتخاب همه رکوردهای این صفحه"
                  type="checkbox"
                  checked={rows.length > 0 && rows.every((r) => selected.includes(r.id))}
                  ref={(element) => {
                    if (element)
                      element.indeterminate =
                        rows.some((row) => selected.includes(row.id)) &&
                        !rows.every((row) => selected.includes(row.id));
                  }}
                  onChange={(e) => onSelect(e.target.checked ? rows.map((r) => r.id) : [])}
                />
              </th>
              {ordered.map((column) => (
                <th
                  key={column.field}
                  style={pinned(column, {}, "var(--schema-grid-header)")}
                  draggable
                  onDragStart={() => setDrag(column.field)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const next = columns.filter((c) => c.field !== drag),
                      source = columns.find((c) => c.field === drag);
                    if (source) {
                      next.splice(
                        next.findIndex((c) => c.field === column.field),
                        0,
                        source
                      );
                      onColumnsChange(next);
                    }
                    setDrag("");
                  }}
                >
                  <span className="schema-grid-column-title">{column.title}</span>
                  <button
                    type="button"
                    className="schema-grid-resizer"
                    aria-label={`تغییر عرض ${column.title}`}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                        e.preventDefault();
                        onColumnsChange(
                          columns.map((c) =>
                            c.field === column.field
                              ? {
                                  ...c,
                                  width: Math.min(800, Math.max(80, c.width + (e.key === "ArrowLeft" ? 20 : -20))),
                                }
                              : c
                          )
                        );
                      }
                    }}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      const origin = event.clientX,
                        initial = column.width;
                      let latest = initial;
                      const move = (e: PointerEvent) => {
                        latest = Math.min(800, Math.max(80, initial + origin - e.clientX));
                        setResizing({ [column.field]: latest });
                      };
                      const done = () => {
                        document.removeEventListener("pointermove", move);
                        document.removeEventListener("pointerup", done);
                        setResizing({});
                        onColumnsChange(columns.map((c) => (c.field === column.field ? { ...c, width: latest } : c)));
                      };
                      document.addEventListener("pointermove", move);
                      document.addEventListener("pointerup", done, { once: true });
                    }}
                  >
                    ⋮
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {start > 0 && (
              <tr aria-hidden="true">
                <td colSpan={ordered.length + 1} style={{ height: offsets[start], padding: 0 }} />
              </tr>
            )}
            {entries.slice(start, end).map(({ row, group, key }, index) =>
              group !== undefined ? (
                <tr key={key} data-entry-key={key} style={{ ...style, gridTemplateColumns: "1fr", minHeight: 64 }}>
                  <td colSpan={ordered.length + 1} className="schema-grid-group">
                    {groupLabel?.(group) || group}
                  </td>
                </tr>
              ) : (
                <tr
                  key={key}
                  data-entry-key={key}
                  aria-rowindex={start + index + 2}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={(event) => {
                    if (
                      !(event.target as HTMLElement).closest(
                        "a,button,input,select,textarea,[role='button'],[role='menuitem']"
                      )
                    )
                      onRowClick?.(row);
                  }}
                  onKeyDown={(event) => {
                    if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault();
                      onRowClick?.(row);
                    }
                  }}
                  style={{ ...style, ...rowStyle?.(row), minHeight: 64 }}
                >
                  <td className="schema-grid-selection">
                    <input
                      aria-label={`انتخاب رکورد ${(rows.indexOf(row) + 1).toLocaleString("fa-IR")}`}
                      type="checkbox"
                      checked={selected.includes(row.id)}
                      onChange={(e) =>
                        onSelect(e.target.checked ? [...selected, row.id] : selected.filter((id) => id !== row.id))
                      }
                    />
                  </td>
                  {ordered.map((column) => (
                    <td key={column.field} style={pinned(column, cellStyle?.(row, column))}>
                      {renderCell(row, column)}
                    </td>
                  ))}
                </tr>
              )
            )}
            {end < entries.length && (
              <tr aria-hidden="true">
                <td
                  colSpan={ordered.length + 1}
                  style={{ height: offsets[entries.length] - offsets[end], padding: 0 }}
                />
              </tr>
            )}
          </tbody>
          {renderFooter && (
            <tfoot>
              <tr style={style}>
                <td className="schema-grid-selection">کل</td>
                {ordered.map((column) => (
                  <td key={column.field} style={pinned(column, {}, "var(--schema-grid-header)")}>
                    {renderFooter(column)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {overflowing && (
        <p className="schema-grid-scroll-hint">
          برای دیدن همه ستون‌ها، جدول را به چپ و راست بکشید.
          {pinsSuspended ? " برای خوانایی بیشتر، ستون‌های سنجاق‌شده در این اندازه همراه جدول حرکت می‌کنند." : ""}
        </p>
      )}
    </div>
  );
}
