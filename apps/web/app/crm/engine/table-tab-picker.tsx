import { useState } from "react";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { Eye, Search, Trash2 } from "lucide-react";
import { normalizePersianSearch } from "@plane/ui";

export const MAIN_TABLE_TAB = "__main__";
export const LOCAL_TAB_PREFIX = "local:";
export type LocalTableTab = { id: string; title: string; columns: string[] };
export type TabColumnChoice = { tabId: string; hidden: string[] };
const storageKey = (code: string) => `crm-table-tabs:${code}`;

function useStoredList<T>(key: string) {
  const [value, setValue] = useState<T[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) || "[]") as T[];
    } catch {
      return [];
    }
  });
  const update = (next: T[]) => {
    setValue(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* Private mode: the choice lasts for this visit only. */
    }
  };
  return [value, update] as const;
}

/** Each viewer picks which table tabs they see; the choice stays in their browser. */
export function useHiddenTabs(key: string) {
  return useStoredList<string>(storageKey(key));
}

/** Tabs a viewer made for themself; they never reach other users. */
export function useLocalTabs(code: string) {
  return useStoredList<LocalTableTab>(`${storageKey(code)}:own`);
}

/** Column choices are private to this browser and to each table tab. */
export function useTabColumnChoices(code: string) {
  return useStoredList<TabColumnChoice>(`${storageKey(code)}:columns`);
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
  activeTabTitle,
  activeColumns,
  hiddenColumns = [],
  onHiddenColumnsChange,
  onDeleteTab,
}: {
  tabs: { id: string; title: string }[];
  hidden: string[];
  onChange: (hidden: string[]) => void;
  includeMain?: boolean;
  activeTabTitle?: string;
  activeColumns?: { id: string; title: string }[];
  hiddenColumns?: string[];
  onHiddenColumnsChange?: (hidden: string[]) => void;
  onDeleteTab?: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const options = includeMain ? [{ id: MAIN_TABLE_TAB, title: "جدول اصلی" }, ...tabs] : tabs;
  const first = options[0]?.id;
  const shown = options.filter((tab) => normalizePersianSearch(tab.title).includes(normalizePersianSearch(query)));
  const visibleCount = options.filter((tab) => !hidden.includes(tab.id)).length;
  return (
    <Popover className="table-tab-picker">
      <PopoverButton className="surface-table-action table-tab-picker-trigger">
        <Eye size={15} aria-hidden="true" />
        تب‌های من
        <span className="table-tab-picker-count">
          {visibleCount === options.length
            ? "همه"
            : `${visibleCount.toLocaleString("fa-IR")} از ${options.length.toLocaleString("fa-IR")}`}
        </span>
      </PopoverButton>
      <PopoverPanel anchor="bottom end" className="table-tab-picker-panel" dir="rtl">
        {options.length > 1 && (
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
        )}
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
            const own = tab.id.startsWith(LOCAL_TAB_PREFIX);
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
                  {own && <small className="table-tab-own">شخصی</small>}
                </label>
                {own && onDeleteTab && (
                  <button
                    type="button"
                    className="table-tab-delete"
                    aria-label={`حذف تب ${tab.title}`}
                    title="حذف تب شخصی"
                    onClick={() => onDeleteTab(tab.id)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
          {!shown.length && <li className="table-tab-picker-empty">تبی با این نام نیست.</li>}
        </ul>
        {includeMain && !tabs.some((tab) => !tab.id.startsWith(LOCAL_TAB_PREFIX)) && (
          <p className="table-tab-picker-hint">
            تب‌هایی که مدیر در «طراحی فرم‌ها و جدول‌ها» برای این جدول بسازد، خودکار اینجا اضافه می‌شوند.
          </p>
        )}
        {activeColumns && onHiddenColumnsChange && (
          <div
            className="table-tab-active-columns"
            role="group"
            aria-label={`ستون‌های ${activeTabTitle || "جدول فعال"}`}
          >
            <strong>ستون‌های {activeTabTitle || "جدول فعال"}</strong>
            <small>برداشتن تیک، ستون را همین حالا از جدول پنهان می‌کند.</small>
            <div className="table-tab-active-column-list">
              {activeColumns.map((column) => {
                const checked = !hiddenColumns.includes(column.id);
                return (
                  <label key={column.id}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        onHiddenColumnsChange(
                          checked ? [...hiddenColumns, column.id] : hiddenColumns.filter((id) => id !== column.id)
                        )
                      }
                    />
                    <span>{column.title}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </PopoverPanel>
    </Popover>
  );
}
