import { describe, expect, it } from "vitest";
import { issueStatusFromState, stateNameFa } from "./issue-status";

describe("Persian state labels", () => {
  it.each([
    ["Backlog", "فهرست انتظار"],
    [" backlog ", "فهرست انتظار"],
    ["Cancelled", "لغوشده"],
    ["Canceled", "لغوشده"],
    ["cancceled", "لغوشده"],
    ["Custom state", "Custom state"],
  ])("shows %s as %s without changing its stored state", (name, expected) => {
    expect(stateNameFa(name)).toBe(expected);
  });
});

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
    [undefined, "cancceled", "Blocked"],
    [undefined, undefined, "Todo"],
  ])("maps group %s and label %s to %s", (group, name, expected) => {
    expect(issueStatusFromState(group, name)).toBe(expected);
  });
});
