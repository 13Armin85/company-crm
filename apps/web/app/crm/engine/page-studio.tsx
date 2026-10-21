import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { ArrowDown, ArrowUp, Check, Columns3, FilePenLine, LockKeyhole, Plus, Search, Trash2 } from "lucide-react";
import { SearchableSelect } from "@plane/ui";
import type { FieldBinding, FieldKind, FormLayoutSchema } from "@plane/ui";
import { Button, Skeleton } from "../components";
import { errorMessage, useWorkspaceAccess } from "../api";
import { useUIStore } from "../store";
import { useEngineDefinitions, useEngineMutation, useEngineQuery } from "./api";
import type { FieldDefinition } from "./api";
import { useSurface } from "./surface";
import type { SurfaceDefinition, SurfaceSchema } from "./surface";

const fieldTypes: { id: FieldKind; title: string }[] = [
  { id: "short_text", title: "متن کوتاه" },
  { id: "long_text", title: "متن چندخطی" },
  { id: "integer", title: "عدد صحیح" },
  { id: "decimal", title: "عدد اعشاری" },
  { id: "money", title: "مبلغ" },
  { id: "percent", title: "درصد" },
  { id: "date", title: "تاریخ" },
  { id: "datetime", title: "تاریخ و ساعت" },
  { id: "date_range", title: "بازه تاریخ" },
  { id: "boolean", title: "بله / خیر" },
  { id: "select", title: "انتخاب یک گزینه" },
  { id: "multi_select", title: "انتخاب چند گزینه" },
  { id: "user", title: "کاربر" },
  { id: "unit", title: "واحد سازمانی" },
  { id: "role", title: "نقش" },
  { id: "file", title: "فایل" },
  { id: "email", title: "ایمیل" },
  { id: "phone", title: "تلفن" },
  { id: "url", title: "پیوند" },
  { id: "rating", title: "امتیاز" },
];
const mandatory: Record<string, string[]> = {
  ticket: ["name", "project_id"],
  task: ["name", "assignee_id"],
  project: ["name"],
  leave: ["user_id", "starts_at", "ends_at"],
};

export function reorderColumn(columns: string[], index: number, direction: -1 | 1) {
  const next = [...columns],
    target = index + direction;
  if (target < 0 || target >= next.length) return columns;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function NewField({
  code,
  onClose,
  onCreated,
}: {
  code: string;
  onClose: () => void;
  onCreated: (field: FieldDefinition) => void;
}) {
  const mutation = useEngineMutation();
  const [title, setTitle] = useState(""),
    [kind, setKind] = useState<FieldKind>("short_text"),
    [options, setOptions] = useState("");
  return (
    <Dialog open onClose={() => !mutation.isPending && onClose()} className="engine-drawer-backdrop">
      <DialogPanel className="engine-drawer studio-new-field">
        <DialogTitle>افزودن فیلد</DialogTitle>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              const field = (await mutation.mutateAsync({
                path: `surfaces/${code}/fields/`,
                data: {
                  title: title.trim(),
                  kind,
                  ...(["select", "multi_select"].includes(kind)
                    ? {
                        options: options
                          .split(/\r?\n/)
                          .map((v) => v.trim())
                          .filter(Boolean),
                      }
                    : {}),
                },
              })) as FieldDefinition;
              onCreated(field);
              onClose();
            } catch {
              /* Keep the input and show the server error. */
            }
          }}
        >
          <label>
            <span>نام فیلد</span>
            <input
              required
              maxLength={255}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <SearchableSelect
            label="نوع فیلد"
            value={kind}
            options={fieldTypes}
            onChange={(value) => setKind(value as FieldKind)}
          />
          {["select", "multi_select"].includes(kind) && (
            <label>
              <span>گزینه‌ها؛ هر گزینه در یک خط</span>
              <textarea required value={options} onChange={(event) => setOptions(event.target.value)} rows={6} />
            </label>
          )}
          {mutation.error && <p role="alert">{errorMessage(mutation.error, "فیلد ساخته نشد.")}</p>}
          <footer>
            <Button type="submit" disabled={!title.trim() || mutation.isPending}>
              افزودن به فرم
            </Button>
            <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
              لغو
            </Button>
          </footer>
        </form>
      </DialogPanel>
    </Dialog>
  );
}

