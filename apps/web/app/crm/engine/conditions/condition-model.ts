/**
 * Pure model behind the condition editor: which operators fit each field kind, what a fresh
 * condition looks like, how edits keep the value consistent, and how a condition reads as Persian.
 * The rules mirror the evaluators in `@plane/ui` (schema-form/rules.ts) and the API (entity_rules.py).
 */
import type { Condition, FieldKind } from "@plane/ui";

export type Leaf = Extract<Condition, { field: string }>;
export type Group = Extract<Condition, { rules: Condition[] }>;
export type Operator = Leaf["op"];
export type ValueInput = "none" | "text" | "number" | "date" | "choice" | "choices";

/** Minimal field shape the model needs; FieldDefinition satisfies it. */
export interface ConditionField {
  code: string;
  title: string;
  kind: FieldKind;
  lookup?: string | null;
  config?: { multiple?: boolean; lookup_codes?: boolean };
}
export interface ChoiceOption {
  id: string;
  title: string;
}

/** Deepest nesting the editor offers; the API accepts up to eight levels. */
export const MAX_GROUP_DEPTH = 4;
/** The API rejects groups with more than thirty conditions. */
export const MAX_GROUP_RULES = 30;

const NUMBER_KINDS = new Set<FieldKind>(["integer", "decimal", "money", "percent", "rating", "computed"]);
const TEXT_KINDS = new Set<FieldKind>(["short_text", "long_text", "rich_text", "url", "email", "phone"]);
const PEOPLE_KINDS = new Set<FieldKind>(["user", "unit", "role"]);
/** Kinds whose stored value cannot be compared meaningfully, only checked for presence. */
const PRESENCE_ONLY_KINDS = new Set<FieldKind>(["file", "relation", "date_range"]);

export const isMultiValue = (field?: ConditionField) =>
  Boolean(
    field && (["multi_select", "tags"].includes(field.kind) || (PEOPLE_KINDS.has(field.kind) && field.config?.multiple))
  );

/** Operators that make sense for a field kind, in the order users usually need them. */
export function operatorsFor(field?: ConditionField): Operator[] {
  if (!field) return ["eq", "ne", "empty", "not_empty"];
  const { kind } = field;
  if (kind === "boolean" || kind === "checkbox") return ["eq", "ne"];
  if (PRESENCE_ONLY_KINDS.has(kind)) return ["not_empty", "empty"];
  if (isMultiValue(field)) return ["contains", "empty", "not_empty"];
  if (NUMBER_KINDS.has(kind) || kind === "date" || kind === "datetime")
    return ["eq", "ne", "gt", "gte", "lt", "lte", "empty", "not_empty"];
  if (kind === "select" || PEOPLE_KINDS.has(kind)) return ["eq", "ne", "in", "not_in", "empty", "not_empty"];
  if (TEXT_KINDS.has(kind)) return ["eq", "ne", "contains", "empty", "not_empty"];
  return ["eq", "ne", "empty", "not_empty"];
}

/** Persian label for an operator, worded for the field kind so a row reads as a sentence. */
export function operatorLabel(op: Operator, field?: ConditionField): string {
  const kind = field?.kind;
  if (kind === "boolean" || kind === "checkbox")
    return op === "eq" ? "تیک خورده باشد (بله)" : "تیک نخورده باشد (خیر یا خالی)";
  const date = kind === "date" || kind === "datetime";
  const labels: Record<Operator, string> = {
    eq: date ? "در تاریخ" : "برابر باشد با",
    ne: date ? "در تاریخی غیر از" : "برابر نباشد با",
    in: "یکی از این‌ها باشد",
    not_in: "هیچ‌کدام از این‌ها نباشد",
    contains: isMultiValue(field) ? "شامل این گزینه باشد" : "شامل این متن باشد",
    empty: "خالی باشد",
    not_empty: "پر شده باشد",
    gt: date ? "بعد از" : "بیشتر از",
    gte: date ? "در تاریخ یا بعد از" : "بیشتر یا مساوی",
    lt: date ? "قبل از" : "کمتر از",
    lte: date ? "در تاریخ یا قبل از" : "کمتر یا مساوی",
  };
  return labels[op];
}

