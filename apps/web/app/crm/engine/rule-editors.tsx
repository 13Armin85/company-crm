import { SearchableSelect } from "@plane/ui";
import type { Condition, Formula } from "@plane/ui";
import type { FieldDefinition, LookupOptionDefinition } from "./api";

type Leaf = Extract<Condition, { field: string }>;
const operators: { id: Leaf["op"]; title: string }[] = [
  { id: "eq", title: "برابر" },
  { id: "ne", title: "نابرابر" },
  { id: "empty", title: "خالی" },
  { id: "not_empty", title: "دارای مقدار" },
  { id: "contains", title: "شامل" },
  { id: "gt", title: "بزرگ‌تر / بعد از" },
  { id: "gte", title: "بزرگ‌تر یا برابر" },
  { id: "lt", title: "کوچک‌تر / پیش از" },
  { id: "lte", title: "کوچک‌تر یا برابر" },
];
export function ConditionEditor({
  value,
  onChange,
  fields,
  lookupValues = [],
  label,
  depth = 0,
}: {
  value?: Condition | null;
  onChange: (value: Condition | null) => void;
  fields: FieldDefinition[];
  lookupValues?: LookupOptionDefinition[];
  label: string;
  depth?: number;
}) {
  const first = fields[0]?.code || "";
  if (!value)
    return (
      <div className="engine-rule-empty">
        <span>{label}</span>
        <button type="button" onClick={() => onChange({ field: first, op: "eq", value: "" })}>
          افزودن شرط
        </button>
      </div>
    );
  if ("rules" in value)
    return (
      <fieldset className="engine-rule-group">
        <legend>{label}</legend>
        <SearchableSelect
          label="ترکیب شرط‌ها"
          value={value.op}
          options={[
            { id: "and", title: "همه شرط‌ها (و)" },
            { id: "or", title: "حداقل یکی (یا)" },
          ]}
          onChange={(op) => onChange({ ...value, op: op as "and" | "or" })}
        />
        {value.rules.map((rule, index) => (
          <ConditionEditor
            key={index}
            label={`شرط ${index + 1}`}
            value={rule}
            fields={fields}
            lookupValues={lookupValues}
            depth={depth + 1}
            onChange={(next) =>
              onChange({
                ...value,
                rules: next
                  ? value.rules.map((old, i) => (i === index ? next : old))
                  : value.rules.filter((_, i) => i !== index),
              })
            }
          />
        ))}
        <button
          type="button"
          onClick={() => onChange({ ...value, rules: [...value.rules, { field: first, op: "eq", value: "" }] })}
        >
          شرط جدید
        </button>
        {depth < 5 && (
          <button
            type="button"
            onClick={() =>
              onChange({
                ...value,
                rules: [...value.rules, { op: "or", rules: [{ field: first, op: "eq", value: "" }] }],
              })
            }
          >
            گروه تو‌در‌تو
          </button>
        )}
        <button type="button" onClick={() => onChange(null)}>
          حذف گروه
        </button>
      </fieldset>
    );
  const field = fields.find((f) => f.code === value.field),
    lookup = lookupValues.filter((v) => v.category === field?.lookup);
  const raw = value.value;
  return (
    <fieldset className="engine-rule">
      <legend>{label}</legend>
      <div className="engine-rule-row">
        <SearchableSelect
          label="فیلد شرط"
          value={value.field}
          options={fields.map((f) => ({ id: f.code, title: f.title }))}
          onChange={(field) => onChange({ ...value, field, value: "" })}
        />
        <SearchableSelect
          label="عملگر شرط"
          value={value.op}
          options={operators}
          onChange={(op) => onChange({ ...value, op: op as Leaf["op"] })}
        />
        {!["empty", "not_empty"].includes(value.op) &&
          (field?.kind === "boolean" || field?.kind === "checkbox" ? (
            <SearchableSelect
              label="مقدار شرط"
              value={String(raw ?? false)}
              options={[
                { id: "true", title: "بله" },
                { id: "false", title: "خیر" },
              ]}
              onChange={(v) => onChange({ ...value, value: v === "true" })}
            />
          ) : lookup.length ? (
            <SearchableSelect
              label="مقدار شرط"
              value={typeof raw === "string" ? raw : ""}
              options={lookup.map((v) => ({ id: field?.config.lookup_codes ? v.code : v.id, title: v.title }))}
              onChange={(v) => onChange({ ...value, value: v })}
            />
          ) : (
            <input
              aria-label="مقدار شرط"
              value={raw && typeof raw === "object" && "dynamic" in raw ? "امروز" : String(raw ?? "")}
              onChange={(e) =>
                onChange({
                  ...value,
                  value:
                    field?.kind === "integer" || field?.kind === "percent" || field?.kind === "rating"
                      ? Number(e.target.value)
                      : e.target.value,
                })
              }
            />
          ))}
      </div>
      <div className="engine-rule-actions">
        {["date", "datetime"].includes(field?.kind || "") && (
          <button type="button" onClick={() => onChange({ ...value, value: { dynamic: "today" } })}>
            مقایسه با امروز
          </button>
        )}
        {depth < 5 && (
          <button type="button" onClick={() => onChange({ op: "and", rules: [value] })}>
            تبدیل به گروه
          </button>
        )}
        <button type="button" onClick={() => onChange(null)}>
          حذف شرط
        </button>
      </div>
    </fieldset>
  );
}

