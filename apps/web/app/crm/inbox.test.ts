import { describe, expect, it } from "vitest";
import { mapNotification } from "./api";

describe("notification presentation", () => {
  it("distinguishes a priority update sent to an assignee from a new assignment", () => {
    const item = mapNotification({
      id: "assigned-update",
      sender: "in_app:issue_activities:assigned",
      data: {
        issue: { name: "درخواست" },
        issue_activity: { field: "priority", verb: "updated", old_value: "high", new_value: "urgent" },
      },
    });
    expect(item.type).toBe("update");
    expect(item.title).toBe("تغییر اولویت");
    expect(item.description).toContain("از «زیاد» به «فوری»");
  });
  it("presents successful logins as account events with a useful destination", () => {
    const item = mapNotification({
      id: "login",
      entity_name: "account",
      sender: "crm:login",
      data: {
        crm_event: { kind: "login", browser: "کروم", device: "ویندوز" },
      },
    });
    expect(item.type).toBe("security");
    expect(item.title).toBe("ورود تازه به حساب شما");
    expect(item.description).toBe("ورود موفق به حساب شما با کروم در ویندوز ثبت شد.");
    expect(item.entityName).toBeUndefined();
    expect(item.actionHref).toBe("/settings?section=profile");
  });
  it("links standalone task events to the user's work", () => {
    const item = mapNotification({
      id: "task",
      entity_name: "workspace_task",
      sender: "crm:workspace_task",
      receiver: "user-1",
      data: {
        issue: { name: "پیگیری مشتری" },
        issue_activity: { field: "assignees", new_identifier: "user-1", new_value: "سارا", verb: "updated" },
      },
    });
    expect(item.description).toContain("به شما واگذار کرد");
    expect(item.actionHref).toBe("/my-work");
    expect(item.actionLabel).toBe("مشاهده کارهای من");
  });
  it("makes role queue arrivals actionable and claims clear", () => {
    const queued = mapNotification({
      id: "queue",
      sender: "crm:routing:queued",
      data: { issue: { name: "درخواست" }, crm_event: { kind: "queued" } },
    });
    expect(queued.title).toBe("کار جدید در صف نقش شما");
    expect(queued.actionHref).toBe("/routing");
    const claimed = mapNotification({
      id: "claimed",
      sender: "crm:routing:claimed",
      triggered_by_details: { display_name: "سارا" },
      data: { issue: { name: "درخواست" }, crm_event: { kind: "claimed" } },
    });
    expect(claimed.description).toContain("سارا کار «درخواست» را از صف پذیرفت");
  });
  const changed = (field: string, oldValue: unknown, newValue: unknown, values: Record<string, unknown> = {}) =>
    mapNotification({
      id: "notice-localized",
      sender: "in_app:issue_activities",
      title: `updated the ${field} to`,
      triggered_by_details: { display_name: "admin" },
      project_name: "توسعه محصول CRM",
      receiver: "receiver-1",
      data: {
        issue: { name: "بررسی درخواست مشتری", state_group: "started" },
        issue_activity: { field, verb: "updated", old_value: oldValue, new_value: newValue },
      },
      ...values,
    });

  it("explains priority changes with the actor, task and Persian values", () => {
    const item = changed("priority", "high", "urgent");
    expect(item.title).toBe("تغییر اولویت");
    expect(item.description).toBe("مدیر سامانه اولویت کار «بررسی درخواست مشتری» را از «زیاد» به «فوری» تغییر داد.");
    expect(item.actor).toBe("مدیر سامانه");
    expect(item.projectName).toBe("توسعه محصول مدیریت ارتباط با مشتری");
    expect(item.entityName).toBe("بررسی درخواست مشتری");
    expect(item.changes).toEqual([
      { label: "اولویت قبلی", value: "زیاد" },
      { label: "اولویت جدید", value: "فوری" },
    ]);
    expect(item.description).not.toMatch(/updated|high|urgent|admin/);
  });

  it.each([
    ["Todo", "In Progress", "برای انجام", "در حال انجام"],
    ["started", "completed", "در حال انجام", "انجام‌شده"],
    ["نام قبلی فارسی", "مرحله جدید", "نام قبلی فارسی", "مرحله جدید"],
  ])("localizes state values %s and %s", (oldValue, newValue, oldLabel, newLabel) => {
    const item = changed("state", oldValue, newValue);
    expect(item.changes?.map((change) => change.value)).toEqual([oldLabel, newLabel]);
    expect(item.description).not.toContain("updated the state");
  });

  it("uses Persian names instead of account usernames and keeps legacy Persian notices useful", () => {
    const item = mapNotification({
      id: "old",
      title: "به‌روزرسانی محصول",
      message_stripped: "یک فعالیت جدید در پروژه CRM ثبت شد.",
      project_name: "توسعه محصول CRM",
      entity_title: "درخواست خرید",
      triggered_by_details: { display_name: "user-42", first_name: "سارا", last_name: "احمدی" },
    });
    expect(item.actor).toBe("سارا احمدی");
    expect(item.title).toBe("به‌روزرسانی محصول");
    expect(item.description).toBe("یک فعالیت جدید در پروژه مدیریت ارتباط با مشتری ثبت شد.");
    expect(item.entityName).toBe("درخواست خرید");
  });

  it("includes the complete comment below its localized event", () => {
    const comment = "جزئیات بررسی درخواست\n".repeat(200);
    const item = changed("comment", "", "", {
      data: {
        issue: { name: "درخواست پشتیبانی" },
        issue_activity: { field: "comment", verb: "created", issue_comment: comment },
      },
    });
    expect(item.type).toBe("comment");
    expect(item.title).toBe("نظر جدید");
    expect(item.description).toContain("برای کار «درخواست پشتیبانی» نظر جدیدی ثبت کرد.");
    expect(item.description).toContain(comment.trim());
    expect(item.preview!.length).toBeLessThanOrEqual(181);
  });

  it("keeps full message text when a structured comment has no snapshot text", () => {
    const item = changed("comment", "", "", {
      message_text: "متن کامل نظر",
      data: { issue_activity: { field: "comment", verb: "created" } },
    });
    expect(item.description).toContain("متن کامل نظر");
  });

  it("makes mentions and assignments personal to the receiver", () => {
    const mention = changed("comment", "", "", { sender: "in_app:issue_activities:mentioned" });
    expect(mention.title).toBe("اشاره به شما");
    expect(mention.description).toContain("از شما نام برد");
    const assigned = changed("assignees", "", "user", {
      data: {
        issue: { name: "درخواست مشتری" },
        issue_activity: {
          field: "assignees",
          verb: "updated",
          old_value: "",
          new_value: "user",
          new_identifier: "receiver-1",
        },
      },
    });
    expect(assigned.type).toBe("assignment");
    expect(assigned.description).toContain("به شما واگذار کرد");
    expect(assigned.changes).toEqual([{ label: "مسئول جدید", value: "شما" }]);
  });

  it("distinguishes removals from additions", () => {
    const removed = changed("assignees", "سارا احمدی", "");
    expect(removed.title).toBe("لغو مسئولیت کار");
    expect(removed.description).toContain("از سارا احمدی برداشت");
    expect(changed("labels", "اشکال", "", { title: "removed label" }).title).toBe("حذف برچسب");
  });

  it("uses Persian dates and numbers in change details", () => {
    expect(changed("target_date", "2024-03-19", "2024-03-20").changes?.[1].value).toBe("۱ فروردین ۱۴۰۳");
    expect(changed("estimate_point", 3, 5).changes?.[1].value).toBe("۵");
  });

  it("does not expose unknown internal event names, JSON or identifiers", () => {
    const identifier = "a13d11c1-03f6-4e10-baf3-677e93eec05f";
    const item = changed(
      "constructor",
      identifier,
      { internal: identifier },
      {
        title: "internal_schema_update",
        message_text: identifier,
        data: { issue_activity: { field: "constructor", verb: "updated", new_value: identifier } },
        triggered_by_details: { display_name: identifier },
      }
    );
    expect(item.title).toBe("به‌روزرسانی کار");
    expect(item.description).not.toMatch(/constructor|internal_schema|a13d11c1|\[object Object\]/);
    expect(item.actor).toBeUndefined();
    expect(item.changes).toBeUndefined();
  });

  it("can present old generated English titles without structured metadata", () => {
    const item = mapNotification({
      id: "legacy",
      title: "You have been mentioned in the issue درخواست مشتری",
      message_text: "You have been mentioned in the issue درخواست مشتری",
      entity_title: "درخواست مشتری",
      sender: "mentioned",
    });
    expect(item.title).toBe("اشاره به شما");
    expect(item.description).toContain("درخواست مشتری");
    expect(item.description).not.toMatch(/You|mentioned|issue/);
  });

  it("preserves the full notification text and actor instead of a shortened preview", () => {
    const full = "متن کامل اعلان\n".repeat(300);
    const item = mapNotification({
      id: "notice-1",
      title: "اعلان",
      message_stripped: "خلاصه",
      message_text: full,
      triggered_by_details: { display_name: "همکار" },
      project: "project-1",
      entity_identifier: "issue-1",
      created_at: "2026-10-11T09:00:00Z",
      read_at: null,
    });
    expect(item.description).toBe(full);
    expect(item.actor).toBe("همکار");
    expect(item.projectId).toBe("project-1");
    expect(item.entityId).toBe("issue-1");
    expect(item.read).toBe(false);
  });
  it.each([
    ["mentioned", "mention"],
    ["issue_comment", "comment"],
    ["issue_assigned", "assignment"],
    ["updated", "update"],
  ])("recognizes %s notifications", (sender, type) => {
    expect(mapNotification({ id: "notice-2", sender, read_at: "2026-10-11T09:00:00Z" }).type).toBe(type);
    expect(mapNotification({ id: "notice-2", read_at: "2026-10-11T09:00:00Z" }).read).toBe(true);
  });
  it("falls back to existing plain text and handles missing optional metadata", () => {
    const item = mapNotification({ id: "notice-3", message_text: "", message_stripped: "متن قبلی", project: null });
    expect(item.description).toBe("متن قبلی");
    expect(item.projectId).toBeUndefined();
    expect(item.actor).toBeUndefined();
    expect(item.read).toBe(false);
  });
});
