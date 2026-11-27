export type ActivityKind = "support" | "phone";

export interface SupportActivity {
  id: string;
  customer: { id: string; title: string };
  issue: { id: string; title: string } | null;
  supporter: { id: string; name: string };
  kind: ActivityKind;
  kind_label: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  summary: string;
  confirmed_at: string;
  revision: number;
}

export interface ActivityDraft {
  id?: string;
  revision?: number;
  customerId: string;
  customerTitle: string;
  issueId: string;
  issueTitle: string;
  kind: ActivityKind;
  startsAt: string;
  endsAt: string;
  summary: string;
  reason: string;
  confirmed: boolean;
}

export const newDraft = (): ActivityDraft => ({
  customerId: "",
  customerTitle: "",
  issueId: "",
  issueTitle: "",
  kind: "support",
  startsAt: "",
  endsAt: "",
  summary: "",
  reason: "",
  confirmed: false,
});

const twoDigits = (number: number) => String(number).padStart(2, "0");

export function localInput(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}T${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
}

export function editDraft(row: SupportActivity): ActivityDraft {
  return {
    id: row.id,
    revision: row.revision,
    customerId: row.customer.id,
    customerTitle: row.customer.title,
    issueId: row.issue?.id ?? "",
    issueTitle: row.issue?.title ?? "",
    kind: row.kind,
    startsAt: localInput(row.starts_at),
    endsAt: localInput(row.ends_at),
    summary: row.summary,
    reason: "",
    confirmed: false,
  };
}

export function draftError(draft: ActivityDraft): string | null {
  if (!draft.customerId) return "مشتری را انتخاب کنید.";
  if (!draft.startsAt || !draft.endsAt) return "ساعت شروع و پایان را وارد کنید.";
  const start = new Date(draft.startsAt);
  const end = new Date(draft.endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start)
    return "پایان فعالیت باید پس از شروع آن باشد.";
  if (end.getTime() - start.getTime() > 24 * 60 * 60 * 1000) return "بازهٔ فعالیت نمی‌تواند بیش از ۲۴ ساعت باشد.";
  if (end > new Date()) return "فعالیت آینده را نمی‌توان انجام‌شده ثبت کرد.";
  if (draft.id && !draft.reason.trim()) return "دلیل اصلاح فعالیت را بنویسید.";
  if (!draft.confirmed) return "زمان واقعی فعالیت را بررسی و ثبت آن را تأیید کنید.";
  return null;
}

export function draftPayload(draft: ActivityDraft) {
  return {
    customer_id: draft.customerId,
    issue_id: draft.issueId || null,
    kind: draft.kind,
    starts_at: new Date(draft.startsAt).toISOString(),
    ends_at: new Date(draft.endsAt).toISOString(),
    summary: draft.summary.trim(),
    confirm: draft.confirmed,
    ...(draft.id ? { revision: draft.revision, reason: draft.reason.trim() } : {}),
  };
}
