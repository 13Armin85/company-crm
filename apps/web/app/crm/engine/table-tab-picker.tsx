import { useState } from "react";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { Eye, Search } from "lucide-react";
import { normalizePersianSearch } from "@plane/ui";

export const MAIN_TABLE_TAB = "__main__";
const storageKey = (code: string) => `crm-table-tabs:${code}`;

/** Each viewer picks which table tabs they see; the choice stays in their browser. */
export function useHiddenTabs(key: string) {
  const [hidden, setHidden] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey(key)) || "[]") as string[];
    } catch {
      return [];
    }
  });
  const update = (next: string[]) => {
    setHidden(next);
    try {
      localStorage.setItem(storageKey(key), JSON.stringify(next));
    } catch {
      /* Private mode: the choice lasts for this visit only. */
    }
  };
  return [hidden, update] as const;
}

export function useVisibleTableTabs(code: string, tabIds: string[]) {
  const [hidden, update] = useHiddenTabs(code);
  const all = [MAIN_TABLE_TAB, ...tabIds];
  // Never leave the table without a tab to show.
  const visible = all.filter((id) => !hidden.includes(id));
  return {
    isVisible: (id: string) => (visible.length ? visible.includes(id) : id === MAIN_TABLE_TAB),
    hidden,
    setHidden: update,
  };
}

export function TableTabPicker({
  tabs,
  hidden,
  onChange,
  includeMain = true,
}: {
  tabs: { id: string; title: string }[];
  hidden: string[];
  onChange: (hidden: string[]) => void;
  includeMain?: boolean;
}) {
  const [query, setQuery] = useState("");
  const options = includeMain ? [{ id: MAIN_TABLE_TAB, title: "جدول اصلی" }, ...tabs] : tabs;
  const first = options[0]?.id;
  const shown = options.filter((tab) => normalizePersianSearch(tab.title).includes(normalizePersianSearch(query)));
  const visibleCount = options.filter((tab) => !hidden.includes(tab.id)).length;
  return (
    <Popover className="table-tab-picker">
      <PopoverButton className="button button-secondary table-tab-picker-trigger">
        <Eye size={15} aria-hidden="true" />
        تب‌های قابل نمایش
        <span className="table-tab-picker-count">
          {visibleCount === options.length
            ? "همه"
            : `${visibleCount.toLocaleString("fa-IR")} از ${options.length.toLocaleString("fa-IR")}`}
        </span>
      </PopoverButton>
      <PopoverPanel anchor="bottom end" className="table-tab-picker-panel" dir="rtl">
        <div className="table-tab-picker-actions">
          <button type="button" onClick={() => onChange([])} disabled={!hidden.length}>
            نمایش همه
          </button>
          <button
            type="button"
            onClick={() => onChange(options.filter((tab) => tab.id !== first).map((tab) => tab.id))}
          >
            فقط «{options[0]?.title}»
          </button>
        </div>
        {options.length > 5 && (
          <label className="table-tab-picker-search">
            <Search size={14} aria-hidden="true" />
            <span className="sr-only">جستجوی تب</span>
            <input value={query} placeholder="جستجوی تب…" onChange={(event) => setQuery(event.target.value)} />
          </label>
        )}
        <ul>
          {shown.map((tab) => {
            const checked = !hidden.includes(tab.id);
            const last = checked && visibleCount === 1;
            return (
              <li key={tab.id}>
                <label className={last ? "is-locked" : ""} title={last ? "حداقل یک تب باید نمایش داده شود" : undefined}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={last}
                    onChange={() => onChange(checked ? [...hidden, tab.id] : hidden.filter((item) => item !== tab.id))}
                  />
                  <span>{tab.title}</span>
                </label>
              </li>
            );
          })}
          {!shown.length && <li className="table-tab-picker-empty">تبی با این نام نیست.</li>}
        </ul>
      </PopoverPanel>
    </Popover>
  );
}
