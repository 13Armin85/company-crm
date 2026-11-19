import { useState } from "react";
import { ArrowDown, ArrowUp, Filter, GitBranch, GripVertical, Plus, Search, Trash2 } from "lucide-react";
import { SearchableSelect, SchemaDrivenForm } from "@plane/ui";
import type { Condition, FieldValue, SchemaField, EntityFormSchema } from "@plane/ui";
import { useSchemaTransport } from "./record-form";
import { api } from "../api";
import { enginePath, useEngineSlug } from "./api";
import type { ViewDefinition, ViewField, ViewColumn } from "./view-types";

/** The server sorts a relation only on its "one" side (by the related title). */
export const sortable = (field: { kind: string; config: { multiple?: boolean } }) =>
  !(field.kind === "relation" && field.config.multiple);

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

export function filterConditionCount(value?: Condition | null): number {
  if (!value) return 0;
  return "rules" in value ? value.rules.reduce((total, rule) => total + filterConditionCount(rule), 0) : 1;
}

export function newFilterCondition(fields: ViewField[], code?: string): Condition | null {
  const field = fields.find((item) => item.filterable && item.operators.length && (!code || item.code === code));
  return field
    ? {
        field: field.code,
        op: (field.operators.includes("eq") ? "eq" : field.operators[0]) as Extract<Condition, { field: string }>["op"],
        value: "",
      }
    : null;
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
  const count = filterConditionCount(value);
  return (
    <div className="advanced-filter-editor">
      <div className="advanced-filter-intro">
        <span className="advanced-filter-icon">
          <Filter size={21} aria-hidden="true" />
        </span>
        <div>
          <h3>شرط‌های نمایش رکوردها</h3>
          <p>فیلد، نحوهٔ مقایسه و مقدار موردنظر را انتخاب کنید. شرط‌ها را برای جستجوی دقیق‌تر ترکیب کنید.</p>
        </div>
        <span className="advanced-filter-count">{count.toLocaleString("fa-IR")} شرط</span>
      </div>
      {value ? (
        <FilterNode value={value} onChange={onChange} fields={fields} depth={depth} />
      ) : (
        <div className="advanced-filter-empty">
          <Filter size={28} aria-hidden="true" />
          <h4>از یک شرط ساده شروع کنید</h4>
          <p>
            {newFilterCondition(fields)
              ? "مثلاً نام شامل یک عبارت باشد یا وضعیت با مقدار دلخواه برابر باشد."
              : "برای این نما فیلد قابل فیلتر در دسترس نیست."}
          </p>
          <button
            className="button button-primary"
            type="button"
            disabled={!newFilterCondition(fields)}
            onClick={() => onChange(newFilterCondition(fields))}
          >
            <Plus size={16} aria-hidden="true" />
            افزودن اولین شرط
          </button>
        </div>
      )}
      {count > 0 && (
        <button type="button" className="advanced-filter-reset" onClick={() => onChange(null)}>
          <Trash2 size={14} aria-hidden="true" />
          پاک کردن همهٔ شرط‌ها
        </button>
      )}
    </div>
  );
}

