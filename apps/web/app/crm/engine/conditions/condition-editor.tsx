/**
 * Visual editor for "required if" / "visible if" rules. Each condition reads as a sentence
 * (input → comparison → value), groups combine conditions with "and"/"or", and a live summary
 * plus inline problems tell the user exactly what the rule does before it is saved.
 */
import { useEffect, useMemo, useState } from "react";
import { CircleAlert, FolderPlus, Plus, Trash2 } from "lucide-react";
import {
  CompactMultiSelector,
  PersianDatePicker,
  SearchableSelect,
  zonedDateTime,
  zonedDateTimeToISO,
} from "@plane/ui";
import type { Condition } from "@plane/ui";
import { useMembers, useOrganizationRoles, useOrganizationUnits } from "../../api";
import { persianDate } from "../../utils";
import type { FieldDefinition, LookupOptionDefinition } from "../api";
import {
  MAX_GROUP_DEPTH,
  MAX_GROUP_RULES,
  conditionProblems,
  describeCondition,
  leafProblem,
  newLeaf,
  operatorLabel,
  operatorsFor,
  parseNumber,
  simplifyCondition,
  valueInputFor,
  withField,
  withOperator,
} from "./condition-model";
import type { ChoiceOption, ConditionField, Group, Leaf } from "./condition-model";

const kindTitles: Partial<Record<FieldDefinition["kind"], string>> = {
  short_text: "متن کوتاه",
  long_text: "متن بلند",
  rich_text: "متن قالب‌دار",
  integer: "عدد صحیح",
  decimal: "عدد اعشاری",
  money: "مبلغ",
  percent: "درصد",
  rating: "امتیاز",
  computed: "محاسباتی",
  date: "تاریخ",
  datetime: "تاریخ و ساعت",
  date_range: "بازه تاریخ",
  checkbox: "بله/خیر",
  boolean: "بله/خیر",
  select: "انتخاب از فهرست",
  multi_select: "چندانتخابی",
  tags: "برچسب",
  user: "کاربر",
  unit: "واحد سازمانی",
  role: "نقش",
  file: "فایل",
  url: "نشانی وب",
  email: "ایمیل",
  phone: "تلفن",
  relation: "ارتباط با رکورد",
};
const CHOICE_KINDS = new Set(["select", "multi_select", "user", "unit", "role"]);

const formatConditionDate = (value: string) => persianDate(value, { year: "numeric", month: "long", day: "numeric" });

/** Option lists for choice-like fields, loaded only for the kinds the form actually uses. */
function useChoiceOptions(fields: FieldDefinition[], lookupValues: LookupOptionDefinition[]) {
  const has = (kind: string) => fields.some((field) => field.kind === kind);
  const { data: members = [] } = useMembers(undefined, undefined, has("user"));
  const { data: roles = [] } = useOrganizationRoles(undefined, has("role"));
  const { data: units = [] } = useOrganizationUnits(undefined, has("unit"));
  return useMemo(
    () =>
      (field: ConditionField): ChoiceOption[] => {
        if (field.kind === "user") return members.map((m) => ({ id: m.id, title: m.displayName }));
        if (field.kind === "role") return roles.map((r) => ({ id: r.id, title: r.name }));
        if (field.kind === "unit") return units.map((u) => ({ id: u.id, title: u.title }));
        if (!field.lookup) return [];
        return lookupValues
          .filter((option) => option.category === field.lookup && option.is_active !== false)
          .map((option) => ({ id: field.config?.lookup_codes ? option.code : option.id, title: option.title }));
      },
    [lookupValues, members, roles, units]
  );
}

interface EditorContext {
  fields: FieldDefinition[];
  choicesFor: (field: ConditionField) => ChoiceOption[];
}

