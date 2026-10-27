import { describe, expect, it } from "vitest";
import { generatePersianCalendarData, gregorianDate, persianCalendarDate, shiftPersianMonth } from "./persian-calendar";

describe("Persian issue calendar", () => {
  it("uses a Jalali month and Saturday-first weeks across Nowruz", () => {
    const payload = generatePersianCalendarData(null, new Date(2024, 2, 20));
    const weeks = Object.values(payload["y-1403"]["m-1"]);
    const days = weeks.flatMap((week) => Object.values(week));

    expect(days[0].date.getDay()).toBe(6);
    expect(
      days.find((day) => day.date.getFullYear() === 2024 && day.date.getMonth() === 2 && day.date.getDate() === 20)
    ).toMatchObject({
      year: 1403,
      month: 1,
      day: 1,
      is_current_month: true,
    });
    expect(days.filter((day) => day.is_current_month)).toHaveLength(31);
    expect(days[days.length - 1].date.getDay()).toBe(5);
  });

  it("moves between Jalali months and years while preserving a valid day", () => {
    const endOfShahrivar = gregorianDate(1403, 6, 31);
    expect(persianCalendarDate(shiftPersianMonth(endOfShahrivar, 1))).toEqual({ jy: 1403, jm: 7, jd: 30 });
    expect(persianCalendarDate(shiftPersianMonth(gregorianDate(1402, 12, 29), 1))).toEqual({
      jy: 1403,
      jm: 1,
      jd: 29,
    });
    expect(persianCalendarDate(shiftPersianMonth(gregorianDate(1403, 1, 1), -12))).toEqual({
      jy: 1402,
      jm: 1,
      jd: 1,
    });
  });
});
