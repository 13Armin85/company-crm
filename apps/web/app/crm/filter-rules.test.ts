import { describe, expect, it } from "vitest";
import { zonedDateTime } from "@plane/ui";
import {
  deadlineFilterError,
  emptyIssueFilters,
  emptyProjectFilters,
  filterIssues,
  filterProjects,
  issueFilterCount,
  matchesDeadline,
  projectFilterCount,
  projectFilterError,
  UNASSIGNED,
  WORKSPACE_TASKS,
} from "./filter-rules";
import type { Issue, Member, Project } from "./types";

const today = "2026-10-14";
const member: Member = {
  id: "sara",
  displayName: "سارا رضایی",
  email: "sara@example.com",
  initials: "س ر",
  role: "عضو",
  avatarColor: "#fff",
};
const issue = (id: string, overrides: Partial<Issue> = {}): Issue => ({
  id,
  name: `کار ${id}`,
  sequenceId: 12,
  scope: "project",
  projectId: "crm",
  projectName: "ارتباط با مشتری",
  projectIdentifier: "CRM",
  status: "Todo",
  priority: "High",
  ...overrides,
});
const project = (id: string, overrides: Partial<Project> = {}): Project => ({
  id,
  name: id,
  identifier: id.toUpperCase(),
  progress: 0,
  memberIds: [],
  ...overrides,
});
const issueIds = (rows: Issue[]) => rows.map((row) => row.id);
const projectIds = (rows: Project[]) => rows.map((row) => row.id);

describe("precise issue filters", () => {
  const issues = [
    issue("todo", { assignee: member, dueDate: "2026-10-13" }),
    issue("review", { status: "Review", priority: "Urgent", assignee: member, dueDate: today }),
    issue("done", { status: "Done", dueDate: "2026-10-13" }),
    issue("blocked", { status: "Blocked", priority: "Low", projectId: "support", dueDate: "2026-10-15" }),
    issue("workspace", { scope: "workspace", projectId: undefined, priority: "None" }),
  ];
  it("starts unrestricted and does not mutate the input", () => {
    expect(filterIssues(issues, emptyIssueFilters(), "", today)).toEqual(issues);
    expect(issues[0].id).toBe("todo");
  });
  it("combines alternatives within a field and intersects different fields", () => {
    expect(
      issueIds(
        filterIssues(
          issues,
          {
            ...emptyIssueFilters(),
            statuses: ["Todo", "Review"],
            priorities: ["Urgent"],
            assigneeIds: [member.id],
            projectIds: ["crm"],
          },
          "",
          today
        )
      )
    ).toEqual(["review"]);
  });
  it("supports unassigned work and workspace work explicitly", () => {
    expect(
      issueIds(
        filterIssues(
          issues,
          { ...emptyIssueFilters(), assigneeIds: [UNASSIGNED], projectIds: [WORKSPACE_TASKS, "support"] },
          "",
          today
        )
      )
    ).toEqual(["blocked", "workspace"]);
  });
  it("excludes completed work and today's deadlines from overdue results", () => {
    expect(issueIds(filterIssues(issues, { ...emptyIssueFilters(), deadline: "overdue" }, "", today))).toEqual([
      "todo",
    ]);
  });
  it("combines date bounds inclusively with status and priority", () => {
    expect(
      issueIds(
        filterIssues(
          issues,
          { ...emptyIssueFilters(), dueFrom: "2026-10-13", dueTo: today, statuses: ["Review", "Blocked"] },
          "",
          today
        )
      )
    ).toEqual(["review"]);
  });
  it("finds identifiers using Persian digits and ignores case and whitespace", () => {
    expect(filterIssues([issues[0]], emptyIssueFilters(), "crm - ۱۲", today)).toHaveLength(1);
  });
  it("normalizes Arabic letters and finds assignees, labels and workspace scope", () => {
    expect(
      filterIssues([issue("arabic", { name: "پيگيري كار" })], emptyIssueFilters(), "پیگیری کار", today)
    ).toHaveLength(1);
    expect(filterIssues(issues, emptyIssueFilters(), "سارا رضایی", today)).toHaveLength(2);
    expect(
      filterIssues([issue("labeled", { labels: ["مشتری جدید"] })], emptyIssueFilters(), "مشتری جدید", today)
    ).toHaveLength(1);
    expect(issueIds(filterIssues(issues, emptyIssueFilters(), "خارج از پروژه", today))).toEqual(["workspace"]);
  });
  it("returns no matches for a reversed date range", () => {
    const filters = { ...emptyIssueFilters(), dueFrom: today, dueTo: "2026-10-13" };
    expect(deadlineFilterError(filters)).toContain("از تاریخ");
    expect(filterIssues(issues, filters, "", today)).toEqual([]);
  });
});

