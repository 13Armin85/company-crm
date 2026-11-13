/** Pure helpers of the leave request pages (ticket 6); no React, no network.
 * The server repeats every check; these only give early, clear feedback. */
import type { LeaveFormValues, LeaveRequestDetail, LeaveStatus, LeaveVersion, TemplateIssue } from "../api/leave";

export const SIGNATURE_NOTICE = "این تصویر امضا است و امضای دیجیتال رمزنگاری‌شده نیست.";
export const SIGN_BUTTON = "ثبت امضا و ارسال برای تأیید";

export const MODE_LABELS: Record<LeaveFormValues["mode"], string> = { daily: "روزانه", hourly: "ساعتی" };

export const STATUS_LABELS: Record<LeaveStatus, string> = {
  draft: "پیش‌نویس",
  pending: "در انتظار تأیید",
  returned: "بازگشت برای اصلاح",
  approved: "تأییدشده",
  rejected: "ردشده",
  cancelled: "لغوشده",
};

export const STATUS_TONES: Record<LeaveStatus, "neutral" | "info" | "warning" | "success" | "danger"> = {
  draft: "neutral",
  pending: "info",
  returned: "warning",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
};

export const EVENT_LABELS: Record<string, string> = {
  "leave.created": "ثبت پیش‌نویس",
  "leave.updated": "ویرایش درخواست",
  "leave.version_created": "ساخت نسخهٔ تازه",
  "leave.signed": "ثبت امضا و ارسال",
  "leave.cancelled": "لغو درخواست",
  "leave.absence_recorded": "ثبت عدم حضور",
  "leave.absence_cancelled": "لغو عدم حضور",
  "record.status_changed": "تغییر وضعیت",
  "signature.uploaded": "بارگذاری تصویر امضا",
  "signature.replaced": "جایگزینی تصویر امضا",
  "signature.viewed": "مشاهدهٔ تصویر امضا",
  "signature.consent_granted": "اعطای اجازهٔ درج امضا",
  "signature.consent_revoked": "لغو اجازهٔ درج امضا",
  "signature.used": "درج امضا روی سند",
};

export const emptyForm = (today = ""): LeaveFormValues => ({
  mode: "daily",
  start_date: today,
  end_date: today,
  start_time: "",
  end_time: "",
  reason: "",
  substitute: "",
  attachments: [],
});

export function formFromVersion(version: LeaveVersion): LeaveFormValues {
  return {
    mode: version.mode,
    start_date: version.start_date,
    end_date: version.end_date,
    start_time: version.start_time ?? "",
    end_time: version.end_time ?? "",
    reason: version.reason,
    substitute: version.substitute?.id ?? "",
    attachments: version.attachments.map((item) => item.id),
  };
}

/** The payload the server accepts; times are sent only for hourly leave. There is no category field. */
export function formPayload(values: LeaveFormValues) {
  const base = {
    mode: values.mode,
    start_date: values.start_date,
    end_date: values.end_date || values.start_date,
    reason: values.reason.trim(),
    substitute: values.substitute || null,
    attachments: values.attachments,
  };
  return values.mode === "hourly" ? { ...base, start_time: values.start_time, end_time: values.end_time } : base;
}

/** Same rules as the server: dates present, end not before start, hourly needs both times and end after start. */
export function formErrors(values: LeaveFormValues): Partial<Record<keyof LeaveFormValues, string>> {
  const errors: Partial<Record<keyof LeaveFormValues, string>> = {};
  if (values.mode !== "daily" && values.mode !== "hourly") errors.mode = "شیوهٔ مدت فقط «روزانه» یا «ساعتی» است.";
  if (!values.start_date) errors.start_date = "تاریخ شروع را انتخاب کنید.";
  const end = values.end_date || values.start_date;
  if (values.start_date && end && end < values.start_date) errors.end_date = "پایان مرخصی نباید پیش از شروع آن باشد.";
  if (values.mode === "hourly") {
    if (!values.start_time) errors.start_time = "ساعت شروع را وارد کنید.";
    if (!values.end_time) errors.end_time = "ساعت پایان را وارد کنید.";
    if (
      values.start_time &&
      values.end_time &&
      !errors.end_date &&
      `${end}T${values.end_time}` <= `${values.start_date}T${values.start_time}`
    )
      errors.end_time = "پایان مرخصی باید بعد از شروع آن باشد.";
  }
  if (values.reason.length > 2000) errors.reason = "دلیل حداکثر می‌تواند ۲۰۰۰ نویسه باشد.";
  return errors;
}

