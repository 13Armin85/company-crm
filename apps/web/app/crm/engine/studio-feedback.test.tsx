import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StudioError, studioInputError, studioIssues } from "./studio-feedback";

describe("designer error feedback", () => {
  const failure = {
    response: {
      data: {
        detail: "نام فیلد را وارد کنید.",
        errors: [
          { path: "title", label: "نام فیلد", message: "نام فیلد را وارد کنید." },
          { path: "options", label: "گزینه‌ها", message: "گزینه‌های تکراری را حذف کنید." },
        ],
      },
    },
  };
  it("keeps structured backend errors associated with their input", () => {
    expect(studioInputError(failure, "title")).toBe("نام فیلد را وارد کنید.");
    expect(studioInputError(failure, "missing")).toBeUndefined();
    const html = renderToStaticMarkup(<StudioError error={failure} fallback="ذخیره انجام نشد." preservesDraft />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("گزینه‌های تکراری را حذف کنید.");
    expect(html).toContain("تغییرات ذخیره‌نشده شما حفظ شده است.");
  });
  it("explains connection timeouts in Persian", () => {
    expect(
      renderToStaticMarkup(<StudioError error={{ code: "ECONNABORTED" }} fallback="عملیات انجام نشد." />)
    ).toContain("دریافت پاسخ بیش از حد طول کشید");
  });
  it("does not expose malformed or English server diagnostics", () => {
    expect(
      studioIssues({
        response: { data: { errors: [null, "raw", { path: "title", message: "Traceback or raw error" }] } },
      })
    ).toEqual([{ path: "title", label: "تنظیمات", message: "این مقدار معتبر نیست؛ ورودی را اصلاح کنید." }]);
  });
});
