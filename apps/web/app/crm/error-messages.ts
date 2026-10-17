const persian = /[\u0600-\u06ff]/;
const messages: Record<string, string> = {
  "This email is already in use.": "این ایمیل ثبت شده است",
  "This username is already in use.": "این نام کاربری قبلاً انتخاب شده است",
  "Enter a valid email address.": "ایمیل معتبر وارد کنید.",
  "This field is required.": "تکمیل این فیلد الزامی است.",
  "This field may not be blank.": "این فیلد نباید خالی باشد.",
  "Network Error": "اتصال به سرور برقرار نشد؛ دوباره تلاش کنید.",
};

export function localizeError(value: string, fallback = "عملیات انجام نشد؛ دوباره تلاش کنید."): string {
  if (messages[value]) return messages[value];
  if (/email/i.test(value) && /already|unique|exists/i.test(value)) return "این ایمیل ثبت شده است";
  if (persian.test(value)) return value;
  return persian.test(fallback) ? fallback : "عملیات انجام نشد؛ دوباره تلاش کنید.";
}

export function firstError(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(value)) return value.map(firstError).find(Boolean);
  if (value && typeof value === "object") {
    const fields = value as Record<string, unknown>;
    const emailError = firstError(fields.email);
    if (emailError && /already|unique|exists/i.test(emailError)) return "این ایمیل ثبت شده است";
    return (
      firstError(fields.error) ??
      firstError(fields.detail) ??
      Object.entries(fields)
        .filter(([key]) => !["code", "error_code", "status_code", "type"].includes(key))
        .map(([, item]) => firstError(item))
        .find(Boolean)
    );
  }
  return undefined;
}
