import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router";
import type { FieldValue } from "@plane/ui";
import { persianDate } from "../utils";
import { RelationPreview } from "./record-form";
import type { ViewField, ViewResult, ViewStyle } from "./view-types";

export const numberText = (value: unknown) => {
  if (value == null) return "—";
  const text = String(value);
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    const [whole, fraction] = text.split("."),
      digits = fraction?.replace(/0+$/, "");
    return (
      (whole.startsWith("-") && BigInt(whole) === 0n && digits ? "−" : "") +
      BigInt(whole).toLocaleString("fa-IR") +
      (digits ? "٫" + digits.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]) : "")
    );
  }
  return Number(value).toLocaleString("fa-IR", { maximumFractionDigits: 20 });
};
export const icons: Record<string, string> = { warning: "⚠", clock: "◷", check: "✓", flag: "⚑", info: "ⓘ" };
export function appearance(style?: ViewStyle): CSSProperties {
  return {
    color: style?.color
      ? `color-mix(in srgb, ${style.color} var(--engine-rule-text-strength, 100%), var(--text-primary))`
      : undefined,
    backgroundColor: style?.background
      ? `color-mix(in srgb, ${style.background} var(--engine-rule-strength, 100%), var(--surface))`
      : undefined,
  };
}
function flatten(value: FieldValue | undefined): (string | number | boolean | { start: string; end: string })[] {
  return Array.isArray(value) ? (value.flat(Infinity) as string[]) : value == null ? [] : [value];
}
function LazyRelationPreview({ entity, id, children }: { entity: string; id: string; children: ReactNode }) {
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null),
    panel = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const cancelClose = () => {
    if (closing.current) clearTimeout(closing.current);
  };
  const show = (target: HTMLElement) => {
    cancelClose();
    const rect = target.getBoundingClientRect();
    setAnchor({
      top: Math.max(10, Math.min(rect.bottom + 8, window.innerHeight - 200)),
      left: Math.max(10, Math.min(rect.left, window.innerWidth - 340)),
    });
  };
  const scheduleClose = () => {
    cancelClose();
    closing.current = setTimeout(() => setAnchor(null), 200);
  };
  const close = () => {
    cancelClose();
    trigger.current?.focus({ preventScroll: true });
    setAnchor(null);
  };
  useEffect(
    () => () => {
      if (closing.current) clearTimeout(closing.current);
    },
    []
  );
  useEffect(() => {
    if (!anchor) return;
    const close = () => setAnchor(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [anchor]);
  return (
    <span
      className="engine-relation-value"
      role="group"
      aria-label="رکورد مرتبط"
      onMouseEnter={(event) => show(event.currentTarget)}
      onMouseLeave={scheduleClose}
      onFocus={(event) => show(event.currentTarget)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget) && !panel.current?.contains(event.relatedTarget))
          scheduleClose();
      }}
    >
      <Link
        to={`/entities/${entity}/${id}`}
        onKeyDown={(event) => {
          if (event.key === "Escape") close();
        }}
      >
        {children}
      </Link>
      <button
        ref={trigger}
        type="button"
        aria-label="اطلاعات رکورد مرتبط"
        aria-expanded={!!anchor}
        onKeyDown={(event) => {
          if (event.key === "Escape") close();
        }}
        onClick={(event) => {
          show(event.currentTarget);
          requestAnimationFrame(() => panel.current?.focus());
        }}
      >
        ⓘ
      </button>
      {anchor &&
        createPortal(
          <div
            ref={panel}
            className="engine-relation-hover"
            role="dialog"
            aria-label="اطلاعات رکورد مرتبط"
            tabIndex={-1}
            style={{ position: "fixed", ...anchor, width: 320, maxWidth: "calc(100vw - 20px)", zIndex: 80 }}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            onFocus={cancelClose}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) scheduleClose();
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") close();
            }}
          >
            <button type="button" aria-label="بستن اطلاعات رکورد مرتبط" onClick={close}>
              ×
            </button>
            <RelationPreview code={entity} id={id} />
          </div>,
          document.body
        )}
    </span>
  );
}
export function ViewValue({
  field,
  value,
  labels = {},
  style,
}: {
  field?: ViewField;
  value?: FieldValue;
  labels?: ViewResult["labels"][string];
  style?: ViewStyle;
}) {
  if (value == null || value === "" || (Array.isArray(value) && !value.length)) return <span>—</span>;
  const badge = field && ["select", "multi_select", "tags"].includes(field.kind);
  const contents = flatten(value).map((item, index) => {
    const text =
      typeof item === "object"
        ? `${persianDate(item.start)} تا ${persianDate(item.end)}`
        : field && ["integer", "decimal", "money", "percent", "computed", "rating"].includes(field.kind)
          ? numberText(item) + (field.config.unit ? ` ${field.config.unit}` : "")
          : typeof item === "boolean"
            ? item
              ? "بله"
              : "خیر"
            : field?.kind === "datetime"
              ? new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
                  dateStyle: "short",
                  timeStyle: "short",
                  timeZone: field.time_zone || "Asia/Tehran",
                }).format(new Date(String(item)))
              : field?.kind === "date"
                ? persianDate(String(item))
                : labels[String(item)]?.title || String(item).replace(/<[^>]*>/g, " ");
    const selected = labels[String(item)];
    const content = (
      <span
        className={badge ? "engine-value-badge" : ""}
        style={
          badge
            ? {
                backgroundColor: (selected?.color || "#64748b").slice(0, 7) + "20",
                color: appearance({ color: selected?.color }).color,
                ...appearance(style),
              }
            : appearance(style)
        }
      >
        {style?.icon && (
          <span role="img" aria-label={style.icon}>
            {icons[style.icon]}{" "}
          </span>
        )}
        {text}
        {selected?.inactive ? " (غیرفعال)" : ""}
      </span>
    );
    if (field?.kind === "relation" && field.relation_entity && typeof item === "string")
      return (
        <LazyRelationPreview entity={field.relation_entity} id={item} key={index}>
          {content}
        </LazyRelationPreview>
      );
    return (
      <span key={index}>
        {index > 0 ? "، " : ""}
        {content}
      </span>
    );
  });
  return <>{contents}</>;
}
