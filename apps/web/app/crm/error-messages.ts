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

const statusReasons: Record<number, string> = {
  400: "اطلاعات ارسال‌شده معتبر نیست؛ ورودی‌ها را بررسی کنید.",
  401: "نشست شما پایان یافته است؛ دوباره وارد حساب شوید.",
  403: "اجازه انجام این عملیات را ندارید؛ دسترسی لازم را از مدیر سامانه بگیرید.",
  404: "مورد درخواستی پیدا نشد یا حذف شده است.",
  405: "این عملیات برای این بخش پشتیبانی نمی‌شود.",
  408: "پاسخ سرور بیش از حد طول کشید؛ دوباره تلاش کنید.",
  409: "این اطلاعات هم‌زمان توسط کاربر دیگری تغییر کرده یا تکراری است؛ صفحه را تازه کنید.",
  413: "حجم فایل یا اطلاعات ارسالی بیش از حد مجاز است.",
  415: "قالب فایل یا اطلاعات ارسالی پشتیبانی نمی‌شود.",
  422: "اطلاعات ارسال‌شده با قواعد ثبت سازگار نیست.",
  429: "تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید.",
  500: "خطای داخلی سرور رخ داد؛ اگر تکرار شد به پشتیبانی اطلاع دهید.",
  502: "سرور برنامه در دسترس نیست؛ چند لحظه بعد دوباره تلاش کنید.",
  503: "سرور موقتاً در دسترس نیست؛ چند لحظه بعد دوباره تلاش کنید.",
  504: "سرور در زمان مقرر پاسخ نداد؛ دوباره تلاش کنید.",
};
// Keys whose Persian name makes a message self-explanatory outside its input, e.g. in a toast.
const fieldLabels: Record<string, string> = {
  title: "نام",
  name: "نام",
  code: "کد",
  kind: "نوع",
  options: "گزینه‌ها",
  lookup: "فهرست انتخابی",
  relation_entity: "بخش مرتبط",
  columns: "ستون‌های جدول",
  table_tabs: "تب‌های جدول",
  placeholder: "متن نمونه",
  help_text: "راهنما",
  config: "تنظیمات",
  layout: "چیدمان",
  sections: "بخش‌ها",
  bindings: "ورودی‌های چیدمان",
  description: "توضیحات",
  parent: "والد",
  category: "دسته",
  default: "مقدار پیش‌فرض",
  formula: "فرمول",
  email: "ایمیل",
  password: "رمز عبور",
  status: "وضعیت",
  state_id: "وضعیت پروژه",
  assignee_id: "مسئول کار",
  assignee_ids: "مسئولان کار",
  project_id: "پروژه",
  due_date: "مهلت انجام",
  target_date: "مهلت انجام",
  tabs: "تب‌های داشبورد",
  widgets: "ویجت‌ها",
  field: "فیلد",
  value: "مقدار",
  start: "تاریخ شروع",
  end: "تاریخ پایان",
  // Leave requests, Word templates and signature images (ticket 6).
  mode: "شیوهٔ مدت",
  start_date: "تاریخ شروع",
  end_date: "تاریخ پایان",
  start_time: "ساعت شروع",
  end_time: "ساعت پایان",
  reason: "دلیل",
  substitute: "جانشین",
  attachments: "پیوست‌ها",
  file: "فایل",
  expires_at: "تاریخ انقضا",
  template: "قالب فرم",
  fingerprint: "پیش‌نمایش سند",
  confirm: "تأیید صریح",
  signature_id: "تصویر امضا",
  grant: "اجازهٔ درج امضا",
  revision: "نسخهٔ درخواست",
};
const machineKeys = new Set(["code", "error_code", "status_code", "type"]);

