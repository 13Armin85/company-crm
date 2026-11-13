/** Pure helpers of the ticket core UI (ticket 5); no React, no network. */
import type { DeadlineState, RoutingConditions, RoutingMethod, RoutingRule, TicketDeadline } from "../api/ticket";
import { formatWorkingMinutes } from "../workflow/model";

// ---------------------------------------------------------------- ن۶ status categories

export type WorkCategoryId = "todo" | "in_progress" | "done";

/** Mirrors ticket_core.GROUP_CATEGORY / STATUS_CATEGORY on the server (the source of truth);
 * rows from the server already carry `category`, this is only for empty kanban columns. */
export const GROUP_CATEGORY: Record<string, WorkCategoryId> = {
  backlog: "todo",
  unstarted: "todo",
  triage: "todo",
  started: "in_progress",
  completed: "done",
  cancelled: "done",
};
export const STATUS_CATEGORY: Record<string, WorkCategoryId> = {
  todo: "todo",
  in_progress: "in_progress",
  review: "in_progress",
  blocked: "in_progress",
  done: "done",
};
/** Board column ids (the UI status enum) → category. */
export const UI_STATUS_CATEGORY: Record<string, WorkCategoryId> = {
  Todo: "todo",
  "In Progress": "in_progress",
  Review: "in_progress",
  Blocked: "in_progress",
  Done: "done",
};
export const CATEGORY_TITLES: Record<WorkCategoryId, string> = {
  todo: "انجام‌نشده",
  in_progress: "در حال انجام",
  done: "انجام‌شده",
};

export function workCategory({ group, status }: { group?: string | null; status?: string | null }): WorkCategoryId {
  if (group) return GROUP_CATEGORY[group.trim().toLowerCase()] ?? "todo";
  return STATUS_CATEGORY[String(status ?? "").trim().toLowerCase()] ?? "todo";
}

export const faDigits = (value: number | string) =>
  String(value).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

export type Tone = "neutral" | "info" | "warning" | "danger" | "success";

export interface StatePresentation {
  tone: Tone;
  icon: "clock" | "alert" | "check" | "pause" | "dash";
  label: string;
}

/** Color + icon + text for every card state of section 6.2 (never color alone). */
export const DEADLINE_STATES: Record<DeadlineState, StatePresentation> = {
  none: { tone: "neutral", icon: "dash", label: "مدت هدف تعیین نشده" },
  not_started: { tone: "neutral", icon: "pause", label: "محاسبه با نخستین شروع کار آغاز می‌شود" },
  running: { tone: "info", icon: "clock", label: "در جریان" },
  near_due: { tone: "warning", icon: "alert", label: "نزدیک موعد" },
  overdue: { tone: "danger", icon: "alert", label: "دیرکرده" },
  closed: { tone: "success", icon: "check", label: "بسته" },
};

export function deadlineSummary(deadline: TicketDeadline): string {
  switch (deadline.state) {
    case "none":
      return "مدت هدف تعیین نشده";
    case "not_started":
      return "محاسبه با نخستین شروع کار آغاز می‌شود";
    case "overdue":
      return `${formatWorkingMinutes(deadline.overdue_minutes)} تأخیر`;
    case "closed":
      return deadline.spent_minutes !== null && deadline.total_minutes !== null
        ? `صرف‌شده ${formatWorkingMinutes(deadline.spent_minutes)} از ${formatWorkingMinutes(deadline.total_minutes)}`
        : "تیکت بسته شده است";
    default:
      return `${formatWorkingMinutes(deadline.remaining_minutes ?? 0)} مانده`;
  }
}

/** Neutral progress 0–100 of the working-time budget (only while running). */
export function progressPercent(deadline: TicketDeadline): number | null {
  if (!["running", "near_due", "overdue"].includes(deadline.state) || !deadline.total_minutes) return null;
  if (deadline.state === "overdue") return 100;
  const used = deadline.total_minutes - (deadline.remaining_minutes ?? 0);
  return Math.min(100, Math.max(0, Math.round((used / deadline.total_minutes) * 100)));
}

