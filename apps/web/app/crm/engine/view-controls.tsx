import { useState } from "react";
import { ArrowUp, GripVertical, Search, Trash2 } from "lucide-react";
import { SearchableSelect, SchemaDrivenForm } from "@plane/ui";
import type { Condition, FieldValue, SchemaField, EntityFormSchema } from "@plane/ui";
import { useSchemaTransport } from "./record-form";
import { api } from "../api";
import { enginePath, useEngineSlug } from "./api";
import type { ViewDefinition, ViewField, ViewColumn } from "./view-types";

const operatorNames: Record<string, string> = {
  eq: "برابر",
  ne: "نابرابر",
  in: "یکی از",
  not_in: "هیچ‌یک از",
  contains: "شامل",
  empty: "خالی",
  not_empty: "دارای مقدار",
  gt: "بزرگ‌تر / بعد از",
  gte: "بزرگ‌تر یا برابر",
  lt: "کوچک‌تر / پیش از",
  lte: "کوچک‌تر یا برابر",
};
export function ViewValueInput({
  field,
  value,
  onChange,
  multiple = false,
  mode = "filter",
}: {
  field: ViewField;
  value?: FieldValue;
  onChange: (value: FieldValue) => void;
  multiple?: boolean;
  mode?: "filter" | "edit";
}) {
  const transport = useSchemaTransport(field.options_entity);
  const slug = useEngineSlug();
  const kind =
    multiple && ["short_text", "long_text", "integer", "decimal", "money", "date", "datetime"].includes(field.kind)
      ? "tags"
      : mode === "filter" && field.kind === "computed"
        ? "decimal"
        : mode === "filter" && ["file", "rich_text"].includes(field.kind)
          ? "short_text"
          : field.kind;
  const input: SchemaField = {
    id: field.code,
    code: field.field_code,
    title: field.title,
    kind,
    config: {
      ...field.config,
      readonly: false,
      editable_after_create: true,
      multiple: multiple || field.config.multiple,
    },
    lookup: field.lookup,
    relation_entity: field.relation_entity,
    binding: { field: field.field_code },
    is_active: true,
  };
  const schema: EntityFormSchema = {
    entity: field.options_entity,
    title: field.title,
    schema_version: 1,
    fields: [input],
    layout: { tabs: [], sections: [{ id: "value", columns: 1, bindings: [{ field: field.field_code }] }] },
  };
  if (["boolean", "checkbox"].includes(field.kind))
    return (
      <SearchableSelect
        showLabel
        label={field.title}
        value={value == null ? "" : String(value)}
        options={[
          { id: "", title: "خالی" },
          { id: "true", title: "بله" },
          { id: "false", title: "خیر" },
        ]}
        onChange={(v) => onChange(v === "" ? null : v === "true")}
      />
    );
  return (
    <SchemaDrivenForm
      {...transport}
      schema={schema}
      values={{ [field.field_code]: value ?? null }}
      onChange={(values) => onChange(values[field.field_code])}
      loadOptions={async (_item, search, page, _parent, selected, resolve) =>
        (
          await api.get(`${enginePath(slug)}/entities/${field.options_entity}/view-options/${field.field_code}/`, {
            params: {
              search,
              page,
              subtype: field.options_subtype,
              ...(resolve ? { resolve: "true", selected: selected?.join(",") } : {}),
            },
          })
        ).data
      }
    />
  );
}

