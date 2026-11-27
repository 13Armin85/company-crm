import { describe, expect, it } from "vitest";
import { describeError, localizeError } from "./error-messages";

describe("Persian error presentation", () => {
  const action = "ذخیرهٔ درخواست انجام نشد";

  it("keeps an actionable validation reason and distinguishes duplicates from permission errors", () => {
    expect(
      describeError({ response: { status: 400, data: { name: ["این نام قبلاً ثبت شده است."] } } }, action)
    ).toContain("این نام قبلاً ثبت شده است");
    expect(describeError({ response: { status: 403, data: {} } }, action)).toContain(
      "اجازه انجام این عملیات را ندارید"
    );
  });

  it("never presents raw HTML, stack traces, machine names or secrets even with Persian text", () => {
    const details = [
      "خطا <script>alert(1)</script>",
      'خطا Traceback File "plane/app/views.py"',
      "خطا django.db.IntegrityError",
      "خطا password=secret-value",
      'خطا {"token":"secret-value"}',
    ];
    for (const detail of details) {
      const displayed = describeError({ response: { status: 400, data: { detail } } }, action);
      expect(displayed).not.toContain(detail);
      expect(displayed).not.toContain("secret-value");
      expect(displayed).toContain("معتبر نیست");
      expect(localizeError(detail, action)).toBe(action);
    }
  });

  it("ignores the body of a server failure and gives a support code", () => {
    const displayed = describeError(
      { response: { status: 500, data: { detail: "خطا password=secret-value" } } },
      action
    );
    expect(displayed).toContain("کد خطا ۵۰۰");
    expect(displayed).not.toContain("secret-value");
  });
});
