import { describe, expect, it } from "vitest";
import { ISSUE_STATUS_COLUMNS, kanbanColumns, kanbanGroups, statusFromDropTarget } from "./kanban";

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
      {
        id: "state:project-review",
        stateId: "project-review",
        status: "Review",
        title: "منتظر بررسی",
        color: "#456",
        category: "in_progress",
      },
    ]);
  });

  it("groups existing status columns under the three ticket categories (ن۶)", () => {
    const groups = kanbanGroups(
      kanbanColumns([
        { id: "a", name: "Backlog", group: "backlog", color: "#1", status: "Todo" },
        { id: "b", name: "Doing", group: "started", color: "#2", status: "In Progress" },
        { id: "c", name: "Done", group: "completed", color: "#3", status: "Done" },
        { id: "d", name: "لغو", group: "cancelled", color: "#4", status: "Done" },
      ])
    );
    expect(groups.map((group) => [group.title, group.columns.map((column) => column.id)])).toEqual([
      ["انجام‌نشده", ["state:a"]],
      ["در حال انجام", ["state:b"]],
      ["انجام‌شده", ["state:c", "state:d"]],
    ]);
    const plain = kanbanGroups(kanbanColumns());
    expect(plain.find((group) => group.category === "in_progress")?.columns.map((column) => column.id)).toEqual([
      "In Progress",
      "Review",
      "Blocked",
    ]);
  });
});