function FilterNode({
  value,
  onChange,
  fields,
  depth = 0,
}: {
  value: Condition;
  onChange: (value: Condition | null) => void;
  fields: ViewField[];
  depth?: number;
}) {
  const fresh = () => newFilterCondition(fields);
  if ("rules" in value)
    return (
      <fieldset className="engine-rule-group advanced-filter-group">
        <legend>
          <GitBranch size={15} aria-hidden="true" />
          {depth ? "زیرگروه شرط‌ها" : "گروه شرط‌ها"}
        </legend>
        <div className="advanced-filter-logic" role="group" aria-label="نحوهٔ ترکیب شرط‌ها">
          <button type="button" aria-pressed={value.op === "and"} onClick={() => onChange({ ...value, op: "and" })}>
            همهٔ شرط‌ها <b>و</b>
          </button>
          <button type="button" aria-pressed={value.op === "or"} onClick={() => onChange({ ...value, op: "or" })}>
            حداقل یک شرط <b>یا</b>
          </button>
        </div>
        <p className="advanced-filter-explanation">
          {value.op === "and"
            ? "رکورد باید تمام شرط‌های این گروه را داشته باشد."
            : "داشتن یکی از شرط‌های این گروه برای نمایش رکورد کافی است."}
        </p>
        <div className="advanced-filter-children">
          {value.rules.map((rule, index) => (
            // eslint-disable-next-line react/no-array-index-key -- The condition contract identifies controlled rule slots by their position, including repeated fields.
            <div key={index} className="advanced-filter-branch">
              {index > 0 && (
                <span className="advanced-filter-join" aria-hidden="true">
                  {value.op === "and" ? "و" : "یا"}
                </span>
              )}
              <FilterNode
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
            </div>
          ))}
        </div>
        <div className="advanced-filter-actions">
          <button
            type="button"
            className="button button-secondary"
            disabled={!fresh()}
            onClick={() => {
              const rule = fresh();
              if (rule) onChange({ ...value, rules: [...value.rules, rule] });
            }}
          >
            <Plus size={15} aria-hidden="true" />
            افزودن شرط
          </button>
          {depth < 5 && (
            <button
              type="button"
              className="button button-secondary"
              disabled={!fresh()}
              onClick={() => {
                const rule = fresh();
                if (rule) onChange({ ...value, rules: [...value.rules, { op: "and", rules: [rule] }] });
              }}
            >
              <GitBranch size={15} aria-hidden="true" />
              افزودن زیرگروه
            </button>
          )}
          <button type="button" className="advanced-filter-remove" onClick={() => onChange(null)}>
            <Trash2 size={14} aria-hidden="true" />
            حذف گروه
          </button>
        </div>
      </fieldset>
    );
  const field = fields.find((f) => f.code === value.field),
    dynamic = value.value && typeof value.value === "object" && !Array.isArray(value.value) && "dynamic" in value.value;
  return (
    <fieldset className="engine-rule-group advanced-filter-condition">
      <legend>شرط</legend>
      <div className="engine-view-filter-leaf">
        <SearchableSelect
          showLabel
          label="فیلد شرط"
          value={value.field}
          options={fields.filter((f) => f.filterable).map((f) => ({ id: f.code, title: f.title }))}
          onChange={(fieldCode) => onChange(newFilterCondition(fields, fieldCode))}
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
            <div className="advanced-filter-dynamic">
              <span>مقدار مقایسه: امروز</span>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => onChange({ ...value, value: null })}
              >
                انتخاب تاریخ ثابت
              </button>
            </div>
          ) : (
            <ViewValueInput
              field={field}
              value={value.value as FieldValue}
              multiple={["in", "not_in"].includes(value.op)}
              onChange={(next) => onChange({ ...value, value: next })}
            />
          ))}
        {["empty", "not_empty"].includes(value.op) && (
          <p className="advanced-filter-no-value">برای این مقایسه نیازی به وارد کردن مقدار نیست.</p>
        )}
      </div>
      <div className="advanced-filter-actions">
        {field &&
          ["date", "datetime"].includes(field.kind) &&
          !["empty", "not_empty", "in", "not_in"].includes(value.op) && (
            <button
              className="button button-secondary"
              type="button"
              onClick={() => onChange({ ...value, value: { dynamic: "today" } })}
            >
              مقایسه با امروز
            </button>
          )}
        {depth < 6 && (
          <button
            className="button button-secondary"
            type="button"
            disabled={!fresh()}
            onClick={() => {
              const rule = fresh();
              if (rule) onChange({ op: "and", rules: [value, rule] });
            }}
          >
            <Plus size={15} aria-hidden="true" />
            افزودن شرط
          </button>
        )}
        <button className="advanced-filter-remove" type="button" onClick={() => onChange(null)}>
          <Trash2 size={14} aria-hidden="true" />
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
      <div className="engine-column-intro">
        <strong>{value.columns.length.toLocaleString("fa-IR")} ستون انتخاب‌شده</strong>
        <p>با فلش‌ها ترتیب را تغییر دهید؛ عرض و پین هر ستون در تنظیمات آن قرار دارد.</p>
      </div>
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
      {fields.some((f) => f.kind === "relation" && f.title.includes(search) && f.code.split(".").length < 4) && (
        <details className="engine-column-paths engine-advanced-setting">
          <summary>افزودن ستون از اطلاعات مرتبط</summary>
          <div>
            {fields
              .filter((f) => f.kind === "relation" && f.title.includes(search) && f.code.split(".").length < 4)
              .map((f) => (
                <button
                  type="button"
                  className="button button-ghost"
                  key={f.code}
                  onClick={() => void onLoadPath(f.code)}
                >
                  ستون‌های مسیر {f.title} ←
                </button>
              ))}
          </div>
        </details>
      )}
      {value.columns
        .filter((c) => !search || (fields.find((f) => f.code === c.field)?.title || c.field).includes(search))
        .map((column) => (
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
            <details className="engine-column-options">
              <summary>تنظیمات پیشرفتهٔ ستون</summary>
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
            </details>
            <span className="engine-column-actions">
              <button
                type="button"
                aria-label={`انتقال ${fields.find((f) => f.code === column.field)?.title || "ستون"} به بالا`}
                title="انتقال به بالا"
                disabled={value.columns.findIndex((item) => item.field === column.field) === 0}
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
                aria-label={`انتقال ${fields.find((f) => f.code === column.field)?.title || "ستون"} به پایین`}
                disabled={value.columns.findIndex((item) => item.field === column.field) === value.columns.length - 1}
                onClick={() => {
                  const next = [...value.columns],
                    position = next.findIndex((item) => item.field === column.field);
                  [next[position], next[position + 1]] = [next[position + 1], next[position]];
                  onChange({ ...value, columns: next });
                }}
              >
                <ArrowDown size={16} aria-hidden="true" />
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
        <div className="engine-view-simple-controls">
          <SearchableSelect
            showLabel
            label="مرتب‌سازی جدول من بر اساس"
            value={value.sort[0]?.field || ""}
            options={[
              { id: "", title: "بدون مرتب‌سازی" },
              ...fields.filter(sortable).map((field) => ({ id: field.code, title: field.title })),
            ]}
            onChange={(field) =>
              onChange({ ...value, sort: field ? [{ field, direction: value.sort[0]?.direction || "asc" }] : [] })
            }
          />
          {!!value.sort.length && (
            <SearchableSelect
              showLabel
              label="جهت مرتب‌سازی"
              value={value.sort[0].direction}
              options={[
                { id: "asc", title: "از کم به زیاد / قدیم به جدید" },
                { id: "desc", title: "از زیاد به کم / جدید به قدیم" },
              ]}
              onChange={(direction) =>
                onChange({ ...value, sort: [{ ...value.sort[0], direction: direction as "asc" | "desc" }] })
              }
            />
          )}
          <SearchableSelect
            showLabel
            label="گروه‌بندی جدول من بر اساس"
            value={value.group || ""}
            options={[
              { id: "", title: "بدون گروه‌بندی" },
              ...fields.filter((field) => field.filterable).map((field) => ({ id: field.code, title: field.title })),
            ]}
            onChange={(group) => onChange({ ...value, group: group || null })}
          />
        </div>
      )}
      {!columnsOnly && (
        <details className="engine-column-advanced engine-advanced-setting">
          <summary>تنظیمات پیشرفتهٔ نمای شخصی</summary>
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
          <h3>مرتب‌سازی چندستونه</h3>
          {value.sort.map((sort, i) => (
            // eslint-disable-next-line react/no-array-index-key -- Controlled sort slots can temporarily select the same field while editing.
            <div className="engine-column-sort-row" key={`${i}:${sort.field}`}>
              <SearchableSelect
                showLabel
                label={`فیلد مرتب‌سازی ${i + 1}`}
                value={sort.field}
                options={fields.filter(sortable).map((f) => ({ id: f.code, title: f.title }))}
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
                aria-label={`حذف مرتب‌سازی ${i + 1}`}
                onClick={() => onChange({ ...value, sort: value.sort.filter((_, index) => index !== i) })}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              onChange({
                ...value,
                sort: [...value.sort, { field: fields.find(sortable)?.code || "", direction: "asc" }],
              })
            }
          >
            افزودن مرتب‌سازی
          </button>
        </details>
      )}
    </div>
  );
}