export const hasErrors = (errors: object) => Object.keys(errors).length > 0;

/** Where a workflow inbox row of this entity opens. */
export function recordHref(entity: string, recordId: string) {
  return entity === "leave_request" ? `/leave-requests/${recordId}` : `/entities/${entity}/${recordId}`;
}

export function holderText(detail: Pick<LeaveRequestDetail, "holder" | "status">) {
  const holder = detail.holder;
  if (!holder) return detail.status === "draft" ? "نزد خود شما (پیش‌نویس)" : "";
  if (holder.error) return `خطای مسیر تأیید در مرحلهٔ «${holder.step}»: ${holder.error}`;
  const names = holder.people.map((p) => p.name).join("، ") || "—";
  const acting = holder.acting_delegate ? ` (جانشین فعال: ${holder.acting_delegate.name})` : "";
  return `مرحلهٔ «${holder.step}» — نزد ${names}${acting}`;
}

export const blockingIssues = (issues: TemplateIssue[]) => issues.filter((issue) => issue.level === "error");

const digits = (value: string) => value.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

/** Attachments: the same limits the server enforces (it repeats every check). */
export const MAX_ATTACHMENTS = 10;
export type AttachmentConfig = { max_file_size: number; extensions: string[] };
export type AttachmentKind = "pdf" | "image" | "sheet" | "doc" | "text" | "other";

export const fileExtension = (name: string) => (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "");

export function attachmentKind(name: string): AttachmentKind {
  const ext = fileExtension(name);
  if (ext === "pdf") return "pdf";
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "image";
  if (["xls", "xlsx", "csv"].includes(ext)) return "sheet";
  if (["doc", "docx"].includes(ext)) return "doc";
  if (ext === "txt") return "text";
  return "other";
}

export const acceptAttribute = (config?: AttachmentConfig) =>
  config ? config.extensions.map((ext) => `.${ext}`).join(",") : undefined;

/** One line under the drop zone: allowed formats and the size limit, in Persian. */
export function attachmentHint(config?: AttachmentConfig) {
  if (!config) return "";
  const formats = config.extensions.map((ext) => ext.toUpperCase()).join("، ");
  return `هر فایل حداکثر ${fileSize(config.max_file_size)} · قالب‌های مجاز: ${formats}`;
}

/** Splits picked files into accepted ones and Persian reasons for the rejected ones (type, size, count). */
export function checkAttachments(files: File[], current: number, config?: AttachmentConfig) {
  const accepted: File[] = [];
  const rejected: string[] = [];
  for (const file of files) {
    const ext = fileExtension(file.name);
    if (config && !config.extensions.includes(ext)) rejected.push(`«${file.name}»: این نوع فایل مجاز نیست.`);
    else if (config && file.size > config.max_file_size)
      rejected.push(`«${file.name}»: حجم فایل بیش از ${fileSize(config.max_file_size)} است.`);
    else if (file.size === 0) rejected.push(`«${file.name}»: فایل خالی است.`);
    else if (current + accepted.length >= MAX_ATTACHMENTS)
      rejected.push(`«${file.name}»: حداکثر ${digits(String(MAX_ATTACHMENTS))} پیوست مجاز است.`);
    else accepted.push(file);
  }
  return { accepted, rejected };
}

export function fileSize(bytes: number) {
  if (bytes < 1024) return digits(`${bytes} بایت`);
  if (bytes < 1024 * 1024) return digits(`${Math.round(bytes / 1024)} کیلوبایت`);
  return digits(`${(bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, "")} مگابایت`);
}