export function ViewFilterEditor({
  value,
  onChange,
  fields,
  depth = 0,
}: {
  value?: Condition | null;
  onChange: (value: Condition | null) => void;
  fields: ViewField[];
  depth?: number;
}) {
  const first = fields.find((f) => f.filterable)?.code || "";
  if (!value)
    return (
      <button
        type="button"
        className="button button-secondary"
        onClick={() => onChange({ field: first, op: "eq", value: "" })}
      >
        افزودن شرط
      </button>
    );
  if ("rules" in value)
    return (
      <fieldset className="engine-rule-group">
        <legend>گروه شرط‌ها</legend>
        <SearchableSelect
          showLabel
          label="ترکیب"
          value={value.op}
          options={[
            { id: "and", title: "همه شرط‌ها (و)" },
            { id: "or", title: "حداقل یکی (یا)" },
          ]}
          onChange={(op) => onChange({ ...value, op: op as "and" | "or" })}
        />
        {value.rules.map((rule, index) => (
          <ViewFilterEditor
            key={index}
            value={rule}
            fields={fields}
            depth={depth + 1}
            onChange={(next) => {
              const rules = next
                ? value.rules.map((old, i) => (i === index ? next : old))
                : value.rules.filter((_, i) => i !== index);
              onChange(rules.length ? { ...value, rules } : null);
            }}
          />
        ))}
        <button
          type="button"
          onClick={() => onChange({ ...value, rules: [...value.rules, { field: first, op: "eq", value: "" }] })}
        >
          شرط جدید
        </button>
        <button type="button" onClick={() => onChange(null)}>
          حذف گروه
        </button>
      </fieldset>
    );
  const field = fields.find((f) => f.code === value.field),
    dynamic = value.value && typeof value.value === "object" && !Array.isArray(value.value) && "dynamic" in value.value;
  return (
    <fieldset className="engine-rule-group">
      <div className="engine-view-filter-leaf">
        <SearchableSelect
          showLabel
          label="فیلد شرط"
          value={value.field}
          options={fields.filter((f) => f.filterable).map((f) => ({ id: f.code, title: f.title }))}
          onChange={(fieldCode) => onChange({ field: fieldCode, op: "eq", value: null })}
        />
        <SearchableSelect
          showLabel
          label="عملگر"
          value={value.op}
          options={(field?.operators || []).map((id) => ({ id, title: operatorNames[id] || id }))}
          onChange={(op) => onChange({ ...value, op: op as typeof value.op, value: null })}
        />
        {field &&
          !["empty", "not_empty"].includes(value.op) &&
          (dynamic ? (
            <p>
              امروز{" "}
              <button type="button" onClick={() => onChange({ ...value, value: null })}>
                انتخاب تاریخ ثابت
              </button>
            </p>
          ) : (
            <ViewValueInput
              field={field}
              value={value.value as FieldValue}
              multiple={["in", "not_in"].includes(value.op)}
              onChange={(next) => onChange({ ...value, value: next })}
            />
          ))}
      </div>
      <div className="engine-actions">
        {field && ["date", "datetime"].includes(field.kind) && (
          <button type="button" onClick={() => onChange({ ...value, value: { dynamic: "today" } })}>
            مقایسه با امروز
          </button>
        )}
        {depth < 6 && (
          <button type="button" onClick={() => onChange({ op: "and", rules: [value] })}>
            گروه تو‌در‌تو
          </button>
        )}
        <button type="button" onClick={() => onChange(null)}>
          حذف شرط
        </button>
      </div>
    </fieldset>
  );
}

