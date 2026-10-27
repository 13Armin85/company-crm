import { jalaaliMonthLength, toGregorian, toJalaali } from "jalaali-js";
import type { ICalendarDate, ICalendarPayload } from "@plane/types";
import { renderFormattedPayloadDate } from "@plane/utils";

export const persianCalendarDate = (date: Date) => toJalaali(date.getFullYear(), date.getMonth() + 1, date.getDate());

export const gregorianDate = (year: number, month: number, day: number) => {
  const { gy, gm, gd } = toGregorian(year, month, day);
  return new Date(gy, gm - 1, gd);
};

export const shiftPersianMonth = (date: Date, offset: number) => {
  const { jy, jm, jd } = persianCalendarDate(date);
  const absolute = jy * 12 + jm - 1 + offset;
  const year = Math.floor(absolute / 12);
  const month = (((absolute % 12) + 12) % 12) + 1;
  return gregorianDate(year, month, Math.min(jd, jalaaliMonthLength(year, month)));
};

export const generatePersianCalendarData = (current: ICalendarPayload | null, selected: Date): ICalendarPayload => {
  const payload = current ?? {};
  const { jy, jm } = persianCalendarDate(selected);
  const firstDate = gregorianDate(jy, jm, 1);
  const offset = (firstDate.getDay() + 1) % 7;
  const length = jalaaliMonthLength(jy, jm);
  const weeks: ICalendarPayload[string][string] = {};
  const today = new Date();
  const todayKey = renderFormattedPayloadDate(today);
  const todayWeekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 1) % 7));

  for (let week = 0; week < Math.ceil((offset + length) / 7); week++) {
    const days: Record<string, ICalendarDate> = {};
    for (let weekday = 0; weekday < 7; weekday++) {
      const date = new Date(firstDate);
      date.setDate(firstDate.getDate() + week * 7 + weekday - offset);
      const key = renderFormattedPayloadDate(date);
      if (!key) continue;
      const jalali = persianCalendarDate(date);
      days[key] = {
        date,
        year: jalali.jy,
        month: jalali.jm,
        day: jalali.jd,
        week,
        is_current_month: jalali.jy === jy && jalali.jm === jm,
        is_current_week:
          date >= todayWeekStart &&
          date < new Date(todayWeekStart.getFullYear(), todayWeekStart.getMonth(), todayWeekStart.getDate() + 7),
        is_today: key === todayKey,
      };
    }
    weeks[`w-${week}`] = days;
  }

  payload[`y-${jy}`] ||= {};
  payload[`y-${jy}`][`m-${jm}`] = weeks;
  return payload;
};