export const needsValue = (op: Operator) => op !== "empty" && op !== "not_empty";

/** Which control the value slot should render for a field and operator. */
export function valueInputFor(field: ConditionField | undefined, op: Operator, hasChoices: boolean): ValueInput {
  if (!needsValue(op) || !field) return needsValue(op) ? "text" : "none";
  if (field.kind === "boolean" || field.kind === "checkbox") return "none";
  if (NUMBER_KINDS.has(field.kind)) return "number";
  if (field.kind === "date" || field.kind === "datetime") return "date";
  if (hasChoices) return op === "in" || op === "not_in" ? "choices" : "choice";
  return "text";
}

const isDynamicToday = (value: Leaf["value"]): value is { dynamic: "today" } =>
  Boolean(value && typeof value === "object" && !Array.isArray(value) && "dynamic" in value);

/** The value a condition starts with for an operator, reusing the previous value where it still fits. */
export function valueForOperator(field: ConditionField | undefined, op: Operator, previous?: Leaf["value"]) {
  if (!needsValue(op)) return undefined;
  // Yes/no rules always compare with "yes"; "ne" then also matches an untouched (empty) checkbox.
  if (field?.kind === "boolean" || field?.kind === "checkbox") return true;
  if (op === "in" || op === "not_in") {
    if (Array.isArray(previous)) return previous;
    return typeof previous === "string" && previous ? [previous] : [];
  }
  if (Array.isArray(previous)) return previous[0] ?? "";
  if (isDynamicToday(previous)) return field?.kind === "date" || field?.kind === "datetime" ? previous : "";
  if (previous === undefined || previous === null || typeof previous === "object") return "";
  return previous;
}

export function newLeaf(field?: ConditionField): Leaf {
  const op = operatorsFor(field)[0];
  const leaf: Leaf = { field: field?.code ?? "", op };
  const value = valueForOperator(field, op);
  return value === undefined ? leaf : { ...leaf, value };
}

/** Applies an operator change and keeps the value valid for it. */
export function withOperator(leaf: Leaf, op: Operator, field?: ConditionField): Leaf {
  const { value: _previous, ...rest } = leaf;
  const value = valueForOperator(field, op, leaf.value);
  return value === undefined ? { ...rest, op } : { ...rest, op, value };
}

/** Applies a field change; the old value means nothing for another field, so it starts over. */
export function withField(leaf: Leaf, field: ConditionField): Leaf {
  const allowed = operatorsFor(field);
  const op = allowed.includes(leaf.op) ? leaf.op : allowed[0];
  const value = valueForOperator(field, op);
  return value === undefined ? { field: field.code, op } : { field: field.code, op, value };
}

/** Accepts Persian and Arabic digits and separators and returns a number, or undefined when invalid. */
export function parseNumber(input: string): number | undefined {
  const latin = input
    .trim()
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[٬,\s]/g, "")
    .replace(/[٫/]/g, ".");
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(latin)) return undefined;
  const value = Number(latin);
  return Number.isFinite(value) ? value : undefined;
}

/** Why a condition cannot be saved yet, or undefined when it is complete. */
export function leafProblem(leaf: Leaf, fields: ConditionField[]): string | undefined {
  const field = fields.find((f) => f.code === leaf.field);
  if (!leaf.field) return "ورودی‌ای برای این شرط انتخاب نشده است.";
  if (!field) return "ورودی این شرط دیگر در دسترس نیست؛ ورودی دیگری انتخاب کنید.";
  if (!operatorsFor(field).includes(leaf.op)) return "این نوع مقایسه برای این ورودی مناسب نیست.";
  if (!needsValue(leaf.op)) return undefined;
  const value = leaf.value;
  if (isDynamicToday(value)) return undefined;
  if (Array.isArray(value)) return value.length ? undefined : "دست‌کم یک گزینه انتخاب کنید.";
  if (value === undefined || value === null || value === "") return "مقدار مقایسه را مشخص کنید.";
  if (NUMBER_KINDS.has(field.kind) && typeof value !== "number" && parseNumber(String(value)) === undefined)
    return "مقدار باید عدد باشد.";
  return undefined;
}

