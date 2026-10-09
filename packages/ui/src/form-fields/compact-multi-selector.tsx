import { useState } from "react";

export function CompactMultiSelector({
  label,
  options,
  selected,
  onChange,
  disabled = false,
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
}) {
  const [query, setQuery] = useState("");
  const filtered = options.filter((option) =>
    `${option.title} ${option.description ?? ""} ${option.category ?? ""}`.toLowerCase().includes(query.toLowerCase())
  );
  const groups = [...new Set(filtered.map((option) => option.category ?? ""))];
  return (
    <fieldset className="compact-selector" disabled={disabled}>
      <legend>
        {label} · {selected.length.toLocaleString("fa-IR")} انتخاب
      </legend>
      <label className="selector-search">
        <span className="sr-only">جستجو در {label}</span>
        <input type="search" placeholder="جستجو…" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <div className="selector-toolbar">
        <button
          type="button"
          onClick={() =>
            onChange([
              ...new Set([...selected, ...filtered.filter((option) => !option.disabled).map((option) => option.id)]),
            ])
          }
        >
          انتخاب نتایج
        </button>
        <button type="button" onClick={() => onChange([])}>
          پاک کردن
        </button>
      </div>
      {selected.length > 0 && (
        <div className="selector-selected" aria-label="انتخاب‌های فعلی">
          {options
            .filter((option) => selected.includes(option.id))
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
        </div>
      )}
      <div className="selector-options">
        {filtered.length === 0 && (
          <p role="status">{options.length ? "نتیجه‌ای یافت نشد." : "گزینه‌ای برای انتخاب وجود ندارد."}</p>
        )}
        {groups.map((group) => (
          <div key={group}>
            {group && <h4>{group}</h4>}
            {filtered
              .filter((option) => (option.category ?? "") === group)
              .map((option) => (
                <label key={option.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(option.id)}
                    disabled={option.disabled}
                    onChange={(event) =>
                      onChange(
                        event.target.checked ? [...selected, option.id] : selected.filter((id) => id !== option.id)
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
                    {option.description && <small dir="auto">{option.description}</small>}
                  </span>
                </label>
              ))}
          </div>
        ))}
      </div>
    </fieldset>
  );
}
