import type { NotificationItem } from "./types";
import { persianDate, toFa } from "./utils";

const priorityNames: Record<string, string> = {
  urgent: "فوری",
  high: "زیاد",
  medium: "متوسط",
  low: "کم",
  none: "بدون اولویت",
};
const stateNames: Record<string, string> = {
  backlog: "فهرست انتظار",
  todo: "برای انجام",
  unstarted: "برای انجام",
  notstarted: "برای انجام",
  started: "در حال انجام",
  inprogress: "در حال انجام",
  review: "بازبینی",
  inreview: "بازبینی",
  completed: "انجام‌شده",
  done: "انجام‌شده",
  cancelled: "لغوشده",
  canceled: "لغوشده",
  blocked: "مسدود",
};
const fieldNames: Record<string, string> = {
  name: "عنوان",
  description: "توضیحات",
  priority: "اولویت",
  state: "وضعیت",
  state_id: "وضعیت",
  target_date: "موعد انجام",
  start_date: "تاریخ شروع",
  assignees: "مسئول کار",
  assignee: "مسئول کار",
  labels: "برچسب",
  label: "برچسب",
  estimate_point: "برآورد",
  cycle: "چرخه",
  module: "بخش پروژه",
  link: "پیوند",
  attachment: "پیوست",
  reaction: "واکنش",
  vote: "رأی",
  relation: "ارتباط کارها",
  archived_at: "بایگانی کار",
  intake_status: "وضعیت بررسی درخواست",
};
const accountNames: Record<string, string> = {
  admin: "مدیر سامانه",
  administrator: "مدیر سامانه",
  system: "سامانه",
  plane: "سامانه",
  user: "کاربر",
  developer: "همکار توسعه‌دهنده",
};
const lookup = (names: Record<string, string>, key: string) => (Object.hasOwn(names, key) ? names[key] : undefined);
const persianLetters = /[آابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهیءؤإئأ]/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const name = (value: unknown): string | undefined => {
  const result = text(value).trim();
  return result && !uuid.test(result) && !["None", "null", "undefined"].includes(result) ? result : undefined;
};
const localizeTerms = (value: string) => value.replace(/\bCRM\b/gi, "مدیریت ارتباط با مشتری");
const actorName = (value: Record<string, unknown>): string | undefined => {
  const fullName = [name(value.first_name), name(value.last_name)].filter(Boolean).join(" ");
  const display = name(value.display_name);
  const preferred = fullName && persianLetters.test(fullName) ? fullName : display || fullName;
  return preferred ? lookup(accountNames, preferred.toLowerCase()) || preferred : undefined;
};
const isGeneratedEnglish = (value: string) =>
  /\b(?:updated (?:the |a )?(?:name|description|priority|state|target date|start date|estimate|cycle|draft|intake)|(?:created|deleted) (?:the |a )?(?:issue|comment|link|attachment)|(?:added|removed) (?:the |a )?(?:assignee|label|cycle|module|reaction|vote)|mentioned|archived the issue|restored the issue)\b/i.test(
    value
  );

function inferField(title: string): string {
  const normalized = title.toLowerCase();
  for (const [phrase, field] of [
    ["target date", "target_date"],
    ["start date", "start_date"],
    ["estimate", "estimate_point"],
    ["priority", "priority"],
    ["state", "state"],
    ["assignee", "assignees"],
    ["comment", "comment"],
    ["description", "description"],
    ["name", "name"],
    ["label", "labels"],
    ["cycle", "cycle"],
    ["module", "module"],
    ["attachment", "attachment"],
    ["link", "link"],
    ["reaction", "reaction"],
    ["vote", "vote"],
    ["relation", "relation"],
    ["archived", "archived_at"],
    ["restored", "archived_at"],
  ])
    if (normalized.includes(phrase)) return field;
  return "";
}

function changeValue(field: string, value: unknown, stateGroup?: string): string {
  const raw = typeof value === "number" ? String(value) : text(value).trim();
  const key = raw.toLowerCase().replace(/[\s_-]/g, "");
  if (field === "priority") return lookup(priorityNames, key) || (persianLetters.test(raw) ? raw : "نامشخص");
  if (["state", "state_id"].includes(field))
    return (
      lookup(stateNames, key) || (persianLetters.test(raw) ? raw : lookup(stateNames, stateGroup || "") || "نامشخص")
    );
  if (!raw || ["None", "null"].includes(raw)) return "ثبت نشده";
  if (["target_date", "start_date"].includes(field))
    return /^\d{4}-\d{2}-\d{2}/.test(raw) ? persianDate(raw, { year: "numeric" }) : "نامشخص";
  if (field === "estimate_point") return /^\d+(?:\.\d+)?$/.test(raw) ? toFa(raw) : "نامشخص";
  if (uuid.test(raw) || raw.startsWith("[") || raw.startsWith("{")) return "نامشخص";
  return ["assignees", "assignee"].includes(field)
    ? lookup(accountNames, raw.toLowerCase()) || raw
    : localizeTerms(raw);
}