/** All problems in a condition tree, each with a readable path such as «شرط ۲ در گروه ۱». */
export function conditionProblems(rule: Condition | null | undefined, fields: ConditionField[]): string[] {
  if (!rule) return [];
  if ("rules" in rule) {
    if (!rule.rules.length) return ["یک گروه شرط خالی است."];
    return rule.rules.flatMap((child) => conditionProblems(child, fields));
  }
  const problem = leafProblem(rule, fields);
  return problem ? [problem] : [];
}

/**
 * Removes empty groups (the API rejects them) and unwraps a single-condition root group so the
 * stored rule stays minimal. Nested groups keep their shape so the editor does not jump around.
 */
export function simplifyCondition(rule: Condition | null | undefined, root = true): Condition | null {
  if (!rule) return null;
  if (!("rules" in rule)) return rule;
  const rules = rule.rules.map((child) => simplifyCondition(child, false)).filter((child) => child !== null);
  if (!rules.length) return null;
  if (root && rules.length === 1) return rules[0];
  return { ...rule, rules };
}

const persianNumber = (value: number) => value.toLocaleString("fa-IR", { maximumFractionDigits: 6 });

function describeValue(
  leaf: Leaf,
  field: ConditionField | undefined,
  choices: ChoiceOption[],
  formatDate: (value: string) => string
): string {
  const value = leaf.value;
  if (isDynamicToday(value)) return "امروز";
  if (typeof value === "boolean") return value ? "«بله»" : "«خیر»";
  const label = (item: string) => choices.find((c) => c.id === item)?.title ?? item;
  if (Array.isArray(value)) return value.map((item) => `«${label(item)}»`).join("، ") || "…";
  if (value === undefined || value === null || value === "") return "…";
  if (typeof value === "number") return persianNumber(value);
  if (field?.kind === "date" || field?.kind === "datetime") return formatDate(String(value));
  return `«${label(String(value))}»`;
}

/** Reads a condition tree as one Persian sentence, e.g. «وضعیت» برابر باشد با «فعال» و «مبلغ» بیشتر از ۱٬۰۰۰. */
export function describeCondition(
  rule: Condition | null | undefined,
  fields: ConditionField[],
  choicesFor: (field: ConditionField) => ChoiceOption[] = () => [],
  formatDate: (value: string) => string = (value) => value,
  nested = false
): string {
  if (!rule) return "";
  if ("rules" in rule) {
    const joiner = rule.op === "and" ? " و " : " یا ";
    const text = rule.rules
      .map((child) => describeCondition(child, fields, choicesFor, formatDate, true))
      .filter(Boolean)
      .join(joiner);
    return nested && rule.rules.length > 1 ? `(${text})` : text;
  }
  const field = fields.find((f) => f.code === rule.field);
  const name = `«${field?.title ?? (rule.field || "ورودی انتخاب‌نشده")}»`;
  const verb = operatorLabel(rule.op, field);
  if (!needsValue(rule.op)) return `${name} ${verb}`;
  if ((field?.kind === "boolean" || field?.kind === "checkbox") && rule.value === true) return `${name} ${verb}`;
  if (field?.kind === "boolean" || field?.kind === "checkbox")
    return `${name} ${rule.op === "eq" ? "برابر باشد با" : "برابر نباشد با"} ${describeValue(rule, field, [], formatDate)}`;
  const value = describeValue(rule, field, field ? choicesFor(field) : [], formatDate);
  if (rule.op === "in" || rule.op === "not_in") return `${name} ${verb}: ${value}`;
  return `${name} ${verb} ${value}`;
}
