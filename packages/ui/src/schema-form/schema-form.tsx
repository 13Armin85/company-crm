import { useEffect, useId, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { PersianDatePicker, PersianDateTimePicker } from "../form-fields/persian-date-picker";
import { fieldRequired, fieldVisible, formDisplayValues } from "./rules";
import type { FieldValue, SchemaField, SchemaFormProps, SchemaOption } from "./types";

function OptionField({
  field,
  value,
  parent,
  disabled,
  loadOptions,
  onChange,
}: {
  field: SchemaField;
  value: FieldValue | undefined;
  parent?: string;
  disabled: boolean;
  loadOptions: SchemaFormProps["loadOptions"];
  onChange: (value: FieldValue) => void;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1);
  const [options, setOptions] = useState<SchemaOption[]>([]),
    [labels, setLabels] = useState<Record<string, string>>({});
  const [count, setCount] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const multiple = field.kind === "multi_select" || Boolean(field.config.multiple);
  const selected = Array.isArray(value) ? value : value ? [String(value)] : [];
  const selectedKey = selected.join(",");
  useEffect(() => {
    if (!loadOptions || !selectedKey) return;
    let live = true;
    void loadOptions(field, "", 1, parent, selectedKey.split(","), true)
      .then((data) => {
        if (live) setLabels((old) => ({ ...old, ...Object.fromEntries(data.results.map((r) => [r.id, r.title])) }));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [field, loadOptions, parent, selectedKey]);
  useEffect(() => {
    if (!open || !loadOptions) return;
    let live = true;
    const timer = window.setTimeout(() => {
      setBusy(true);
      setError("");
      void loadOptions(field, query, page, parent)
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
  }, [field, loadOptions, open, page, parent, query]);
  return (
    <div className="schema-picker">
      <button
        type="button"
        className="schema-picker-trigger"
        disabled={disabled}
        aria-label={field.title}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setPage(1);
        }}
      >
        {selected.length
          ? selected.map((id) => labels[id] || "انتخاب ثبت‌شده").join("، ")
          : field.placeholder || "انتخاب…"}
        <span aria-hidden>⌄</span>
      </button>
      {selected.length > 0 && !disabled && (
        <button
          type="button"
          className="schema-clear"
          aria-label={`پاک کردن ${field.title}`}
          onClick={() => onChange(multiple ? [] : null)}
        >
          ×
        </button>
      )}
      {open && (
        <div className="schema-picker-panel">
          <input
            autoFocus
            aria-label={`جستجوی ${field.title}`}
            value={query}
            placeholder="جستجو…"
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
          />
          <div role="listbox" aria-label={field.title} aria-multiselectable={multiple}>
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={selected.includes(option.id)}
                disabled={option.disabled}
                onClick={() => {
                  onChange(
                    multiple
                      ? selected.includes(option.id)
                        ? selected.filter((v) => v !== option.id)
                        : [...selected, option.id]
                      : option.id
                  );
                  if (!multiple) setOpen(false);
                }}
              >
                <span style={{ color: option.color }}>
                  {selected.includes(option.id) ? "✓ " : ""}
                  {option.title}
                </span>
                {option.disabled && " (غیرفعال)"}
              </button>
            ))}
          </div>
          {busy && <p role="status">در حال دریافت…</p>}
          {error && <p role="alert">{error}</p>}
          {!busy && !error && options.length === 0 && <p>گزینه‌ای یافت نشد.</p>}
          {options.length < count && (
            <button type="button" disabled={busy} onClick={() => setPage(page + 1)}>
              نمایش بیشتر
            </button>
          )}
          <button type="button" onClick={() => setOpen(false)}>
            بستن
          </button>
        </div>
      )}
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
        field={field}
        value={value}
        disabled={disabled}
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
      <input
        {...common}
        value={Array.isArray(value) ? value.join("، ") : ""}
        placeholder="تگ‌ها را با ویرگول جدا کنید"
        onChange={(e) =>
          onChange([
            ...new Set(
              e.target.value
                .split(/[,،]/)
                .map((v) => v.trim())
                .filter(Boolean)
            ),
          ])
        }
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
        {uploadError && <p role="alert">{uploadError}</p>}
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
        type={field.kind === "email" ? "email" : field.kind === "url" ? "url" : field.kind === "phone" ? "tel" : "text"}
        value={text}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  const related = field.kind === "relation" ? (Array.isArray(value) ? value : value ? [String(value)] : []) : [];
  return (
    <div className={`schema-field schema-field-${field.kind}`} data-field={field.code}>
      <label htmlFor={id}>
        {field.title}
        {required && <span aria-label="الزامی"> *</span>}
        {!field.is_active && <small> (غیرفعال)</small>}
      </label>
      {input}
      {related.map((id) => (
        <RelationInfo key={id} field={field} id={id} props={props} />
      ))}
      {field.help_text && <small id={`${id}-help`}>{field.help_text}</small>}
      {props.errors?.[field.code] && <p role="alert">{props.errors[field.code]}</p>}
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
  return (
    <div className="schema-form" dir="rtl">
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
