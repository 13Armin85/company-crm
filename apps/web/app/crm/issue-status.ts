import type { Status } from "./types";

/** Keep persisted state names and group keys intact; translate only their labels. */
export function stateNameFa(name: unknown): string {
  const label = String(name ?? "").trim();
  const normalized = label.replaceAll("_", " ");
  if (/^backlog$/i.test(normalized)) return "فهرست انتظار";
  if (/^(?:cancelled|canceled|cancceled)$/i.test(normalized)) return "لغوشده";
  if (/^(?:unstarted|to[\s-]?do)$/i.test(normalized)) return "برای انجام";
  if (/^(?:started|in[\s-]?progress)$/i.test(normalized)) return "در حال انجام";
  if (/^(?:in[\s-]?)?review$/i.test(normalized)) return "بازبینی";
  if (/^(?:done|completed)$/i.test(normalized)) return "انجام‌شده";
  if (/^blocked$/i.test(normalized)) return "مسدود";
  return label;
}

export function issueStatusFromState(group: unknown, name: unknown): Status {
  const category = String(group ?? "")
    .trim()
    .toLowerCase();
  const label = String(name ?? "");
  const review = /review|بازبینی/i.test(label);
  if (category === "backlog" || category === "unstarted") return "Todo";
  if (category === "started") return review ? "Review" : "In Progress";
  if (category === "completed") return "Done";
  // Ticket 5 (ن۶): cancelled closes the ticket — it belongs to the "done" category.
  if (category === "cancelled") return "Done";
  if (review) return "Review";
  if (/\b(?:unstarted|backlog|todo)\b|برای انجام|انجام[‌\s]*نشده/i.test(label)) return "Todo";
  if (/\b(?:started|progress)\b|فعال|جریان/i.test(label)) return "In Progress";
  if (/\b(?:completed|done)\b|تمام|تکمیل|انجام[‌\s]*شده/i.test(label)) return "Done";
  if (/\b(?:cancelled|canceled|cancceled|blocked)\b|مسدود|لغو/i.test(label)) return "Blocked";
  return "Todo";
}
