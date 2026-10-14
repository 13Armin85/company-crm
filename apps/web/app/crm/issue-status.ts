import type { Status } from "./types";

export function issueStatusFromState(group: unknown, name: unknown): Status {
  const category = String(group ?? "")
    .trim()
    .toLowerCase();
  const label = String(name ?? "");
  const review = /review|بازبینی/i.test(label);
  if (category === "backlog" || category === "unstarted") return "Todo";
  if (category === "started") return review ? "Review" : "In Progress";
  if (category === "completed") return "Done";
  if (category === "cancelled") return "Blocked";
  if (review) return "Review";
  if (/\b(?:unstarted|backlog|todo)\b|برای انجام|انجام[‌\s]*نشده/i.test(label)) return "Todo";
  if (/\b(?:started|progress)\b|فعال|جریان/i.test(label)) return "In Progress";
  if (/\b(?:completed|done)\b|تمام|تکمیل|انجام[‌\s]*شده/i.test(label)) return "Done";
  if (/\b(?:cancelled|blocked)\b|مسدود|لغو/i.test(label)) return "Blocked";
  return "Todo";
}
