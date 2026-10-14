import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { Calendar } from "@plane/propel/calendar";
import { changePersianCalendarPeriod, jalaliToDateOnly, PersianCalendarNavigation } from "@plane/ui";
import { IssueCalendar } from "./issue-calendar";
import type { Issue } from "./types";

const issue = (name: string, dueDate?: string): Issue => ({
  id: name,
  name,
  dueDate,
  scope: "project",
  projectId: "project-1",
  projectIdentifier: "CRM",
  sequenceId: 1,
  status: "Todo",
  priority: "None",
});
const renderCalendar = (issues: Issue[] = [], timeZone = "Asia/Tehran") =>
  renderToStaticMarkup(<IssueCalendar issues={issues} projects={[]} timeZone={timeZone} />);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Jalali issue calendars", () => {
  it("orders the agenda without requiring ES2023 array methods or changing the input", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-03-20T12:00:00Z"));
    const prototype = Array.prototype as typeof Array.prototype & { toSorted: () => unknown };
    vi.spyOn(prototype, "toSorted").mockImplementation(() => {
      throw new Error("ES2023 array methods unavailable");
    });
    const issues = [issue("موعد دوم", "2024-03-21"), issue("موعد اول", "2024-03-20")];
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <IssueCalendar issues={issues} projects={[]} timeZone="Asia/Tehran" showAgenda />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const agenda = html.slice(html.indexOf('aria-label="کارهای این ماه"'));
    expect(agenda).toContain("موعد اول");
    expect(agenda.indexOf("موعد اول")).toBeLessThan(agenda.indexOf("موعد دوم"));
    expect(issues.map((item) => item.name)).toEqual(["موعد دوم", "موعد اول"]);
  });

  it.each(["UTC", "Asia/Tehran", "America/Los_Angeles"])(
    "groups Gregorian date-only deadlines into the same Jalali month in %s",
    (timeZone) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-03-20T12:00:00Z"));
      const html = renderCalendar(
        [
          issue("موعد نوروز", "2024-03-20"),
          issue("موعد اسفند", "2024-03-19"),
          issue("موعد اردیبهشت", "2024-04-20"),
          issue("تاریخ نامعتبر", "invalid"),
          issue("بدون موعد"),
        ],
        timeZone
      );
      expect(html).toContain('aria-label="فروردین ۱۴۰۳"');
      expect(html).toContain("موعد نوروز");
      expect(html).not.toContain("موعد اسفند");
      expect(html).not.toContain("موعد اردیبهشت");
      expect(html).not.toContain("تاریخ نامعتبر");
      expect(html).not.toContain("بدون موعد");
      expect(html).toContain('aria-label="ماه تقویم"');
      expect(html).toContain('aria-label="سال تقویم"');
      expect(html).toContain('aria-label="ماه قبل"');
      expect(html).toContain('aria-label="ماه بعد"');
      expect(html).toContain(">شنبه</span>");
    }
  );

  it("uses the user's timezone for the current month at the Nowruz boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-03-19T21:00:00Z"));
    expect(renderCalendar([], "Asia/Tehran")).toContain('aria-label="فروردین ۱۴۰۳"');
    expect(renderCalendar([], "UTC")).toContain('aria-label="اسفند ۱۴۰۲"');
  });

  it.each([
    ["2021-03-19T12:00:00Z", true],
    ["2022-03-19T12:00:00Z", false],
  ])("respects leap Esfand in %s and keeps an empty month navigable", (date, leap) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(date));
    const html = renderCalendar();
    expect(html).toContain('class="calendar-grid"');
    expect(html).toContain("موعدی در این ماه ثبت نشده");
    expect(html.includes(">۳۰</span>")).toBe(leap);
    expect(html).toContain('aria-label="سال تقویم"');
  });
});

describe("shared range and single-date calendar", () => {
  it("uses Jalali month calculations and offers both month and year dropdowns", () => {
    const date = new Date(2024, 2, 20);
    const html = renderToStaticMarkup(<Calendar mode="single" selected={date} defaultMonth={date} />);
    expect(html).toContain("فروردین");
    expect(html).toContain("۱۴۰۳");
    expect(html).toContain("rdp-months_dropdown");
    expect(html).toContain("rdp-years_dropdown");
    expect(html).toContain('aria-label="ماه"');
    expect(html).toContain('aria-label="سال"');
    expect(html).toContain('dir="rtl"');
    expect(html).not.toContain("March");
  });
});

describe("calendar date navigation", () => {
  it("preserves the chosen day when moving to another month or year", () => {
    expect(changePersianCalendarPeriod("2024-03-20", 1403, 2)).toBe("2024-04-20");
    expect(changePersianCalendarPeriod(jalaliToDateOnly(1403, 6, 31), 1403, 7)).toBe(jalaliToDateOnly(1403, 7, 30));
  });
  it("clamps leap Esfand's last day when switching to a non-leap year", () => {
    expect(changePersianCalendarPeriod("2021-03-20", 1400, 12)).toBe("2022-03-20");
  });
  it.each([
    ["invalid", 1403, 1],
    ["2024-03-20", 1403, 13],
    ["2024-03-20", 1403, 0],
    ["2024-03-20", 99999, 1],
    ["2024-03-20", 1403.5, 1],
  ] as const)("rejects invalid navigation %s/%s/%s", (value, year, month) => {
    expect(changePersianCalendarPeriod(value, year, month)).toBe("");
  });
  it("shows labelled month, year and day controls with a readable period heading", () => {
    const html = renderToStaticMarkup(
      <PersianCalendarNavigation value="2024-03-20" onChange={() => undefined} description="۲ کار در این ماه" />
    );
    expect(html).toContain("فروردین");
    expect(html).toContain("۱۴۰۳");
    expect(html).toContain("۲ کار در این ماه");
    expect(html).toContain('aria-label="رفتن به تاریخ"');
    expect(html).toContain('aria-label="ماه تقویم"');
    expect(html).toContain('aria-label="سال تقویم"');
    expect(html).toContain("۱ فروردین ۱۴۰۳");
  });
  it("disables date selection, both dropdowns and all navigation actions together", () => {
    const html = renderToStaticMarkup(
      <PersianCalendarNavigation value="2024-03-20" onChange={() => undefined} disabled />
    );
    expect(html.match(/<button[^>]*disabled/g)).toHaveLength(6);
    expect(html.match(/<input[^>]*disabled/g)).toHaveLength(2);
  });
  it("marks the selected day without treating it as a task deadline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-03-20T12:00:00Z"));
    const html = renderCalendar();
    expect(html).toContain('data-selected="true" aria-label="۱ فروردین ۱۴۰۳"');
    expect(html).toContain("۰ کار در این ماه");
    expect(html).toContain("موعدی در این ماه ثبت نشده");
  });
});
