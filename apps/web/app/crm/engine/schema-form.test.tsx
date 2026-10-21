import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SchemaDrivenForm, validateSchemaValues, formDisplayValues, matchesCondition } from "@plane/ui";
import type { EntityFormSchema } from "@plane/ui";
import { moveBinding } from "./form-designer";

const schema: EntityFormSchema = {
  entity: "sample",
  title: "فرم",
  schema_version: 1,
  layout: {
    tabs: [],
    sections: [
      {
        id: "a",
        columns: 2,
        bindings: [
          { field: "urgent" },
          { field: "reason" },
          { field: "secret" },
          { field: "number" },
          { field: "total" },
        ],
      },
      { id: "b", columns: 1, bindings: [] },
    ],
  },
  fields: [
    {
      id: "urgent",
      code: "urgent",
      title: "فوری",
      kind: "boolean",
      config: {},
      binding: { field: "urgent" },
      is_active: true,
    },
    {
      id: "reason",
      code: "reason",
      title: "علت",
      kind: "short_text",
      config: {
        visible_if: { field: "urgent", op: "eq", value: true },
        required_if: { field: "urgent", op: "eq", value: true },
        min_length: 3,
      },
      binding: { field: "reason" },
      is_active: true,
    },
    {
      id: "secret",
      code: "secret",
      title: "پنهان",
      kind: "short_text",
      config: { hidden: true },
      binding: { field: "secret" },
      is_active: true,
    },
    {
      id: "number",
      code: "number",
      title: "عدد",
      kind: "integer",
      config: {},
      binding: { field: "number" },
      is_active: true,
    },
    {
      id: "total",
      code: "total",
      title: "جمع",
      kind: "computed",
      config: { formula: { op: "add", args: [{ field: "number" }, { value: 3 }] } },
      binding: { field: "total" },
      is_active: true,
    },
  ],
};
describe("schema-driven form behavior", () => {
  it("applies conditional visibility and required validation without losing zero/false", () => {
    expect(validateSchemaValues(schema, { urgent: false, number: 0 })).toEqual({});
    expect(validateSchemaValues(schema, { urgent: true, number: 0 })).toEqual({ reason: "تکمیل این فیلد الزامی است." });
    const hidden = renderToStaticMarkup(
      <SchemaDrivenForm schema={schema} values={{ urgent: false }} onChange={() => {}} />
    );
    expect(hidden).not.toContain('data-field="reason"');
    expect(hidden).not.toContain('data-field="secret"');
    expect(
      renderToStaticMarkup(<SchemaDrivenForm schema={schema} values={{ urgent: true }} onChange={() => {}} />)
    ).toContain('data-field="reason"');
  });
  it("previews arithmetic and preserves distinct numeric and text values in conditions", () => {
    expect(formDisplayValues(schema, { number: 4 }).total).toBe(7);
    expect(matchesCondition({ field: "x", op: "eq", value: 1 }, { x: "1" })).toBe(false);
  });
  it("moves a binding between sections without losing overrides or duplicating it", () => {
    const original = structuredClone(schema.layout);
    original.sections[0].bindings[0].readonly = true;
    const moved = moveBinding(original, "a", "urgent", "b");
    expect(moved.sections[1].bindings).toEqual([{ field: "urgent", readonly: true }]);
    expect(moved.sections[0].bindings.some((b) => b.field === "urgent")).toBe(false);
    expect(original.sections[0].bindings[0].field).toBe("urgent");
  });
  it("compares canonical money decimals exactly and datetime instants across offsets", () => {
    const typed = {
      ...schema,
      fields: [
        { ...schema.fields[3], kind: "money" as const },
        { ...schema.fields[1], code: "when", kind: "datetime" as const },
      ],
    };
    expect(
      matchesCondition(
        { field: "number", op: "gt", value: "9007199254740992.01" },
        { number: "9007199254740992.02" },
        typed
      )
    ).toBe(true);
    expect(matchesCondition({ field: "number", op: "eq", value: "12.10" }, { number: "12.1" }, typed)).toBe(true);
    expect(
      matchesCondition(
        { field: "when", op: "eq", value: "2026-10-19T08:30:00Z" },
        { when: "2026-10-19T12:00:00+03:30" },
        typed
      )
    ).toBe(true);
  });
});