describe("deadline boundaries", () => {
  it.each(["UTC", "Asia/Tehran", "America/Los_Angeles"])(
    "keeps date-only deadlines on their calendar day in %s",
    (timeZone) => {
      expect(matchesDeadline(today, { ...emptyIssueFilters(), deadline: "today" }, today, false, timeZone)).toBe(true);
    }
  );
  it("converts timestamps and determines today in the user's timezone", () => {
    const timestamp = "2026-10-13T21:00:00Z";
    expect(zonedDateTime(timestamp, "Asia/Tehran")?.date).toBe(today);
    expect(matchesDeadline(timestamp, { ...emptyIssueFilters(), deadline: "today" }, today, false, "Asia/Tehran")).toBe(
      true
    );
    expect(matchesDeadline(timestamp, { ...emptyIssueFilters(), deadline: "today" }, today, false, "UTC")).toBe(false);
  });
  it("distinguishes future, missing and invalid dates", () => {
    expect(matchesDeadline("2026-10-15", { ...emptyIssueFilters(), deadline: "upcoming" }, today)).toBe(true);
    expect(matchesDeadline(undefined, { ...emptyIssueFilters(), deadline: "no-date" }, today)).toBe(true);
    expect(matchesDeadline(undefined, { ...emptyIssueFilters(), dueFrom: today }, today)).toBe(false);
    expect(matchesDeadline("2026-02-30", { ...emptyIssueFilters(), deadline: "with-date" }, today)).toBe(false);
    expect(deadlineFilterError({ ...emptyIssueFilters(), dueFrom: "2026-02-30" })).toBeDefined();
  });
});

describe("precise project filters", () => {
  const projects = [
    project("crm", { memberIds: [member.id], projectLeadId: member.id, progress: 50, targetDate: today }),
    project("support", { memberIds: ["ali"], progress: 25 }),
    project("complete", { memberIds: [member.id], progress: 100, targetDate: "2026-10-13" }),
    project("archived", { memberIds: [member.id], archivedAt: "2026-10-01", progress: 50 }),
  ];
  it("intersects member, lead, progress and date filters", () => {
    expect(
      projectIds(
        filterProjects(
          projects,
          {
            ...emptyProjectFilters(),
            memberIds: [member.id, "ali"],
            leadIds: [member.id],
            progressMin: "50",
            progressMax: "50",
            dueFrom: today,
            dueTo: today,
          },
          "",
          "active",
          today
        )
      )
    ).toEqual(["crm"]);
  });
  it("continues to filter inside the selected tab", () => {
    const filters = { ...emptyProjectFilters(), memberIds: [member.id] };
    expect(projectIds(filterProjects(projects, filters, "", "all", today))).toEqual(["crm", "complete"]);
    expect(projectIds(filterProjects(projects, filters, "", "active", today))).toEqual(["crm"]);
    expect(projectIds(filterProjects(projects, filters, "", "completed", today))).toEqual(["complete"]);
    expect(projectIds(filterProjects(projects, filters, "", "archived", today))).toEqual(["archived"]);
  });
  it("resetting detailed filters preserves the selected tab and search", () => {
    expect(projectIds(filterProjects(projects, emptyProjectFilters(), "archived", "archived", today))).toEqual([
      "archived",
    ]);
  });
  it("handles zero percent and projects without a lead or deadline", () => {
    expect(
      filterProjects(
        [project("new")],
        { ...emptyProjectFilters(), progressMin: "0", progressMax: "0", leadIds: [UNASSIGNED], deadline: "no-date" },
        "",
        "all",
        today
      )
    ).toHaveLength(1);
  });
  it.each([
    { progressMin: "101" },
    { progressMin: "-1" },
    { progressMax: "2.5" },
    { progressMin: "NaN" },
    { progressMin: "80", progressMax: "20" },
  ])("rejects invalid progress bounds %j", (bounds) => {
    const filters = { ...emptyProjectFilters(), ...bounds };
    expect(projectFilterError(filters)).toBeDefined();
    expect(filterProjects(projects, filters, "", "all", today)).toEqual([]);
  });
  it("excludes completed projects from overdue results", () => {
    expect(filterProjects(projects, { ...emptyProjectFilters(), deadline: "overdue" }, "", "all", today)).toEqual([]);
  });
  it("counts active criteria, including a zero progress bound and a combined deadline range", () => {
    expect(issueFilterCount(emptyIssueFilters())).toBe(0);
    expect(
      issueFilterCount({
        ...emptyIssueFilters(),
        statuses: ["Todo", "Review"],
        deadline: "overdue",
        dueFrom: "2026-10-01",
        dueTo: today,
      })
    ).toBe(2);
    expect(projectFilterCount({ ...emptyProjectFilters(), progressMax: "0" })).toBe(1);
  });
});
