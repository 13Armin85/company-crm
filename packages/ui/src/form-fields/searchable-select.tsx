import { useId, useState } from "react";
import { ErrorNotice } from "../error-notice";
import { Combobox, ComboboxButton, ComboboxInput, ComboboxOption, ComboboxOptions } from "@headlessui/react";

export const normalizePersianSearch = (text: string) =>
  text
    .toLowerCase()
    .replace(/ي|ى/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[۰-۹٠-٩]/g, (digit) => String(digit.charCodeAt(0) & 15))
    .replace(/[\s\u200c\u200d]+/g, "")
    .trim();

export function SearchableSelect({
  value,
  onChange,
  options,
  label,
  placeholder = "انتخاب…",
  disabled = false,
  loading = false,
  error,
  id,
  wrapOptions = true,
  optionClassName = "",
  selectedLabel,
  containedOptions = false,
  showLabel = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { id: string; title: string; description?: string; disabled?: boolean }[];
  label: string;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  error?: string;
  id?: string;
  wrapOptions?: boolean;
  optionClassName?: string;
  selectedLabel?: string;
  containedOptions?: boolean;
  showLabel?: boolean;
}) {
  const [query, setQuery] = useState("");
  const generatedId = useId();
  const inputId = id || generatedId;
  const filtered = options.filter((option) =>
    normalizePersianSearch(`${option.title} ${option.description ?? ""}`).includes(normalizePersianSearch(query))
  );
  const visibleOptions: typeof options = filtered.length
    ? filtered
    : [{ id: "\u0000empty", title: "نتیجه‌ای یافت نشد.", disabled: true }];
  const visibleById = new Map(visibleOptions.map((option) => [option.id, option]));
  return (
    <div
      className="searchable-select"
      data-transfer-field={optionClassName === "member-transfer-options" ? "" : undefined}
    >
      {showLabel && <label htmlFor={inputId}>{label}</label>}
      <Combobox
        value={value}
        onChange={(next: string | null) => {
          if (next !== null) onChange(next);
        }}
        disabled={disabled || loading}
        onClose={() => setQuery("")}
        virtual={{
          options: visibleOptions.map((option) => option.id),
          disabled: (optionId) => Boolean(visibleById.get(optionId)?.disabled),
        }}
      >
        <div className="selector-input-row">
          <ComboboxInput
            defaultValue={selectedLabel}
            id={inputId}
            aria-label={label}
            aria-invalid={Boolean(error)}
            placeholder={loading ? "در حال دریافت…" : placeholder}
            displayValue={(current: string) =>
              options.find((option) => option.id === current)?.title ?? selectedLabel ?? ""
            }
            onChange={(event) => setQuery(event.target.value)}
          />
          <ComboboxButton type="button" aria-label={`باز کردن ${label}`}>
            ⌄
          </ComboboxButton>
        </div>
        <ComboboxOptions
          data-transfer-options={optionClassName === "member-transfer-options" ? "" : undefined}
          className={`selector-panel selector-single-options${wrapOptions ? "" : " selector-single-options-nowrap"}${containedOptions ? " selector-single-options-contained" : ""} ${optionClassName}`}
          anchor={containedOptions ? undefined : "bottom start"}
          portal={!containedOptions}
          modal={false}
          dir="rtl"
        >
          {({ option: optionId }: { option: string }) => {
            const option = visibleById.get(optionId);
            if (!option)
              return <ComboboxOption value={optionId || "\u0000stale"} disabled className="selector-single-option" />;
            return (
              <ComboboxOption
                key={option.id}
                value={option.id}
                disabled={option.disabled}
                className="selector-single-option"
              >
                {filtered.length ? (
                  <>
                    {option.title}
                    {option.disabled && " (غیرفعال)"}
                    {option.description && <small dir="auto">{option.description}</small>}
                  </>
                ) : (
                  <p role="status">{option.title}</p>
                )}
              </ComboboxOption>
            );
          }}
        </ComboboxOptions>
      </Combobox>
      <ErrorNotice message={error} />
    </div>
  );
}