export function originLabel(deadline: TicketDeadline): string {
  if (deadline.target_origin === "ticket") return "مقدار همین تیکت";
  if (deadline.target_origin === "type") return "پیش‌فرض نوع تیکت";
  return "";
}

export function minutesFrom(hours: string | number, minutes: string | number): number | null {
  const h = Number(hours || 0);
  const m = Number(minutes || 0);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || m < 0 || m >= 60) return null;
  const total = Math.round(h) * 60 + Math.round(m);
  return total > 0 ? total : null;
}

export function extensionErrors(minutes: number | null, reason: string): string[] {
  const errors = [];
  if (!minutes) errors.push("مدت اضافه را به ساعت یا دقیقهٔ کاری وارد کنید.");
  if (!reason.trim()) errors.push("دلیل درخواست تمدید الزامی است.");
  return errors;
}

export function targetErrors(minutes: number | null, reason: string, clearing: boolean): string[] {
  const errors = [];
  if (!clearing && !minutes) errors.push("مدت هدف را به ساعت یا دقیقهٔ کاری وارد کنید.");
  if (!reason.trim()) errors.push("دلیل تغییر مدت هدف الزامی است.");
  return errors;
}

export function delayErrors(reason: string, progress: string, expected: string | null, now = new Date()): string[] {
  const errors = [];
  if (!reason.trim()) errors.push("دلیل تأخیر را بنویسید.");
  if (!progress.trim()) errors.push("وضعیت پیشرفت را بنویسید.");
  if (!expected) errors.push("زمان پایان جدید را انتخاب کنید.");
  else if (new Date(expected) <= now) errors.push("زمان پایان جدید باید در آینده باشد.");
  return errors;
}

export function contactErrors(values: {
  channel: string;
  contactName: string;
  summary: string;
  resolved: boolean | null;
}): string[] {
  const errors = [];
  if (!values.channel) errors.push("کانال تماس را انتخاب کنید.");
  if (!values.contactName.trim()) errors.push("نام مخاطب را بنویسید.");
  if (!values.summary.trim()) errors.push("خلاصهٔ گفتگو را بنویسید.");
  if (values.resolved === null) errors.push("نتیجهٔ تماس را انتخاب کنید.");
  return errors;
}

// ---------------------------------------------------------------- presets (ن۷)

export const PRESETS = [
  { id: "all", label: "همه" },
  { id: "mine", label: "من" },
  { id: "unassigned", label: "بدون مسئول" },
  { id: "overdue", label: "عقب‌افتاده" },
  { id: "closed", label: "بسته‌شده" },
  { id: "portal", label: "درگاه: منتظر تریاژ" },
] as const;

export type PresetId = (typeof PRESETS)[number]["id"];

export const BADGE_LABELS: Record<string, { label: string; tone: Tone }> = {
  running: { label: "در موعد", tone: "info" },
  near_due: { label: "نزدیک موعد", tone: "warning" },
  overdue: { label: "دیرکرده", tone: "danger" },
  closed: { label: "بسته", tone: "success" },
  not_started: { label: "شروع‌نشده", tone: "neutral" },
};

// ---------------------------------------------------------------- history (۶.۹)

export const HISTORY_KINDS = [
  { id: "", label: "همه" },
  { id: "status", label: "وضعیت" },
  { id: "assignee", label: "مسئول و ارجاع" },
  { id: "deadline", label: "موعد" },
  { id: "extension", label: "تمدید" },
  { id: "delay", label: "تأخیر" },
  { id: "contact", label: "تماس" },
  { id: "lifecycle", label: "بستن/بازگشایی" },
  { id: "fields", label: "فیلدها" },
  { id: "portal", label: "درگاه و برآورد" },
] as const;

