import { describe, expect, it } from "vitest";
import { activityEventLabel, chartLabel, chartNumber, chartTooltipValue } from "./chart-labels";

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
});