function locatedError(value: unknown, path: string[] = []): { message: string; path: string[] } | undefined {
  if (typeof value === "string" && value.trim()) return { message: value, path };
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      // Object rows keep their position so the message can name the row; string lists do not.
      const found = locatedError(item, item && typeof item === "object" ? [...path, String(index)] : path);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const fields = value as Record<string, unknown>;
  const ordered = [
    "errors",
    ...Object.keys(fields).filter((key) => !["error", "detail", "errors"].includes(key)),
    "detail",
    "error",
  ];
  for (const key of ordered) {
    if (!(key in fields) || (machineKeys.has(key) && !Array.isArray(fields[key]))) continue;
    const found = locatedError(fields[key], [...path, key]);
    if (found) return found;
  }
  return undefined;
}

const sentence = (value: string) => value.replace(/[.؛:،\s]+$/, "");
const faDigits = (value: number) => value.toLocaleString("fa-IR", { useGrouping: false });
const structural = new Set(["error", "errors", "detail", "non_field_errors"]);

/** Where in the submitted data the error points, e.g. sections.2.title -> «بخش‌ها، ردیف ۳ › نام». */
function errorLocation(path: string[]): { key?: string; label?: string } {
  const parts: string[] = [];
  let key: string | undefined;
  for (let index = 0; index < path.length; index += 1) {
    const part = path[index];
    if (structural.has(part) || /^\d+$/.test(part)) continue;
    key = part;
    const row = path[index + 1];
    const name = fieldLabels[part] || `ورودی «${part.replaceAll("_", " ")}»`;
    parts.push(row && /^\d+$/.test(row) ? `${name}، ردیف ${faDigits(Number(row) + 1)}` : name);
  }
  return { key, label: parts.length ? parts.join(" › ") : undefined };
}

const generic = "عملیات انجام نشد؛ دوباره تلاش کنید.";

/** Prefix the failed action unless the reason already says it. */
function withAction(action: string, reason: string): string {
  const head = sentence(action);
  if (!head || head === "خطا" || head === sentence(generic) || sentence(reason) === head || reason.startsWith(head))
    return reason;
  return `${head}: ${reason}`;
}

/** A Persian explanation of what failed, where, and why: action, input, then the server reason or HTTP meaning. */
export function describeError(error: unknown, fallback: string): string {
  const failure = error as { code?: string; message?: string; response?: { status?: number; data?: unknown } };
  const action = persian.test(fallback) ? fallback : "عملیات انجام نشد؛ دوباره تلاش کنید.";
  if (!failure?.response) {
    if (failure?.code === "ECONNABORTED" || failure?.code === "ETIMEDOUT")
      return `${sentence(action)}: پاسخ سرور بیش از حد طول کشید؛ اتصال را بررسی و دوباره تلاش کنید.`;
    if (failure?.code === "ERR_NETWORK" || failure?.message === "Network Error")
      return withAction(action, "اتصال به سرور برقرار نشد؛ اتصال شبکه یا روشن‌بودن سرور را بررسی و دوباره تلاش کنید.");
    const local = typeof failure?.message === "string" ? failure.message : "";
    return persian.test(local) ? withAction(action, local) : localizeError(local, fallback);
  }
  const { status = 0, data } = failure.response;
  const supportCode = status >= 500 ? ` (کد خطا ${faDigits(status)})` : "";
  // Proxies answer 502/504 with an HTML page; that body is not a reason.
  const found = typeof data === "string" && /^\s*</.test(data) ? undefined : locatedError(data);
  if (found) {
    const { key, label } = errorLocation(found.path);
    if (/email/i.test(found.path.join(".") + found.message) && /already|unique|exists/i.test(found.message))
      return "این ایمیل ثبت شده است";
    const known = messages[found.message] ?? (persian.test(found.message) ? found.message : undefined);
    if (known === messages["This email is already in use."]) return known;
    if (known) {
      const located =
        label && !(key && fieldLabels[key] && known.includes(fieldLabels[key])) ? `${label}: ${known}` : known;
      return withAction(action, located) + supportCode;
    }
    if (label && status < 500) {
      return withAction(action, `${label}: ${statusReasons[status] || "مقدار واردشده معتبر نیست؛ آن را بررسی کنید."}`);
    }
  }
  const reason = statusReasons[status] ?? (status >= 500 ? statusReasons[500] : undefined);
  return reason ? `${sentence(action)}: ${reason}${supportCode}` : action;
}
