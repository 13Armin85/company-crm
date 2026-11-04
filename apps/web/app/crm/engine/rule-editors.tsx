import { SearchableSelect } from "@plane/ui";
import type { Formula } from "@plane/ui";
import type { FieldDefinition } from "./api";

export { ConditionEditor } from "./conditions/condition-editor";
export { conditionProblems } from "./conditions/condition-model";

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
        onChange={(nextMode) =>
          onChange(
            nextMode === "field"
              ? { field: fields[0]?.code || "" }
              : nextMode === "today"
                ? { dynamic: "today" }
                : nextMode === "operation"
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
