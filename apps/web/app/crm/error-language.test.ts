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
  it("explains the HTTP status when the server reason is not Persian", () => {
    expect(errorMessage({ response: { status: 403, data: { detail: "Forbidden" } } }, "ذخیره جدول انجام نشد.")).toBe(
      "ذخیره جدول انجام نشد: اجازه انجام این عملیات را ندارید؛ دسترسی لازم را از مدیر سامانه بگیرید."
    );
    expect(errorMessage({ response: { status: 502, data: "<html>Bad Gateway</html>" } }, "ذخیره نشد")).toBe(
      "ذخیره نشد: سرور برنامه در دسترس نیست؛ چند لحظه بعد دوباره تلاش کنید."
    );
  });
  it("reports timeouts and lost connections", () => {
    expect(errorMessage({ code: "ECONNABORTED" }, "دریافت نشد.")).toMatch(/^دریافت نشد: پاسخ سرور/);
    expect(errorMessage({ code: "ERR_NETWORK", message: "Network Error" }, "دریافت نشد.")).toBe(
      "اتصال به سرور برقرار نشد؛ دوباره تلاش کنید."
    );
  });
});