export function FormulaEditor({
  value = { value: 0 },
  onChange,
  fields,
  label = "فرمول",
  depth = 0,
}: {
  value?: Formula;
  onChange: (value: Formula) => void;
  fields: FieldDefinition[];
  label?: string;
  depth?: number;
}) {
  const mode = "field" in value ? "field" : "dynamic" in value ? "today" : "args" in value ? "operation" : "constant";
  return (
    <fieldset className="engine-formula">
      <legend>{label}</legend>
      <SearchableSelect
        label="نوع ورودی فرمول"
        value={mode}
        options={[
          { id: "field", title: "مقدار یک فیلد" },
          { id: "constant", title: "عدد یا تاریخ ثابت" },
          { id: "today", title: "امروز" },
          ...(depth < 6 ? [{ id: "operation", title: "عملیات محاسباتی" }] : []),
        ]}
        onChange={(mode) =>
          onChange(
            mode === "field"
              ? { field: fields[0]?.code || "" }
              : mode === "today"
                ? { dynamic: "today" }
                : mode === "operation"
                  ? { op: "add", args: [{ value: 0 }, { value: 0 }] }
                  : { value: 0 }
          )
        }
      />
      {"field" in value && (
        <SearchableSelect
          label="فیلد ورودی"
          value={value.field}
          options={fields
            .filter((f) =>
              ["integer", "decimal", "money", "percent", "rating", "date", "datetime", "computed"].includes(f.kind)
            )
            .map((f) => ({ id: f.code, title: f.title }))}
          onChange={(field) => onChange({ field })}
        />
      )}
      {"value" in value && (
        <input
          aria-label="مقدار ثابت فرمول"
          value={String(value.value)}
          onChange={(e) =>
            onChange({ value: /^-?\d+(\.\d+)?$/.test(e.target.value) ? Number(e.target.value) : e.target.value })
          }
        />
      )}
      {"args" in value && (
        <>
          <SearchableSelect
            label="عملیات"
            value={value.op}
            options={[
              { id: "add", title: "جمع" },
              { id: "subtract", title: "تفریق" },
              { id: "multiply", title: "ضرب" },
              { id: "divide", title: "تقسیم" },
              { id: "date_diff", title: "اختلاف تاریخ به روز" },
            ]}
            onChange={(op) => onChange({ ...value, op: op as typeof value.op })}
          />
          <div className="engine-formula-operands">
            <FormulaEditor
              label="ورودی اول"
              value={value.args[0]}
              onChange={(left) => onChange({ ...value, args: [left, value.args[1]] })}
              fields={fields}
              depth={depth + 1}
            />
            <FormulaEditor
              label="ورودی دوم"
              value={value.args[1]}
              onChange={(right) => onChange({ ...value, args: [value.args[0], right] })}
              fields={fields}
              depth={depth + 1}
            />
          </div>
        </>
      )}
    </fieldset>
  );
}
