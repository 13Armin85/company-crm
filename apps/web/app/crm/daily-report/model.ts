/** Pure helpers of the daily report pages (ticket 8); no React, no network.
 * The server repeats every check; these only give early, clear feedback. */
import type { DayPayload, DayStatus, ItemKind, ReportItem, Suggestion } from "../api/reports";
import { toFa } from "../utils";

export const KINDS: { code: ItemKind; title: string; hint: string; placeholder: string }[] = [
  { code: "done", title: "انجام‌شده", hint: "کارهایی که امروز تمام شد", placeholder: "مثلاً: پاسخ به درخواست مشتری الف" },
  { code: "in_progress", title: "در حال انجام", hint: "کارهایی که ادامه دارد", placeholder: "مثلاً: بررسی گزارش خطا" },
  {
    code: "blocker",
    title: "مانع یا نیاز به کمک",
    hint: "چه چیزی جلوی کار را گرفته است؟",
    placeholder: "مثلاً: دسترسی به سرور آزمون ندارم",
  },
  { code: "next_step", title: "گام بعدی", hint: "برنامهٔ روز کاری بعد", placeholder: "مثلاً: آزمون نهایی و تحویل" },
];

export const PRESENCE_LABEL = "خوداظهاری — حضور تأییدشده نیست";
export const EFFORT_LABEL = "تخمین تلاش (نه ساعت کاری)";
export const FULL_LEAVE_TEXT = "روز تمام‌مرخصی — گزارش لازم نیست";

export const DAY_STATUS_TONES: Record<DayStatus, "success" | "warning" | "danger" | "neutral" | "info"> = {
  submitted: "success",
  late: "warning",
  draft: "info",
  missing: "danger",
  not_required: "neutral",
  off: "neutral",
  future: "neutral",
};

export const MAX_TEXT = 2000;

export const emptyItem = (kind: ItemKind, text = ""): ReportItem => ({
  kind,
  text,
  needs_help: false,
  issue: null,
  project: null,
  effort_minutes: null,
  source_kind: "",
  source_id: "",
});

/** Items of one kind in their saved order. */
export const itemsOf = (items: ReportItem[], kind: ItemKind) => items.filter((item) => item.kind === kind);

/** A kept suggestion becomes an ordinary line that remembers where it came from. */
export function itemFromSuggestion(suggestion: Suggestion, text = suggestion.text): ReportItem {
  return {
    ...emptyItem(suggestion.kind, text),
    issue: suggestion.issue ? { id: suggestion.issue.id, title: suggestion.issue.title, number: suggestion.issue.number } : null,
    source_kind: suggestion.source_kind,
    source_id: suggestion.source_id,
  };
}

/** Lines copied from the previous report keep their text and links but not their old source. */
export function itemsFromPrevious(items: ReportItem[]): ReportItem[] {
  return items
    .filter((item) => item.kind !== "done")
    .map((item) => ({
      ...item,
      id: undefined,
      kind: item.kind === "next_step" ? "in_progress" : item.kind,
      issue: item.issue?.hidden ? null : item.issue,
      source_kind: "previous",
    }));
}

/** Suggestions not yet kept in the form (matched by their source). */
export function pendingSuggestions(suggestions: Suggestion[], items: ReportItem[]): Suggestion[] {
  const used = new Set(items.filter((item) => item.source_kind).map((item) => `${item.source_kind}:${item.source_id}`));
  return suggestions.filter((suggestion) => !used.has(`${suggestion.source_kind}:${suggestion.source_id}`));
}

export function itemErrors(items: ReportItem[], submit: boolean): string[] {
  const errors: string[] = [];
  if (submit && !items.some((item) => item.text.trim())) errors.push("برای ثبت گزارش دست‌کم یک مورد بنویسید.");
  items.forEach((item, index) => {
    if (!item.text.trim()) errors.push(`متن مورد ${toFa(index + 1)} خالی است.`);
    if (item.text.length > MAX_TEXT) errors.push(`متن مورد ${toFa(index + 1)} بیش از ${toFa(MAX_TEXT)} نویسه است.`);
    if (item.effort_minutes !== null && (item.effort_minutes < 1 || item.effort_minutes > 1440))
      errors.push(`${EFFORT_LABEL} مورد ${toFa(index + 1)} باید بین ۱ و ۱۴۴۰ دقیقه باشد.`);
  });
  return errors;
}

/** The body the server accepts; links travel as ids only. */
export function savePayload(items: ReportItem[], day: DayPayload | undefined, submit: boolean) {
  return {
    submit,
    revision: day?.report?.revision,
    items: items
      .filter((item) => item.text.trim())
      .map((item) => ({
        kind: item.kind,
        text: item.text.trim(),
        needs_help: item.kind === "blocker" && item.needs_help,
        issue_id: item.issue?.id ?? null,
        project_id: item.project?.id ?? null,
        effort_minutes: item.effort_minutes,
        source_kind: item.source_kind,
        source_id: item.source_id,
      })) as unknown as ReportItem[],
  };
}

export function parseEffort(value: string): number | null {
  const digits = value.replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))).trim();
  if (!digits) return null;
  const number = Number(digits);
  return Number.isFinite(number) ? Math.round(number) : null;
}

export const sourceKindLabel = (kind: string) =>
  ({
    issue: "فعالیت روی تیکت",
    comment: "نظر",
    event: "رویداد تقویم",
    decision: "تصمیم گردش‌کار",
    activity: "فعالیت",
    previous: "از گزارش قبلی",
    template: "از قالب شخصی",
  })[kind] ?? "";

/** Is today's report still expected? Used for the header badge. */
export function dayBadge(day: DayPayload): { label: string; tone: "success" | "warning" | "danger" | "neutral" | "info" } {
  if (day.report?.status === "submitted")
    return day.report.is_late ? { label: "ثبت‌شده (دیرهنگام)", tone: "warning" } : { label: "ثبت‌شده", tone: "success" };
  if (day.requirement === "not_required") return { label: FULL_LEAVE_TEXT, tone: "neutral" };
  if (day.requirement === "off") return { label: "روز غیرکاری", tone: "neutral" };
  if (day.requirement === "future") return { label: "روز آینده", tone: "neutral" };
  return day.report ? { label: "پیش‌نویس", tone: "info" } : { label: "ثبت‌نشده", tone: "danger" };
}

export const shiftDate = (iso: string, days: number) => {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export const minutesText = (minutes: number | null) => {
  if (!minutes) return "";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours ? `${toFa(hours)} ساعت` : "", rest ? `${toFa(rest)} دقیقه` : ""].filter(Boolean).join(" و ");
};
