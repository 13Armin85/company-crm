import { useState } from "react";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { normalizePersianSearch } from "./searchable-select";

export function CompactMultiSelector({
  label,
  options,
  selected,
  onChange,
  disabled = false,
  expanded = false,
}: {
  label: string;
  options: {
    id: string;
    title: string;
    description?: string;
    category?: string;
    disabled?: boolean;
    initials?: string;
    avatarUrl?: string;
  }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  expanded?: boolean;
}) {
  const [query, setQuery] = useState("");
  const filtered = options.filter((option) =>
    normalizePersianSearch(`${option.title} ${option.description ?? ""} ${option.category ?? ""}`).includes(
      normalizePersianSearch(query)
    )
  );
  const groups = [...new Set(filtered.map((option) => option.category ?? ""))];
  return (
    <fieldset className="compact-selector" disabled={disabled}>
      <legend>
        {label} · {selected.length.toLocaleString("fa-IR")} انتخاب
      </legend>
      {selected.length > 0 && (
        <div className="selector-selected" aria-label="انتخاب‌های فعلی">
          {options
            .filter((option) => selected.includes(option.id))
            .slice(0, 2)
            .map((option) => (
              <span key={option.id}>
                {option.title}
                <button
                  type="button"
                  aria-label={`حذف انتخاب ${option.title}`}
                  onClick={() => onChange(selected.filter((id) => id !== option.id))}
                >
                  ×
                </button>
              </span>
            ))}
          {selected.length > 2 && <span>{(selected.length - 2).toLocaleString("fa-IR")} مورد دیگر</span>}
        </div>
      )}
      <Popover>
        {!expanded && (
          <PopoverButton type="button" className="selector-trigger" disabled={disabled}>
            انتخاب {label} · {selected.length.toLocaleString("fa-IR")} انتخاب ⌄
          </PopoverButton>
        )}
        <PopoverPanel static={expanded} className="selector-panel" focus={!expanded}>
          <label className="selector-search">
            <span className="sr-only">جستجو در {label}</span>
            <input
              type="search"
              placeholder="جستجو…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="selector-toolbar">
            <button
              type="button"
              onClick={() =>
                onChange([
                  ...new Set([
                    ...selected,
                    ...filtered.filter((option) => !option.disabled).map((option) => option.id),
                  ]),
                ])
              }
            >
              انتخاب نتایج
            </button>
            <button
              type="button"
              onClick={() => onChange(selected.filter((id) => !filtered.some((option) => option.id === id)))}
            >
              پاک کردن نتایج
            </button>
          </div>
          <div
            className="selector-options"
            role="group"
            onKeyDown={(event) => {
              if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
              const inputs = Array.from(
                event.currentTarget.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:not(:disabled)')
              );
              const index = inputs.indexOf(event.target as HTMLInputElement);
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? inputs.length - 1
                    : Math.max(0, Math.min(inputs.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
              event.preventDefault();
              inputs[next]?.focus();
            }}
          >
            {filtered.length === 0 && (
              <p role="status">{options.length ? "نتیجه‌ای یافت نشد." : "گزینه‌ای برای انتخاب وجود ندارد."}</p>
            )}
            {groups.map((group) => (
              <div key={group}>
                {group && <h4>{group}</h4>}
                {filtered
                  .filter((option) => (option.category ?? "") === group)
                  .map((option) => (
                    <label key={option.id} className="selector-option">
                      <input
                        type="checkbox"
                        checked={selected.includes(option.id)}
                        disabled={Boolean(option.disabled) && !selected.includes(option.id)}
                        onChange={(event) =>
                          onChange(
                            event.target.checked
                              ? [...new Set([...selected, option.id])]
                              : selected.filter((id) => id !== option.id)
                          )
                        }
                      />
                      {(option.initials || option.avatarUrl) && (
                        <span className="selector-avatar" aria-hidden="true">
                          {option.avatarUrl ? <img src={option.avatarUrl} alt="" /> : option.initials}
                        </span>
                      )}
                      <span>
                        {option.title}
                        {option.disabled && <small>???????</small>}
                        {option.description && <small dir="auto">{option.description}</small>}
                      </span>
                    </label>
                  ))}
              </div>
            ))}
          </div>
        </PopoverPanel>
      </Popover>
    </fieldset>
  );
}
