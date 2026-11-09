import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, GitBranch, ListChecks, Pencil, Plus, Search, X } from "lucide-react";
import { normalizePersianSearch } from "@plane/ui";
import { Button, Skeleton } from "../components";
import { errorMessage, useWorkspaceAccess } from "../api";
import { ErrorNotice } from "../error-state";
import { useEngineDefinitions } from "./api";
import type { LookupDefinition, LookupOptionDefinition } from "./api";
import { DefinitionEditor } from "./definition-editor";
import type { EditableDefinition } from "./definition-editor";
import { plainText } from "../utils";

type ChoiceFilter = "all" | "active" | "inactive";

function ChoiceEditorDialog({
  kind,
  row,
  onClose,
  onSaved,
}: {
  kind: "lookups" | "values";
  row?: EditableDefinition;
  onClose: () => void;
  onSaved?: (row?: EditableDefinition) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => {
      if (element.open) element.close();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="engine-choices-dialog"
      aria-label={`${row?.id ? "ویرایش" : "ساخت"} ${kind === "lookups" ? "لیست انتخابی" : "گزینهٔ لیست"}`}
      onClose={onClose}
    >
      <DefinitionEditor kind={kind} row={row} onClose={onClose} onSaved={onSaved} />
    </dialog>
  );
}

export function LookupSettings() {
  const accessQuery = useWorkspaceAccess();
  const access = accessQuery.data;
  const lookups = useEngineDefinitions<LookupDefinition>("lookups", Boolean(access?.can("Lookup.View")));
  const values = useEngineDefinitions<LookupOptionDefinition>("values", Boolean(access?.can("Lookup.View")));
  const [selectedId, setSelectedId] = useState("");
  const [listSearch, setListSearch] = useState("");
  const [optionSearch, setOptionSearch] = useState("");
  const [filter, setFilter] = useState<ChoiceFilter>("all");
  const [editingLookup, setEditingLookup] = useState<LookupDefinition | "new" | null>(null);
  const [editingValue, setEditingValue] = useState<LookupOptionDefinition | "new" | null>(null);
  if (accessQuery.isLoading) return <Skeleton rows={4} />;
  if (!access?.can("Lookup.View"))
    return <p role="status">برای دیدن لیست‌های انتخابی، دسترسی مشاهدهٔ لیست پایه لازم است.</p>;
  if (lookups.isLoading || values.isLoading) return <Skeleton rows={4} />;
  if ((lookups.error && !lookups.data) || (values.error && !values.data))
    return (
      <section className="engine-choices-load-error" aria-label="خطا در بارگذاری لیست‌های انتخابی">
        <ErrorNotice message={errorMessage(lookups.error || values.error, "دریافت لیست‌ها و گزینه‌ها انجام نشد.")} />
        <Button
          variant="secondary"
          onClick={() => {
            void lookups.refetch();
            void values.refetch();
          }}
        >
          تلاش دوباره
        </Button>
      </section>
    );
  const lists = lookups.data || [];
  const allValues = values.data || [];
  const selected = lists.find((item) => item.id === selectedId) || lists[0];
  const options = allValues
    .filter((item) => item.category === selected?.id)
    // eslint-disable-next-line unicorn/no-array-sort -- The filtered array is private and older browsers lack toSorted.
    .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title, "fa"));
  const visibleLists = lists.filter((item) =>
    normalizePersianSearch(`${item.title} ${item.description || ""} ${item.code}`).includes(
      normalizePersianSearch(listSearch)
    )
  );
  const visibleOptions = options.filter(
    (item) =>
      (filter === "all" || item.is_active === (filter === "active")) &&
      normalizePersianSearch(`${item.title} ${item.code}`).includes(normalizePersianSearch(optionSearch))
  );
  const activeCount = options.filter((item) => item.is_active).length;
  return (
    <section className="engine-choices" aria-labelledby="engine-choices-title">
      <header className="engine-choices-intro">
        <span className="engine-choices-intro-icon" aria-hidden="true">
          <ListChecks size={24} />
        </span>
        <div>
          <span className="engine-rules-eyebrow">مدیریت گزینه‌های فرم</span>
          <h3 id="engine-choices-title">لیست‌های انتخابی</h3>
          <p>
            لیست را بسازید، گزینه‌هایش را اضافه کنید و سپس آن را در «منبع گزینه‌ها» به ورودی انتخاب تکی یا چندتایی وصل
            کنید.
          </p>
        </div>
        {access.can("Lookup.Create") && (
          <Button onClick={() => setEditingLookup("new")}>
            <Plus size={16} aria-hidden="true" /> ساخت لیست جدید
          </Button>
        )}
      </header>
      <ErrorNotice message={lookups.error && errorMessage(lookups.error, "دریافت لیست‌ها انجام نشد.")} />
      <ErrorNotice message={values.error && errorMessage(values.error, "دریافت گزینه‌های لیست انجام نشد.")} />
      <div className="engine-choices-layout">
        <aside className="engine-choices-library" aria-label="لیست‌های موجود">
          <div className="engine-choices-library-heading">
            <strong>لیست‌های موجود</strong>
            <span>{lists.length.toLocaleString("fa-IR")}</span>
          </div>
          {lists.length > 0 && (
            <div className="engine-choices-search">
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                aria-label="جست‌وجوی لیست"
                value={listSearch}
                onChange={(event) => setListSearch(event.target.value)}
                placeholder="جست‌وجوی لیست…"
              />
              {listSearch && (
                <button type="button" aria-label="پاک کردن جست‌وجوی لیست" onClick={() => setListSearch("")}>
                  <X size={15} />
                </button>
              )}
            </div>
          )}
          <nav className="engine-choices-library-list" aria-label="انتخاب لیست">
            {visibleLists.map((item) => {
              const count = allValues.filter((value) => value.category === item.id).length;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={item.id === selected?.id ? "is-selected" : ""}
                  aria-current={item.id === selected?.id ? "true" : undefined}
                  aria-controls="engine-choices-detail"
                  onClick={() => {
                    setSelectedId(item.id);
                    setOptionSearch("");
                    setFilter("all");
                  }}
                >
                  <span className="engine-choices-library-copy">
                    <strong>{item.title}</strong>
                    <small>
                      {plainText(item.description || (item.is_active ? "آمادهٔ استفاده در فرم" : "لیست غیرفعال"))}
                    </small>
                  </span>
                  <span className="engine-choices-library-count" aria-label={`${count.toLocaleString("fa-IR")} گزینه`}>
                    {count.toLocaleString("fa-IR")}
                  </span>
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
              );
            })}
          </nav>
          {lists.length > 0 && visibleLists.length === 0 && (
            <p className="engine-choices-empty-small" role="status">
              لیستی با این عبارت پیدا نشد.
            </p>
          )}
          {lists.length === 0 && (
            <p className="engine-choices-empty-small" role="status">
              هنوز لیستی ساخته نشده است. با «ساخت لیست جدید» شروع کنید.
            </p>
          )}
        </aside>

        <section
          className="engine-choices-detail"
          id="engine-choices-detail"
          aria-labelledby="engine-choices-detail-title"
        >
          {selected ? (
            <>
              <header className="engine-choices-detail-heading">
                <div>
                  <span className="engine-rules-eyebrow">گزینه‌های لیست انتخاب‌شده</span>
                  <h4 id="engine-choices-detail-title">{selected.title}</h4>
                  <p>{plainText(selected.description || "این لیست در تمام فرم‌های فضای کاری قابل استفاده است.")}</p>
                </div>
                {access.can("Lookup.Edit") && (
                  <Button variant="secondary" onClick={() => setEditingLookup(selected)}>
                    <Pencil size={15} aria-hidden="true" /> ویرایش لیست
                  </Button>
                )}
              </header>
              <div className="engine-choices-summary" aria-label="وضعیت لیست">
                <span className={selected.is_active ? "engine-choices-status is-active" : "engine-choices-status"}>
                  {selected.is_active ? "لیست فعال" : "لیست غیرفعال"}
                </span>
                <span>{options.length.toLocaleString("fa-IR")} گزینه</span>
                <span>{activeCount.toLocaleString("fa-IR")} گزینهٔ فعال</span>
                <code dir="ltr">{selected.code}</code>
              </div>
              <div className="engine-choices-toolbar">
                <div>
                  <h5>مقدارهای قابل انتخاب</h5>
                  <p>ترتیب نمایش گزینه‌ها با عدد «جایگاه» در ویرایش هر گزینه تعیین می‌شود.</p>
                </div>
                {access.can("Lookup.Create") && (
                  <Button onClick={() => setEditingValue("new")}>
                    <Plus size={16} aria-hidden="true" /> افزودن گزینه به این لیست
                  </Button>
                )}
              </div>
              {options.length > 0 && (
                <div className="engine-choices-filters">
                  <div className="engine-choices-search">
                    <Search size={17} aria-hidden="true" />
                    <input
                      type="search"
                      aria-label={`جست‌وجوی گزینه در ${selected.title}`}
                      value={optionSearch}
                      onChange={(event) => setOptionSearch(event.target.value)}
                      placeholder="جست‌وجوی گزینه…"
                    />
                    {optionSearch && (
                      <button type="button" aria-label="پاک کردن جست‌وجوی گزینه" onClick={() => setOptionSearch("")}>
                        <X size={15} />
                      </button>
                    )}
                  </div>
                  <div className="engine-choices-filter-buttons" role="group" aria-label="فیلتر وضعیت گزینه‌ها">
                    {(
                      [
                        ["all", "همه"],
                        ["active", "فعال"],
                        ["inactive", "غیرفعال"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={filter === value}
                        onClick={() => setFilter(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {options.length === 0 ? (
                <div className="engine-choices-empty" role="status">
                  <ListChecks size={26} aria-hidden="true" />
                  <strong>این لیست هنوز گزینه‌ای ندارد</strong>
                  <p>گزینه‌های قابل انتخاب کاربر را اضافه کنید؛ هر گزینه یک مقدار مستقل است.</p>
                  {access.can("Lookup.Create") && (
                    <Button variant="secondary" onClick={() => setEditingValue("new")}>
                      <Plus size={16} /> افزودن اولین گزینه
                    </Button>
                  )}
                </div>
              ) : visibleOptions.length === 0 ? (
                <div className="engine-choices-empty" role="status">
                  <Search size={24} aria-hidden="true" />
                  <strong>گزینه‌ای با این فیلتر پیدا نشد</strong>
                  <p>عبارت جست‌وجو یا فیلتر وضعیت را تغییر دهید.</p>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setOptionSearch("");
                      setFilter("all");
                    }}
                  >
                    نمایش همهٔ گزینه‌ها
                  </Button>
                </div>
              ) : (
                <ul className="engine-choices-options" aria-label={`گزینه‌های ${selected.title}`}>
                  {visibleOptions.map((item) => {
                    const parent = allValues.find((candidate) => candidate.id === item.parent);
                    return (
                      <li key={item.id} className={item.is_active ? "" : "is-inactive"}>
                        <span
                          className="engine-choices-option-color"
                          style={{ backgroundColor: item.color || "#64748b" }}
                          aria-hidden="true"
                        >
                          {item.icon || ""}
                        </span>
                        <div className="engine-choices-option-copy">
                          <strong>{item.title}</strong>
                          <span>
                            <code dir="ltr">{item.code}</code>
                            {item.parent && (
                              <small>
                                <GitBranch size={13} aria-hidden="true" /> والد: {parent?.title || "نامشخص"}
                              </small>
                            )}
                          </span>
                        </div>
                        <div className="engine-choices-option-meta">
                          {item.is_default && (
                            <span className="engine-choices-default">
                              <Check size={13} aria-hidden="true" /> پیش‌فرض
                            </span>
                          )}
                          {!item.is_active && <span className="engine-choices-inactive">غیرفعال</span>}
                        </div>
                        {access.can("Lookup.Edit") && (
                          <button
                            type="button"
                            className="button button-ghost"
                            aria-label={`ویرایش گزینهٔ ${item.title}`}
                            onClick={() => setEditingValue(item)}
                          >
                            <Pencil size={15} aria-hidden="true" /> ویرایش
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <details className="engine-choices-help">
                <summary>
                  <GitBranch size={17} aria-hidden="true" /> لیست وابسته چگونه کار می‌کند؟
                </summary>
                <p>
                  ابتدا گزینه‌های لیست والد را بسازید. سپس برای هر گزینهٔ این لیست، «مقدار والد» را در ویرایش گزینه انتخاب
                  کنید. در تنظیمات ورودی فرم هم فیلد والد را مشخص کنید تا فقط گزینه‌های مربوط نمایش داده شوند.
                </p>
              </details>
            </>
          ) : (
            <div className="engine-choices-empty" role="status">
              <ListChecks size={30} aria-hidden="true" />
              <h4 id="engine-choices-detail-title">اولین لیست انتخابی را بسازید</h4>
              <p>پس از ساخت لیست، می‌توانید گزینه‌های آن را همین‌جا مدیریت کنید.</p>
            </div>
          )}
        </section>
      </div>
      {editingLookup && (
        <ChoiceEditorDialog
          key={editingLookup === "new" ? "new-lookup" : editingLookup.id}
          kind="lookups"
          row={editingLookup === "new" ? undefined : editingLookup}
          onClose={() => setEditingLookup(null)}
          onSaved={(row) => {
            if (row?.id) setSelectedId(row.id);
          }}
        />
      )}
      {editingValue && selected && (
        <ChoiceEditorDialog
          key={editingValue === "new" ? `new-value-${selected.id}` : editingValue.id}
          kind="values"
          row={
            editingValue === "new"
              ? { category: selected.id, position: Math.max(0, ...options.map((item) => item.position)) + 1 }
              : editingValue
          }
          onClose={() => setEditingValue(null)}
        />
      )}
    </section>
  );
}
