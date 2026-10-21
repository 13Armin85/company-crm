import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { SchemaDataGrid } from "@plane/ui";
import { ViewRenderer, ViewValue } from "./view-renderers";
import type { ViewDefinition, ViewField, ViewResult } from "./view-types";

const fields: ViewField[] = [
  { code: "title", field_code: "title", title: "عنوان", kind: "short_text" },
  { code: "amount", field_code: "amount", title: "مبلغ", kind: "money" },
  { code: "phase", field_code: "phase", title: "مرحله", kind: "select" },
  { code: "date", field_code: "date", title: "تاریخ", kind: "date" },
].map((f) => ({
  ...f,
  kind: f.kind as ViewField["kind"],
  options_entity: "sample",
  config: {},
  filterable: true,
  table_visible: true,
  searchable: true,
  operators: ["eq"],
}));
const definition: ViewDefinition = {
  version: 1,
  type: "table",
  columns: fields.map((f) => ({ field: f.code, width: 180 })),
  sort: [],
  settings: { kanban_field: "phase", calendar_field: "date" },
};
const data: ViewResult = {
  count: 1,
  page: 1,
  page_size: 100,
  warnings: [],
  totals: { amount: { sum: "2000.25", avg: "2000.25" } },
  groups: [],
  definition,
  labels: { phase: { open: { title: "باز", color: "#123456", inactive: true } } },
  results: [
    {
      id: "record-id",
      number: "T-001",
      title: "رکورد نمونه",
      revision: 1,
      is_active: true,
      can_edit: false,
      values: { title: "رکورد نمونه", amount: "2000.25", phase: "open", date: "2026-10-19" },
      styles: {
        row: { background: "#fee2e2", color: "#334455", icon: "warning" },
        cells: { date: { color: "#b91c1c", icon: "clock" } },
        badges: { phase: { background: "#eeeeee" } },
      },
    },
  ],
};

describe("shared entity views", () => {
  it.each(["table", "kanban", "list", "calendar", "cards"] as const)(
    "renders the same data, rules and historical lookup in %s",
    (type) => {
      const markup = renderToStaticMarkup(
        <MemoryRouter>
          <ViewRenderer
            code="sample"
            definition={{ ...definition, type }}
            data={data}
            fields={fields}
            onChange={() => {}}
            selected={[]}
            onSelect={() => {}}
            onMove={async () => {}}
            calendarDate="2026-10-19"
            onCalendarDate={() => {}}
          />
        </MemoryRouter>
      );
      expect(markup).toContain("رکورد نمونه");
      expect(markup).toContain("غیرفعال");
      expect(markup).toContain("#fee2e2");
      expect(markup).toContain("#b91c1c");
      expect(markup).toContain("/entities/sample/record-id");
      expect(markup).not.toContain("ویرایش مبلغ");
    }
  );
  it("keeps false, zero and text input safe", () => {
    expect(renderToStaticMarkup(<ViewValue value={false} />)).toContain("خیر");
    expect(renderToStaticMarkup(<ViewValue field={fields[1]} value={0} />)).toContain("۰");
    expect(renderToStaticMarkup(<ViewValue value="<script>unsafe()</script>" />)).not.toContain("<script>");
  });
  it("renders a bounded DOM for a full server page and exposes selection accessibly", () => {
    const markup = renderToStaticMarkup(
      <SchemaDataGrid
        columns={[{ field: "title", title: "عنوان", width: 200, pin: "right" }]}
        rows={Array.from({ length: 200 }, (_, i) => ({ id: String(i), title: `row-${i}` }))}
        selected={[]}
        onSelect={() => {}}
        onColumnsChange={() => {}}
        renderCell={(row) => row.title}
      />
    );
    expect(markup).toContain('aria-rowcount="200"');
    expect(markup).toContain("انتخاب همه رکوردهای این صفحه");
    expect(markup).toContain("row-0");
    expect(markup).not.toContain("row-199");
    expect(markup).toContain("تغییر عرض عنوان");
  });
  it("preserves complete row contents and keeps selection labels in Persian", () => {
    const title = "اطلاعات کامل درخواست با توضیحات طولانی برای بررسی واحد سازمانی ".repeat(12);
    const markup = renderToStaticMarkup(
      <SchemaDataGrid
        columns={[{ field: "title", title: "عنوان درخواست", width: 180 }]}
        rows={[{ id: "internal-record-id", title }]}
        selected={[]}
        onSelect={() => {}}
        onColumnsChange={() => {}}
        renderCell={(row) => row.title}
      />
    );
    expect(markup).toContain(title);
    expect(markup).toContain("انتخاب رکورد ۱");
    expect(markup).not.toContain('aria-label="انتخاب رکورد internal-record-id"');
  });
});