export function presentNotification(item: Record<string, unknown>): NotificationItem {
  const data = record(item.data);
  const issue = record(data.issue);
  const activity = record(data.issue_activity);
  const sender = text(item.sender).toLowerCase();
  const crmEvent = record(data.crm_event);
  const login = sender === "crm:login" && crmEvent.kind === "login";
  const queued = sender === "crm:routing:queued" && crmEvent.kind === "queued";
  const claimed = sender === "crm:routing:claimed" && crmEvent.kind === "claimed";
  const rawTitle = text(item.title);
  const field = name(activity.field) || (isGeneratedEnglish(rawTitle) ? inferField(rawTitle) : "");
  const verb =
    name(activity.verb) ||
    (rawTitle.toLowerCase().includes("deleted")
      ? "deleted"
      : rawTitle.toLowerCase().includes("created")
        ? "created"
        : "updated");
  const isMention =
    Boolean(item.is_mentioned_notification) || sender.includes("mentioned") || /mentioned/i.test(rawTitle);
  const isComment = field === "comment" || sender.includes("comment");
  const isAssignment = ["assignee", "assignees"].includes(field) || (!field && sender.includes("assigned"));
  const type: NotificationItem["type"] = login
    ? "security"
    : isMention
      ? "mention"
      : isComment
        ? "comment"
        : isAssignment
          ? "assignment"
          : "update";
  const actor = actorName(record(item.triggered_by_details));
  const entityName = name(issue.name) || name(item.entity_title);
  const projectName = name(item.project_name);
  const subject = entityName
    ? `کار «${localizeTerms(entityName)}»`
    : item.entity_name === "project"
      ? "این پروژه"
      : "این کار";
  const who = actor || "یکی از همکاران";
  const removed =
    verb === "deleted" ||
    /\bremoved\b/i.test(rawTitle) ||
    (["assignees", "assignee", "labels", "label", "cycle", "module", "link", "attachment"].includes(field) &&
      !name(activity.new_value) &&
      Boolean(name(activity.old_value)));
  let eventLabel = item.entity_name === "project" ? "به‌روزرسانی پروژه" : "به‌روزرسانی کار";
  let description = `${who} اطلاعات ${subject} را به‌روزرسانی کرد.`;
  const changes: NonNullable<NotificationItem["changes"]> = [];

  if (login) {
    eventLabel = "ورود تازه به حساب شما";
    const browser = text(crmEvent.browser),
      device = text(crmEvent.device);
    description =
      browser && device && persianLetters.test(browser) && persianLetters.test(device)
        ? `ورود موفق به حساب شما با ${browser} در ${device} ثبت شد.`
        : "ورود موفق به حساب شما ثبت شد.";
  } else if (queued) {
    eventLabel = "کار جدید در صف نقش شما";
    description = `${subject} در صف نقش شما آمادهٔ پذیرش است.`;
  } else if (claimed) {
    eventLabel = "پذیرش کار از صف";
    description = `${who} ${subject} را از صف پذیرفت و مسئولیت آن را بر عهده گرفت.`;
  } else if (isMention) {
    eventLabel = "اشاره به شما";
    description = `${who} ${isComment ? "در یک نظر دربارهٔ" : "در"} ${subject} از شما نام برد.`;
  } else if (isComment) {
    eventLabel = verb === "deleted" ? "حذف نظر" : verb === "updated" && field === "comment" ? "ویرایش نظر" : "نظر جدید";
    description =
      verb === "deleted"
        ? `${who} یک نظر دربارهٔ ${subject} را حذف کرد.`
        : verb === "updated" && field === "comment"
          ? `${who} نظر خود دربارهٔ ${subject} را ویرایش کرد.`
          : `${who} برای ${subject} نظر جدیدی ثبت کرد.`;
  } else if (isAssignment) {
    eventLabel = removed ? "لغو مسئولیت کار" : "واگذاری کار";
    const assignee = changeValue(field || "assignees", removed ? activity.old_value : activity.new_value);
    const toYou = !removed && activity.new_identifier === item.receiver && Boolean(item.receiver);
    description = removed
      ? `${who} مسئولیت ${subject} را از ${assignee} برداشت.`
      : `${who} ${subject} را ${toYou ? "به شما" : assignee !== "نامشخص" && assignee !== "ثبت نشده" ? `به ${assignee}` : "به یکی از همکاران"} واگذار کرد.`;
    if (assignee !== "نامشخص" && assignee !== "ثبت نشده")
      changes.push({ label: removed ? "مسئول قبلی" : "مسئول جدید", value: toYou ? "شما" : assignee });
  } else if (field === "archived_at") {
    const restored = activity.new_value === "restore" || /restored/i.test(rawTitle);
    eventLabel = restored ? "بازگرداندن کار از بایگانی" : "بایگانی کار";
    description = `${who} ${subject} را ${restored ? "از بایگانی بازگرداند" : "بایگانی کرد"}.`;
  } else if (Object.hasOwn(fieldNames, field)) {
    const label = fieldNames[field];
    eventLabel = `تغییر ${label}`;
    description = `${who} ${label} ${subject} را تغییر داد.`;
    if (["state", "state_id", "priority", "target_date", "start_date", "estimate_point", "name"].includes(field)) {
      if (Object.hasOwn(activity, "old_value"))
        changes.push({ label: `${label} قبلی`, value: changeValue(field, activity.old_value) });
      if (Object.hasOwn(activity, "new_value"))
        changes.push({
          label: `${label} جدید`,
          value: changeValue(field, activity.new_value, text(issue.state_group)),
        });
      if (changes.length === 2)
        description = `${who} ${label} ${subject} را از «${changes[0].value}» به «${changes[1].value}» تغییر داد.`;
    } else if (["labels", "label", "cycle", "module", "link", "attachment"].includes(field)) {
      eventLabel = `${removed ? "حذف" : "افزودن"} ${label}`;
      description = `${who} یک ${label} را ${removed ? "از" : "به"} ${subject} ${removed ? "حذف" : "اضافه"} کرد.`;
    }
  } else if (verb === "created") {
    eventLabel = "کار جدید";
    description = `${who} ${subject} را ایجاد کرد.`;
  } else if (verb === "deleted") {
    eventLabel = "حذف کار";
    description = `${who} ${subject} را حذف کرد.`;
  }

  const rawMessage = text(item.message_text) || text(item.message_stripped) || text(item.message);
  const structured =
    login ||
    queued ||
    claimed ||
    Object.keys(activity).length > 0 ||
    isGeneratedEnglish(rawTitle) ||
    sender.startsWith("in_app:issue_activities");
  const title = !structured && persianLetters.test(rawTitle) ? localizeTerms(rawTitle) : eventLabel;
  const comment =
    name(activity.issue_comment) ||
    (isComment && rawMessage && !isGeneratedEnglish(rawMessage) ? rawMessage : undefined);
  if (isComment && comment && structured) description += `\n\n${comment}`;
  else if (
    !structured &&
    rawMessage &&
    !isGeneratedEnglish(rawMessage) &&
    (persianLetters.test(rawMessage) || isComment)
  )
    description = localizeTerms(rawMessage);
  const preview = Array.from(description.replace(/\s+/g, " ").trim());
  return {
    id: String(item.id),
    title,
    description,
    preview: preview.length > 180 ? preview.slice(0, 180).join("") + "…" : preview.join(""),
    time: item.created_at ? String(item.created_at) : "",
    read: Boolean(item.read_at),
    type,
    actor,
    eventLabel,
    projectId: typeof item.project === "string" ? item.project : undefined,
    entityId: typeof item.entity_identifier === "string" ? item.entity_identifier : undefined,
    projectName: projectName ? localizeTerms(projectName) : undefined,
    entityName: !login && entityName ? localizeTerms(entityName) : undefined,
    changes: changes.length ? changes : undefined,
    actionHref: login
      ? "/settings?section=profile"
      : queued
        ? "/routing"
        : item.entity_name === "workspace_task"
          ? "/my-work"
          : undefined,
    actionLabel: login
      ? "مشاهده حساب کاربری"
      : queued
        ? "مشاهده صف کارها"
        : item.entity_name === "workspace_task"
          ? "مشاهده کارهای من"
          : undefined,
  };
}
