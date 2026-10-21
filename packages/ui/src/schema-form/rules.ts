import { zonedDateTime, zonedDateTimeToISO, CRM_TIME_ZONE } from "../form-fields/persian-date-utils";
import type { Condition, EntityFormSchema, FieldValue, Formula, FormValues, SchemaField } from "./types";

export const emptyFieldValue = (value: unknown) =>
  value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
function decimalComparison(left: unknown, right: unknown): number | undefined {
  const parse = (value: unknown) => {
    const match = String(value).match(/^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
    if (!match || !(match[2] || match[3])) return undefined;
    const digits = match[2] + (match[3] || ""),
      scale = (match[3]?.length || 0) - Number(match[4] || 0);
    if (digits.length > 256 || Math.abs(scale) > 256) return undefined;
    return { value: BigInt(digits) * (match[1] === "-" ? -1n : 1n), scale };
  };
  const a = parse(left),
    b = parse(right);
  if (!a || !b) return undefined;
  const scale = Math.max(a.scale, b.scale);
  const av = a.value * 10n ** BigInt(scale - a.scale),
    bv = b.value * 10n ** BigInt(scale - b.scale);
  return av < bv ? -1 : av > bv ? 1 : 0;
}
export function matchesCondition(
  rule: Condition | undefined | null,
  values: FormValues,
  schema?: EntityFormSchema
): boolean {
  if (!rule) return true;
  if ("rules" in rule)
    return rule.op === "and"
      ? rule.rules.every((r) => matchesCondition(r, values, schema))
      : rule.rules.some((r) => matchesCondition(r, values, schema));
  const left = values[rule.field];
  const raw = rule.value;
  const kind = schema?.fields.find((field) => field.code === rule.field)?.kind;
  const zone = schema?.time_zone || CRM_TIME_ZONE;
  const today = zonedDateTime(new Date(), zone)?.date;
  const right =
    raw && typeof raw === "object" && "dynamic" in raw
      ? kind === "datetime" && today
        ? zonedDateTimeToISO(today, "00:00", zone)
        : today
      : raw;
  if (
    kind &&
    ["integer", "decimal", "money", "percent", "rating", "computed"].includes(kind) &&
    !emptyFieldValue(left) &&
    !emptyFieldValue(right)
  ) {
    const compared = decimalComparison(left, right);
    if (rule.op === "in" || rule.op === "not_in") {
      const found = Array.isArray(right) && right.some((v) => decimalComparison(left, v) === 0);
      return rule.op === "in" ? found : !found;
    }
    if (compared === undefined) return false;
    if (rule.op === "eq") return compared === 0;
    if (rule.op === "ne") return compared !== 0;
    if (rule.op === "gt") return compared > 0;
    if (rule.op === "gte") return compared >= 0;
    if (rule.op === "lt") return compared < 0;
    if (rule.op === "lte") return compared <= 0;
  }
  if (kind === "datetime" && typeof left === "string" && typeof right === "string") {
    const a = Date.parse(left),
      b = Date.parse(right);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      if (rule.op === "eq") return a === b;
      if (rule.op === "ne") return a !== b;
      if (rule.op === "gt") return a > b;
      if (rule.op === "gte") return a >= b;
      if (rule.op === "lt") return a < b;
      if (rule.op === "lte") return a <= b;
    }
  }
  switch (rule.op) {
    case "empty":
      return emptyFieldValue(left);
    case "not_empty":
      return !emptyFieldValue(left);
    case "eq":
      return JSON.stringify(left) === JSON.stringify(right);
    case "ne":
      return JSON.stringify(left) !== JSON.stringify(right);
    case "in":
      return Array.isArray(right) && right.some((v) => v === left);
    case "not_in":
      return !Array.isArray(right) || !right.some((v) => v === left);
    case "contains":
      return typeof left === "string"
        ? left.includes(String(right))
        : Array.isArray(left) && left.includes(String(right));
    default: {
      if (emptyFieldValue(left) || emptyFieldValue(right)) return false;
      if (
        (typeof left !== "string" && typeof left !== "number") ||
        (typeof right !== "string" && typeof right !== "number")
      )
        return false;
      if (rule.op === "gt") return left > right;
      if (rule.op === "gte") return left >= right;
      if (rule.op === "lt") return left < right;
      return left <= right;
    }
  }
}
export function evaluateFormula(node: Formula, values: FormValues, timeZone = CRM_TIME_ZONE): FieldValue {
  if ("field" in node) return values[node.field] ?? null;
  if ("value" in node) return node.value;
  if ("dynamic" in node) return zonedDateTime(new Date(), timeZone)?.date ?? null;
  const a = evaluateFormula(node.args[0], values, timeZone),
    b = evaluateFormula(node.args[1], values, timeZone);
  if (emptyFieldValue(a) || emptyFieldValue(b)) return null;
  if (node.op === "date_diff") {
    const days = (Date.parse(String(a).slice(0, 10)) - Date.parse(String(b).slice(0, 10))) / 86400000;
    return Number.isFinite(days) ? days : null;
  }
  const left = Number(a),
    right = Number(b);
  const result =
    node.op === "add"
      ? left + right
      : node.op === "subtract"
        ? left - right
        : node.op === "multiply"
          ? left * right
          : left / right;
  return Number.isFinite(result) ? result : null;
}
export function formDisplayValues(schema: EntityFormSchema, values: FormValues): FormValues {
  const result = { ...values },
    pending = new Set<string>(),
    done = new Set<string>();
  const fields = new Map(schema.fields.map((f) => [f.code, f]));
  const visit = (code: string) => {
    if (done.has(code) || pending.has(code)) return;
    pending.add(code);
    const field = fields.get(code);
    if (field?.kind === "computed" && field.config.formula) {
      const walk = (node: Formula) => {
        if ("field" in node) visit(node.field);
        else if ("args" in node) node.args.forEach(walk);
      };
      walk(field.config.formula);
      result[code] = evaluateFormula(field.config.formula, result, schema.time_zone || CRM_TIME_ZONE);
    }
    pending.delete(code);
    done.add(code);
  };
  schema.fields.forEach((f) => visit(f.code));
  return result;
}
export const fieldVisible = (field: SchemaField, values: FormValues, schema?: EntityFormSchema) =>
  !field.config.hidden &&
  field.config.effective_visible !== false &&
  matchesCondition(field.config.visible_if, values, schema);
