import { describe, expect, it } from "vitest";
import { ISSUE_STATUS_COLUMNS, kanbanColumns, statusFromDropTarget } from "./kanban";

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

  it("uses the project's actual state IDs as drop targets", () => {
    const columns = kanbanColumns([
      { id: "project-review", name: "منتظر بررسی", group: "started", color: "#456", status: "Review" },
    ]);
    expect(columns).toEqual([
      { id: "state:project-review", stateId: "project-review", status: "Review", title: "منتظر بررسی", color: "#456" },
    ]);
  });
});
