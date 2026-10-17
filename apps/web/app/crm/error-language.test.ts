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
