import { describe, expect, it } from "vitest";
import { activityDescription, activityEventLabel, chartLabel, chartNumber, chartTooltipValue } from "./chart-labels";

describe("Persian dashboard chart labels", () => {
  it("uses the configured choice title and Persian digits", () => {
    expect(chartLabel("custom-code", { "custom-code": "مرحله 2" })).toBe("مرحله ۲");
    expect(chartLabel("in_progress")).toBe("در حال انجام");
    expect(chartLabel(null)).toBe("بدون مقدار");
  });

  it("localizes counts and tooltip names", () => {
    expect(chartNumber(1234)).toBe("۱٬۲۳۴");
    expect(chartTooltipValue(3, "count")).toEqual(["۳", "تعداد"]);
  });

  it("shows activity types in Persian", () => {
    expect(activityEventLabel("record.created")).toBe("رکورد ایجاد شد");
    expect(activityEventLabel("record.field_changed")).toBe("فیلد رکورد تغییر کرد");
    expect(activityEventLabel("unknown.event")).toBe("فعالیت ثبت شد");
  });
  it("names the actor, record, changed field, and readable values", () => {
    expect(
      activityDescription({
        actor: "سارا",
        record: "پیگیری فاکتور",
        event: "record.status_changed",
        field: "وضعیت",
        before: "todo",
        after: "done",
      })
    ).toBe("سارا وضعیت «پیگیری فاکتور» را از «برای انجام» به «انجام‌شده» تغییر داد");
    expect(activityDescription({ actor: "علی", record: "درخواست مرخصی", event: "record.created" })).toBe(
      "علی «درخواست مرخصی» را ایجاد کرد"
    );
    expect(
      activityDescription({
        actor: "علی",
        record: "قرارداد ۱۲",
        event: "record.field_changed",
        field: "مسئول",
        before: "",
        after: "مریم",
      })
    ).toBe("علی مسئول «قرارداد ۱۲» را «مریم» تعیین کرد");
    expect(
      activityDescription({
        actor: "علی",
        record: "قرارداد ۱۲",
        event: "record.field_changed",
        field: "مبلغ",
        before: "۵۰۰",
        after: "",
      })
    ).toBe("علی مبلغ «قرارداد ۱۲» را پاک کرد (مقدار قبلی: «۵۰۰»)");
    expect(
      activityDescription({
        actor: "علی",
        record: "قرارداد ۱۲",
        event: "record.field_changed",
        field: "پیوست",
        before: null,
        after: null,
      })
    ).toBe("علی پیوست «قرارداد ۱۲» را تغییر داد");
  });
  it("shows rich-text changes as Persian sentences without editor HTML", () => {
    expect(
      activityDescription({
        actor: "علی",
        record: "TT21",
        event: "record.field_changed",
        field: "توضیحات",
        before: '<p class="editor-paragraph-block">متن قدیم</p>',
        after: '<p class="editor-paragraph-block" data-id="123">متن تازه &amp; کامل</p>',
      })
    ).toBe("علی توضیحات «TT21» را از «متن قدیم» به «متن تازه & کامل» تغییر داد");
    expect(chartLabel("<p>شرح &amp; توضیح</p>")).toBe("شرح & توضیح");
  });
});
