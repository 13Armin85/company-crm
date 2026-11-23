import { describe, expect, it } from "vitest";
import { auditEventTitle, auditFieldTitle, auditValue } from "./audit-presentation";

describe("audit presentation", () => {
  it("shows readable Persian labels and values", () => {
    expect(auditFieldTitle("ticket_assignees")).toBe("گیرندگان");
    expect(auditValue("in_progress", "status")).toBe("در حال انجام");
    expect(auditValue("<p>شرح &amp; توضیح</p>", "description")).toBe("شرح & توضیح");
    expect(auditValue("cb7145c9-c6e6-41b6-8bc2-0d1ba43bc23e", "assignee")).toBe("گیرنده ثبت شده");
    expect(auditValue("cb۷۱۴۵c۹-c۶e۶-۴۱b۶-۸bc۲-۰d۱ba۴۳bc۲۳e", "assignee")).toBe("گیرنده ثبت شده");
    expect(auditValue({ title: "<b>کار تازه</b>", status: "todo", id: "cb7145c9-c6e6-41b6-8bc2-0d1ba43bc23e" })).toBe(
      "عنوان: کار تازه، وضعیت: برای انجام"
    );
    expect(
      auditEventTitle({
        id: "1",
        type: "record.field_changed",
        field: "priority",
        before: "low",
        after: "high",
        actor: "علی",
        at: "2026-11-23T09:00:00Z",
        metadata: {},
      })
    ).toBe("تغییر اولویت");
  });
});
