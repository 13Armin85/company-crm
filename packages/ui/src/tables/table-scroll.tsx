import { useEffect, useRef, useState } from "react";
import type { HTMLAttributes, PointerEvent, TableHTMLAttributes } from "react";

export function ScrollableTable(props: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <TableScroll>
      <table {...props} style={{ width: "max-content", minWidth: "100%", ...props.style }} />
    </TableScroll>
  );
}

/** Keeps a wide table within its page; touch, keyboard, scrollbar and mouse drag all work. */
export function TableScroll({ children, className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => setWide(element.scrollWidth > element.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [children]);
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    event.currentTarget.classList.remove("is-dragging");
    if (drag.current && !drag.current.moved) drag.current = null;
  };
  return (
    <div className="horizontal-table-shell" style={{ minWidth: 0, maxWidth: "100%" }}>
      {wide && (
        <p className="horizontal-table-hint">
          برای دیدن همهٔ ستون‌ها، جدول را افقی بکشید یا از نوار پایین آن استفاده کنید.
        </p>
      )}
      <div
        {...props}
        ref={root}
        className={`horizontal-table-scroll ${className}`}
        style={{ minWidth: 0, maxWidth: "100%", overflow: "auto", ...props.style }}
        role="region"
        aria-label={props["aria-label"] || "جدول؛ قابل اسکرول افقی"}
        tabIndex={0}
        data-overflow={wide || undefined}
        onKeyDown={(event) => {
          props.onKeyDown?.(event);
          if (event.target !== event.currentTarget || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
          event.preventDefault();
          event.currentTarget.scrollBy({ left: event.key === "ArrowLeft" ? -120 : 120 });
        }}
        onPointerDown={(event) => {
          if (
            !wide ||
            event.pointerType !== "mouse" ||
            event.button !== 0 ||
            (event.target as HTMLElement).closest("a,button,input,select,textarea,[role='button']")
          )
            return;
          drag.current = { x: event.clientX, left: event.currentTarget.scrollLeft, moved: false };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start || event.buttons !== 1) return;
          const delta = event.clientX - start.x;
          if (!start.moved && Math.abs(delta) < 6) return;
          start.moved = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.classList.add("is-dragging");
          event.currentTarget.scrollLeft = start.left - delta;
        }}
        onPointerUp={finish}
        onPointerCancel={(event) => {
          finish(event);
          drag.current = null;
        }}
        onClickCapture={(event) => {
          if (!drag.current?.moved) return;
          event.preventDefault();
          event.stopPropagation();
          drag.current = null;
        }}
      >
        {children}
      </div>
    </div>
  );
}
