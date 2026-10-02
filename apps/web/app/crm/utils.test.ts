import { describe, expect, it } from "vitest";
import { greeting, persianDate, priorityFa, statusFa, toFa } from "./utils";

describe("Persian CRM formatting", () => {
  it("converts Latin digits to Persian digits", () => {
    expect(toFa(1405)).toBe("۱۴۰۵");
    expect(toFa("WEB-128")).toBe("WEB-۱۲۸");
  });

  it("converts Gregorian dates to the Jalali calendar", () => {
    expect(persianDate("2026-09-13")).toBe("۲۲ شهریور");
  });

  it.each([
    [5, "صبح بخیر"],
    [11, "صبح بخیر"],
    [12, "ظهر بخیر"],
    [14, "ظهر بخیر"],
    [15, "بعد از ظهر بخیر"],
    [18, "بعد از ظهر بخیر"],
    [19, "شب بخیر"],
    [23, "شب بخیر"],
  ])("returns the expected greeting at hour %i", (hour, expected) => {
    expect(greeting(hour)).toBe(expected);
  });

  it("keeps Persian labels for statuses and priorities", () => {
    expect(statusFa["In Progress"]).toBe("در حال انجام");
    expect(priorityFa.Urgent).toBe("فوری");
    expect(priorityFa.None).toBe("بدون اولویت");
  });
});
