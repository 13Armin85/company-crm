import { describe, expect, it } from "vitest";
import { matchesCondition } from "@plane/ui";
import type { Condition, EntityFormSchema, FieldKind } from "@plane/ui";
import {
  conditionProblems,
  describeCondition,
  newLeaf,
  operatorsFor,
  parseNumber,
  simplifyCondition,
  valueInputFor,
  withField,
  withOperator,
} from "./condition-model";
import type { ConditionField, Leaf } from "./condition-model";

const field = (code: string, kind: FieldKind, extra: Partial<ConditionField> = {}): ConditionField => ({
  code,
  title: code,
  kind,
  config: {},
  ...extra,
});
const status = field("status", "select", { title: "وضعیت", lookup: "statuses" });
const amount = field("amount", "money", { title: "مبلغ" });
const vip = field("vip", "checkbox", { title: "مشتری ویژه" });
const due = field("due", "date", { title: "سررسید" });
const tags = field("tags", "tags", { title: "برچسب‌ها" });
const attachment = field("attachment", "file", { title: "پیوست" });
const fields = [status, amount, vip, due, tags, attachment];

const schemaFor = (...codes: ConditionField[]): EntityFormSchema =>
  ({ fields: codes.map((f) => ({ code: f.code, kind: f.kind })) }) as unknown as EntityFormSchema;

describe("operators per field kind", () => {
  it("offers only comparisons that the evaluators support for the kind", () => {
    expect(operatorsFor(amount)).toEqual(["eq", "ne", "gt", "gte", "lt", "lte", "empty", "not_empty"]);
    expect(operatorsFor(status)).toEqual(["eq", "ne", "in", "not_in", "empty", "not_empty"]);
    expect(operatorsFor(vip)).toEqual(["eq", "ne"]);
    expect(operatorsFor(tags)).toEqual(["contains", "empty", "not_empty"]);
    expect(operatorsFor(attachment)).toEqual(["not_empty", "empty"]);
    expect(operatorsFor(field("name", "short_text"))).not.toContain("gt");
  });

  it("picks a value control that matches the field", () => {
    expect(valueInputFor(amount, "gt", false)).toBe("number");
    expect(valueInputFor(due, "lt", false)).toBe("date");
    expect(valueInputFor(status, "eq", true)).toBe("choice");
    expect(valueInputFor(status, "in", true)).toBe("choices");
    expect(valueInputFor(vip, "eq", false)).toBe("none");
    expect(valueInputFor(amount, "empty", false)).toBe("none");
  });
});

describe("editing keeps conditions consistent", () => {
  it("starts a yes/no condition that also treats an untouched checkbox as «no»", () => {
    const checked = newLeaf(vip);
    expect(checked).toEqual({ field: "vip", op: "eq", value: true });
    const unchecked = withOperator(checked, "ne", vip);
    expect(matchesCondition(unchecked, { vip: null }, schemaFor(vip))).toBe(true);
    expect(matchesCondition(unchecked, { vip: true }, schemaFor(vip))).toBe(false);
    expect(matchesCondition(checked, { vip: true }, schemaFor(vip))).toBe(true);
  });

  it("drops the value for presence checks and converts between single and list values", () => {
    const leaf: Leaf = { field: "status", op: "eq", value: "active" };
    expect(withOperator(leaf, "empty", status)).toEqual({ field: "status", op: "empty" });
    const list = withOperator(leaf, "in", status);
    expect(list.value).toEqual(["active"]);
    expect(withOperator(list, "eq", status).value).toBe("active");
  });

  it("resets the value and an unsupported operator when the field changes", () => {
    const leaf: Leaf = { field: "amount", op: "gt", value: 500 };
    expect(withField(leaf, status)).toEqual({ field: "status", op: "eq", value: "" });
    expect(withField(leaf, due)).toEqual({ field: "due", op: "gt", value: "" });
  });

  it("parses Persian digits and separators", () => {
    expect(parseNumber("۱۲٬۵۰۰")).toBe(12500);
    expect(parseNumber("٣٫٥")).toBe(3.5);
    expect(parseNumber("-4")).toBe(-4);
    expect(parseNumber("12a")).toBeUndefined();
    expect(parseNumber("")).toBeUndefined();
  });

  it("removes empty groups and unwraps a single root condition", () => {
    const leaf: Leaf = { field: "amount", op: "gt", value: 1 };
    expect(simplifyCondition({ op: "and", rules: [] })).toBeNull();
    expect(simplifyCondition({ op: "and", rules: [leaf] })).toEqual(leaf);
    expect(simplifyCondition({ op: "and", rules: [leaf, { op: "or", rules: [] }] })).toEqual(leaf);
    const nested: Condition = { op: "and", rules: [leaf, { op: "or", rules: [leaf] }] };
    expect(simplifyCondition(nested)).toEqual(nested);
  });
});

describe("validation", () => {
  it("reports incomplete, invalid and orphaned conditions", () => {
    expect(conditionProblems({ field: "status", op: "eq", value: "" }, fields)).toEqual(["مقدار مقایسه را مشخص کنید."]);
    expect(conditionProblems({ field: "status", op: "in", value: [] }, fields)).toHaveLength(1);
    expect(conditionProblems({ field: "amount", op: "gt", value: "abc" }, fields)).toEqual(["مقدار باید عدد باشد."]);
    expect(conditionProblems({ field: "gone", op: "eq", value: "x" }, fields)).toHaveLength(1);
    expect(conditionProblems({ field: "tags", op: "gt", value: "x" }, fields)).toHaveLength(1);
    expect(conditionProblems({ op: "or", rules: [] }, fields)).toHaveLength(1);
  });

  it("accepts complete conditions, including presence checks and «today»", () => {
    const rule: Condition = {
      op: "and",
      rules: [
        { field: "attachment", op: "not_empty" },
        { field: "due", op: "lt", value: { dynamic: "today" } },
        {
          op: "or",
          rules: [
            { field: "amount", op: "gte", value: 0 },
            { field: "vip", op: "eq", value: true },
          ],
        },
      ],
    };
    expect(conditionProblems(rule, fields)).toEqual([]);
  });
});

describe("summary sentence", () => {
  it("reads a nested rule in plain Persian with option titles", () => {
    const rule: Condition = {
      op: "and",
      rules: [
        { field: "status", op: "eq", value: "s1" },
        {
          op: "or",
          rules: [
            { field: "amount", op: "gt", value: 1000 },
            { field: "vip", op: "eq", value: true },
          ],
        },
      ],
    };
    const text = describeCondition(rule, fields, (f) => (f.code === "status" ? [{ id: "s1", title: "فعال" }] : []));
    expect(text).toBe("«وضعیت» برابر باشد با «فعال» و («مبلغ» بیشتر از ۱٬۰۰۰ یا «مشتری ویژه» تیک خورده باشد (بله))");
  });
});
