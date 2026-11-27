import { describe, expect, it } from "vitest";
import { draftError, draftPayload, editDraft, newDraft } from "./model";

const complete = () => ({
  ...newDraft(),
  customerId: "customer-1",
  startsAt: "2025-11-16T08:00",
  endsAt: "2025-11-16T09:00",
  confirmed: true,
});

describe("support activity confirmation", () => {
  it("requires a customer, valid real interval and explicit confirmation", () => {
    expect(draftError(newDraft())).toContain("مشتری");
    expect(draftError({ ...complete(), endsAt: "2025-11-16T07:00" })).toContain("پس از شروع");
    expect(draftError({ ...complete(), confirmed: false })).toContain("تأیید");
    expect(draftError(complete())).toBeNull();
  });

  it("sends the user's entered instants and requires a reason for a correction", () => {
    const draft = complete();
    expect(draftPayload(draft)).toMatchObject({
      customer_id: "customer-1",
      kind: "support",
      confirm: true,
    });
    expect(new Date(draftPayload(draft).ends_at).getTime() - new Date(draftPayload(draft).starts_at).getTime()).toBe(
      60 * 60 * 1000
    );
    const correction = editDraft({
      id: "activity-1",
      customer: { id: "customer-1", title: "مشتری الف" },
      issue: null,
      supporter: { id: "user-1", name: "پشتیبان" },
      kind: "phone",
      kind_label: "تماس تلفنی",
      starts_at: "2025-11-16T08:00:00+03:30",
      ends_at: "2025-11-16T09:00:00+03:30",
      duration_minutes: 60,
      summary: "پاسخ تلفنی",
      confirmed_at: "2025-11-16T09:00:00+03:30",
      revision: 2,
    });
    expect(correction.confirmed).toBe(false);
    expect(draftError({ ...correction, confirmed: true })).toContain("دلیل اصلاح");
  });
});
