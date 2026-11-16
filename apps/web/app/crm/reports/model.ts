/** Pure helpers of the report pages (ticket 8); no React, no network. The server validates every
 * definition against its source registry again and recomputes the viewer's scope on every run. */
import type {
  Cell,
  FieldType,
  FilterRule,
  ReportDefinition,
  ReportRange,
  ReportSource,
  SourceField,
} from "../api/reports";
import { toFa } from "../utils";

export const RELATIVE_RANGES = [7, 30, 90, 365];
export const MAX_GROUPS = 2;
export const INCOMPATIBLE_TEXT = "تعریف گزارش با ساختار فعلی سازگار نیست";

/** The definition to run: the source default overlaid with what is saved/edited. */
export function mergeDefinition(source: ReportSource, partial?: Partial<ReportDefinition> | null): ReportDefinition {
  return {
    columns: partial?.columns ?? source.default.columns,
    filters: partial?.filters ?? source.default.filters,
    range: partial && "range" in partial ? (partial.range ?? null) : source.default.range,
    sort: partial?.sort ?? source.default.sort,
    group_by: partial?.group_by ?? source.default.group_by,
    aggregates: partial?.aggregates ?? source.default.aggregates,
  };
}

/** Open a specific day from the daily report form, including dates outside the default range. */
export function definitionForDate(
  source: ReportSource,
  partial?: Partial<ReportDefinition> | null,
  date?: string | null
): ReportDefinition {
  const definition = mergeDefinition(source, partial);
  if (source.code === "daily_report_items" && date && /^\d{4}-\d{2}-\d{2}$/.test(date))
    return { ...definition, range: { type: "absolute", from: date, to: date } };
  return definition;
}

export const fieldOf = (source: ReportSource, key: string): SourceField | undefined =>
  source.fields.find((field) => field.key === key);

/** Client mirror of the server whitelist; returns Persian problems (empty = valid). */
export function definitionErrors(source: ReportSource, definition: ReportDefinition): string[] {
  const errors: string[] = [];
  const unknown = [
    ...definition.columns,
    ...definition.filters.map((rule) => rule.field),
    ...definition.sort.map((rule) => rule.field),
    ...definition.group_by,
    ...definition.aggregates.map((agg) => agg.field).filter(Boolean),
  ].filter((key) => key && !fieldOf(source, key as string));
  if (unknown.length)
    errors.push(`ستون ${[...new Set(unknown)].map((key) => `«${key}»`).join("، ")} در این منبع وجود ندارد.`);
  if (!definition.columns.length) errors.push("دست‌کم یک ستون انتخاب کنید.");
  if (definition.group_by.length > MAX_GROUPS) errors.push("گروه‌بندی حداکثر دو سطح دارد.");
  for (const key of definition.group_by) {
    const field = fieldOf(source, key);
    if (field && !field.group) errors.push(`گروه‌بندی بر اساس «${field.label}» مجاز نیست.`);
  }
  for (const rule of definition.filters) {
    const field = fieldOf(source, rule.field);
    if (field && !field.ops.some((op) => op.code === rule.op))
      errors.push(`عملگر انتخاب‌شده برای «${field.label}» مجاز نیست.`);
    if (field && ["in", "not_in"].includes(rule.op) && (!Array.isArray(rule.value) || !rule.value.length))
      errors.push(`برای «${field.label}» دست‌کم یک مقدار انتخاب کنید.`);
  }
  for (const agg of definition.aggregates) {
    if (agg.fn === "count") continue;
    const field = agg.field ? fieldOf(source, agg.field) : undefined;
    if (!field || field.type !== "number" || !field.agg) errors.push("جمع و میانگین فقط روی فیلدهای عددی مجاز است.");
  }
  const range = definition.range;
  if (range?.type === "absolute" && (!range.from || !range.to)) errors.push("تاریخ آغاز و پایان بازه را انتخاب کنید.");
  if (range?.type === "absolute" && range.from && range.to && range.from > range.to)
    errors.push("تاریخ آغاز بازه نباید پس از تاریخ پایان باشد.");
  if (source.range_required && !range) errors.push("برای این گزارش بازهٔ زمانی لازم است.");
  return [...new Set(errors)];
}

/** Persian digits for numbers, Jalali dates and date-times; text is shown as it is. */
export function displayCell(value: Cell, type: FieldType): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number")
    return toFa(Number.isInteger(value) ? value.toLocaleString("en-US") : value.toFixed(2));
  if (type === "date" || type === "datetime" || type === "number") return toFa(String(value));
  return String(value);
}

export function rangeLabel(range: ReportRange | null): string {
  if (!range) return "بدون محدودیت تاریخ";
  if (range.type === "relative") return `${toFa(range.days ?? 0)} روز گذشته`;
  return `از ${toFa((range.from ?? "").replaceAll("-", "/"))} تا ${toFa((range.to ?? "").replaceAll("-", "/"))}`;
}

export function defaultFilter(field: SourceField): FilterRule {
  const op = field.ops[0]?.code ?? "eq";
  const value =
    field.type === "bool"
      ? true
      : ["in", "not_in"].includes(op)
        ? []
        : field.type === "choice"
          ? (field.choices[0]?.code ?? "")
          : field.type === "number"
            ? 0
            : "";
  return { field: field.key, op, value };
}

export function changeOp(rule: FilterRule, field: SourceField, op: string): FilterRule {
  const many = ["in", "not_in"].includes(op);
  const wasMany = ["in", "not_in"].includes(rule.op);
  if (many === wasMany) return { ...rule, op };
  if (many) return { ...rule, op, value: rule.value === "" || rule.value === undefined ? [] : [rule.value] };
  return { ...rule, op, value: Array.isArray(rule.value) ? (rule.value[0] ?? defaultFilter(field).value) : rule.value };
}

/** The structured "incompatible definition" error of the server (409), if that is what this is. */
export function incompatibleError(error: unknown): { message: string; missing: string[] } | null {
  const data = (error as { response?: { status?: number; data?: Record<string, unknown> } })?.response;
  if (data?.status !== 409 || data.data?.code !== "incompatible") return null;
  const message = typeof data.data.error === "string" ? data.data.error : INCOMPATIBLE_TEXT;
  const missing = Array.isArray(data.data.missing) ? (data.data.missing as string[]) : [];
  return { message, missing };
}

/** Removes references to columns a source no longer has (used by "edit report" after an incompatibility). */
export function repairDefinition(source: ReportSource, definition: ReportDefinition): ReportDefinition {
  const known = (key?: string) => Boolean(key && fieldOf(source, key));
  const columns = definition.columns.filter(known);
  return {
    columns: columns.length ? columns : source.default.columns,
    filters: definition.filters.filter((rule) => known(rule.field)),
    range: definition.range,
    sort: definition.sort.filter((rule) => known(rule.field)),
    group_by: definition.group_by.filter(known),
    aggregates: definition.aggregates.filter((agg) => agg.fn === "count" || known(agg.field)),
  };
}

export const tooLarge = (error: unknown) =>
  (error as { response?: { data?: { code?: string } } })?.response?.data?.code === "too_large";
