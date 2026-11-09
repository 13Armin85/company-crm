import { displayPersianDate, validTimeZone } from "@plane/ui";
import { sanitizeHTML } from "@plane/utils";

import type { Priority, Status } from "./types";

export const toFa = (value: string | number) => String(value).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
const htmlEntities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
};
const decodeEntities = (value: string) =>
  value.replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, (match, name: string) => {
    if (name.startsWith("#")) {
      const code =
        name[1]?.toLowerCase() === "x" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return htmlEntities[name.toLowerCase()] ?? match;
  });
/** Text shown outside the rich-text editor must never contain editor markup. */
export const plainText = (value: unknown) => {
  let text = String(value ?? "");
  for (let index = 0; index < 3; index++) {
    text = sanitizeHTML(decodeEntities(text).replace(/<\/(?:p|div|li|h[1-6]|blockquote)>|<br\s*\/?>/gi, " "));
  }
  return decodeEntities(text).replace(/\s+/g, " ").trim();
};
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
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value))
    return plainText(value);
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
