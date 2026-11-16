import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { ReportResult, ReportSource } from "../api/reports";
import { Aggregates, Builder, Groups, IncompatibleNotice, ResultMeta, ResultTable } from "./components";
import {
  changeOp,
  defaultFilter,
  definitionErrors,
  definitionForDate,
  displayCell,
  incompatibleError,
  mergeDefinition,
  rangeLabel,
  repairDefinition,
} from "./model";
import { SavedList, SourceCard } from "./reports-page";

const noop = () => undefined;
const render = (node: ReactElement) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>
  );

const source: ReportSource = {
  code: "ticket_deadlines",
  title: "موعد و دیرکرد تیکت",
  description: "توضیح",
  note: "",
  version: 1,
  date_field: "target_at",
  date_label: "موعد",
  range_required: false,
  team: true,
  default: {
    columns: ["title", "deadline_state", "delay_minutes"],
    filters: [],
    range: null,
    sort: [{ field: "title", dir: "asc" }],
    group_by: [],
    aggregates: [{ fn: "count" }],
  },
  fields: [
    {
      key: "title",
      label: "عنوان",
      type: "text",
      filter: true,
      group: false,
      agg: false,
      ops: [{ code: "contains", title: "شامل" }],
      choices: [],
      method: "",
    },
    {
      key: "deadline_state",
      label: "وضعیت موعد",
      type: "choice",
      filter: true,
      group: true,
      agg: false,
      ops: [
        { code: "eq", title: "برابر" },
        { code: "in", title: "یکی از" },
      ],
      choices: [
        { code: "overdue", title: "دیرکرده" },
        { code: "near_due", title: "نزدیک موعد" },
      ],
      method: "نزدیک موعد = ۲۰٪",
    },
    {
      key: "delay_minutes",
      label: "دیرکرد",
      type: "number",
      filter: true,
      group: false,
      agg: true,
      ops: [{ code: "gt", title: "بزرگ‌تر از" }],
      choices: [],
      method: "پایان منهای موعد",
    },
    {
      key: "target_at",
      label: "موعد",
      type: "datetime",
      filter: true,
      group: false,
      agg: false,
      ops: [{ code: "gte", title: "از" }],
      choices: [],
      method: "",
    },
  ],
};

const result: ReportResult = {
  source: "ticket_deadlines",
  title: "موعد",
  note: "",
  definition: source.default,
  columns: [
    { key: "title", label: "عنوان", type: "text", method: "" },
    { key: "deadline_state", label: "وضعیت موعد", type: "choice", method: "نزدیک موعد = ۲۰٪" },
    { key: "delay_minutes", label: "دیرکرد", type: "number", method: "پایان منهای موعد" },
    { key: "target_at", label: "موعد", type: "datetime", method: "" },
  ],
  rows: [{ cells: ["نصب سرور", "دیرکرده", 120, "1405/10/19 10:30"], link: "/edit/ticket/1" }],
  total: 1250,
  page: 1,
  pages: 25,
  page_size: 50,
  aggregates: [{ fn: "count", label: "تعداد", value: 1250, method: "شمارش ردیف‌ها پس از فیلتر" }],
  groups: [],
  range: { from: "2027-01-01", to: "2027-01-31", from_text: "۱۴۰۵/۱۰/۱۱", to_text: "۱۴۰۵/۱۱/۱۱", field: "موعد" },
  scope: { team: true, people: 6, all: false },
  generated_at: "",
};

describe("report definition validation (mirror of the server whitelist)", () => {
  it("opens a specific daily report date even outside the default range", () => {
    const daily = { ...source, code: "daily_report_items" };
    expect(definitionForDate(daily, null, "2026-01-01").range).toEqual({
      type: "absolute",
      from: "2026-01-01",
      to: "2026-01-01",
    });
    expect(definitionForDate(daily, null, "invalid").range).toEqual(source.default.range);
    expect(definitionForDate(source, null, "2026-01-01").range).toEqual(source.default.range);
  });
  it("accepts the default definition", () => {
    expect(definitionErrors(source, mergeDefinition(source))).toEqual([]);
  });

  it("refuses unknown columns, three-level grouping, sums on text and a reversed range", () => {
    const base = mergeDefinition(source);
    expect(definitionErrors(source, { ...base, columns: ["salary"] })[0]).toContain("«salary»");
    expect(
      definitionErrors(source, { ...base, group_by: ["deadline_state", "deadline_state", "deadline_state"] })
    ).toContain("گروه‌بندی حداکثر دو سطح دارد.");
    expect(definitionErrors(source, { ...base, aggregates: [{ fn: "sum", field: "title" }] })).toContain(
      "جمع و میانگین فقط روی فیلدهای عددی مجاز است."
    );
    expect(
      definitionErrors(source, { ...base, range: { type: "absolute", from: "2027-02-01", to: "2027-01-01" } })
    ).toContain("تاریخ آغاز بازه نباید پس از تاریخ پایان باشد.");
    expect(
      definitionErrors(source, { ...base, filters: [{ field: "deadline_state", op: "in", value: [] }] })[0]
    ).toContain("دست‌کم یک مقدار");
  });

  it("switches filter operators between single and multiple values", () => {
    const field = source.fields[1];
    const single = defaultFilter(field);
    expect(single).toEqual({ field: "deadline_state", op: "eq", value: "overdue" });
    expect(changeOp(single, field, "in").value).toEqual(["overdue"]);
    expect(changeOp({ ...single, op: "in", value: ["near_due"] }, field, "eq").value).toBe("near_due");
  });

  it("repairs a definition after the source lost a column", () => {
    const repaired = repairDefinition(source, {
      ...mergeDefinition(source),
      columns: ["title", "gone"],
      sort: [{ field: "gone", dir: "asc" }],
      aggregates: [{ fn: "count" }, { fn: "sum", field: "gone" }],
    });
    expect(repaired.columns).toEqual(["title"]);
    expect(repaired.sort).toEqual([]);
    expect(repaired.aggregates).toEqual([{ fn: "count" }]);
  });
});

