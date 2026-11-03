import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Combobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
  Popover,
  PopoverButton,
  PopoverPanel,
} from "@headlessui/react";
import { ErrorNotice } from "../error-notice";
import type { CSSProperties } from "react";
import { PersianDatePicker, PersianDateTimePicker } from "../form-fields/persian-date-picker";
import { fieldRequired, fieldVisible, formDisplayValues } from "./rules";
import type { FieldValue, SchemaField, SchemaFormProps, SchemaOption } from "./types";

/** Server-backed option list shared by the single and multi option inputs. */
function useOptionSource(
  field: SchemaField,
  loadOptions: SchemaFormProps["loadOptions"],
  parent: string | undefined,
  selected: string[]
) {
  const [active, setActive] = useState(false),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1);
  const [options, setOptions] = useState<SchemaOption[]>([]),
    [labels, setLabels] = useState<Record<string, string>>({});
  const [count, setCount] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const selectedKey = selected.join(",");
  // The form rebuilds field objects (and some callers the loader) on every render; key requests on stable values.
  const latest = useRef({ field, loadOptions });
  latest.current = { field, loadOptions };
  const hasLoader = Boolean(loadOptions);
  useEffect(() => {
    const { field: current, loadOptions: load } = latest.current;
    if (!load || !selectedKey) return;
    let live = true;
    void load(current, "", 1, parent, selectedKey.split(","), true)
      // eslint-disable-next-line promise/always-return -- only updates local labels.
      .then((data) => {
        if (live) setLabels((old) => ({ ...old, ...Object.fromEntries(data.results.map((r) => [r.id, r.title])) }));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [field.code, hasLoader, parent, selectedKey]);
  useEffect(() => {
    if (!active || !hasLoader) return;
    let live = true;
    const timer = window.setTimeout(() => {
      const { field: current, loadOptions: load } = latest.current;
      if (!load) return;
      setBusy(true);
      setError("");
      void load(current, query, page, parent)
        // eslint-disable-next-line promise/always-return -- only updates local options.
        .then((data) => {
          if (!live) return;
          setOptions((old) =>
            page === 1 ? data.results : [...old, ...data.results.filter((r) => !old.some((o) => o.id === r.id))]
          );
          setLabels((old) => ({ ...old, ...Object.fromEntries(data.results.map((r) => [r.id, r.title])) }));
          setCount(data.count);
        })
        .catch(() => {
          if (live) setError("دریافت گزینه‌ها انجام نشد؛ دوباره تلاش کنید.");
        })
        .finally(() => {
          if (live) setBusy(false);
        });
    }, 180);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [field.code, hasLoader, active, page, parent, query]);
  return {
    options,
    busy,
    error,
    query,
    hasMore: options.length < count,
    activate: () => setActive(true),
    search: (text: string) => {
      setQuery(text);
      setPage(1);
    },
    more: () => setPage((current) => current + 1),
    label: (id: string) => labels[id] || "انتخاب ثبت‌شده",
  };
}

function OptionStatus({ source }: { source: ReturnType<typeof useOptionSource> }) {
  return (
    <>
      {source.busy && (
        <p role="status" className="schema-picker-status">
          در حال دریافت…
        </p>
      )}
      <ErrorNotice message={source.error} />
      {!source.busy && !source.error && source.options.length === 0 && (
        <p role="status" className="schema-picker-status">
          {source.query ? "نتیجه‌ای یافت نشد." : "گزینه‌ای برای انتخاب وجود ندارد."}
        </p>
      )}
      {source.hasMore && (
        <button
          type="button"
          className="schema-picker-more"
          disabled={source.busy}
          onMouseDown={(event) => event.preventDefault()}
          onClick={source.more}
        >
          نمایش بیشتر
        </button>
      )}
    </>
  );
}

/** Single choice renders like SearchableSelect; multiple choice like CompactMultiSelector. */
function OptionField({
  id,
  field,
  value,
  parent,
  disabled,
  invalid,
  loadOptions,
  onChange,
}: {
  id: string;
  field: SchemaField;
  value: FieldValue | undefined;
  parent?: string;
  disabled: boolean;
  invalid: boolean;
  loadOptions: SchemaFormProps["loadOptions"];
  onChange: (value: FieldValue) => void;
}) {
  const multiple = field.kind === "multi_select" || Boolean(field.config.multiple);
  const selected = Array.isArray(value) ? value : value ? [String(value)] : [];
  const source = useOptionSource(field, loadOptions, parent, selected);
  if (!multiple)
    return (
      <div className="searchable-select schema-picker" onFocusCapture={source.activate}>
        <Combobox
          value={selected[0] ?? null}
          onChange={(next: string | null) => {
            if (next !== null) onChange(next);
          }}
          disabled={disabled}
          onClose={() => source.search("")}
        >
          <div className="selector-input-row">
            <ComboboxInput
              id={id}
              aria-label={field.title}
              aria-invalid={invalid}
              aria-describedby={`${id}-help`}
              placeholder={field.placeholder || "انتخاب…"}
              displayValue={(current: string | null) => (current ? source.label(current) : "")}
              onChange={(event) => source.search(event.target.value)}
            />
            {selected.length > 0 && !disabled && (
              <button
                type="button"
                className="schema-clear"
                aria-label={`پاک کردن ${field.title}`}
                onClick={() => onChange(null)}
              >
                ×
              </button>
            )}
            <ComboboxButton type="button" aria-label={`باز کردن ${field.title}`} onClick={source.activate}>
              ⌄
            </ComboboxButton>
          </div>
          <ComboboxOptions
            className="selector-panel selector-single-options"
            anchor="bottom start"
            portal
            modal={false}
            dir="rtl"
          >
            {source.options.map((option) => (
              <ComboboxOption
                key={option.id}
                value={option.id}
                disabled={option.disabled}
                className="selector-single-option"
              >
                <span style={{ color: option.color }}>{option.title}</span>
                {option.disabled && " (غیرفعال)"}
              </ComboboxOption>
            ))}
            <OptionStatus source={source} />
          </ComboboxOptions>
        </Combobox>
      </div>
    );
  const toggle = (optionId: string, checked: boolean) =>
    onChange(checked ? [...new Set([...selected, optionId])] : selected.filter((v) => v !== optionId));
  return (
    <fieldset className="compact-selector schema-picker schema-picker-multi" disabled={disabled}>
      {selected.length > 0 && (
        <div className="selector-selected" aria-label="انتخاب‌های فعلی">
          {selected.map((optionId) => (
            <span key={optionId}>
              {source.label(optionId)}
              {!disabled && (
                <button
                  type="button"
                  aria-label={`حذف انتخاب ${source.label(optionId)}`}
                  onClick={() => toggle(optionId, false)}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      <Popover>
        <PopoverButton
          id={id}
          type="button"
          className="selector-trigger"
          aria-label={field.title}
          aria-invalid={invalid}
          aria-describedby={`${id}-help`}
          disabled={disabled}
          onClick={source.activate}
        >
          <span>{field.placeholder || `انتخاب ${field.title}`}</span>
          <span>
            {selected.length.toLocaleString("fa-IR")} انتخاب <span aria-hidden>⌄</span>
          </span>
        </PopoverButton>
        <PopoverPanel
          className="selector-panel selector-multi-options"
          focus={false}
          anchor="bottom start"
          portal
          dir="rtl"
        >
          <label className="selector-search">
            <span className="sr-only">جستجو در {field.title}</span>
            <input
              type="search"
              placeholder="جستجو…"
              value={source.query}
              onChange={(event) => source.search(event.target.value)}
            />
          </label>
          <div className="selector-toolbar">
            <button
              type="button"
              onClick={() =>
                onChange([
                  ...new Set([...selected, ...source.options.filter((option) => !option.disabled).map((o) => o.id)]),
                ])
              }
            >
              انتخاب نتایج
            </button>
            <button
              type="button"
              onClick={() => onChange(selected.filter((v) => !source.options.some((option) => option.id === v)))}
            >
              پاک کردن نتایج
            </button>
          </div>
          <div className="selector-options" role="group" aria-label={field.title}>
            {source.options.map((option) => (
              <label key={option.id} className="selector-option">
                <input
                  type="checkbox"
                  checked={selected.includes(option.id)}
                  disabled={Boolean(option.disabled) && !selected.includes(option.id)}
                  onChange={(event) => toggle(option.id, event.target.checked)}
                />
                <span style={{ color: option.color }}>
                  {option.title}
                  {option.disabled && <small>غیرفعال</small>}
                </span>
              </label>
            ))}
          </div>
          <OptionStatus source={source} />
        </PopoverPanel>
      </Popover>
    </fieldset>
  );
}

/** Tags are typed as chips: Enter or a comma adds one, so spaces inside a tag are kept. */
function TagField({
  id,
  field,
  value,
  disabled,
  invalid,
  onChange,
}: {
  id: string;
  field: SchemaField;
  value: FieldValue | undefined;
  disabled: boolean;
  invalid: boolean;
  onChange: (value: FieldValue) => void;
}) {
  const [draft, setDraft] = useState("");
  const tags = Array.isArray(value) ? value : [];
  const commit = (text: string) => {
    const added = text
      .split(/[,،]/)
      .map((v) => v.trim())
      .filter(Boolean);
    if (added.length) onChange([...new Set([...tags, ...added])]);
    setDraft("");
  };
  return (
    <div className="schema-tag-input">
      {tags.length > 0 && (
        <div className="selector-selected" aria-label="تگ‌های فعلی">
          {tags.map((tag) => (
            <span key={tag}>
              {tag}
              {!disabled && (
                <button
                  type="button"
                  aria-label={`حذف تگ ${tag}`}
                  onClick={() => onChange(tags.filter((v) => v !== tag))}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      <input
        id={id}
        disabled={disabled}
        aria-label={field.title}
        aria-invalid={invalid}
        aria-describedby={`${id}-help`}
        value={draft}
        placeholder={field.placeholder || "تگ را بنویسید و Enter بزنید"}
        onChange={(e) => {
          if (/[,،]/.test(e.target.value)) commit(e.target.value);
          else setDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && !draft && tags.length) onChange(tags.slice(0, -1));
        }}
        onBlur={() => commit(draft)}
      />
    </div>
  );
}

function FormField({
  field,
  value,
  displayed,
  onChange,
  props,
}: {
  field: SchemaField;
  value: FieldValue | undefined;
  displayed: SchemaFormProps["values"];
  onChange: (value: FieldValue) => void;
  props: SchemaFormProps;
}) {
  const id = useId(),
    [uploading, setUploading] = useState(false),
    [uploadError, setUploadError] = useState("");
  const disabled = Boolean(
    props.disabled ||
    field.config.readonly ||
    !field.is_active ||
    (props.editing && field.config.editable_after_create === false)
  );
  const required = fieldRequired(field, displayed, props.schema),
    config = field.config;
  const common = {
    id,
    disabled,
    "aria-label": field.title,
    "aria-invalid": Boolean(props.errors?.[field.code]),
    "aria-describedby": `${id}-help`,
    placeholder: field.placeholder,
  };
  const text = typeof value === "string" || typeof value === "number" ? String(value) : "";
  let input;
  if (["select", "multi_select", "user", "unit", "role", "relation"].includes(field.kind)) {
    input = (
      <OptionField
        id={id}
        field={field}
        value={value}
        disabled={disabled}
        invalid={Boolean(props.errors?.[field.code])}
        loadOptions={props.loadOptions}
        parent={config.depends_on ? String(displayed[config.depends_on] || "") : undefined}
        onChange={onChange}
      />
    );
  } else if (field.kind === "date") {
    input = (
      <PersianDatePicker
        {...common}
        timeZone={props.schema.time_zone}
        value={text}
        label={field.title}
        onChange={onChange}
        required={required}
      />
    );
  } else if (field.kind === "datetime") {
    input = (
      <PersianDateTimePicker
        {...common}
        timeZone={props.schema.time_zone}
        value={text}
        label={field.title}
        onChange={onChange}
        required={required}
      />
    );
  } else if (field.kind === "date_range") {
    const range =
      value && typeof value === "object" && !Array.isArray(value) && "start" in value ? value : { start: "", end: "" };
    input = (
      <div className="schema-date-range">
        <PersianDatePicker
          value={range.start}
          disabled={disabled}
          label={`${field.title} از`}
          onChange={(start) => onChange({ ...range, start })}
        />
        <PersianDatePicker
          value={range.end}
          disabled={disabled}
          label={`${field.title} تا`}
          onChange={(end) => onChange({ ...range, end })}
        />
      </div>
    );
  } else if (field.kind === "checkbox" || field.kind === "boolean") {
    input = (
      <input
        {...common}
        type="checkbox"
        role={field.kind === "boolean" ? "switch" : undefined}
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  } else if (field.kind === "rating") {
    input = (
      <div className="schema-stars" role="group" aria-label={field.title}>
        {Array.from({ length: config.stars || 5 }, (_, i) => (
          <button
            key={i}
            type="button"
            disabled={disabled}
            aria-label={`${i + 1} ستاره`}
            aria-pressed={Number(value) === i + 1}
            onClick={() => onChange(i + 1)}
            style={{ color: Number(value) > i ? "#d97706" : "#94a3b8" }}
          >
            ★
          </button>
        ))}
      </div>
    );
  } else if (field.kind === "tags") {
    input = (
      <TagField
        id={id}
        field={field}
        value={value}
        disabled={disabled}
        invalid={Boolean(props.errors?.[field.code])}
        onChange={onChange}
      />
    );
  } else if (field.kind === "file") {
    input = (
      <div className="schema-files">
        <label className="schema-file-upload" data-disabled={disabled || uploading || undefined}>
          <span>{uploading ? "در حال بارگذاری…" : "انتخاب و بارگذاری فایل"}</span>
          <input
            {...common}
            disabled={disabled || uploading}
            type="file"
            multiple
            accept={config.extensions?.map((e) => `.${e}`).join(",")}
            onChange={async (e) => {
              if (!props.uploadFile || !e.target.files) return;
              setUploading(true);
              setUploadError("");
              try {
                const ids = Array.isArray(value) ? [...value] : [];
                for (const file of Array.from(e.target.files)) {
                  if (file.size > (config.max_file_size ?? 5242880)) throw new Error("حجم فایل بیش از حد مجاز است.");
                  if (
                    config.extensions?.length &&
                    !config.extensions.includes(file.name.split(".").pop()?.toLowerCase() || "")
                  )
                    throw new Error("نوع فایل مجاز نیست.");
                  // eslint-disable-next-line no-await-in-loop -- files upload one at a time to keep their order.
                  ids.push((await props.uploadFile(field, file)).id);
                }
                onChange(ids);
              } catch (error) {
                setUploadError(error instanceof Error ? error.message : "بارگذاری انجام نشد.");
              } finally {
                setUploading(false);
                e.target.value = "";
              }
            }}
          />
        </label>
        {uploading && <p role="status">در حال بارگذاری…</p>}
        <ErrorNotice message={uploadError} />
        {(Array.isArray(value) ? value : []).map((file, i) => (
          <div key={file}>
            <a href={props.fileHref?.(field, file)} target="_blank" rel="noreferrer">
              فایل {(i + 1).toLocaleString("fa-IR")}
            </a>
            {!disabled && (
              <button
                type="button"
                aria-label={`حذف فایل ${i + 1}`}
                onClick={() => onChange((value as string[]).filter((v) => v !== file))}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
    );
  } else if (field.kind === "rich_text" && props.renderRichText) {
    input = props.renderRichText(field, text, onChange, disabled);
  } else if (field.kind === "long_text" || field.kind === "rich_text") {
    input = <textarea {...common} value={text} rows={4} onChange={(e) => onChange(e.target.value)} />;
  } else if (field.kind === "computed") {
    input = (
      <output id={id} aria-label={field.title}>
        {emptyText(value)}
      </output>
    );
  } else if (["integer", "decimal", "money", "percent"].includes(field.kind)) {
    input = (
      <div className="schema-number">
        <input
          {...common}
          inputMode={field.kind === "integer" ? "numeric" : "decimal"}
          dir="ltr"
          value={text}
          onChange={(e) => {
            const raw = e.target.value.replace(/[,٬]/g, "").replace(/[۰-۹٠-٩]/g, (d) => String(d.charCodeAt(0) & 15));
            if (!(field.kind === "integer" ? /^-?\d*$/ : /^-?\d*(\.\d*)?$/).test(raw)) return;
            onChange(raw === "" ? null : raw);
          }}
        />
        {field.kind === "money" && (
          <small>
            {Number.isFinite(Number(text)) && text !== ""
              ? new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 10 }).format(Number(text))
              : ""}{" "}
            {config.unit}
          </small>
        )}
        {field.kind === "percent" && <small>٪</small>}
      </div>
    );
  } else {
    input = (
      <input
        {...common}
        type={
          field.config.secret
            ? "password"
            : field.kind === "email"
              ? "email"
              : field.kind === "url"
                ? "url"
                : field.kind === "phone"
                  ? "tel"
                  : "text"
        }
        dir={["email", "url", "phone"].includes(field.kind) ? "ltr" : undefined}
        value={text}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  const related = field.kind === "relation" ? (Array.isArray(value) ? value : value ? [String(value)] : []) : [];
  return (
    <div
      className={`schema-field schema-field-${field.kind}${props.errors?.[field.code] ? " has-error" : ""}`}
      data-field={field.code}
    >
      <label htmlFor={id}>
        {field.title}
        {required && <span aria-label="الزامی"> *</span>}
        {!field.is_active && <small> (غیرفعال)</small>}
      </label>
      {input}
      {related.map((relatedId) => (
        <RelationInfo key={relatedId} field={field} id={relatedId} props={props} />
      ))}
      {field.help_text && <small id={`${id}-help`}>{field.help_text}</small>}
      {props.errors?.[field.code] && <span className="sr-only">{props.errors[field.code]}</span>}
    </div>
  );
}

function RelationInfo({ field, id, props }: { field: SchemaField; id: string; props: SchemaFormProps }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="schema-relation-preview"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <a href={props.relationHref?.(field, id)} onFocus={() => setOpen(true)}>
        باز کردن رکورد مرتبط
      </a>
      <button type="button" aria-expanded={open} onClick={() => setOpen(true)} onFocus={() => setOpen(true)}>
        اطلاعات
      </button>
      {open && (
        <div className="schema-relation-panel">
          {props.renderRelationPreview?.(field, id)}
          <button type="button" onClick={() => setOpen(false)}>
            بستن اطلاعات
          </button>
        </div>
      )}
    </div>
  );
}

function emptyText(value: FieldValue | undefined): string {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

export function SchemaDrivenForm(props: SchemaFormProps) {
  const { schema, values, onChange } = props;
  const [tab, setTab] = useState(schema.layout.tabs[0]?.id || "");
  const displayed = useMemo(() => formDisplayValues(schema, values), [schema, values]);
  const fields = useMemo(() => new Map(schema.fields.map((f) => [f.code, f])), [schema]);
  const update = (field: SchemaField, value: FieldValue) => {
    const next = { ...values, [field.code]: value };
    for (const child of schema.fields)
      if (child.config.depends_on === field.code) next[child.code] = child.kind === "multi_select" ? [] : null;
    onChange(next);
  };
  const firstError = Object.entries(props.errors || {}).find(([, message]) => message);
  return (
    <div className="schema-form" dir="rtl">
      <ErrorNotice message={firstError && `${fields.get(firstError[0])?.title || "فرم"}: ${firstError[1]}`} />
      {schema.layout.tabs.length > 0 && (
        <div role="tablist" aria-label="بخش‌های فرم" className="schema-tabs">
          {schema.layout.tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={(tab || schema.layout.tabs[0]?.id) === item.id}
              onClick={() => setTab(item.id)}
            >
              {item.title}
            </button>
          ))}
        </div>
      )}
      {schema.layout.sections
        .filter((section) => !section.tab || section.tab === (tab || schema.layout.tabs[0]?.id))
        .map((section) => (
          <section key={section.id} className="schema-section">
            {section.title && <h3>{section.title}</h3>}
            <div className="schema-grid" style={{ "--schema-columns": section.columns } as CSSProperties}>
              {section.bindings.map((binding) => {
                const original = fields.get(binding.field);
                if (!original) return null;
                const field: SchemaField = {
                  ...original,
                  title: binding.title || original.title,
                  binding,
                  config: {
                    ...original.config,
                    ...(binding.required !== undefined && binding.required_if === undefined
                      ? { required_if: undefined }
                      : {}),
                    ...Object.fromEntries(
                      Object.entries(binding).filter(([key]) =>
                        [
                          "required",
                          "hidden",
                          "readonly",
                          "editable_after_create",
                          "default",
                          "required_if",
                          "visible_if",
                        ].includes(key)
                      )
                    ),
                  },
                };
                if (
                  !fieldVisible(field, displayed, schema) ||
                  (!field.is_active && (values[field.code] === null || values[field.code] === undefined))
                )
                  return null;
                return (
                  <FormField
                    key={field.code}
                    field={field}
                    value={displayed[field.code]}
                    displayed={displayed}
                    onChange={(value) => update(field, value)}
                    props={props}
                  />
                );
              })}
            </div>
          </section>
        ))}
    </div>
  );
}
