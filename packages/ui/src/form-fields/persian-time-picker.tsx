import { useEffect, useId, useState } from "react";
import { ChevronDown, ChevronUp, Clock3 } from "lucide-react";
import { persianDigits } from "./persian-date-utils";

export interface PersianTimePickerProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  disabled?: boolean;
}

const pad = (value: number) => String(value).padStart(2, "0");
const normalizeDigits = (value: string) =>
  value
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));

export function PersianTimePicker({ value, onChange, label, disabled = false }: PersianTimePickerProps) {
  const id = useId();
  const [hour, setHour] = useState(value.slice(0, 2));
  const [minute, setMinute] = useState(value.slice(3, 5));
  useEffect(() => {
    // Keep an unfinished entry while the controlled value catches up with typing.
    setHour((current) =>
      current !== "" && Number(current) === Number(value.slice(0, 2)) ? current : value.slice(0, 2)
    );
    setMinute((current) =>
      current !== "" && Number(current) === Number(value.slice(3, 5)) ? current : value.slice(3, 5)
    );
  }, [value]);

  const change = (part: "hour" | "minute", next: string) => {
    const normalized = normalizeDigits(next);
    const maximum = part === "hour" ? 23 : 59;
    if (!/^\d{0,2}$/.test(normalized) || Number(normalized) > maximum) return;
    if (part === "hour") setHour(normalized);
    else setMinute(normalized);
    if (normalized !== "") {
      onChange(
        part === "hour"
          ? `${pad(Number(normalized))}:${value.slice(3, 5)}`
          : `${value.slice(0, 2)}:${pad(Number(normalized))}`
      );
    }
  };
  const step = (part: "hour" | "minute", direction: number) => {
    const maximum = part === "hour" ? 24 : 60;
    const current = Number(part === "hour" ? hour || value.slice(0, 2) : minute || value.slice(3, 5));
    change(part, pad((current + direction + maximum) % maximum));
  };

  return (
    <fieldset
      className="persian-time-picker"
      disabled={disabled}
      aria-label={label ? `ساعت ${label}` : "انتخاب ساعت"}
      dir="rtl"
    >
      <div className="persian-time-heading" aria-hidden="true">
        <span>
          <Clock3 size={16} />
          {label ? `ساعت ${label}` : "انتخاب ساعت"}
        </span>
        <small>۲۴ ساعته</small>
      </div>
      <div className="persian-time-segments" dir="ltr">
        {(["hour", "minute"] as const).map((part, index) => {
          const title = part === "hour" ? "ساعت" : "دقیقه";
          const accessibleLabel = label ? `${title} ${label}` : title;
          const current = part === "hour" ? hour : minute;
          return (
            <div className="persian-time-unit" key={part}>
              {index === 1 && (
                <span className="persian-time-colon" aria-hidden="true">
                  :
                </span>
              )}
              <label htmlFor={`${id}-${part}`}>{title}</label>
              <div className="persian-time-control">
                <input
                  id={`${id}-${part}`}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  role="spinbutton"
                  aria-label={accessibleLabel}
                  aria-valuemin={0}
                  aria-valuemax={part === "hour" ? 23 : 59}
                  aria-valuenow={Number(current || (part === "hour" ? value.slice(0, 2) : value.slice(3, 5)))}
                  value={persianDigits(current)}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => change(part, event.target.value)}
                  onBlur={() => (part === "hour" ? setHour(value.slice(0, 2)) : setMinute(value.slice(3, 5)))}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                      event.preventDefault();
                      step(part, event.key === "ArrowUp" ? 1 : -1);
                    }
                  }}
                />
                <div className="persian-time-steppers">
                  <button type="button" aria-label={`افزایش ${accessibleLabel}`} onClick={() => step(part, 1)}>
                    <ChevronUp size={16} />
                  </button>
                  <button type="button" aria-label={`کاهش ${accessibleLabel}`} onClick={() => step(part, -1)}>
                    <ChevronDown size={16} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="persian-time-presets">
        <span>دقیقه</span>
        {["00", "15", "30", "45"].map((preset) => (
          <button
            type="button"
            key={preset}
            aria-label={`${persianDigits(preset)} دقیقه${label ? ` ${label}` : ""}`}
            aria-pressed={value.slice(3, 5) === preset}
            onClick={() => change("minute", preset)}
          >
            {persianDigits(preset)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