function PageEditor({ code, fields }: { code: string; fields: FieldDefinition[] }) {
  const query = useSurface(code),
    mutation = useEngineMutation(),
    { data: access } = useWorkspaceAccess();
  const [params] = useSearchParams();
  const [mode, setMode] = useState(params.get("mode") === "columns" ? "columns" : "form");
  const [draft, setDraft] = useState<SurfaceDefinition>(),
    [revision, setRevision] = useState(0);
  const [form, setForm] = useState<FormLayoutSchema>(),
    [formRevision, setFormRevision] = useState(0);
  const [creating, setCreating] = useState(false),
    [selectedTab, setSelectedTab] = useState(""),
    [newTab, setNewTab] = useState("");
  const setDirty = useUIStore((state) => state.setFormDirty);
  useEffect(() => {
    if (query.data && draft === undefined) {
      setDraft(structuredClone(query.data.definition));
      setRevision(query.data.revision);
      setForm(query.data.form?.layout ? structuredClone(query.data.form.layout) : undefined);
      setFormRevision(query.data.form?.revision || 0);
    }
  }, [query.data, draft]);
  const dirty = Boolean(
    draft &&
    (JSON.stringify(draft) !== JSON.stringify(query.data?.definition) ||
      JSON.stringify(form) !== JSON.stringify(query.data?.form?.layout))
  );
  useEffect(() => {
    setDirty(`page-studio:${code}`, dirty);
    return () => setDirty(`page-studio:${code}`, false);
  }, [code, dirty, setDirty]);
  if (query.isLoading || (!draft && !query.error)) return <Skeleton rows={5} />;
  if (!query.data || !draft) return <p role="alert">{errorMessage(query.error, "تنظیمات صفحه دریافت نشد.")}</p>;
  const surface = query.data,
    tabs = draft.table_tabs || [],
    activeTab = tabs.find((tab) => tab.id === selectedTab);
  const columns = activeTab?.columns || draft.columns;
  const setColumns = (next: string[]) =>
    setDraft(
      activeTab
        ? { ...draft, table_tabs: tabs.map((tab) => (tab.id === activeTab.id ? { ...tab, columns: next } : tab)) }
        : { ...draft, columns: next }
    );
  const bindingList = form ? form.sections.flatMap((section) => section.bindings) : draft.fields;
  const findField = (fieldCode: string) =>
    fields.find((field) => field.code === fieldCode) || surface.engine_fields.find((field) => field.code === fieldCode);
  const allColumns = [
    ...surface.native_columns.map((title) => ({ id: `native:${title}`, title })),
    ...surface.engine_fields
      .filter(
        (field) =>
          !field.config.hidden &&
          field.table_visible !== false &&
          (!form || bindingList.some((binding) => binding.field === field.code) || field.options_surface !== code)
      )
      .map((field) => ({
        id: `engine:${field.code}`,
        title: bindingList.find((binding) => binding.field === field.code)?.title || field.title,
      })),
    ...bindingList.flatMap((binding) => {
      const field = findField(binding.field);
      return field && !binding.hidden
        ? [{ id: `${form ? "engine" : "field"}:${binding.field}`, title: binding.title || field.title }]
        : [];
    }),
  ].filter((column, index, all) => all.findIndex((other) => other.id === column.id) === index);
  const updateBinding = (field: string, patch: Partial<FieldBinding>) => {
    if (form)
      setForm({
        ...form,
        sections: form.sections.map((section) => ({
          ...section,
          bindings: section.bindings.map((binding) => (binding.field === field ? { ...binding, ...patch } : binding)),
        })),
      });
    else
      setDraft({
        ...draft,
        fields: draft.fields.map((binding) => (binding.field === field ? { ...binding, ...patch } : binding)),
      });
  };
  const removeField = (field: string) => {
    if (form)
      setForm({
        ...form,
        sections: form.sections.map((section) => ({
          ...section,
          bindings: section.bindings.filter((binding) => binding.field !== field),
        })),
      });
    const clean = (list: string[]) => {
      const next = list.filter((column) => column !== `field:${field}` && column !== `engine:${field}`);
      return next.length || !surface.native_columns.length ? next : [`native:${surface.native_columns[0]}`];
    };
    setDraft({
      ...draft,
      fields: draft.fields.filter((binding) => binding.field !== field),
      columns: clean(draft.columns),
      table_tabs: tabs.map((tab) => ({ ...tab, columns: clean(tab.columns) })),
    });
  };
  const save = async () => {
    const submitted = draft,
      submittedForm = form;
    try {
      const result = (await mutation.mutateAsync({
        path: `surfaces/${code}/`,
        method: "put",
        data: {
          revision,
          definition: draft,
          ...(form ? { form: { layout: form, revision: formRevision } } : {}),
        },
      })) as SurfaceSchema;
      setDraft((current) => (JSON.stringify(current) === JSON.stringify(submitted) ? result.definition : current));
      setForm((current) => (JSON.stringify(current) === JSON.stringify(submittedForm) ? result.form?.layout : current));
      setRevision(result.revision);
      setFormRevision(result.form?.revision || 0);
    } catch {
      /* Retain unsaved edits after validation or revision conflict. */
    }
  };
  return (
    <div className="page-studio-editor">
      <header className="page-studio-heading">
        <div>
          <h2>{surface.title}</h2>
          <p>فقط ورودی‌ها و جدول همین صفحه را تغییر دهید.</p>
        </div>
        <Link to={surface.path} className="button button-secondary">
          باز کردن صفحه ↗
        </Link>
      </header>
      <div className="page-studio-tabs" role="tablist" aria-label="بخش طراحی">
        <button type="button" role="tab" aria-selected={mode === "form"} onClick={() => setMode("form")}>
          <FilePenLine size={17} />
          فیلدهای فرم
        </button>
        {!!surface.native_columns.length && (
          <button type="button" role="tab" aria-selected={mode === "columns"} onClick={() => setMode("columns")}>
            <Columns3 size={17} />
            جدول و تب‌ها
          </button>
        )}
        <Button
          icon={Check}
          disabled={!dirty || mutation.isPending || !access?.can("FormLayout.Publish")}
          onClick={() => void save()}
        >
          ذخیره تغییرات
        </Button>
      </div>
      {mutation.error && <p role="alert">{errorMessage(mutation.error, "تغییرات ذخیره نشد.")}</p>}
      {mode === "form" && (
        <>
          <div className="studio-field-heading">
            <h3>فیلدهای این فرم</h3>
            {access?.can("Field.Create") && (
              <Button icon={Plus} onClick={() => setCreating(true)}>
                افزودن فیلد
              </Button>
            )}
          </div>
          <div className="studio-fields">
            <div className="studio-field-labels">
              <span>نام و نوع فیلد</span>
              <span>نمایش</span>
              <span>الزامی</span>
            </div>
            {!form &&
              surface.native_fields.map((field) => {
                const config = { ...field, ...draft.native[field.code] };
                const update = (patch: { hidden?: boolean; required?: boolean }) =>
                  setDraft({
                    ...draft,
                    native: { ...draft.native, [field.code]: { ...draft.native[field.code], ...patch } },
                  });
                return (
                  <div className="studio-field-row" key={field.code}>
                    <div>
                      <strong>{field.title}</strong>
                      {field.locked && (
                        <small>
                          <LockKeyhole size={12} />
                          ضروری
                        </small>
                      )}
                    </div>
                    <input
                      type="checkbox"
                      aria-label={`نمایش ${field.title}`}
                      checked={!config.hidden}
                      disabled={field.locked}
                      onChange={(event) => update({ hidden: !event.target.checked })}
                    />
                    <input
                      type="checkbox"
                      aria-label={`الزامی بودن ${field.title}`}
                      checked={config.required}
                      disabled={field.locked || config.hidden}
                      onChange={(event) => update({ required: event.target.checked })}
                    />
                  </div>
                );
              })}
            {bindingList.map((binding) => {
              const field = findField(binding.field),
                title = binding.title || field?.title || binding.field;
              const locked = Boolean(form && mandatory[code]?.includes(binding.source || ""));
              return (
                <div className="studio-field-row studio-custom-row" key={binding.field}>
                  <div>
                    <input
                      aria-label={`نام فیلد ${title}`}
                      value={title}
                      maxLength={255}
                      onChange={(event) => updateBinding(binding.field, { title: event.target.value })}
                    />
                    <small>
                      {fieldTypes.find((type) => type.id === field?.kind)?.title || "فیلد فرم"}
                      {locked ? " · ضروری" : ""}
                    </small>
                  </div>
                  <input
                    type="checkbox"
                    aria-label={`نمایش ${title}`}
                    checked={!(binding.hidden ?? field?.config.hidden)}
                    disabled={locked}
                    onChange={(event) => updateBinding(binding.field, { hidden: !event.target.checked })}
                  />
                  <input
                    type="checkbox"
                    aria-label={`الزامی بودن ${title}`}
                    checked={binding.required ?? Boolean(field?.config.required)}
                    disabled={locked || binding.hidden}
                    onChange={(event) => updateBinding(binding.field, { required: event.target.checked })}
                  />
                  <button
                    type="button"
                    aria-label={`حذف ${title} از فرم`}
                    disabled={locked}
                    onClick={() => removeField(binding.field)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
      {mode === "columns" && (
        <>
          <section className="studio-table-tabs-editor">
            <h3>تب‌های جدول</h3>
            <p>هر تب می‌تواند ستون‌های متفاوتی داشته باشد.</p>
            <div className="surface-table-tabs" role="tablist" aria-label="انتخاب تب جدول">
              <button type="button" role="tab" aria-selected={!activeTab} onClick={() => setSelectedTab("")}>
                جدول اصلی
              </button>
              {tabs.map((tab) => (
                <button
                  type="button"
                  key={tab.id}
                  role="tab"
                  aria-selected={activeTab?.id === tab.id}
                  onClick={() => setSelectedTab(tab.id)}
                >
                  {tab.title}
                </button>
              ))}
            </div>
            {activeTab && (
              <div className="studio-tab-edit">
                <label>
                  <span>نام تب</span>
                  <input
                    maxLength={80}
                    value={activeTab.title}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        table_tabs: tabs.map((tab) =>
                          tab.id === activeTab.id ? { ...tab, title: event.target.value } : tab
                        ),
                      })
                    }
                  />
                </label>
                <Button
                  variant="danger"
                  icon={Trash2}
                  onClick={() => {
                    setDraft({ ...draft, table_tabs: tabs.filter((tab) => tab.id !== activeTab.id) });
                    setSelectedTab("");
                  }}
                >
                  حذف تب
                </Button>
              </div>
            )}
            <form
              className="studio-add-tab"
              onSubmit={(event) => {
                event.preventDefault();
                if (!newTab.trim()) return;
                const id = crypto.randomUUID();
                setDraft({
                  ...draft,
                  table_tabs: [
                    ...tabs,
                    { id, title: newTab.trim(), columns: columns.length ? [...columns] : [allColumns[0].id] },
                  ],
                });
                setSelectedTab(id);
                setNewTab("");
              }}
            >
              <input
                aria-label="نام تب جدید"
                placeholder="نام تب جدید…"
                maxLength={80}
                value={newTab}
                onChange={(event) => setNewTab(event.target.value)}
              />
              <Button type="submit" icon={Plus} disabled={!newTab.trim() || tabs.length >= 20}>
                افزودن تب
              </Button>
            </form>
          </section>
          <div className="studio-columns">
            <section>
              <h3>ستون‌های {activeTab?.title || "جدول اصلی"}</h3>
              {allColumns.map((column) => (
                <label className="studio-column-choice" key={column.id}>
                  <input
                    type="checkbox"
                    checked={columns.includes(column.id)}
                    onChange={(event) =>
                      setColumns(
                        event.target.checked
                          ? [...columns, column.id]
                          : columns.filter((current) => current !== column.id)
                      )
                    }
                  />
                  <span>{column.title}</span>
                </label>
              ))}
            </section>
            <section>
              <h3>ترتیب ستون‌ها</h3>
              {columns.map((column, index) => (
                <div className="studio-column-order" key={column}>
                  <span>{(index + 1).toLocaleString("fa-IR")}</span>
                  <strong>{allColumns.find((item) => item.id === column)?.title || "فیلد برداشته‌شده"}</strong>
                  <button
                    type="button"
                    aria-label="انتقال ستون به بالا"
                    disabled={!index}
                    onClick={() => setColumns(reorderColumn(columns, index, -1))}
                  >
                    <ArrowUp size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label="انتقال ستون به پایین"
                    disabled={index === columns.length - 1}
                    onClick={() => setColumns(reorderColumn(columns, index, 1))}
                  >
                    <ArrowDown size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label="حذف ستون"
                    onClick={() => setColumns(columns.filter((item) => item !== column))}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </section>
          </div>
        </>
      )}
      {creating && (
        <NewField
          code={code}
          onClose={() => setCreating(false)}
          onCreated={(field) => {
            if (form) {
              const next = structuredClone(form);
              if (!next.sections.length) next.sections.push({ id: "main", columns: 2, bindings: [] });
              next.sections[0].bindings.push({ field: field.code });
              setForm(next);
            } else setDraft({ ...draft, fields: [...draft.fields, { field: field.code }] });
          }}
        />
      )}
    </div>
  );
}

export function PageStudio() {
  const pages = useEngineQuery<{ results: SurfaceSchema[] }>("surfaces", "surfaces/");
  const { data: fields = [] } = useEngineDefinitions<FieldDefinition>("fields");
  const [params, setParams] = useSearchParams(),
    [search, setSearch] = useState("");
  const allPages = pages.data?.results || [];
  const code = allPages.some((page) => page.code === params.get("page")) ? params.get("page")! : allPages[0]?.code;
  if (pages.isLoading) return <Skeleton rows={6} />;
  if (pages.error) return <p role="alert">{errorMessage(pages.error, "فهرست صفحه‌ها دریافت نشد.")}</p>;
  return (
    <div className="page-studio">
      <aside className="page-studio-sidebar">
        <h2>صفحه‌های برنامه</h2>
        <label className="studio-search">
          <Search size={16} />
          <input
            aria-label="جستجوی صفحه"
            placeholder="جستجوی صفحه…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <nav aria-label="انتخاب صفحه برای طراحی">
          {allPages
            .filter((page) => !search || page.title.includes(search))
            .map((page) => (
              <button
                type="button"
                key={page.code}
                aria-current={page.code === code ? "page" : undefined}
                onClick={() => setParams({ page: page.code })}
              >
                <span className="studio-page-icon">
                  <FilePenLine size={18} />
                </span>
                <span>
                  <strong>{page.title}</strong>
                  <small>فرم{page.native_columns.length ? " و جدول" : ""}</small>
                </span>
                <span className="studio-page-arrow">‹</span>
              </button>
            ))}
        </nav>
      </aside>
      {code && <PageEditor key={code} code={code} fields={fields} />}
    </div>
  );
}
