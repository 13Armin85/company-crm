import { useEffect, useId, useState } from "react";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import jalaali from "jalaali-js";
import { SearchableSelect } from "./searchable-select";
import { PersianTimePicker } from "./persian-time-picker";
import {
  CRM_TIME_ZONE,
  jalaliToDateOnly,
  parseDateOnly,
  persianDigits,
  persianMonths,
  validTimeZone,
  zonedDateTime,
  zonedDateTimeToISO,
} from "./persian-date-utils";

const { jalaaliMonthLength } = jalaali;

export interface PersianDatePickerProps {
  id?: string;
  label?: string;
  value?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  min?: string;
  max?: string;
  timeZone?: string;
  allowClear?: boolean;
}

export function PersianDatePicker({
  id,
  label = "تاریخ",
  value,
  onChange,
  disabled,
  required,
  error,
  min,
  max,
  timeZone = CRM_TIME_ZONE,
  allowClear = true,
}: PersianDatePickerProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const todayValue = zonedDateTime(new Date(), timeZone)!.date;
  const today = parseDateOnly(todayValue)!;
  const chosen = parseDateOnly(value);
  const chosenYear = chosen?.jy;
  const chosenMonth = chosen?.jm;
  const [view, setView] = useState({ year: chosen?.jy ?? today.jy, month: chosen?.jm ?? today.jm });
  useEffect(() => {
    if (chosenYear && chosenMonth) setView({ year: chosenYear, month: chosenMonth });
  }, [chosenYear, chosenMonth]);
  const move = (offset: number) => {
    const absolute = view.year * 12 + view.month - 1 + offset;
    setView({ year: Math.floor(absolute / 12), month: (((absolute % 12) + 12) % 12) + 1 });
  };
  const first = jalaliToDateOnly(view.year, view.month, 1);
  const weekday = (new Date(`${first}T12:00:00Z`).getUTCDay() + 1) % 7;
  const count = jalaaliMonthLength(view.year, view.month);
  const allowed = (date: string) => Boolean(date) && (!min || date >= min) && (!max || date <= max);
  return (
    <div className="persian-date-picker" dir="rtl">
      <Popover>
        <PopoverButton
          id={controlId}
          type="button"
          disabled={disabled}
          className="persian-date-trigger"
          aria-label={label}
          aria-invalid={Boolean(error || (value && !chosen))}
        >
          {chosen
            ? `${persianDigits(chosen.jd)} ${persianMonths[chosen.jm - 1]} ${persianDigits(chosen.jy)}`
            : "انتخاب تاریخ شمسی"}
          <CalendarDays size={18} aria-hidden="true" />
        </PopoverButton>
        <PopoverPanel className="selector-panel persian-calendar" anchor="bottom start" dir="rtl">
          {({ close }) => (
            <>
              <div className="persian-calendar-header">
                <button type="button" aria-label="ماه قبل" onClick={() => move(-1)}>
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
                <select
                  aria-label="ماه"
                  value={view.month}
                  onChange={(event) => setView({ ...view, month: Number(event.target.value) })}
                >
                  {persianMonths.map((month, index) => (
                    <option key={month} value={index + 1}>
                      {month}
                    </option>
                  ))}
                </select>
                <SearchableSelect
                  label="سال"
                  value={String(view.year)}
                  onChange={(year) => setView({ ...view, year: Number(year) })}
                  options={Array.from({ length: 101 }, (_, index) => view.year - 50 + index).map((year) => ({
                    id: String(year),
                    title: persianDigits(year),
                  }))}
                />
                <button type="button" aria-label="ماه بعد" onClick={() => move(1)}>
                  <ChevronLeft size={18} aria-hidden="true" />
                </button>
              </div>
              <div className="persian-calendar-weekdays" aria-hidden="true">
                {["ش", "ی", "د", "س", "چ", "پ", "ج"].map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>
              <div
                className="persian-calendar-grid"
                role="group"
                aria-label="روزهای ماه"
                onKeyDown={(event) => {
                  const offset = { ArrowLeft: 1, ArrowRight: -1, ArrowDown: 7, ArrowUp: -7 }[event.key];
                  if (offset === undefined) return;
                  const buttons = Array.from(
                    event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")
                  );
                  const index = buttons.indexOf(event.target as HTMLButtonElement);
                  event.preventDefault();
                  buttons[Math.max(0, Math.min(buttons.length - 1, index + offset))]?.focus();
                }}
              >
                {Array.from({ length: weekday }, (_, index) => (
                  <span key={`blank-${index}`} aria-hidden="true" />
                ))}
                {Array.from({ length: count }, (_, index) => index + 1).map((day) => {
                  const date = jalaliToDateOnly(view.year, view.month, day);
                  return (
                    <button
                      key={day}
                      type="button"
                      disabled={!allowed(date)}
                      aria-label={`${persianDigits(day)} ${persianMonths[view.month - 1]} ${persianDigits(view.year)}`}
                      aria-pressed={date === value}
                      data-today={date === todayValue || undefined}
                      aria-current={date === todayValue ? "date" : undefined}
                      onClick={() => {
                        onChange(date);
                        close();
                      }}
                    >
                      {persianDigits(day)}
                    </button>
                  );
                })}
              </div>
              <div className="persian-calendar-footer">
                <button
                  type="button"
                  disabled={!allowed(todayValue)}
                  onClick={() => {
                    onChange(todayValue);
                    close();
                  }}
                >
                  امروز
                </button>
                {allowClear && (
                  <button
                    type="button"
                    onClick={() => {
                      onChange("");
                      close();
                    }}
                  >
                    پاک‌کردن
                  </button>
                )}
              </div>
            </>
          )}
        </PopoverPanel>
      </Popover>
      {required && (
        <input
          className="date-validation-input"
          disabled={disabled}
          aria-label={`${label} الزامی`}
          value={chosen ? value : ""}
          required
          tabIndex={-1}
          onChange={() => undefined}
          onInvalid={() => document.getElementById(controlId)?.focus()}
        />
      )}
      {(error || (value && !chosen)) && <p role="alert">{error || "تاریخ واردشده معتبر نیست."}</p>}
    </div>
  );
}

export function PersianDateTimePicker({ value, onChange, timeZone, min, max, ...props }: PersianDatePickerProps) {
  const generatedId = useId();
  const controlId = props.id ?? generatedId;
  const zone = validTimeZone(timeZone);
  const parts = value ? zonedDateTime(value, zone) : undefined;
  const [date, setDate] = useState(parts?.date ?? "");
  const [time, setTime] = useState(parts?.time ?? "00:00");
  const [error, setError] = useState("");
  useEffect(() => {
    const next = value ? zonedDateTime(value, zone) : undefined;
    setDate(next?.date ?? "");
    setTime(next?.time ?? "00:00");
  }, [value, zone]);
  const update = (nextDate: string, nextTime: string) => {
    setDate(nextDate);
    setTime(nextTime);
    const result = nextDate ? zonedDateTimeToISO(nextDate, nextTime, zone) : "";
    const invalid =
      Boolean(nextDate && !result) ||
      Boolean(
        result && ((min && Date.parse(result) < Date.parse(min)) || (max && Date.parse(result) > Date.parse(max)))
      );
    setError(invalid ? "زمان انتخاب‌شده معتبر یا در بازهٔ مجاز نیست." : "");
    if (!invalid) onChange(result);
  };
  const validationError = error || (value && !parts ? "زمان واردشده معتبر نیست." : props.error);
  return (
    <div className="persian-datetime-picker">
      <PersianDatePicker
        {...props}
        id={controlId}
        required={false}
        value={date}
        timeZone={zone}
        min={min ? zonedDateTime(min, zone)?.date : undefined}
        max={max ? zonedDateTime(max, zone)?.date : undefined}
        error={validationError}
        onChange={(next) => update(next, time)}
      />
      <PersianTimePicker
        label={props.label}
        value={time}
        disabled={props.disabled}
        onChange={(next) => update(date, next)}
      />
      <input
        className="date-validation-input"
        aria-label={`${props.label ?? "زمان"} اعتبارسنجی`}
        disabled={props.disabled}
        required={props.required}
        value={value ?? ""}
        tabIndex={-1}
        ref={(input) => input?.setCustomValidity(validationError ?? "")}
        onChange={() => undefined}
        onInvalid={() => document.getElementById(controlId)?.focus()}
      />
    </div>
  );
}
