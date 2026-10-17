import type { Issue, Project } from "./types";

export function canTransferIssue(
  issue: Issue,
  userId: string | undefined,
  can: (code: string) => boolean,
  projects: Project[]
) {
  const ownsProject =
    issue.scope === "project" &&
    Boolean(userId) &&
    projects.some(
      (project) =>
        project.id === issue.projectId && (project.createdById === userId || project.projectLeadId === userId)
    );
  return can("Issue.Assign") && (can("Issue.Edit") || ownsProject || Boolean(userId && issue.assignee?.id === userId));
}

export function canChangeIssueStatus(issue: Issue, userId: string | undefined, can: (code: string) => boolean) {
  return can("Issue.Status.Edit") && (can("Issue.Edit") || Boolean(userId && issue.assignee?.id === userId));
}

export function isReceivedIssue(issue: Issue, userId: string | undefined) {
  return Boolean(userId && issue.assignee?.id === userId && issue.senderId !== userId);
}

export function isCurrentReceivedIssue(issue: Issue, userId: string | undefined) {
  return isReceivedIssue(issue, userId) && issue.status !== "Done" && !issue.archived;
}

export function isPersonalHistoryIssue(issue: Issue, userId: string | undefined) {
  return Boolean(userId && (issue.wasAssignedToMe || issue.assignee?.id === userId));
}
