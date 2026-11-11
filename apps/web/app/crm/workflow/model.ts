/** Pure helpers of the workflow designer and record panel; no React, no network. */
import type {
  InstanceActions,
  StepRunView,
  StepType,
  ValidationIssue,
  WorkflowGraph,
  WorkflowStep,
  WorkflowTransition,
} from "../api/workflow";

const digits = (value: number | string) => String(value).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

export const STEP_TYPE_LABELS: Record<StepType, string> = {
  start: "شروع",
  normal: "عادی",
  approval: "تأیید",
  end: "پایان",
};

export function splitMinutes(total?: number | null) {
  const value = Math.max(0, Math.round(total || 0));
  return { hours: Math.floor(value / 60), minutes: value % 60 };
}

export function joinMinutes(hours: number, minutes: number): number | null {
  const total = Math.max(0, Math.round(hours || 0)) * 60 + Math.max(0, Math.round(minutes || 0));
  return total > 0 ? total : null;
}

export function formatWorkingMinutes(total?: number | null) {
  if (total === null || total === undefined) return "";
  const { hours, minutes } = splitMinutes(total);
  const parts = [
    ...(hours ? [`${digits(hours)} ساعت`] : []),
    ...(minutes || !hours ? [`${digits(minutes)} دقیقه`] : []),
  ];
  return `${parts.join(" و ")} کاری`;
}

/** Labels shown next to the deadline of the current step. */
export function deadlineBadges(run: StepRunView | null | undefined) {
  if (!run || !run.target_at) return [];
  const badges: { id: string; label: string; tone: "warning" | "danger" | "muted" }[] = [];
  if (run.paused) badges.push({ id: "paused", label: "متوقف", tone: "muted" });
  if (run.overdue) badges.push({ id: "overdue", label: "دیرکرد", tone: "danger" });
  else if (run.near_due) badges.push({ id: "near_due", label: "نزدیک موعد", tone: "warning" });
  return badges;
}

/** Which action groups the panel renders. Only server-granted actions ever appear. */
export function visibleActions(actions: InstanceActions | undefined) {
  if (!actions) return [];
  const result: string[] = [];
  if (actions.transitions.length) result.push("transitions");
  if (actions.can_contact_resolve) result.push("contact");
  if (actions.can_to_standard) result.push("to_standard");
  if (actions.can_pause) result.push("pause");
  if (actions.can_resume) result.push("resume");
  if (actions.can_report_delay) result.push("delay");
  if (actions.can_request_extension) result.push("extension");
  if (actions.can_decide_extension) result.push("decide_extension");
  if (actions.can_reassign) result.push("reassign");
  if (actions.can_migrate) result.push("migrate");
  return result;
}

export function reasonError(text: string, required: boolean) {
  if (!required) return "";
  return text.trim() ? "" : "ثبت دلیل الزامی است.";
}

export function delayReportErrors(input: { reason: string; progress: string; expected_at: string }, now = Date.now()) {
  return [
    ...(input.reason.trim() ? [] : ["دلیل دیرکرد را بنویسید."]),
    ...(input.progress.trim() ? [] : ["وضعیت پیشرفت کار را بنویسید."]),
    ...(input.expected_at ? [] : ["زمان مورد انتظار برای پایان را انتخاب کنید."]),
    ...(input.expected_at && Date.parse(input.expected_at) <= now ? ["زمان مورد انتظار باید در آینده باشد."] : []),
  ];
}

export function extensionErrors(
  input: { mode: "minutes" | "moment"; hours: number; minutes: number; target_at: string; reason: string },
  current?: string | null
) {
  const errors: string[] = [];
  if (input.mode === "minutes" && !joinMinutes(input.hours, input.minutes)) errors.push("مدت تمدید را وارد کنید.");
  if (input.mode === "moment") {
    if (!input.target_at) errors.push("مهلت جدید را انتخاب کنید.");
    else if (current && Date.parse(input.target_at) <= Date.parse(current))
      errors.push("مهلت جدید باید بعد از مهلت فعلی باشد.");
  }
  if (!input.reason.trim()) errors.push("دلیل تمدید را بنویسید.");
  return errors;
}

export function contactErrors(
  input: { channel: string; contact_name: string; contact_at: string; summary: string; outcome: string },
  now = Date.now()
) {
  return [
    ...(input.channel ? [] : ["کانال تماس را انتخاب کنید."]),
    ...(input.contact_name.trim() ? [] : ["نام مخاطب را بنویسید."]),
    ...(input.contact_at ? [] : ["زمان تماس را انتخاب کنید."]),
    ...(input.contact_at && Date.parse(input.contact_at) > now ? ["زمان تماس نمی‌تواند در آینده باشد."] : []),
    ...(input.summary.trim() ? [] : ["خلاصهٔ گفتگو را بنویسید."]),
    ...(input.outcome.trim() ? [] : ["نتیجهٔ تماس را بنویسید."]),
  ];
}

export function uniqueCode(prefix: string, taken: string[]) {
  let index = taken.length + 1;
  while (taken.includes(`${prefix}${index}`)) index += 1;
  return `${prefix}${index}`;
}