export function ConditionEditor({
  value,
  onChange,
  fields,
  lookupValues = [],
  label,
  description,
}: {
  value?: Condition | null;
  onChange: (value: Condition | null) => void;
  /** Inputs the rule may compare; pass only the ones available on this form. */
  fields: FieldDefinition[];
  lookupValues?: LookupOptionDefinition[];
  label: string;
  /** What happens while no condition is set, shown under the title. */
  description?: string;
}) {
  const choicesFor = useChoiceOptions(fields, lookupValues);
  const context: EditorContext = { fields, choicesFor };
  const root: Group | undefined = value ? ("rules" in value ? value : { op: "and", rules: [value] }) : undefined;
  const save = (next: Group | null) => onChange(simplifyCondition(next));
  const problems = conditionProblems(value, fields);
  const summary = describeCondition(value, fields, choicesFor, formatConditionDate);

  return (
    <section className="engine-condition" aria-label={label}>
      <header className="engine-condition-header">
        <div>
          <strong>{label}</strong>
          <p>
            {root
              ? "شرط‌های زیر بررسی می‌شوند؛ تا وقتی برقرار نباشند این قاعده اعمال نمی‌شود."
              : description || "شرطی تعیین نشده است؛ این قاعده هیچ‌وقت به‌صورت شرطی اعمال نمی‌شود."}
          </p>
        </div>
        {root && (
          <button type="button" className="engine-condition-link danger" onClick={() => onChange(null)}>
            حذف همه شرط‌ها
          </button>
        )}
      </header>
      {!root ? (
        fields.length ? (
          <button type="button" className="engine-condition-add primary" onClick={() => onChange(newLeaf(fields[0]))}>
            <Plus size={16} aria-hidden />
            افزودن شرط
          </button>
        ) : (
          <p className="engine-condition-note">
            ورودی دیگری برای مقایسه وجود ندارد؛ ابتدا ورودی‌های دیگر را به فرم اضافه کنید.
          </p>
        )
      ) : (
        <>
          <GroupEditor group={root} depth={0} context={context} onChange={save} />
          <div className="engine-condition-summary" role="status">
            <span>یعنی:</span> وقتی {summary || "…"}
          </div>
          {problems.length > 0 && (
            <div className="engine-condition-problems" role="alert">
              <CircleAlert size={16} aria-hidden />
              {problems.length === 1
                ? "یک شرط کامل نیست؛ تا کامل نشود ذخیره انجام نمی‌شود."
                : `${problems.length.toLocaleString("fa-IR")} شرط کامل نیستند؛ تا کامل نشوند ذخیره انجام نمی‌شود.`}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function GroupEditor({
  group,
  depth,
  context,
  onChange,
}: {
  group: Group;
  depth: number;
  context: EditorContext;
  onChange: (group: Group | null) => void;
}) {
  const replace = (index: number, next: Condition | null) => {
    const rules = next
      ? group.rules.map((rule, i) => (i === index ? next : rule))
      : group.rules.filter((_, i) => i !== index);
    // A group without conditions is invalid on the server, so it disappears with its last condition.
    onChange(rules.length ? { ...group, rules } : null);
  };
  const full = group.rules.length >= MAX_GROUP_RULES;
  const joiner = group.op === "and" ? "و" : "یا";
  return (
    <div className={`engine-condition-group depth-${Math.min(depth, 3)}`}>
      {(group.rules.length > 1 || depth > 0) && (
        <div className="engine-condition-group-head">
          {depth > 0 && <span className="engine-condition-group-title">گروه شرط‌ها</span>}
          <div className="engine-condition-mode" role="radiogroup" aria-label="نحوه ترکیب شرط‌ها">
            {(
              [
                ["and", "همه برقرار باشند", "و"],
                ["or", "دست‌کم یکی برقرار باشد", "یا"],
              ] as const
            ).map(([op, title, short]) => (
              <button
                key={op}
                type="button"
                role="radio"
                aria-checked={group.op === op}
                className={group.op === op ? "active" : ""}
                onClick={() => onChange({ ...group, op })}
              >
                {title} <small>({short})</small>
              </button>
            ))}
          </div>
          {depth > 0 && (
            <button
              type="button"
              className="engine-condition-icon"
              aria-label="حذف گروه"
              title="حذف گروه"
              onClick={() => onChange(null)}
            >
              <Trash2 size={16} aria-hidden />
            </button>
          )}
        </div>
      )}
      <ol className="engine-condition-list">
        {group.rules.map((rule, index) => (
          // Conditions are positional and carry no id; the index is their identity.
          // eslint-disable-next-line react/no-array-index-key
          <li key={index}>
            {index > 0 && <span className="engine-condition-joiner">{joiner}</span>}
            {"rules" in rule ? (
              <GroupEditor group={rule} depth={depth + 1} context={context} onChange={(next) => replace(index, next)} />
            ) : (
              <RuleRow leaf={rule} number={index + 1} context={context} onChange={(next) => replace(index, next)} />
            )}
          </li>
        ))}
      </ol>
      <div className="engine-condition-actions">
        <button
          type="button"
          className="engine-condition-add"
          disabled={full}
          onClick={() => onChange({ ...group, rules: [...group.rules, newLeaf(context.fields[0])] })}
        >
          <Plus size={15} aria-hidden />
          شرط دیگر
        </button>
        {depth < MAX_GROUP_DEPTH && (
          <button
            type="button"
            className="engine-condition-add"
            disabled={full}
            title="چند شرط را با هم بسنجید؛ مثلاً «الف و (ب یا ج)»"
            onClick={() =>
              onChange({
                ...group,
                rules: [...group.rules, { op: group.op === "and" ? "or" : "and", rules: [newLeaf(context.fields[0])] }],
              })
            }
          >
            <FolderPlus size={15} aria-hidden />
            گروه شرط‌ها
          </button>
        )}
        {full && <small>حداکثر {MAX_GROUP_RULES.toLocaleString("fa-IR")} شرط در هر گروه</small>}
      </div>
    </div>
  );
}

function RuleRow({
  leaf,
  number,
  context,
  onChange,
}: {
  leaf: Leaf;
  number: number;
  context: EditorContext;
  onChange: (leaf: Leaf | null) => void;
}) {
  const { fields, choicesFor } = context;
  const field = fields.find((f) => f.code === leaf.field);
  const operators = operatorsFor(field);
  const choices = field ? choicesFor(field) : [];
  const input = valueInputFor(field, leaf.op, Boolean(field && CHOICE_KINDS.has(field.kind)));
  const problem = leafProblem(leaf, fields);
  const fieldOptions = [
    ...(field || !leaf.field ? [] : [{ id: leaf.field, title: `${leaf.field} (در دسترس نیست)` }]),
    ...fields.map((f) => ({ id: f.code, title: f.title, description: kindTitles[f.kind] })),
  ];
  return (
    <div className={`engine-condition-rule${problem ? " invalid" : ""}`}>
      <span className="engine-condition-number" aria-hidden>
        {number.toLocaleString("fa-IR")}
      </span>
      <div className="engine-condition-cells">
        <div className="engine-condition-cell">
          <SearchableSelect
            showLabel
            label="اگر ورودی"
            value={leaf.field}
            options={fieldOptions}
            onChange={(code) => {
              const next = fields.find((f) => f.code === code);
              if (next) onChange(withField(leaf, next));
            }}
          />
        </div>
        <div className="engine-condition-cell">
          <SearchableSelect
            showLabel
            label="به این شکل"
            value={operators.includes(leaf.op) ? leaf.op : ""}
            placeholder="نوع مقایسه…"
            options={operators.map((op) => ({ id: op, title: operatorLabel(op, field) }))}
            onChange={(op) => onChange(withOperator(leaf, op as Leaf["op"], field))}
          />
        </div>
        {input !== "none" && (
          <div className="engine-condition-cell value">
            <ValueControl leaf={leaf} field={field} input={input} choices={choices} onChange={onChange} />
          </div>
        )}
      </div>
      <button
        type="button"
        className="engine-condition-icon"
        aria-label={`حذف شرط ${number.toLocaleString("fa-IR")}`}
        title="حذف شرط"
        onClick={() => onChange(null)}
      >
        <Trash2 size={16} aria-hidden />
      </button>
      {problem && (
        <p className="engine-condition-error">
          <CircleAlert size={14} aria-hidden />
          {problem}
        </p>
      )}
    </div>
  );
}

function ValueControl({
  leaf,
  field,
  input,
  choices,
  onChange,
}: {
  leaf: Leaf;
  field?: FieldDefinition;
  input: ReturnType<typeof valueInputFor>;
  choices: ChoiceOption[];
  onChange: (leaf: Leaf) => void;
}) {
  const raw = leaf.value;
  const set = (value: Leaf["value"]) => onChange({ ...leaf, value });
  if (input === "number") return <NumberValue value={raw} onChange={set} />;
  if (input === "date") {
    const today = Boolean(raw && typeof raw === "object" && !Array.isArray(raw) && "dynamic" in raw);
    const text = typeof raw === "string" ? raw : "";
    const dateOnly = field?.kind === "datetime" && text ? (zonedDateTime(text)?.date ?? "") : text;
    return (
      <div className="engine-condition-date">
        <SearchableSelect
          showLabel
          label="با"
          value={today ? "today" : "fixed"}
          options={[
            { id: "fixed", title: "یک تاریخ مشخص" },
            { id: "today", title: "تاریخ امروز (هر روز به‌روز)" },
          ]}
          onChange={(mode) => set(mode === "today" ? { dynamic: "today" } : "")}
        />
        {!today && (
          <PersianDatePicker
            label="تاریخ"
            value={dateOnly}
            onChange={(date) =>
              // Datetime fields hold instants, so the chosen day is compared from its local midnight.
              set(field?.kind === "datetime" && date ? (zonedDateTimeToISO(date, "00:00") ?? date) : date)
            }
          />
        )}
      </div>
    );
  }
  if (input === "choices")
    return (
      <CompactMultiSelector
        label="گزینه‌ها"
        options={choices}
        selected={Array.isArray(raw) ? raw : []}
        onChange={(ids) => set(ids)}
      />
    );
  if (input === "choice")
    return (
      <SearchableSelect
        showLabel
        label="مقدار"
        value={typeof raw === "string" ? raw : ""}
        placeholder={choices.length ? "انتخاب گزینه…" : "گزینه‌ای تعریف نشده"}
        options={choices}
        onChange={(id) => set(id)}
      />
    );
  return (
    <label className="engine-condition-text">
      <span>مقدار</span>
      <input
        value={typeof raw === "string" ? raw : ""}
        placeholder="متن مورد نظر را بنویسید"
        onChange={(event) => set(event.target.value)}
      />
    </label>
  );
}

/** Keeps the typed text locally so partial numbers such as «۱۲.» or «-» stay editable. */
function NumberValue({ value, onChange }: { value: Leaf["value"]; onChange: (value: Leaf["value"]) => void }) {
  const external = typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
  const [text, setText] = useState(external);
  useEffect(() => {
    setText((current) => (parseNumber(current) === parseNumber(external) && current !== "" ? current : external));
  }, [external]);
  return (
    <label className="engine-condition-text">
      <span>مقدار</span>
      <input
        inputMode="decimal"
        dir="ltr"
        value={text}
        placeholder="مثلاً ۱۰۰۰"
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          const parsed = parseNumber(next);
          onChange(next.trim() === "" ? "" : (parsed ?? next));
        }}
      />
    </label>
  );
}
