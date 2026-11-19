import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Condition } from "@plane/ui";
import { filterConditionCount, newFilterCondition, ViewFilterEditor } from "./view-controls";
import type { ViewField } from "./view-types";

const fields: ViewField[] = [
  {
    code: "name",
    field_code: "name",
    options_entity: "customer",
    title: "نام مشتری",
    kind: "short_text",
    config: {},
    operators: ["eq", "contains", "empty"],
    filterable: true,
    table_visible: true,
    searchable: true,
  },
];
const render = (value: Condition | null, available = fields) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ViewFilterEditor value={value} fields={available} onChange={() => {}} />
    </QueryClientProvider>
  );

describe("advanced view filters", () => {
  it("starts with a guided empty state and handles fields that cannot be filtered", () => {
    expect(render(null)).toContain("افزودن اولین شرط");
    expect(render(null)).toContain("از یک شرط ساده شروع کنید");
    const unavailable = render(null, []);
    expect(unavailable).toContain("فیلد قابل فیلتر در دسترس نیست");
    expect(unavailable).toContain("disabled");
    expect(newFilterCondition([])).toBeNull();
  });
  it("uses an operator supported by the selected field and ignores forbidden fields", () => {
    expect(newFilterCondition(fields)).toEqual({ field: "name", op: "eq", value: "" });
    expect(newFilterCondition([{ ...fields[0], operators: ["contains"] }])).toEqual({
      field: "name",
      op: "contains",
      value: "",
    });
    expect(newFilterCondition([{ ...fields[0], filterable: false }])).toBeNull();
    expect(newFilterCondition(fields, "hidden")).toBeNull();
    expect(newFilterCondition([{ ...fields[0], operators: [] }])).toBeNull();
  });
  it("counts nested conditions and explains the selected group logic once per group", () => {
    const condition: Condition = {
      op: "or",
      rules: [
        { field: "name", op: "empty" },
        {
          op: "and",
          rules: [
            { field: "name", op: "not_empty" },
            { field: "name", op: "empty" },
          ],
        },
      ],
    };
    expect(filterConditionCount(condition)).toBe(3);
    expect(filterConditionCount(null)).toBe(0);
    const html = render(condition);
    expect(html).toContain("۳ شرط");
    expect(html).toContain("داشتن یکی از شرط‌های این گروه");
    expect(html).toContain("رکورد باید تمام شرط‌های این گروه");
    expect(html.match(/شرط‌های نمایش رکوردها/g)).toHaveLength(1);
    expect(html).toContain("افزودن زیرگروه");
    expect(html).toContain("پاک کردن همهٔ شرط‌ها");
  });
  it("explains empty comparisons without showing a value input or date shortcut", () => {
    const html = render({ field: "name", op: "empty" });
    expect(html).toContain("نیازی به وارد کردن مقدار نیست");
    expect(html).not.toContain('class="schema-form"');
    const dateField: ViewField = { ...fields[0], kind: "date", operators: ["eq", "empty"] };
    expect(render({ field: "name", op: "empty" }, [dateField])).not.toContain("مقایسه با امروز");
    const dynamic = render({ field: "name", op: "eq", value: { dynamic: "today" } }, [dateField]);
    expect(dynamic).toContain("مقدار مقایسه: امروز");
    expect(dynamic).toContain("انتخاب تاریخ ثابت");
  });
});