export const EVENT_TITLES: Record<string, string> = {
  "ticket.category_changed": "تغییر وضعیت",
  "record.status_changed": "تغییر وضعیت",
  "ticket.target_started": "شروع محاسبهٔ زمان هدف",
  "ticket.target_changed": "تغییر مدت هدف",
  "ticket.target_restarted": "ادامهٔ زمان هدف پس از بازگشایی",
  "ticket.overdue_flagged": "دیرکرد",
  "ticket.extension_requested": "درخواست تمدید",
  "ticket.extension_approved": "تأیید تمدید",
  "ticket.extension_rejected": "رد تمدید",
  "ticket.delay_reported": "گزارش تأخیر",
  "ticket.contact": "تماس با مشتری",
  "ticket.closed": "بستن تیکت",
  "ticket.reopened": "بازگشایی تیکت",
  "ticket.referred": "ارجاع",
  "ticket.referral_accepted": "پذیرش ارجاع",
  "ticket.referral_rejected": "رد ارجاع",
  "ticket.routed": "ارجاع خودکار",
  "ticket.queued": "صف بدون مسئول",
  "ticket.field_changed": "تغییر فیلد",
  "record.created": "ثبت تیکت",
  "record.updated": "ویرایش تیکت",
  "record.deactivated": "غیرفعال‌سازی تیکت",
  "record.activated": "فعال‌سازی تیکت",
  // Ticket 7: customer portal and quotes.
  "portal.request_submitted": "ثبت درخواست از درگاه مشتری",
  "portal.customer_message": "پیام مشتری",
  "portal.reply": "پاسخ به مشتری",
  "portal.internal_note": "یادداشت داخلی",
  "portal.request_approved": "تأیید درخواست درگاه",
  "portal.request_rejected": "رد درخواست درگاه",
  "portal.info_requested": "درخواست تکمیل اطلاعات از مشتری",
  "portal.info_provided": "پاسخ مشتری به درخواست تکمیل",
  "portal.feedback": "بازخورد مشتری",
  "portal.feedback_edited": "ویرایش بازخورد مشتری",
  "quote.created": "ساخت برآورد",
  "quote.sent": "ارسال برآورد",
  "quote.approved": "تأیید برآورد توسط مشتری",
  "quote.rejected": "رد برآورد توسط مشتری",
  "quote.revision_requested": "درخواست اصلاح برآورد",
};

/** Form field codes of the ticket entity → what users call them (generic record events). */
export const FIELD_LABELS: Record<string, string> = {
  title: "عنوان",
  ticket_state: "وضعیت",
  task_status: "وضعیت",
  priority: "اولویت",
  ticket_assignees: "مسئولان",
  assignee: "مسئول",
  due_date: "سررسید",
  project: "پروژه",
  rich_description: "شرح",
  description: "شرح",
};

export function eventTitle(type: string, field: string, metadata: Record<string, unknown>): string {
  if (type === "ticket.field_changed" && typeof metadata.field_title === "string")
    return `تغییر ${metadata.field_title}`;
  if (type === "record.field_changed" && FIELD_LABELS[field]) return `تغییر ${FIELD_LABELS[field]}`;
  if ((type === "record.updated" || type === "record.status_changed") && FIELD_LABELS[field])
    return `تغییر ${FIELD_LABELS[field]}`;
  return EVENT_TITLES[type] || "تغییر تیکت";
}

const STATUS_CODES: Record<string, string> = {
  todo: "برای انجام",
  in_progress: "در حال انجام",
  review: "بازبینی",
  blocked: "مسدود",
  done: "انجام‌شده",
};
const PRIORITY_CODES: Record<string, string> = {
  urgent: "فوری",
  high: "بالا",
  medium: "متوسط",
  low: "پایین",
  none: "بدون اولویت",
};

/** Events that only repeat what the per-field rows already show. */
export const HIDDEN_EVENTS = new Set(["record.updated"]);

export function historyValue(value: unknown, field = ""): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" && (field === "ticket_state" || field === "task_status" || field === "status"))
    return STATUS_CODES[value] ?? value;
  if (typeof value === "string" && field === "priority") return PRIORITY_CODES[value] ?? value;
  if (typeof value === "number") return formatWorkingMinutes(value);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return persianMoment(value);
  if (Array.isArray(value)) return value.length ? faDigits(value.length) + " مورد" : "—";
  if (typeof value === "object") {
    const count = Object.keys(value as Record<string, unknown>).length;
    return count ? `${faDigits(count)} فیلد` : "—";
  }
  return faDigits(String(value));
}

