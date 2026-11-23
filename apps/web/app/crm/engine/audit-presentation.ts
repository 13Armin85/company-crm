import type { AuditEvent } from "./api";
import { plainText, toFa } from "../utils";

const fieldTitles: Record<string, string> = {
  title: "عنوان",
  name: "نام",
  description: "شرح",
  rich_description: "شرح",
  status: "وضعیت",
  task_status: "وضعیت",
  ticket_state: "وضعیت",
  priority: "اولویت",
  assignee: "گیرنده",
  assignees: "گیرندگان",
  ticket_assignees: "گیرندگان",
  project: "پروژه",
  project_id: "پروژه",
  start_date: "تاریخ شروع",
  due_date: "سررسید",
  target_date: "تاریخ هدف",
  completed_at: "زمان انجام",
  is_active: "فعال بودن",
};

const valueTitles: Record<string, string> = {
  todo: "برای انجام",
  unstarted: "شروع نشده",
  backlog: "در انتظار انجام",
  in_progress: "در حال انجام",
  "in progress": "در حال انجام",
  started: "در حال انجام",
  review: "در حال بازبینی",
  blocked: "متوقف شده",
  done: "انجام شده",
  completed: "انجام شده",
  cancelled: "لغو شده",
  urgent: "فوری",
  high: "بالا",
  medium: "متوسط",
  low: "پایین",
  none: "بدون اولویت",
  true: "بله",
  false: "خیر",
};

const normalizedDigits = (value: string) =>
  value.replace(/[۰-۹٠-٩]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩".indexOf(digit) % 10));
const isIdentifier = (value: string) =>
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(normalizedDigits(value));

export function auditFieldTitle(field: string, metadata: AuditEvent["metadata"] = {}): string {
  if (typeof metadata.field_title === "string" && metadata.field_title.trim()) return plainText(metadata.field_title);
  return fieldTitles[field] || (field ? "اطلاعات" : "");
}

export function auditValue(value: unknown, field = ""): string {
  if (value === null || value === undefined || value === "") return "ثبت نشده";
  if (typeof value === "boolean") return value ? "بله" : "خیر";
  if (typeof value === "number") return toFa(value);
  if (Array.isArray(value)) {
    if (!value.length) return "موردی ثبت نشده";
    return value.length <= 3
      ? value.map((item) => auditValue(item, field)).join("، ")
      : `${toFa(value.length)} مورد ثبت شده`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key, item]) => !["id", "created_at", "updated_at", "revision"].includes(key) && item != null)
      .slice(0, 5);
    return entries.length
      ? entries.map(([key, item]) => `${auditFieldTitle(key)}: ${auditValue(item, key)}`).join("، ")
      : "اطلاعات ثبت شده";
  }
  const cleaned = plainText(value);
  if (!cleaned) return "ثبت نشده";
  if (isIdentifier(cleaned)) return fieldTitles[field] ? `${fieldTitles[field]} ثبت شده` : "مورد ثبت شده";
  if (/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(cleaned)) {
    const date = new Date(cleaned);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
        timeZone: "Asia/Tehran",
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(date);
    }
  }
  return valueTitles[cleaned.toLowerCase()] || (/^[a-z][a-z_\d.-]*$/i.test(cleaned) ? "مقدار ثبت شده" : toFa(cleaned));
}

export function auditEventTitle(event: AuditEvent): string {
  const field = auditFieldTitle(event.field, event.metadata);
  if (event.type === "record.created") return "ثبت اطلاعات";
  if (event.type === "record.updated") return field ? `ویرایش ${field}` : "ویرایش اطلاعات";
  if (event.type === "record.field_changed" || event.type === "record.status_changed")
    return `تغییر ${field || "اطلاعات"}`;
  if (event.type === "record.deactivated") return "غیرفعال‌سازی";
  if (event.type === "record.activated") return "فعال‌سازی";
  const workflowTitles: Record<string, string> = {
    "workflow.started": "شروع گردش‌کار",
    "workflow.transition": "انجام مرحلهٔ گردش‌کار",
    "workflow.reassigned": "ارجاع کار",
    "workflow.paused": "توقف مرحله",
    "workflow.resumed": "ازسرگیری مرحله",
    "workflow.delay_reported": "گزارش دیرکرد",
    "workflow.extension_requested": "درخواست تمدید",
    "workflow.extension_decided": "بررسی تمدید",
    "workflow.converted_to_standard": "انتقال به مسیر عادی",
    "workflow.migrated": "انتقال به نسخهٔ دیگر",
    "workflow.error": "خطای گردش‌کار",
  };
  if (event.type.startsWith("workflow.")) return workflowTitles[event.type] || "تغییر گردش‌کار";
  return field ? `تغییر ${field}` : "تغییر اطلاعات";
}
