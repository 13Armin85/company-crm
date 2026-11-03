import { persianDateValue, toFa } from "../utils";

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

export function chartLabel(value: unknown, labels: Record<string, string> = {}): string {
  if (value === null || value === undefined || value === "") return "بدون مقدار";
  const raw = String(value);
  return toFa(persianDateValue(labels[raw] || knownLabels[raw.toLowerCase()] || raw));
}

export function chartNumber(value: unknown): string {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("fa-IR") : toFa(String(value ?? ""));
}

export function chartTooltipValue(value: unknown, name: unknown): [string, string] {
  const label = name === "value" || name === "count" ? "تعداد" : chartLabel(name);
  return [chartNumber(value), label];
}