export function persianMoment(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  // Built from parts so the order reads naturally in Persian: «چهارشنبه ۲۰ آبان ۱۴۰۵، ساعت ۲۲:۴۶».
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      timeZone: "Asia/Tehran",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );
  return `${parts.weekday} ${parts.day} ${parts.month} ${parts.year}، ساعت ${parts.hour}:${parts.minute}`;
}

// ---------------------------------------------------------------- routing rules (۶.۸)

export const METHOD_LABELS: Record<RoutingMethod, string> = {
  manager: "مدیر واحد (بالا رفتن در درخت واحد)",
  user: "فرد ثابت",
  group: "گروه ثابت",
  round_robin: "نوبتی",
  least_loaded: "کمترین حجم کار",
};

export const PRIORITY_LABELS: Record<string, string> = {
  urgent: "فوری",
  high: "بالا",
  medium: "متوسط",
  low: "پایین",
  none: "بدون اولویت",
};

export function conditionCount(conditions: RoutingConditions): number {
  return (
    (["type_ids", "priorities", "customer_ids", "project_ids", "unit_ids"] as const).filter(
      (key) => (conditions[key] ?? []).length > 0
    ).length + (conditions.expression ? 1 : 0)
  );
}

/** «اگر [نوع = …] و [اولویت = …] ← [روش] به [مقصد]» */
export function ruleSentence(rule: RoutingRule, names: Record<string, string> = {}): string {
  const label = (ids: string[] = []) => ids.map((id) => names[id] || PRIORITY_LABELS[id] || "…").join("، ");
  const c = rule.conditions || {};
  const parts = [
    c.type_ids?.length ? `نوع = ${label(c.type_ids)}` : "",
    c.priorities?.length ? `اولویت = ${label(c.priorities)}` : "",
    c.customer_ids?.length ? `مشتری = ${label(c.customer_ids)}` : "",
    c.project_ids?.length ? `پروژه = ${label(c.project_ids)}` : "",
    c.unit_ids?.length ? `واحد = ${label(c.unit_ids)}` : "",
    c.expression ? "شرط پیشرفته" : "",
  ].filter(Boolean);
  const when = parts.length ? `اگر ${parts.map((p) => `[${p}]`).join(" و ")}` : "برای همهٔ تیکت‌ها";
  const target =
    rule.method === "user"
      ? rule.target_user_name || "فرد انتخاب‌نشده"
      : rule.method === "group"
        ? `صف «${rule.role_name || "نقش"}»`
        : rule.method === "manager"
          ? `مدیر «${rule.unit_title || "واحد"}»`
          : rule.member_ids.length
            ? `${faDigits(rule.member_ids.length)} نفر`
            : `دارندگان نقش «${rule.role_name || "—"}»`;
  return `${when} ← ${METHOD_LABELS[rule.method]} به ${target}`;
}

export function ruleProblems(rule: Partial<RoutingRule>): string[] {
  const errors = [];
  if (!rule.name?.trim()) errors.push("نام قاعده را بنویسید.");
  if (rule.method === "user" && !rule.target_user_id) errors.push("فرد ثابت را انتخاب کنید.");
  if (rule.method === "group" && !rule.required_role_id) errors.push("نقش گروه را انتخاب کنید.");
  if (rule.method === "manager" && (!rule.unit_id || !rule.required_role_id))
    errors.push("برای روش «مدیر واحد» واحد و نقش لازم را انتخاب کنید.");
  if (
    (rule.method === "round_robin" || rule.method === "least_loaded") &&
    !(rule.member_ids ?? []).length &&
    !rule.required_role_id &&
    !rule.unit_id
  )
    errors.push("اعضای نوبت را انتخاب کنید یا نقش/واحد را مشخص کنید.");
  return errors;
}

/** New order after moving one rule up (-1) or down (+1). */
export function moveRule(ids: string[], id: string, delta: -1 | 1): string[] {
  const index = ids.indexOf(id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= ids.length) return ids;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