export const fieldRequired = (field: SchemaField, values: FormValues, schema?: EntityFormSchema) =>
  Boolean(
    field.config.required || (field.config.required_if && matchesCondition(field.config.required_if, values, schema))
  );
export function validateSchemaValues(schema: EntityFormSchema, values: FormValues): Record<string, string> {
  const errors: Record<string, string> = {},
    displayed = formDisplayValues(schema, values);
  for (const field of schema.fields) {
    if (!field.is_active || !fieldVisible(field, displayed, schema) || field.kind === "computed") continue;
    const value = displayed[field.code],
      config = field.config;
    if (emptyFieldValue(value)) {
      if (fieldRequired(field, displayed, schema)) errors[field.code] = "تکمیل این فیلد الزامی است.";
      continue;
    }
    if (typeof value === "string") {
      if (value.length < (config.min_length ?? 0) || value.length > (config.max_length ?? 100000))
        errors[field.code] = "طول مقدار در محدوده مجاز نیست.";
      if (config.regex) {
        try {
          if (!new RegExp(`^(?:${config.regex})$`).test(value))
            errors[field.code] = config.regex_message || "قالب مقدار معتبر نیست.";
        } catch {
          /* Backend validates dialect-specific expressions. */
        }
      }
      if (field.kind === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
        errors[field.code] = "ایمیل معتبر وارد کنید.";
      if (field.kind === "url") {
        try {
          const url = new URL(value);
          if (!["http:", "https:"].includes(url.protocol)) throw new Error();
        } catch {
          errors[field.code] = "لینک معتبر با http یا https وارد کنید.";
        }
      }
      if (field.kind === "phone" && !/^\+?[\d\s()-]{5,30}$/.test(value))
        errors[field.code] = "شماره تلفن معتبر وارد کنید.";
    }
    if (["integer", "decimal", "money", "percent", "rating"].includes(field.kind)) {
      const number = Number(value);
      if (
        !Number.isFinite(number) ||
        (field.kind === "integer" && !Number.isInteger(number)) ||
        number < (config.min ?? (field.kind === "percent" || field.kind === "rating" ? 0 : -Infinity)) ||
        number >
          (config.max ?? (field.kind === "percent" ? 100 : field.kind === "rating" ? (config.stars ?? 5) : Infinity))
      )
        errors[field.code] = "عدد معتبر در محدوده مجاز وارد کنید.";
    }
    if (
      field.kind === "date_range" &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "start" in value &&
      (!value.start || !value.end || value.start > value.end)
    )
      errors[field.code] = "بازه تاریخ معتبر انتخاب کنید.";
  }
  return errors;
}
