import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { DashboardCalendar, dashboardCalendarRange, stepDashboardCalendar } from "./calendar";
import type { DashboardWidget } from "./types";

vi.mock("./api", () => ({
  useWidgetData: () => ({
    data: {
      items: [
        { id: "new-year", date: "2024-03-20", title: "کار نوروز" },
        { id: "previous-year", date: "2024-03-19" },
      ],
    },
    isLoading: false,
    isError: false,
  }),
}));

afterEach(() => vi.useRealTimers());

describe("dashboard Persian calendar", () => {
  it("requests the exact Jalali month across Nowruz", () => {
    expect(dashboardCalendarRange("2024-03-20", "month")).toEqual({ start: "2024-03-20", end: "2024-04-20" });
    expect(dashboardCalendarRange("2024-03-19", "month")).toEqual({ start: "2024-02-20", end: "2024-03-20" });
    expect(dashboardCalendarRange("invalid", "month")).toBeUndefined();
  });

  it("starts the week on Saturday and keeps navigation in the Jalali month", () => {
    expect(dashboardCalendarRange("2024-03-20", "week")).toEqual({ start: "2024-03-16", end: "2024-03-23" });
    expect(stepDashboardCalendar("2024-03-20", "month", 1)).toBe("2024-04-20");
    expect(stepDashboardCalendar("2024-03-20", "week", 1)).toBe("2024-03-27");
  });

  it("labels a week across Nowruz with both Persian dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-03-20T12:00:00Z"));
    const widget: DashboardWidget = {
      id: "calendar-week",
      type: "calendar",
      x: 0,
      y: 0,
      w: 6,
      h: 3,
      config: { entity: "ticket", date_field: "due_date", calendar_view: "week" },
    };
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <DashboardCalendar widget={widget} />
      </MemoryRouter>
    );
    expect(html).toContain("۲۶ اسفند ۱۴۰۲ تا ۳ فروردین ۱۴۰۳");
  });

  it("renders Persian days and only events inside the selected month", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-03-20T12:00:00Z"));
    const widget: DashboardWidget = {
      id: "calendar",
      type: "calendar",
      x: 0,
      y: 0,
      w: 6,
      h: 3,
      config: { entity: "ticket", calendar_view: "month" },
    };
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <DashboardCalendar widget={widget} />
      </MemoryRouter>
    );
    expect(html).toContain('aria-label="تقویم شمسی داشبورد"');
    expect(html).toContain("فروردین ۱۴۰۳");
    expect(html).toContain('aria-label="۱ فروردین ۱۴۰۳"');
    expect(html).toContain("/entities/ticket/new-year");
    expect(html).toContain("کار نوروز");
    expect(html).not.toContain("/entities/ticket/previous-year");
  });
});
