import { describe, expect, it } from "vitest";
import {
  displayPersianDate,
  jalaliToDateOnly,
  parseDateOnly,
  validTimeZone,
  zonedDateTime,
  zonedDateTimeToISO,
  normalizePersianSearch,
} from "@plane/ui";
import { persianDate } from "./utils";

describe("Persian date contracts", () => {
  it("round trips Nowruz and leap Esfand without converting date-only to UTC", () => {
    expect(parseDateOnly("2024-03-20")).toEqual({ jy: 1403, jm: 1, jd: 1 });
    expect(jalaliToDateOnly(1403, 1, 1)).toBe("2024-03-20");
    expect(jalaliToDateOnly(1399, 12, 30)).toBe("2021-03-20");
    expect(jalaliToDateOnly(1400, 12, 30)).toBe("");
    expect(parseDateOnly("2025-02-29")).toBeUndefined();
    expect(parseDateOnly("invalid")).toBeUndefined();
    expect(persianDate("invalid")).toBe("تاریخ نامعتبر");
  });
  it.each(["UTC", "Asia/Tehran", "America/Los_Angeles"])("preserves date-only regardless of %s", (timeZone) => {
    expect(displayPersianDate("2024-03-20", timeZone)).toEqual({ jy: 1403, jm: 1, jd: 1 });
    expect(persianDate("2024-03-20", { year: "numeric", timeZone })).toBe("۱ فروردین ۱۴۰۳");
  });
  it.each(["UTC", "Asia/Tehran", "America/Los_Angeles"])("round trips an explicit time in %s", (zone) => {
    const iso = zonedDateTimeToISO("2026-10-11", "00:15", zone);
    expect(iso).toMatch(/Z$/);
    expect(zonedDateTime(iso, zone)).toEqual({ date: "2026-10-11", time: "00:15", seconds: "00" });
  });
  it("uses the Tehran offset and handles a zone crossing the previous day", () => {
    expect(zonedDateTimeToISO("2026-10-11", "00:15", "Asia/Tehran")).toBe("2026-10-10T20:45:00.000Z");
    expect(zonedDateTime("2024-03-20T00:00:00Z", "America/Los_Angeles")?.date).toBe("2024-03-19");
    expect(zonedDateTimeToISO("2026-03-08", "02:30", "America/Los_Angeles")).toBe("");
    expect(zonedDateTimeToISO("2026-10-11", "25:99", "UTC")).toBe("");
    expect(validTimeZone("invalid")).toBe("Asia/Tehran");
  });
  it("normalizes Persian and Arabic search without dropping meaningful letters", () => {
    expect(normalizePersianSearch("كيوان علي‌پور")).toBe(normalizePersianSearch("کیوان علی پور"));
    expect(normalizePersianSearch("نقش ۸۰")).toBe(normalizePersianSearch("نقش 80"));
    expect(normalizePersianSearch("۱۴۰۴")).toBe(normalizePersianSearch("١٤٠٤"));
  });
});
