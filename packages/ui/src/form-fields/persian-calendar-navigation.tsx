import { CalendarDays, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import jalaali from "jalaali-js";
import { PersianDatePicker } from "./persian-date-picker";
import { jalaliToDateOnly, parseDateOnly, persianDigits, persianMonths, zonedDateTime } from "./persian-date-utils";
import { SearchableSelect } from "./searchable-select";

/** Preserve the selected day when possible, including leap-year and month-end transitions. */
export function changePersianCalendarPeriod(value: string, year: number, month: number) {
  const selected = parseDateOnly(value);
  if (!selected || !Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return "";
  try {
    return jalaliToDateOnly(year, month, Math.min(selected.jd, jalaali.jalaaliMonthLength(year, month)));
  } catch {
    return "";
  }
}

export function PersianCalendarNavigation({
  value,
  onChange,
  timeZone,
  description = "تقویم شمسی",
  disabled = false,
}: {
  value: string;
  onChange: (date: string) => void;
  timeZone?: string;
  description?: string;
  disabled?: boolean;
}) {
  const todayValue = zonedDateTime(new Date(), timeZone)?.date ?? "";
  const today = parseDateOnly(todayValue)!;
  const selected = parseDateOnly(value) ?? today;
  const validValue = parseDateOnly(value) ? value : todayValue;
  const years = Array.from({ length: 101 }, (_, index) => today.jy - 50 + index);
  if (!years.includes(selected.jy)) years.push(selected.jy);
  // eslint-disable-next-line unicorn/no-array-sort -- This local array supports the ES2022 browser target.
  years.sort((a, b) => a - b);
  const periodChange = (year: number, month: number) => {
    const date = changePersianCalendarPeriod(validValue, year, month);
    if (date) onChange(date);
  };
  const adjacent = (offset: number) => {
    const absolute = selected.jy * 12 + selected.jm - 1 + offset;
    return changePersianCalendarPeriod(validValue, Math.floor(absolute / 12), (((absolute % 12) + 12) % 12) + 1);
  };

  return (
    <section className="persian-calendar-navigation" aria-label="انتخاب تاریخ تقویم" dir="rtl">
      <div className="persian-navigation-heading">
        <div className="persian-navigation-summary">
          <span className="persian-navigation-icon" aria-hidden="true">
            <CalendarDays size={21} />
          </span>
          <div>
            <h2>
              {persianMonths[selected.jm - 1]} <span>{persianDigits(selected.jy)}</span>
            </h2>
            <p>{description}</p>
          </div>
        </div>
        <div className="persian-navigation-actions">
          <button
            type="button"
            className="persian-navigation-today"
            disabled={disabled}
            onClick={() => onChange(todayValue)}
          >
            <RotateCcw size={14} aria-hidden="true" />
            امروز
          </button>
          <div className="persian-navigation-arrows">
            <button
              type="button"
              aria-label="ماه قبل"
              disabled={disabled || !adjacent(-1)}
              onClick={() => onChange(adjacent(-1))}
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="ماه بعد"
              disabled={disabled || !adjacent(1)}
              onClick={() => onChange(adjacent(1))}
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
      <div className="persian-navigation-fields">
        <div>
          <span>ماه</span>
          <SearchableSelect
            label="ماه تقویم"
            value={String(selected.jm)}
            disabled={disabled}
            onChange={(month) => periodChange(selected.jy, Number(month))}
            options={persianMonths.map((month, index) => ({ id: String(index + 1), title: month }))}
          />
        </div>
        <div>
          <span>سال</span>
          <SearchableSelect
            label="سال تقویم"
            value={String(selected.jy)}
            disabled={disabled}
            onChange={(year) => periodChange(Number(year), selected.jm)}
            options={years.map((year) => ({ id: String(year), title: persianDigits(year) }))}
          />
        </div>
        <div className="persian-navigation-date">
          <span>رفتن به یک روز مشخص</span>
          <PersianDatePicker
            label="رفتن به تاریخ"
            value={validValue}
            timeZone={timeZone}
            disabled={disabled}
            allowClear={false}
            onChange={(date) => {
              if (parseDateOnly(date)) onChange(date);
            }}
          />
        </div>
      </div>
    </section>
  );
}
