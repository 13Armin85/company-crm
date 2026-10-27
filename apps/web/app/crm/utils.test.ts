import { describe, expect, it } from "vitest";
import { greeting, persianDate, persianDateValue, priorityFa, statusFa, toFa } from "./utils";

describe("Persian CRM formatting", () => {
  it("converts Latin digits to Persian digits", () => {
    expect(toFa(1405)).toBe("۱۴۰۵");
    expect(toFa("WEB-128")).toBe("WEB-۱۲۸");
  });

  it("converts Gregorian dates to the Jalali calendar", () => {
    expect(persianDate("2026-09-13")).toBe("۲۲ شهریور");
  });

  it("formats dashboard date values without changing other values", () => {
    expect(persianDateValue("2024-03-20")).toBe("۱ فروردین ۱۴۰۳");
    expect(persianDateValue("2024-03-20T12:00:00Z")).toContain("۱ فروردین ۱۴۰۳");
    expect(persianDateValue("2024-03-20 extra")).toBe("2024-03-20 extra");
    expect(persianDateValue(null)).toBe("—");
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