export function newStep(graph: WorkflowGraph, type: StepType = "normal", status = ""): WorkflowStep {
  return {
    code: uniqueCode(
      "step_",
      graph.steps.map((step) => step.code)
    ),
    title: type === "approval" ? "تأیید" : "مرحلهٔ جدید",
    type,
    status_code: status,
    assignee: { type: type === "approval" ? "direct_manager" : type === "end" ? "none" : "subject" },
    target_minutes: null,
    required_fields: [],
    editable_fields: [],
    pause: {},
  };
}

export function newTransition(graph: WorkflowGraph, from: string, to: string): WorkflowTransition {
  return {
    code: uniqueCode(
      "move_",
      graph.transitions.map((row) => row.code)
    ),
    from,
    to,
    kind: "advance",
    label: "ادامه",
  };
}

/** Rename a step code everywhere it is referenced. */
export function renameStep(graph: WorkflowGraph, from: string, to: string): WorkflowGraph {
  return {
    steps: graph.steps.map((step) => (step.code === from ? { ...step, code: to } : step)),
    transitions: graph.transitions.map((row) => ({
      ...row,
      from: row.from === from ? to : row.from,
      to: row.to === from ? to : row.to,
    })),
  };
}

export function removeStep(graph: WorkflowGraph, code: string): WorkflowGraph {
  return {
    steps: graph.steps.filter((step) => step.code !== code),
    transitions: graph.transitions.filter((row) => row.from !== code && row.to !== code),
  };
}

/**
 * Instant checks while editing; the server's «بررسی» report is authoritative and
 * also checks statuses, fields, roles and conditions.
 */
export function localIssues(graph: WorkflowGraph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const codes = graph.steps.map((step) => step.code);
  const starts = graph.steps.filter((step) => step.type === "start");
  if (starts.length !== 1)
    issues.push({ step: null, transition: null, message: "گردش‌کار باید دقیقاً یک مرحلهٔ شروع داشته باشد." });
  if (!graph.steps.some((step) => step.type === "end"))
    issues.push({ step: null, transition: null, message: "گردش‌کار دست‌کم یک مرحلهٔ پایان لازم دارد." });
  for (const step of graph.steps) {
    if (!step.code.trim()) issues.push({ step: step.code, transition: null, message: "هر مرحله باید کد داشته باشد." });
    if (codes.filter((code) => code === step.code).length > 1)
      issues.push({ step: step.code, transition: null, message: `کد مرحلهٔ «${step.code}» تکراری است.` });
    if (step.type !== "end" && !graph.transitions.some((row) => row.from === step.code))
      issues.push({
        step: step.code,
        transition: null,
        message: `مرحلهٔ «${step.title || step.code}» انتقال خروجی ندارد و فرایند در آن گیر می‌کند.`,
      });
    if (step.target_minutes !== null && step.target_minutes !== undefined && step.target_minutes <= 0)
      issues.push({ step: step.code, transition: null, message: `مدت هدف مرحلهٔ «${step.title}» باید مثبت باشد.` });
  }
  for (const row of graph.transitions) {
    if (!codes.includes(row.from) || !codes.includes(row.to))
      issues.push({
        step: null,
        transition: row.code,
        message: `مبدأ یا مقصد انتقال «${row.label || row.code}» مرحلهٔ موجودی نیست.`,
      });
    if (row.auto && (row.kind === "reject" || row.kind === "return"))
      issues.push({
        step: null,
        transition: row.code,
        message: `انتقال «${row.label || row.code}» دلیل لازم دارد و نمی‌تواند خودکار باشد.`,
      });
  }
  return issues;
}

export const issuesForStep = (issues: ValidationIssue[], code: string) => issues.filter((row) => row.step === code);
export const issuesForTransition = (issues: ValidationIssue[], code: string) =>
  issues.filter((row) => row.transition === code);
export const generalIssues = (issues: ValidationIssue[]) => issues.filter((row) => !row.step && !row.transition);

/** Steps in reading order: breadth-first from the start step, then any unreachable ones. */
export function orderedPath(graph: WorkflowGraph) {
  const start = graph.steps.find((step) => step.type === "start");
  const seen: string[] = [];
  const queue = start ? [start.code] : [];
  while (queue.length) {
    const code = queue.shift()!;
    if (seen.includes(code)) continue;
    seen.push(code);
    for (const row of graph.transitions)
      if (row.from === code && row.kind !== "return" && !seen.includes(row.to)) queue.push(row.to);
  }
  return [
    ...seen.map((code) => graph.steps.find((step) => step.code === code)!).filter(Boolean),
    ...graph.steps.filter((step) => !seen.includes(step.code)),
  ];
}

export const TIMELINE_LABELS: Record<string, string> = {
  start: "شروع فرایند",
  advance: "ادامه",
  approve: "تأیید",
  reject: "رد",
  return: "بازگشت برای اصلاح",
  refer: "ارجاع",
  end: "پایان",
  auto: "انتقال خودکار",
  reassign: "ارجاع مدیریتی",
  pause: "توقف",
  resume: "ازسرگیری",
  delay_report: "گزارش دیرکرد",
  extension: "درخواست تمدید",
  extension_approved: "تأیید تمدید",
  extension_rejected: "رد تمدید",
  to_standard: "انتقال به مسیر عادی",
  migrate: "انتقال به نسخهٔ دیگر",
  error: "خطای گردش‌کار",
  remind: "یادآوری مهلت",
};

export const versionLabel = (number: number) => `نسخهٔ ${digits(number)}`;
export { digits as persianDigits };