export function ColumnEditor({
  value,
  onChange,
  fields,
  onLoadPath,
  columnsOnly = false,
}: {
  value: ViewDefinition;
  onChange: (value: ViewDefinition) => void;
  fields: ViewField[];
  onLoadPath: (path: string) => Promise<void>;
  columnsOnly?: boolean;
}) {
  const [search, setSearch] = useState(""),
    [drag, setDrag] = useState("");
  const updateColumn = (field: string, patch: Partial<ViewColumn>) =>
    onChange({ ...value, columns: value.columns.map((c) => (c.field === field ? { ...c, ...patch } : c)) });
  return (
    <div className="engine-column-editor">
      <div className="engine-column-tools">
        <label className="engine-column-search">
          <span>جستجو در ستون‌ها</span>
          <span className="engine-input-with-icon">
            <Search size={16} aria-hidden="true" />
            <input placeholder="عنوان یا مسیر ستون…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </span>
        </label>
        <SearchableSelect
          showLabel
          label="افزودن ستون"
          value=""
          options={fields
            .filter((f) => f.table_visible && !value.columns.some((c) => c.field === f.code))
            .map((f) => ({ id: f.code, title: f.title }))}
          onChange={(fieldCode) =>
            onChange({ ...value, columns: [...value.columns, { field: fieldCode, width: 180 }] })
          }
        />
      </div>
      {fields
        .filter((f) => f.kind === "relation" && f.title.includes(search) && f.code.split(".").length < 4)
        .map((f) => (
          <button type="button" className="button button-ghost" key={f.code} onClick={() => void onLoadPath(f.code)}>
            ستون‌های مسیر {f.title} ←
          </button>
        ))}
      {value.columns
        .filter((c) => !search || (fields.find((f) => f.code === c.field)?.title || c.field).includes(search))
        .map((column, index) => (
          <div
            className="engine-column-row"
            key={column.field}
            draggable
            onDragStart={() => setDrag(column.field)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const source = value.columns.find((c) => c.field === drag);
              if (source) {
                const next = value.columns.filter((c) => c.field !== drag);
                next.splice(
                  next.findIndex((c) => c.field === column.field),
                  0,
                  source
                );
                onChange({ ...value, columns: next });
              }
            }}
          >
            <span className="engine-column-drag" aria-hidden="true">
              <GripVertical size={17} />
            </span>
            <span className="engine-column-name">
              <strong>{fields.find((f) => f.code === column.field)?.title || "فیلد بدون عنوان"}</strong>
              <small dir="ltr">{column.field}</small>
            </span>
            {fields.find((field) => field.code === column.field)?.kind === "relation" &&
              !column.field.includes(".") && (
                <SearchableSelect
                  showLabel
                  label="نمایش ارتباط"
                  value={column.display || "values"}
                  options={[
                    { id: "values", title: "مقادیر مرتبط" },
                    { id: "related_list", title: "تعداد و فهرست مرتبط" },
                  ]}
                  onChange={(displayMode) =>
                    updateColumn(column.field, {
                      display: displayMode === "related_list" ? "related_list" : undefined,
                    })
                  }
                />
              )}
            <label className="engine-column-width">
              <span>عرض ستون</span>
              <span className="engine-suffixed-input">
                <input
                  aria-label={`عرض ${fields.find((f) => f.code === column.field)?.title || "ستون"}`}
                  type="number"
                  min={80}
                  max={800}
                  value={column.width}
                  onChange={(e) =>
                    updateColumn(column.field, { width: Math.max(80, Math.min(800, Number(e.target.value))) })
                  }
                />
                <small>px</small>
              </span>
            </label>
            <SearchableSelect
              showLabel
              label="پین ستون"
              value={column.pin || ""}
              options={[
                { id: "", title: "بدون پین" },
                { id: "right", title: "راست" },
                { id: "left", title: "چپ" },
              ]}
              onChange={(pin) => updateColumn(column.field, { pin: pin as ViewColumn["pin"] })}
            />
            <span className="engine-column-actions">
              <button
                type="button"
                aria-label="ستون به بالا"
                title="انتقال به بالا"
                disabled={!index}
                onClick={() => {
                  const next = [...value.columns],
                    position = next.findIndex((c) => c.field === column.field);
                  [next[position - 1], next[position]] = [next[position], next[position - 1]];
                  onChange({ ...value, columns: next });
                }}
              >
                <ArrowUp size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`مخفی کردن ${fields.find((f) => f.code === column.field)?.title || "ستون"}`}
                title="حذف از جدول"
                disabled={value.columns.length === 1}
                onClick={() => onChange({ ...value, columns: value.columns.filter((c) => c.field !== column.field) })}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </span>
          </div>
        ))}
      {!value.columns.some((column) =>
        (fields.find((field) => field.code === column.field)?.title || column.field).includes(search)
      ) && <p className="engine-column-empty">ستونی با این عبارت پیدا نشد.</p>}
      {!columnsOnly && (
        <div className="engine-column-advanced">
          <h3>مرتب‌سازی چندستونه</h3>
          <fieldset>
            <legend>ستون‌های خلاصه اطلاعات من</legend>
            <p>ستون‌ها را انتخاب و برای تغییر ترتیب جابه‌جا کنید. بدون انتخاب، خلاصه رسمی استفاده می‌شود.</p>
            {fields.map((field) => (
              <label key={field.code} className="engine-checkbox">
                <input
                  type="checkbox"
                  checked={value.summary?.includes(field.code) || false}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      summary: event.target.checked
                        ? [...(value.summary || []), field.code]
                        : (value.summary || []).filter((path) => path !== field.code),
                    })
                  }
                />
                {field.title}
              </label>
            ))}
            {(value.summary || []).map((path) => (
              <div
                key={path}
                draggable
                onDragStart={() => setDrag(path)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (!value.summary?.includes(drag)) return;
                  const next = value.summary.filter((field) => field !== drag);
                  next.splice(next.indexOf(path), 0, drag);
                  onChange({ ...value, summary: next });
                }}
              >
                {fields.find((field) => field.code === path)?.title || path}
              </div>
            ))}
          </fieldset>
          {value.sort.map((sort, i) => (
            <div className="engine-actions" key={`${i}:${sort.field}`}>
              <SearchableSelect
                showLabel
                label={`فیلد مرتب‌سازی ${i + 1}`}
                value={sort.field}
                options={fields.map((f) => ({ id: f.code, title: f.title }))}
                onChange={(field) =>
                  onChange({ ...value, sort: value.sort.map((s, index) => (index === i ? { ...s, field } : s)) })
                }
              />
              <SearchableSelect
                showLabel
                label="جهت"
                value={sort.direction}
                options={[
                  { id: "asc", title: "صعودی" },
                  { id: "desc", title: "نزولی" },
                ]}
                onChange={(direction) =>
                  onChange({
                    ...value,
                    sort: value.sort.map((s, index) =>
                      index === i ? { ...s, direction: direction as "asc" | "desc" } : s
                    ),
                  })
                }
              />
              <button
                type="button"
                onClick={() => onChange({ ...value, sort: value.sort.filter((_, index) => index !== i) })}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              onChange({ ...value, sort: [...value.sort, { field: fields[0]?.code || "", direction: "asc" }] })
            }
          >
            افزودن مرتب‌سازی
          </button>
          <SearchableSelect
            showLabel
            label="گروه‌بندی"
            value={value.group || ""}
            options={[
              { id: "", title: "بدون گروه" },
              ...fields.filter((f) => f.filterable).map((f) => ({ id: f.code, title: f.title })),
            ]}
            onChange={(group) => onChange({ ...value, group: group || null })}
          />
        </div>
      )}
    </div>
  );
}
