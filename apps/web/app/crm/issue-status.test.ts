import { describe, expect, it } from "vitest";
import { issueStatusFromState } from "./issue-status";

describe("issue workflow status mapping", () => {
  it.each([
    ["unstarted", "برای انجام", "Todo"],
    ["backlog", "کار جدید", "Todo"],
    ["started", "در حال انجام", "In Progress"],
    ["started", "بازبینی", "Review"],
    ["completed", "انجام‌شده", "Done"],
    ["cancelled", "مسدود", "Blocked"],
    [" UNSTARTED ", "شروع نشده", "Todo"],
    ["completed", "Custom active label", "Done"],
    [undefined, "Unstarted", "Todo"],
    [undefined, "انجام‌نشده", "Todo"],
    [undefined, "انجام‌شده", "Done"],
    [undefined, "In Progress", "In Progress"],
    [undefined, "Review", "Review"],
    [undefined, "Blocked", "Blocked"],
    [undefined, undefined, "Todo"],
  ])("maps group %s and label %s to %s", (group, name, expected) => {
    expect(issueStatusFromState(group, name)).toBe(expected);
  });
});
