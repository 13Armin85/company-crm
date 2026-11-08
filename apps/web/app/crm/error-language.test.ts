import { describe, expect, it } from "vitest";
import { errorMessage } from "./api";
import { passwordError } from "./access/components";

describe("Persian error messages", () => {
  it("translates specific legacy API errors", () => {
    expect(errorMessage({ response: { data: { error: "This username is already in use." } } }, "Failed")).toBe(
      "این نام کاربری قبلاً انتخاب شده است"
    );
  });
  it("preserves Persian errors and never exposes unknown English errors", () => {
    expect(errorMessage({ response: { data: { error: "خطا" } } }, "خطا")).toBe("خطا");
    expect(errorMessage({}, "خطا")).toBe("خطا");
    expect(errorMessage(new Error("Request failed with status code 500"), "ساخت حساب انجام نشد.")).toBe(
      "ساخت حساب انجام نشد."
    );
    expect(errorMessage({}, "Failed")).toMatch(/[\u0600-\u06ff]/);
  });
  it.each([
    { error: "این ایمیل ثبت شده است" },
    { email: ["user with this email already exists."] },
    { email: ["This field must be unique."] },
    { code: "unique", detail: { email: ["This email is already in use."] } },
  ])("shows the exact duplicate email message for nested API errors: %j", (data) => {
    expect(errorMessage({ response: { data } }, "ساخت حساب انجام نشد.")).toBe("این ایمیل ثبت شده است");
  });
  it("validates passwords in Persian", () => {
    expect(passwordError("", "")).toBe("وارد کردن رمز عبور و تکرار آن الزامی است.");
    expect(passwordError("password", "different")).toBe("رمز عبور و تکرار آن یکسان نیستند.");
    expect(passwordError("short", "short")).toBe("رمز عبور باید حداقل ۸ نویسه باشد.");
  });
});

describe("specific failure reasons", () => {
  it("names the input of a localized server error", () => {
    expect(errorMessage({ response: { status: 400, data: { code: ["این مقدار قبلاً استفاده شده است."] } } }, "خطا")).toBe(
      "کد: این مقدار قبلاً استفاده شده است."
    );
  });
  it("uses the detailed field error when a generic error is also present", () => {
    expect(
      errorMessage(
        {
          response: {
            status: 400,
            data: { error: "Validation failed", errors: { target_date: ["تاریخ نمی‌تواند قبل از امروز باشد."] } },
          },
        },
        "ذخیره کار انجام نشد"
      )
    ).toBe("ذخیره کار انجام نشد: مهلت انجام: تاریخ نمی‌تواند قبل از امروز باشد.");
    expect(
      errorMessage({ response: { status: 400, data: { custom_field: ["Invalid value"] } } }, "ذخیره کار انجام نشد")
    ).toBe("ذخیره کار انجام نشد: ورودی «custom field»: اطلاعات ارسال‌شده معتبر نیست؛ ورودی‌ها را بررسی کنید.");
  });
  it("explains the HTTP status when the server reason is not Persian", () => {
    expect(errorMessage({ response: { status: 403, data: { detail: "Forbidden" } } }, "ذخیره جدول انجام نشد.")).toBe(
      "ذخیره جدول انجام نشد: اجازه انجام این عملیات را ندارید؛ دسترسی لازم را از مدیر سامانه بگیرید."
    );
    expect(errorMessage({ response: { status: 502, data: "<html>Bad Gateway</html>" } }, "ذخیره نشد")).toBe(
      "ذخیره نشد: سرور برنامه در دسترس نیست؛ چند لحظه بعد دوباره تلاش کنید. (کد خطا ۵۰۲)"
    );
  });
  it("reports timeouts and lost connections", () => {
    expect(errorMessage({ code: "ECONNABORTED" }, "دریافت نشد.")).toMatch(/^دریافت نشد: پاسخ سرور/);
    expect(errorMessage({ code: "ERR_NETWORK", message: "Network Error" }, "دریافت نشد.")).toBe(
      "دریافت نشد: اتصال به سرور برقرار نشد؛ اتصال شبکه یا روشن‌بودن سرور را بررسی و دوباره تلاش کنید."
    );
  });
  it("names the failed action, the row and the input of nested errors", () => {
    expect(
      errorMessage(
        { response: { status: 400, data: { sections: [{}, {}, { title: ["این فیلد نباید خالی باشد."] }] } } },
        "ذخیره فرم انجام نشد"
      )
    ).toBe("ذخیره فرم انجام نشد: بخش‌ها، ردیف ۳ › نام: این فیلد نباید خالی باشد.");
    expect(
      errorMessage(
        { response: { status: 400, data: ["داشبورد در دستگاه دیگری تغییر کرده است؛ دوباره بارگذاری کنید."] } },
        "ذخیره داشبورد انجام نشد"
      )
    ).toBe("ذخیره داشبورد انجام نشد: داشبورد در دستگاه دیگری تغییر کرده است؛ دوباره بارگذاری کنید.");
    expect(errorMessage({ response: { status: 500, data: { detail: "Server Error" } } }, "ذخیره نشد")).toBe(
      "ذخیره نشد: خطای داخلی سرور رخ داد؛ اگر تکرار شد به پشتیبانی اطلاع دهید. (کد خطا ۵۰۰)"
    );
    expect(errorMessage(new Error("پروژهٔ «CRM» وضعیتی ندارد."), "تغییر وضعیت ذخیره نشد")).toBe(
      "تغییر وضعیت ذخیره نشد: پروژهٔ «CRM» وضعیتی ندارد."
    );
  });
});

describe("engine request failures", () => {
  it("names the record type and operation that failed", async () => {
    const { engineActionLabel } = await import("./engine/api");
    expect(engineActionLabel("entities/ticket/unique-rules/42/", "delete")).toBe("حذف قانون یکتایی انجام نشد");
    expect(engineActionLabel("entities/ticket/records/7/", "patch")).toBe("ذخیرهٔ رکورد انجام نشد");
    expect(engineActionLabel("forms/abc/", "put")).toBe("ذخیرهٔ فرم انجام نشد");
    expect(engineActionLabel("unknown/path/")).toBe("ثبت تغییرات انجام نشد");
  });
});
