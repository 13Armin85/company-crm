import { displayPersianDate, validTimeZone } from "@plane/ui";

import type { Priority, Status } from "./types";

export const toFa = (value: string | number) => String(value).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
export const persianDate = (date?: string | Date, options?: Intl.DateTimeFormatOptions) => {
  if (!date) return "بدون تاریخ";
  const parsed = displayPersianDate(date, validTimeZone(options?.timeZone));
  if (!parsed) return "تاریخ نامعتبر";
  const { jy, jm, jd } = parsed;
  const months = [
    "فروردین",
    "اردیبهشت",
    "خرداد",
    "تیر",
    "مرداد",
    "شهریور",
    "مهر",
    "آبان",
    "آذر",
    "دی",
    "بهمن",
    "اسفند",
  ];
  const clock = options?.hour
    ? " · " +
      new Intl.DateTimeFormat("fa-IR", {
        timeZone: validTimeZone(options.timeZone),
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(date))
    : "";
  return `${toFa(jd)} ${months[jm - 1]}${options?.year ? ` ${toFa(jy)}` : ""}${clock}`;
};
export const persianDateValue = (value: unknown) => {
  if (typeof value !== "string") return String(value ?? "—");
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value)) return value;
  return persianDate(value, { year: "numeric", ...(value.includes("T") ? { hour: "2-digit" as const } : {}) });
};
export const greeting = (hour = new Date().getHours()) => {
  if (hour < 12) return "صبح بخیر";
  if (hour < 15) return "ظهر بخیر";
  if (hour < 19) return "بعد از ظهر بخیر";
  return "شب بخیر";
};
export const statusFa: Record<Status, string> = {
  Todo: "برای انجام",
  "In Progress": "در حال انجام",
  Review: "بازبینی",
  Done: "انجام‌شده",
  Blocked: "مسدود",
};
export const priorityFa: Record<Priority, string> = {
  Urgent: "فوری",
  High: "زیاد",
  Medium: "متوسط",
  Low: "کم",
  None: "بدون اولویت",
};
