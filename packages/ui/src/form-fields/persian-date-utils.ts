import jalaali from "jalaali-js";

const { toGregorian, toJalaali } = jalaali;

export const CRM_TIME_ZONE = "Asia/Tehran";
export const persianMonths = [
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
export const persianDigits = (value: string | number) =>
  String(value).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
const pad = (value: number) => String(value).padStart(2, "0");
export function validTimeZone(zone?: string) {
  try {
    if (zone) {
      new Intl.DateTimeFormat("en", { timeZone: zone }).format();
      return zone;
    }
  } catch {
    /* Fall back to the documented company zone. */
  }
  return CRM_TIME_ZONE;
}
export function parseDateOnly(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return undefined;
  try {
    return toJalaali(year, month, day);
  } catch {
    return undefined;
  }
}
export function jalaliToDateOnly(year: number, month: number, day: number) {
  try {
    const { gy, gm, gd } = toGregorian(year, month, day);
    const value = `${gy}-${pad(gm)}-${pad(gd)}`;
    const result = parseDateOnly(value);
    return result?.jy === year && result.jm === month && result.jd === day ? value : "";
  } catch {
    return "";
  }
}
export function zonedDateTime(value: string | Date, zone = CRM_TIME_ZONE) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: validTimeZone(zone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
    seconds: get("second"),
  };
}
export function zonedDateTimeToISO(date: string, time: string, zone = CRM_TIME_ZONE) {
  if (!parseDateOnly(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return "";
  const target = Date.parse(`${date}T${time}:00Z`);
  let guess = target;
  for (let index = 0; index < 3; index++) {
    const parts = zonedDateTime(new Date(guess), zone)!;
    const represented = Date.parse(`${parts.date}T${parts.time}:${parts.seconds}Z`);
    guess += target - represented;
  }
  const result = zonedDateTime(new Date(guess), zone);
  return result?.date === date && result.time === time ? new Date(guess).toISOString() : "";
}
export function displayPersianDate(value: string | Date, zone = CRM_TIME_ZONE) {
  const date =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : zonedDateTime(value, zone)?.date;
  return parseDateOnly(date);
}
