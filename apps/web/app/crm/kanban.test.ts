import { describe, expect, it } from "vitest";
import { ISSUE_STATUS_COLUMNS, statusFromDropTarget } from "./kanban";

describe("CRM kanban statuses", () => {
  it("provides every supported workflow status as a drop target", () => {
    expect(ISSUE_STATUS_COLUMNS.map((column) => column.id)).toEqual([
      "Todo",
      "In Progress",
      "Review",
      "Done",
      "Blocked",
    ]);
  });

  it("only accepts workflow columns as status drop targets", () => {
    expect(statusFromDropTarget("Review")).toBe("Review");
    expect(statusFromDropTarget("issue-id")).toBeUndefined();
    expect(statusFromDropTarget(undefined)).toBeUndefined();
  });
});
