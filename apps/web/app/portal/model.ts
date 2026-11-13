/** Pure helpers of the customer portal (no React): formatting, which actions to offer, client-side checks.
 * The server makes every decision again; these only decide what the page shows. */
import { persianDate, toFa } from "../crm/utils";
import type { PortalQuote, PortalRequestDetail } from "./api/portal";

export const formatRial = (value: string | number | null | undefined) => {
  if (value === null || value === undefined || value === "") return "—";
  const digits = String(value).replace(/\D/g, "");
  return `${toFa(digits.replace(/\B(?=(\d{3})+(?!\d))/g, "٬"))} ریال`;
};

export const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${toFa((bytes / 1024 / 1024).toFixed(1))} مگابایت`
    : `${toFa(Math.max(1, Math.round(bytes / 1024)))} کیلوبایت`;

export const portalDate = (value: string | null | undefined, withTime = true) =>
  value ? persianDate(value, { year: "numeric", ...(withTime ? { hour: "2-digit" as const } : {}) }) : "—";

/** Tone of a customer-visible status label (only the company's allowed codes reach the client). */
export const statusTone = (code: string) =>
  ({
    submitted: "info",
    reviewing: "info",
    awaiting_customer: "warning",
    in_progress: "progress",
    done: "success",
    rejected: "danger",
  })[code] ?? "neutral";

export type QuoteAction = "approved" | "rejected" | "revision_requested";

export const QUOTE_ACTIONS: { id: QuoteAction; label: string; confirm: boolean }[] = [
  { id: "approved", label: "تأیید برآورد", confirm: true },
  { id: "revision_requested", label: "درخواست اصلاح", confirm: false },
  { id: "rejected", label: "رد برآورد", confirm: true },
];

/** Buttons offered on a quote card: only for a sent, still-valid version. */
export const quoteActions = (quote: Pick<PortalQuote, "status" | "can_decide">) =>
  quote.status.code === "sent" && quote.can_decide ? QUOTE_ACTIONS : [];

export const quoteDecisionErrors = (action: QuoteAction, comment: string) => {
  const errors: string[] = [];
  if (action === "revision_requested" && !comment.trim()) errors.push("برای درخواست اصلاح، توضیح بنویسید.");
  if (comment.length > 1000) errors.push("توضیح حداکثر ۱۰۰۰ نویسه است.");
  return errors;
};

export const CONFIRM_TEXT: Record<QuoteAction, string> = {
  approved: "با تأیید، این نسخهٔ برآورد قطعی می‌شود و دیگر قابل تغییر نیست. ادامه می‌دهید؟",
  rejected: "با رد، این نسخهٔ برآورد بسته می‌شود و تصمیم قابل بازگشت نیست. ادامه می‌دهید؟",
  revision_requested: "",
};

/** The feedback form appears only after the request is done (server flag) — or to edit within the window. */
export const feedbackMode = (detail: Pick<PortalRequestDetail, "can_feedback" | "feedback">) => {
  if (!detail.can_feedback) return "hidden" as const;
  if (!detail.feedback) return "new" as const;
  return detail.feedback.can_edit ? ("edit" as const) : ("locked" as const);
};

export const requestErrors = (subject: string, description: string) => {
  const errors: string[] = [];
  if (subject.trim().length < 3) errors.push("موضوع درخواست را (دست‌کم ۳ نویسه) بنویسید.");
  if (subject.length > 200) errors.push("موضوع حداکثر ۲۰۰ نویسه است.");
  if (description.trim().length < 10) errors.push("شرح درخواست را (دست‌کم ۱۰ نویسه) بنویسید.");
  if (description.length > 5000) errors.push("شرح حداکثر ۵۰۰۰ نویسه است.");
  return errors;
};

export interface FileRules {
  max_count: number;
  max_size: number;
  extensions: string[];
}

export const DEFAULT_FILE_RULES: FileRules = {
  max_count: 5,
  max_size: 5 * 1024 * 1024,
  extensions: ["pdf", "png", "jpg", "jpeg", "gif", "webp", "txt", "docx", "xlsx"],
};

/** Early, friendly checks; the server still reads the real content type and refuses mismatches. */
export const fileErrors = (files: { name: string; size: number }[], rules: FileRules = DEFAULT_FILE_RULES) => {
  const errors: string[] = [];
  if (files.length > rules.max_count) errors.push(`حداکثر ${toFa(rules.max_count)} فایل می‌توانید پیوست کنید.`);
  for (const file of files) {
    const extension = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
    if (!rules.extensions.includes(extension)) errors.push(`نوع فایل «${file.name}» مجاز نیست.`);
    else if (file.size > rules.max_size)
      errors.push(`حجم فایل «${file.name}» بیش از ${formatSize(rules.max_size)} است.`);
  }
  return errors;
};

export const acceptAttribute = (rules: FileRules = DEFAULT_FILE_RULES) =>
  rules.extensions.map((e) => `.${e}`).join(",");

export const RATING_LABELS = ["", "خیلی بد", "بد", "متوسط", "خوب", "عالی"];
