import { stateNameFa } from "../issue-status";
import { persianDateValue, plainText, toFa } from "../utils";

const knownLabels: Record<string, string> = {
  urgent: "فوری",
  high: "زیاد",
  medium: "متوسط",
  low: "کم",
  none: "بدون اولویت",
  backlog: "در صف",
  todo: "برای انجام",
  "to do": "برای انجام",
  in_progress: "در حال انجام",
  "in progress": "در حال انجام",
  review: "بازبینی",
  done: "انجام‌شده",
  completed: "انجام‌شده",
  cancelled: "لغوشده",
  canceled: "لغوشده",
  blocked: "مسدود",
  true: "بله",
  false: "خیر",
};

const eventLabels: Record<string, string> = {
  "record.created": "رکورد ایجاد شد",
  "record.updated": "رکورد ویرایش شد",
  "record.deleted": "رکورد حذف شد",
  "record.status_changed": "وضعیت رکورد تغییر کرد",
  "record.field_changed": "فیلد رکورد تغییر کرد",
};

export function activityEventLabel(value: unknown): string {
  return eventLabels[String(value)] || "فعالیت ثبت شد";
}

/** "" means the field was empty; null/undefined means the server could not show the value. */
const readableValue = (value: unknown): string | undefined => {
  if (value === "") return "";
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return undefined;
  const raw = plainText(value);
  if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(raw)) return undefined;
  return stateNameFa(chartLabel(raw)).slice(0, 80);
};

export function activityDescription(item: Record<string, unknown>): string {
  const actor = plainText(item.actor || "کاربر");
  const record = plainText(item.record || "رکورد").slice(0, 100);
  const target = `«${record}»`;
  if (item.event === "record.created") return `${actor} ${target} را ایجاد کرد`;
  if (item.event === "record.deleted") return `${actor} ${target} را حذف کرد`;
  if (item.event === "surface.values.updated") return `${actor} اطلاعات فرم ${target} را ویرایش کرد`;
  if (item.event === "record.field_changed" || item.event === "record.status_changed") {
    const field = plainText(item.field || (item.event === "record.status_changed" ? "وضعیت" : "یکی از فیلدها"));
    const before = readableValue(item.before);
    const after = readableValue(item.after);
    if (before && after && before !== after)
      return `${actor} ${field} ${target} را از «${before}» به «${after}» تغییر داد`;
    if (before === "" && after) return `${actor} ${field} ${target} را «${after}» تعیین کرد`;
    if (before && after === "") return `${actor} ${field} ${target} را پاک کرد (مقدار قبلی: «${before}»)`;
    if (after) return `${actor} ${field} ${target} را به «${after}» تغییر داد`;
    return `${actor} ${field} ${target} را تغییر داد`;
  }
  return `${actor} ${target} را ویرایش کرد`;
}

export function chartLabel(value: unknown, labels: Record<string, string> = {}): string {
  if (value === null || value === undefined || value === "") return "بدون مقدار";
  const raw = String(value);
  return toFa(persianDateValue(labels[raw] || knownLabels[raw.toLowerCase()] || raw));
}

export function tableValueLabel(field: string, title: string, value: unknown, displayValue?: string): string {
  const status = ["status", "task_status", "ticket_state", "state_id"].includes(field) || title === "وضعیت";
  if (status) {
    const raw = displayValue ?? value;
    if (raw === null || raw === undefined || raw === "") return "—";
    if (!displayValue && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(String(raw))) return "وضعیت نامشخص";
    return plainText(stateNameFa(chartLabel(raw))) || "—";
  }
  return plainText(displayValue ?? persianDateValue(value)) || "—";
}

export function chartNumber(value: unknown): string {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("fa-IR") : toFa(String(value ?? ""));
}

export function chartTooltipValue(value: unknown, name: unknown): [string, string] {
  const label = name === "value" || name === "count" ? "تعداد" : chartLabel(name);
  return [chartNumber(value), label];
}
