import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ColumnEditor } from "./view-controls";
import type { ViewDefinition, ViewField } from "./view-types";

const definition: ViewDefinition = {
  version: 1,
  type: "table",
  columns: [{ field: "title", width: 220 }],
  summary: [],
  sort: [],
  filter: null,
  group: null,
};

const fields: ViewField[] = [
  {
    code: "title",
    field_code: "title",
    options_entity: "customer",
    title: "نام مشتری",
    kind: "short_text",
    config: {},
    operators: ["eq", "contains"],
    filterable: true,
    table_visible: true,
    searchable: true,
  },
];

describe("ColumnEditor design modes", () => {
  it("keeps every column input visibly labelled in the official table designer", () => {
    const markup = renderToStaticMarkup(
      <ColumnEditor columnsOnly value={definition} fields={fields} onChange={() => {}} onLoadPath={async () => {}} />
    );

    expect(markup).toContain("جستجو در ستون‌ها");
    expect(markup).toContain("عرض ستون");
    expect(markup).toContain("پین ستون");
    expect(markup).not.toContain("مرتب‌سازی چندستونه");
  });

  it("preserves advanced view controls in the regular view drawer", () => {
    const markup = renderToStaticMarkup(
      <ColumnEditor value={definition} fields={fields} onChange={() => {}} onLoadPath={async () => {}} />
    );

    expect(markup).toContain("مرتب‌سازی چندستونه");
    expect(markup).toContain("گروه‌بندی");
  });
});
