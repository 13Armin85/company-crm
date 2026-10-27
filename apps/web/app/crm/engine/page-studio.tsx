import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Columns3,
  FilePenLine,
  LockKeyhole,
  Plus,
  Search,
  Trash2,
  X,
  Info,
  RotateCcw,
  ChevronLeft,
} from "lucide-react";
import { SearchableSelect, normalizePersianSearch } from "@plane/ui";
import type { FieldBinding, FieldKind, FormLayoutSchema } from "@plane/ui";
import { Button, Skeleton } from "../components";
import { useUIStore } from "../store";
import { useEngineMutation, useEngineQuery } from "./api";
import type { FieldDefinition } from "./api";
import { useSurface } from "./surface";
import type { SurfaceDefinition, SurfaceSchema, SurfaceDesigner } from "./surface";
import { StudioError, studioInputError } from "./studio-feedback";
import { toFa } from "../utils";

export function reorderColumn(columns: string[], index: number, direction: -1 | 1) {
  const next = [...columns],
    target = index + direction;
  if (target < 0 || target >= next.length) return columns;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
export const createTableTabId = () => `tab-${crypto.getRandomValues(new Uint32Array(4)).join("-")}`;
function StudioSwitch({
  title,
  checked,
  disabled,
  reason,
  onChange,
}: {
  title: string;
  checked: boolean;
  disabled: boolean;
  reason?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="studio-switch" title={reason}>
      <input
        type="checkbox"
        aria-label={title}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="studio-switch-track" aria-hidden="true" />
      <span className="studio-switch-caption">{title.startsWith("نمایش") ? "نمایش" : "الزامی"}</span>
    </label>
  );
}

function NewField({
  code,
  designer,
  onClose,
  onCreated,
}: {
  code: string;
  designer: SurfaceDesigner;
  onClose: () => void;
  onCreated: (field: FieldDefinition) => void;
}) {
  const mutation = useEngineMutation("فیلد ساخته شد؛ برای اعمال آن در صفحه، تغییرات فرم را ذخیره کنید.");
  const [title, setTitle] = useState(""),
    [kind, setKind] = useState<FieldKind>("short_text"),
    [options, setOptions] = useState(""),
    [helpText, setHelpText] = useState(""),
    [placeholder, setPlaceholder] = useState("");
  const titleError = studioInputError(mutation.error, "title"),
    optionsError = studioInputError(mutation.error, "options");
  return (
    <Dialog open onClose={() => !mutation.isPending && onClose()} className="engine-drawer-backdrop">
      <DialogPanel className="studio-new-field">
        <header className="studio-dialog-heading">
          <span className="studio-dialog-icon">
            <Plus size={22} />
          </span>
          <div>
            <DialogTitle>افزودن فیلد</DialogTitle>
            <p>ورودی جدید را برای همین فرم بسازید.</p>
          </div>
          <button type="button" aria-label="بستن افزودن فیلد" disabled={mutation.isPending} onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <form
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              const field = (await mutation.mutateAsync({
                path: `surfaces/${code}/fields/`,
                data: {
                  title: title.trim(),
                  kind,
                  help_text: helpText,
                  placeholder,
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
          <fieldset disabled={mutation.isPending} className="studio-dialog-fields">
            <label className="studio-input-label">
              <span>
                نام فیلد <b aria-hidden="true">*</b>
              </span>
              <input
                required
                data-autofocus
                aria-label="نام فیلد"
                placeholder="مثلاً: شماره قرارداد"
                maxLength={designer.limits.field_title}
                aria-invalid={Boolean(titleError)}
                aria-describedby={titleError ? "studio-title-error" : undefined}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
              {titleError && (
                <small className="studio-input-error" id="studio-title-error">
                  {titleError}
                </small>
              )}
            </label>
            <SearchableSelect
              label="نوع فیلد"
              showLabel
              value={kind}
              options={designer.field_types}
              error={studioInputError(mutation.error, "kind")}
              onChange={(value) => setKind(value as FieldKind)}
            />
            {["select", "multi_select"].includes(kind) && (
              <label className="studio-input-label">
                <span>
                  گزینه‌ها <b aria-hidden="true">*</b>
                </span>
                <textarea
                  required
                  aria-label="گزینه‌ها"
                  placeholder={"عادی\nفوری\nخیلی فوری"}
                  aria-invalid={Boolean(optionsError)}
                  aria-describedby="studio-options-help"
                  value={options}
                  onChange={(event) => setOptions(event.target.value)}
                  rows={5}
                />
                <small id="studio-options-help" className={optionsError ? "studio-input-error" : ""}>
                  {optionsError || `هر گزینه در یک خط؛ حداکثر ${toFa(designer.limits.options)} گزینه متفاوت.`}
                </small>
              </label>
            )}
            <label className="studio-input-label">
              <span>
                متن نمونه <small>اختیاری</small>
              </span>
              <input
                value={placeholder}
                onChange={(event) => setPlaceholder(event.target.value)}
                placeholder="راهنمای کوتاه داخل ورودی"
                maxLength={255}
              />
            </label>
            <label className="studio-input-label">
              <span>
                راهنمای فیلد <small>اختیاری</small>
              </span>
              <textarea
                value={helpText}
                onChange={(event) => setHelpText(event.target.value)}
                placeholder="توضیحی برای کسی که این فرم را پر می‌کند…"
                rows={2}
                maxLength={2000}
              />
            </label>
          </fieldset>
          {mutation.error && (
            <StudioError error={mutation.error} fallback="فیلد ساخته نشد؛ اطلاعات را بررسی کنید." preservesDraft />
          )}
          <footer>
            <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
              لغو
            </Button>
            <Button type="submit" icon={Plus} disabled={mutation.isPending}>
              {mutation.isPending ? "در حال ساخت…" : "افزودن به فرم"}
            </Button>
          </footer>
        </form>
      </DialogPanel>
    </Dialog>
  );
}

export function PageEditor({
  code,
  tableOnly = false,
  embedded = false,
}: {
  code: string;
  tableOnly?: boolean;
  embedded?: boolean;
}) {
  const query = useSurface(code),
    mutation = useEngineMutation();
  const [createdFields, setCreatedFields] = useState<FieldDefinition[]>([]);
  const [confirmReload, setConfirmReload] = useState(false);
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
  if (!query.data || !draft)
    return <StudioError error={query.error} fallback="تنظیمات صفحه دریافت نشد." retry={() => void query.refetch()} />;
  if (!query.data.designer)
    return (
      <StudioError
        error={null}
        fallback="تنظیمات طراحی این صفحه آماده نیست؛ صفحه را دوباره دریافت کنید."
        retry={() => void query.refetch()}
      />
    );
  const surface = query.data,
    designer = query.data.designer,
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
    createdFields.find((field) => field.code === fieldCode) ||
    surface.schema.fields.find((field) => field.code === fieldCode) ||
    surface.engine_fields.find((field) => field.code === fieldCode);
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
          ...(form && !tableOnly ? { form: { layout: form, revision: formRevision } } : {}),
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
  const currentMode = (tableOnly || mode === "columns") && surface.native_columns.length ? "columns" : "form";
  const reloadLatest = async () => {
    const result = await query.refetch();
    if (!result.data || result.error) return;
    setDraft(structuredClone(result.data.definition));
    setRevision(result.data.revision);
    setForm(result.data.form?.layout ? structuredClone(result.data.form.layout) : undefined);
    setFormRevision(result.data.form?.revision || 0);
    mutation.reset();
    setConfirmReload(false);
  };
  return (
    <div className="page-studio-editor">
      {!embedded && (
        <header className="page-studio-heading">
          <div className="studio-heading-copy">
            <span className="studio-eyebrow">تنظیمات صفحه</span>
            <h2>{surface.title}</h2>
            <p>فیلدهای موردنیاز و نحوه نمایش اطلاعات این صفحه را تنظیم کنید.</p>
          </div>
          <Link to={surface.path} className="button button-secondary">
            مشاهده صفحه <ChevronLeft size={14} />
          </Link>
        </header>
      )}
      {!tableOnly && (
        <div className="page-studio-tabs" role="tablist" aria-label="بخش طراحی">
          <button
            type="button"
            role="tab"
            id={`studio-form-${code}`}
            aria-controls={`studio-panel-${code}`}
            aria-selected={currentMode === "form"}
            onClick={() => setMode("form")}
          >
            <FilePenLine size={17} />
            فیلدهای فرم
          </button>
          {!!surface.native_columns.length && (
            <button
              type="button"
              role="tab"
              id={`studio-columns-${code}`}
              aria-controls={`studio-panel-${code}`}
              aria-selected={currentMode === "columns"}
              onClick={() => setMode("columns")}
            >
              <Columns3 size={17} />
              جدول و تب‌ها
            </button>
          )}
        </div>
      )}
      {!designer.can_publish && (
        <div className="studio-notice" role="note">
          <LockKeyhole size={18} />
          <p>{designer.publish_reason}</p>
        </div>
      )}
      {query.error && (
        <StudioError
          error={query.error}
          fallback="دریافت آخرین تنظیمات انجام نشد؛ دوباره تلاش کنید."
          retry={() => void query.refetch()}
        />
      )}
      {mutation.error && (
        <StudioError error={mutation.error} fallback="تغییرات ذخیره نشد؛ تنظیمات را بررسی کنید." preservesDraft />
      )}
      {(mutation.error as { response?: { status?: number } })?.response?.status === 409 && (
        <Button variant="secondary" onClick={() => setConfirmReload(true)}>
          دریافت آخرین نسخه
        </Button>
      )}
      <div role="tabpanel" id={`studio-panel-${code}`} aria-labelledby={`studio-${currentMode}-${code}`}>
        <fieldset className="studio-editor-controls" disabled={!designer.can_publish || mutation.isPending}>
          {currentMode === "form" && (
            <>
              <div className="studio-field-heading">
                <div>
                  <h3>
                    فیلدهای این فرم{" "}
                    <span className="studio-count">
                      {toFa(form ? bindingList.length : surface.native_fields.length + bindingList.length)}
                    </span>
                  </h3>
                  <p>نام و نوع ورودی را ببینید و وضعیت نمایش و الزامی‌بودن آن را تعیین کنید.</p>
                </div>
                <Button icon={Plus} disabled={!designer.can_create_field} onClick={() => setCreating(true)}>
                  افزودن فیلد
                </Button>
              </div>
              {!designer.can_create_field && designer.can_publish && (
                <p className="studio-permission-note">{designer.create_field_reason}</p>
              )}
              <div className="studio-fields">
                <div className="studio-field-labels">
                  <span>نام و نوع فیلد</span>
                  <span>نمایش</span>
                  <span>الزامی</span>
                  <span className="studio-sr-only">عملیات</span>
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
                          <small>
                            {designer.field_types.find((type) => type.id === field.kind)?.title || "ورودی اصلی"}
                          </small>
                          {field.locked && (
                            <small className="studio-lock-note">
                              <LockKeyhole size={12} />
                              {field.lock_reason}
                            </small>
                          )}
                        </div>
                        <StudioSwitch
                          title={`نمایش ${field.title}`}
                          checked={!config.hidden}
                          disabled={field.locked}
                          reason={field.lock_reason}
                          onChange={(checked) => update({ hidden: !checked })}
                        />
                        <StudioSwitch
                          title={`الزامی بودن ${field.title}`}
                          checked={config.required}
                          disabled={field.locked || Boolean(config.hidden)}
                          reason={
                            field.lock_reason ||
                            (config.hidden ? "فیلد پنهان در فرم از کاربر دریافت نمی‌شود." : undefined)
                          }
                          onChange={(checked) => update({ required: checked })}
                        />
                        <span aria-hidden="true" />
                      </div>
                    );
                  })}
                {bindingList.map((binding) => {
                  const field = findField(binding.field),
                    title = binding.title ?? field?.title ?? binding.field;
                  const lockReason = designer.locked_fields[binding.field],
                    locked = Boolean(lockReason);
                  return (
                    <div className="studio-field-row studio-custom-row" key={binding.field}>
                      <div>
                        <label className="studio-input-label">
                          <span className="studio-mobile-label">نام فیلد</span>
                          <input
                            className="studio-field-input"
                            aria-label={`نام فیلد ${field?.title || binding.field}`}
                            value={title}
                            maxLength={designer.limits.field_title}
                            onChange={(event) => updateBinding(binding.field, { title: event.target.value })}
                          />
                        </label>
                        <small>
                          {designer.field_types.find((type) => type.id === field?.kind)?.title || "فیلد اصلی فرم"}
                        </small>
                        {locked && (
                          <small className="studio-lock-note">
                            <LockKeyhole size={12} />
                            {lockReason}
                          </small>
                        )}
                      </div>
                      <StudioSwitch
                        title={`نمایش ${title || "فیلد"}`}
                        checked={!(binding.hidden ?? field?.config.hidden)}
                        disabled={locked}
                        reason={lockReason}
                        onChange={(checked) => updateBinding(binding.field, { hidden: !checked })}
                      />
                      <StudioSwitch
                        title={`الزامی بودن ${title || "فیلد"}`}
                        checked={binding.required ?? Boolean(field?.config.required)}
                        disabled={locked || Boolean(binding.hidden ?? field?.config.hidden)}
                        reason={lockReason}
                        onChange={(checked) => updateBinding(binding.field, { required: checked })}
                      />
                      <button
                        type="button"
                        aria-label={`حذف ${title} از فرم`}
                        disabled={locked}
                        title={lockReason || "حذف از فرم و ستون‌های مرتبط؛ اطلاعات ذخیره‌شده حذف نمی‌شود."}
                        onClick={() => removeField(binding.field)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="studio-form-help">
                <Info size={16} />
                <p>فیلدهای ضروری برای ثبت اطلاعات قفل هستند. حذف فیلد از فرم، داده‌های قبلی آن را پاک نمی‌کند.</p>
              </div>
            </>
          )}
          {currentMode === "columns" && (
            <>
              <section className="studio-table-tabs-editor">
                <div className="studio-section-title">
                  <span className="studio-section-icon">
                    <Columns3 size={18} />
                  </span>
                  <div>
                    <h3>تب‌های جدول</h3>
                    <p>برای هر تب، مجموعه‌ای از ستون‌های موردنیاز را انتخاب کنید.</p>
                  </div>
                  <span className="studio-count">
                    {toFa(tabs.length)} از {toFa(designer.limits.table_tabs)} تب
                  </span>
                </div>
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
                        className="studio-field-input"
                        maxLength={designer.limits.tab_title}
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
                    const id = createTableTabId();
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
                  <label className="studio-input-label">
                    <span>نام تب جدید</span>
                    <input
                      className="studio-field-input"
                      aria-label="نام تب جدید"
                      placeholder="مثلاً: اطلاعات تماس"
                      maxLength={designer.limits.tab_title}
                      value={newTab}
                      onChange={(event) => setNewTab(event.target.value)}
                    />
                  </label>
                  <Button
                    type="submit"
                    icon={Plus}
                    disabled={!newTab.trim() || tabs.length >= designer.limits.table_tabs}
                  >
                    افزودن تب
                  </Button>
                </form>
                <p className="studio-input-hint">
                  {tabs.length >= designer.limits.table_tabs
                    ? "به حداکثر تعداد تب رسیده‌اید؛ برای افزودن تب جدید، ابتدا یکی از تب‌ها را حذف کنید."
                    : "نام تب را وارد کنید؛ تنظیمات تب پس از ذخیره تغییرات در صفحه اعمال می‌شود."}
                </p>
              </section>
              <div className="studio-columns">
                <section>
                  <div className="studio-columns-heading">
                    <div>
                      <h3>ستون‌های قابل نمایش</h3>
                      <p>{activeTab?.title || "جدول اصلی"} · موارد موردنیاز را انتخاب کنید.</p>
                    </div>
                    <span className="studio-count">{toFa(columns.length)} ستون</span>
                  </div>
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
                  <p>اولین ستون در سمت راست جدول قرار می‌گیرد.</p>
                  {!columns.length && (
                    <div className="studio-empty">
                      <Columns3 size={24} />
                      <strong>هنوز ستونی انتخاب نشده است</strong>
                      <small>برای ذخیره جدول، حداقل یک ستون انتخاب کنید.</small>
                    </div>
                  )}
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
        </fieldset>
      </div>
      <footer className="studio-save-bar">
        <div className="studio-save-actions">
          <Button
            variant="secondary"
            icon={RotateCcw}
            disabled={mutation.isPending}
            onClick={() => setConfirmReload(true)}
          >
            بازنشانی
          </Button>
          <Button
            icon={Check}
            disabled={!dirty || mutation.isPending || !designer.can_publish}
            onClick={() => void save()}
          >
            {mutation.isPending ? "در حال ذخیره…" : "ذخیره تغییرات"}
          </Button>
        </div>
      </footer>
      {confirmReload && (
        <Dialog open onClose={() => !query.isFetching && setConfirmReload(false)} className="engine-drawer-backdrop">
          <DialogPanel className="studio-confirm-dialog">
            <DialogTitle>دریافت آخرین تنظیمات</DialogTitle>
            <p>تنظیمات ذخیره‌شده دوباره دریافت می‌شود و تغییرات ذخیره‌نشده این صفحه کنار گذاشته می‌شود.</p>
            <footer>
              <Button variant="secondary" disabled={query.isFetching} onClick={() => setConfirmReload(false)}>
                انصراف
              </Button>
              <Button disabled={query.isFetching} onClick={() => void reloadLatest()}>
                {query.isFetching ? "در حال دریافت…" : "دریافت و بازنشانی"}
              </Button>
            </footer>
            {query.error && <StudioError error={query.error} fallback="دریافت نسخه جدید انجام نشد؛ دوباره تلاش کنید." />}
          </DialogPanel>
        </Dialog>
      )}
      {creating && (
        <NewField
          code={code}
          designer={designer}
          onClose={() => setCreating(false)}
          onCreated={(field) => {
            setCreatedFields((current) => [...current, field]);
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
  const [params, setParams] = useSearchParams(),
    [search, setSearch] = useState("");
  const allPages = (pages.data?.results || []).filter((page) =>
    ["ticket", "task", "project", "leave", "users", "roles", "units", "routing", "cycles"].includes(page.code)
  );
  const code = allPages.some((page) => page.code === params.get("page")) ? params.get("page")! : allPages[0]?.code;
  if (pages.isLoading) return <Skeleton rows={6} />;
  if (pages.error)
    return <StudioError error={pages.error} fallback="فهرست صفحه‌ها دریافت نشد." retry={() => void pages.refetch()} />;
  const filteredPages = allPages.filter((page) =>
    normalizePersianSearch(page.title).includes(normalizePersianSearch(search))
  );
  return (
    <div className="page-studio">
      <aside className="page-studio-sidebar">
        <div className="studio-sidebar-heading">
          <span className="studio-eyebrow">انتخاب صفحه</span>
          <h2>
            صفحه‌های برنامه <span>{toFa(allPages.length)}</span>
          </h2>
          <p>فرم و جدول کدام صفحه را تغییر می‌دهید؟</p>
        </div>
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
          {filteredPages.map((page) => (
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
        {!filteredPages.length && (
          <div className="studio-empty">
            <Search size={22} />
            <strong>صفحه‌ای پیدا نشد</strong>
            <small>نام دیگری را جستجو کنید.</small>
          </div>
        )}
      </aside>
      {code ? (
        <PageEditor key={code} code={code} />
      ) : (
        <div className="studio-empty">
          <FilePenLine size={26} />
          <strong>صفحه‌ای برای طراحی در دسترس نیست</strong>
          <small>دسترسی صفحه‌ها را از مدیر سامانه پیگیری کنید.</small>
        </div>
      )}
    </div>
  );
}
