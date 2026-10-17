import { describe, expect, it } from "vitest";
import { canChangeIssueStatus, canTransferIssue, isCurrentReceivedIssue, isPersonalHistoryIssue } from "./task-access";
import type { Issue, Project } from "./types";

const issue = { assignee: { id: "owner" } } as Issue;
const can =
  (...permissions: string[]) =>
  (code: string) =>
    permissions.includes(code);

describe("project task transfers", () => {
  const projectIssue = { ...issue, scope: "project", projectId: "project" } as Issue;
  it.each(["createdById", "projectLeadId"])(
    "allows the project owner identified by %s to transfer another person's task",
    (field) => {
      const projects: Project[] = [{ id: "project", name: "Project", identifier: "PRJ", [field]: "project-owner" }];
      expect(canTransferIssue(projectIssue, "project-owner", can("Issue.Assign"), projects)).toBe(true);
      expect(canChangeIssueStatus(projectIssue, "project-owner", can("Issue.Status.Edit"))).toBe(false);
    }
  );
  it("rejects other members and ownership of a different project", () => {
    const projects = [{ id: "different", createdById: "member" }] as Project[];
    expect(canTransferIssue(projectIssue, "member", can("Issue.Assign"), projects)).toBe(false);
    expect(
      canTransferIssue(projectIssue, "project-owner", can(), [
        { id: "project", createdById: "project-owner" },
      ] as Project[])
    ).toBe(false);
  });
});

describe("task status authorization", () => {
  it("allows the assignee to move their task", () => {
    expect(canChangeIssueStatus(issue, "owner", can("Issue.Status.Edit"))).toBe(true);
  });
  it("prevents the sender from moving another person's task", () => {
    expect(canChangeIssueStatus(issue, "sender", can("Issue.Status.Edit", "Issue.Create"))).toBe(false);
  });
  it("allows an administrator to move every task", () => {
    expect(canChangeIssueStatus(issue, "admin", can("Issue.Status.Edit", "Issue.Edit"))).toBe(true);
  });
  it("requires an authenticated assignee and a status permission", () => {
    expect(canChangeIssueStatus(issue, undefined, can("Issue.Status.Edit"))).toBe(false);
    expect(canChangeIssueStatus(issue, "owner", can())).toBe(false);
  });
});

describe("personal task views", () => {
  const received = { ...issue, senderId: "manager", status: "Todo", wasAssignedToMe: true } as Issue;
  it("only shows work received from another person as current work", () => {
    expect(isCurrentReceivedIssue(received, "owner")).toBe(true);
    expect(isCurrentReceivedIssue({ ...received, senderId: "owner" }, "owner")).toBe(false);
    expect(isCurrentReceivedIssue({ ...received, status: "Done" }, "owner")).toBe(false);
    expect(isCurrentReceivedIssue({ ...received, archived: true }, "owner")).toBe(false);
  });
  it("retains transferred and old completed tasks in personal history", () => {
    const transferred = { ...received, assignee: { id: "next-owner" } } as Issue;
    expect(isCurrentReceivedIssue(transferred, "owner")).toBe(false);
    expect(isPersonalHistoryIssue(transferred, "owner")).toBe(true);
    expect(isPersonalHistoryIssue({ ...received, status: "Done", createdAt: "2011-01-01" }, "owner")).toBe(true);
    expect(isPersonalHistoryIssue({ ...transferred, wasAssignedToMe: false }, "owner")).toBe(false);
  });
});