describe("report rendering", () => {
  it("shows numbers and Jalali dates with Persian digits", () => {
    expect(displayCell(1250, "number")).toBe("۱,۲۵۰");
    expect(displayCell("1405/10/19 10:30", "datetime")).toBe("۱۴۰۵/۱۰/۱۹ ۱۰:۳۰");
    expect(displayCell(null, "text")).toBe("—");
    expect(rangeLabel({ type: "relative", days: 30 })).toBe("۳۰ روز گذشته");
  });

  it("shows the record count, the applied range, the scope and each column's method", () => {
    const html = render(
      <>
        <ResultMeta result={result} />
        <Aggregates result={result} />
        <ResultTable result={result} onPage={noop} />
      </>
    );
    expect(html).toContain("۱,۲۵۰");
    expect(html).toContain("موعد از ۱۴۰۵/۱۰/۱۱ تا ۱۴۰۵/۱۱/۱۱");
    expect(html).toContain("شما و ۵ نفر زیرمجموعه");
    expect(html).toContain("روش محاسبه: نزدیک موعد = ۲۰٪");
    expect(html).toContain("روش محاسبه: شمارش ردیف‌ها پس از فیلتر");
    expect(html).toContain("صفحهٔ ۱ از ۲۵");
    expect(html).toContain('href="/edit/ticket/1"');
  });

  it("renders groups with counts", () => {
    const html = render(
      <Groups
        result={{
          ...result,
          groups: [
            { keys: [{ field: "deadline_state", label: "وضعیت موعد", value: "دیرکرده" }], count: 3, aggregates: [] },
          ],
        }}
      />
    );
    expect(html).toContain("دیرکرده");
    expect(html).toContain("۳");
  });

  it("explains an incompatible saved definition instead of showing partial data", () => {
    const parsed = incompatibleError({
      response: {
        status: 409,
        data: {
          code: "incompatible",
          error: "ستون «delay_reason» دیگر در منبع وجود ندارد.",
          missing: ["delay_reason"],
        },
      },
    });
    expect(parsed).toEqual({ message: "ستون «delay_reason» دیگر در منبع وجود ندارد.", missing: ["delay_reason"] });
    expect(incompatibleError({ response: { status: 400, data: {} } })).toBeNull();
    const html = render(<IncompatibleNotice message={parsed!.message} missing={parsed!.missing} onEdit={noop} />);
    expect(html).toContain("تعریف گزارش با ساختار فعلی سازگار نیست");
    expect(html).toContain("ویرایش گزارش");
  });

  it("renders the builder with columns, range, filters, grouping and aggregates", () => {
    const html = render(<Builder source={source} definition={mergeDefinition(source)} onChange={noop} />);
    for (const text of [
      "ستون‌ها",
      "بازهٔ زمانی (موعد)",
      "فیلترها",
      "گروه‌بندی (حداکثر ۲ سطح)",
      "شمارش رکوردها",
      "جمع دیرکرد",
      "میانگین دیرکرد",
    ])
      expect(html).toContain(text);
    expect(html).not.toContain("جمع عنوان");
  });

  it("lists base sources and saved reports with their owner and actions", () => {
    const html = render(
      <>
        <SourceCard source={source} />
        <SavedList
          onCopy={noop}
          onDelete={noop}
          rows={[
            {
              id: "s1",
              name: "دیرکردهای تیم",
              description: "",
              source: "ticket_deadlines",
              source_title: "موعد و دیرکرد تیکت",
              definition: {},
              schema_version: 1,
              visibility: "shared",
              shared_roles: [],
              shared_units: [],
              owner: { id: "m", name: "مدیر" },
              mine: false,
              revision: 1,
              can: { edit: false, delete: false, share: false, copy: true, export: true },
              updated_at: "",
            },
          ]}
        />
      </>
    );
    expect(html).toContain('href="/reports/source/ticket_deadlines"');
    expect(html).toContain("از مدیر");
    expect(html).toContain("اشتراکی");
    expect(html).toContain("کپی");
    expect(html).not.toContain(">حذف<");
  });
});
