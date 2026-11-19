import { describe, expect, it } from "vitest";
import type { PortalSettingsDoc } from "../api/portal";
import { isPortalLabelUsed, nextPortalLabelCode } from "./portal-status-model";

const doc = {
  labels: [
    { code: "reviewing", title: "در حال بررسی" },
    { code: "custom_1", title: "پیگیری" },
    { code: "done", title: "انجام‌شده" },
  ],
  default_label: "reviewing",
  status_map: { "category:done": "done" },
  stage_labels: { pending: "custom_1" },
  staff_name: "team",
  team_name: "تیم پشتیبانی",
  feedback_edit_hours: 72,
  files: { max_count: 5, max_size: 5 * 1024 * 1024, extensions: ["pdf"] },
  session: { idle_minutes: 30, absolute_hours: 12 },
  lockout: { attempts: 5, minutes: 15 },
  notify_channels: { email: false, sms: false },
} satisfies PortalSettingsDoc;

describe("customer-visible status labels", () => {
  it("creates a unique internal code without asking the user to type one", () => {
    expect(nextPortalLabelCode(doc.labels)).toBe("custom_2");
    expect(nextPortalLabelCode([...doc.labels, { code: "custom_2", title: "جدید" }])).toBe("custom_3");
  });

  it("keeps labels referenced by the default, a status or a stage from being removed", () => {
    expect(isPortalLabelUsed(doc, "reviewing")).toBe(true);
    expect(isPortalLabelUsed(doc, "done")).toBe(true);
    expect(isPortalLabelUsed(doc, "custom_1")).toBe(true);
    expect(isPortalLabelUsed(doc, "other")).toBe(false);
  });
});
