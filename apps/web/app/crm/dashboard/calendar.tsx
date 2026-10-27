import {
  displayPersianDate,
  jalaliToDateOnly,
  parseDateOnly,
  PersianDatePicker,
  persianDigits,
  persianMonths,
  zonedDateTime,
} from "@plane/ui";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { jalaaliMonthLength } from "jalaali-js";
import { useState } from "react";
import { Link } from "react-router";
import { errorMessage } from "../api";
import { Button } from "../components";
import { persianDate } from "../utils";
import { useWidgetData } from "./api";
import type { DashboardWidget } from "./types";

const weekdays = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];
const oneDay = 86_400_000;

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function dashboardCalendarRange(value: string, view: "month" | "week") {
  const selected = parseDateOnly(value);
  if (!selected) return undefined;
  if (view === "week") {
    const weekday = (new Date(`${value}T12:00:00Z`).getUTCDay() + 1) % 7;
    const start = shiftDate(value, -weekday);
    return { start, end: shiftDate(start, 7) };
  }
  const start = jalaliToDateOnly(selected.jy, selected.jm, 1);
  return { start, end: shiftDate(start, jalaaliMonthLength(selected.jy, selected.jm)) };
}

export function stepDashboardCalendar(value: string, view: "month" | "week", direction: number) {
  if (view === "week") return shiftDate(value, direction * 7);
  const selected = parseDateOnly(value);
  if (!selected) return value;
  const absolute = selected.jy * 12 + selected.jm - 1 + direction;
  const year = Math.floor(absolute / 12);
  const month = (((absolute % 12) + 12) % 12) + 1;
  return jalaliToDateOnly(year, month, Math.min(selected.jd, jalaaliMonthLength(year, month)));
}

export function DashboardCalendar({ widget }: { widget: DashboardWidget }) {
  const today = zonedDateTime(new Date())!.date;
  const [selectedDate, setSelectedDate] = useState(today);
  const view = widget.config.calendar_view === "week" ? "week" : "month";
  const range = dashboardCalendarRange(selectedDate, view)!;
  const queryWidget = { ...widget, config: { ...widget.config, calendar_range: range } };
  const result = useWidgetData(queryWidget);
  const entity = String(widget.config.entity || "ticket");
  const selected = parseDateOnly(selectedDate)!;
  const monthName = persianMonths[selected.jm - 1];
  const title =
    view === "week"
      ? `${persianDate(range.start, { year: "numeric" })} تا ${persianDate(shiftDate(range.end, -1), { year: "numeric" })}`
      : `${monthName} ${persianDigits(selected.jy)}`;
  const days = Math.round((Date.parse(`${range.end}T00:00:00Z`) - Date.parse(`${range.start}T00:00:00Z`)) / oneDay);
  const offset = view === "month" ? (new Date(`${range.start}T12:00:00Z`).getUTCDay() + 1) % 7 : 0;
  const cells = Array.from(
    { length: view === "month" ? Math.ceil((offset + days) / 7) * 7 : 7 },
    (_, index) => index - offset
  );
  const items = Array.isArray(result.data?.items)
    ? (result.data.items as { id: string; date: string; title?: string }[])
    : [];
  const events = new Map<string, typeof items>();
  for (const item of items) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(item.date) ? item.date : zonedDateTime(item.date)?.date;
    if (date && date >= range.start && date < range.end) events.set(date, [...(events.get(date) || []), item]);
  }

  return (
    <section className="dashboard-persian-calendar" dir="rtl" aria-label="تقویم شمسی داشبورد">
      <div className="dashboard-calendar-toolbar">
        <div className="dashboard-calendar-title">
          <strong>{title}</strong>
          <span>{view === "week" ? "نمای هفتگی شمسی" : "نمای ماهانه شمسی"}</span>
        </div>
        <div className="dashboard-calendar-actions">
          <button
            type="button"
            aria-label={view === "week" ? "هفته قبل" : "ماه قبل"}
            onClick={() => setSelectedDate(stepDashboardCalendar(selectedDate, view, -1))}
          >
            <ChevronRight size={17} />
          </button>
          <button type="button" onClick={() => setSelectedDate(today)}>
            <RotateCcw size={14} /> امروز
          </button>
          <button
            type="button"
            aria-label={view === "week" ? "هفته بعد" : "ماه بعد"}
            onClick={() => setSelectedDate(stepDashboardCalendar(selectedDate, view, 1))}
          >
            <ChevronLeft size={17} />
          </button>
        </div>
        <PersianDatePicker
          label="رفتن به تاریخ در تقویم داشبورد"
          value={selectedDate}
          allowClear={false}
          onChange={setSelectedDate}
        />
      </div>
      {result.isError ? (
        <div className="dashboard-widget-error">
          <p>{errorMessage(result.error, "دریافت تقویم انجام نشد")}</p>
          <Button variant="secondary" onClick={() => result.refetch()}>
            تلاش دوباره
          </Button>
        </div>
      ) : (
        <>
          <div className="dashboard-calendar-weekdays" aria-hidden="true">
            {weekdays.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="dashboard-calendar-grid" aria-label={title}>
            {cells.map((offsetDay) => {
              const iso = offsetDay >= 0 && offsetDay < days ? shiftDate(range.start, offsetDay) : "";
              const jalali = iso ? displayPersianDate(iso) : undefined;
              const dayEvents = iso ? events.get(iso) || [] : [];
              return (
                <div
                  key={offsetDay}
                  className={`dashboard-calendar-day${iso ? "" : " outside"}${iso === today ? " today" : ""}`}
                  aria-label={
                    jalali
                      ? `${persianDigits(jalali.jd)} ${persianMonths[jalali.jm - 1]} ${persianDigits(jalali.jy)}`
                      : undefined
                  }
                >
                  {jalali && (
                    <>
                      <div className="dashboard-calendar-day-heading">
                        <span>{persianDigits(jalali.jd)}</span>
                        {dayEvents.length > 0 && <small>{persianDigits(dayEvents.length)} رویداد</small>}
                      </div>
                      {dayEvents.map((item) => (
                        <Link
                          key={item.id}
                          to={`/entities/${entity}/${item.id}`}
                          title={item.title || `${persianDigits(jalali.jd)} ${persianMonths[jalali.jm - 1]}`}
                        >
                          {item.title || "باز کردن رکورد"}
                        </Link>
                      ))}
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {result.isLoading && <p className="dashboard-calendar-status">در حال دریافت رویدادها…</p>}
          {!result.isLoading && !items.length && (
            <p className="dashboard-calendar-status">رویدادی در این {view === "week" ? "هفته" : "ماه"} ثبت نشده است.</p>
          )}
        </>
      )}
    </section>
  );
}
