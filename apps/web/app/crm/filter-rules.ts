import { parseDateOnly, zonedDateTime } from "@plane/ui";
import type { Issue, Priority, Project, Status } from "./types";
import { issueReference, matchesRecordSearch } from "./identifiers";

export const UNASSIGNED = "__unassigned__";
export const WORKSPACE_TASKS = "__workspace__";
export type DeadlineMode = "all" | "with-date" | "overdue" | "today" | "upcoming" | "no-date";
export type ProjectTab = "all" | "active" | "completed" | "archived";

export interface DeadlineFilters {
  deadline: DeadlineMode;
  dueFrom: string;
  dueTo: string;
}
export interface IssueFilters extends DeadlineFilters {
  statuses: Status[];
  priorities: Priority[];
  projectIds: string[];
  assigneeIds: string[];
}
export interface ProjectFilters extends DeadlineFilters {
  memberIds: string[];
  leadIds: string[];
  progressMin: string;
  progressMax: string;
}

export const emptyIssueFilters = (): IssueFilters => ({
  statuses: [],
  priorities: [],
  projectIds: [],
  assigneeIds: [],
  deadline: "all",
  dueFrom: "",
  dueTo: "",
});
export const emptyProjectFilters = (): ProjectFilters => ({
  memberIds: [],
  leadIds: [],
  progressMin: "",
  progressMax: "",
  deadline: "all",
  dueFrom: "",
  dueTo: "",
});

export function deadlineFilterError(filters: DeadlineFilters) {
  if ((filters.dueFrom && !parseDateOnly(filters.dueFrom)) || (filters.dueTo && !parseDateOnly(filters.dueTo)))
    return "تاریخ معتبر انتخاب کنید.";
  if (filters.dueFrom && filters.dueTo && filters.dueFrom > filters.dueTo)
    return "موعد «از تاریخ» باید پیش از «تا تاریخ» یا برابر با آن باشد.";
  return undefined;
}
export function projectFilterError(filters: ProjectFilters) {
  const dateError = deadlineFilterError(filters);
  if (dateError) return dateError;
  const values = [filters.progressMin, filters.progressMax].filter((value) => value !== "");
  if (values.some((value) => !Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 100))
    return "درصد پیشرفت باید عددی بین صفر و صد باشد.";
  if (
    filters.progressMin !== "" &&
    filters.progressMax !== "" &&
    Number(filters.progressMin) > Number(filters.progressMax)
  )
    return "حداقل پیشرفت باید کمتر از حداکثر پیشرفت یا برابر با آن باشد.";
  return undefined;
}

export function matchesDeadline(
  value: string | undefined,
  filters: DeadlineFilters,
  today: string,
  completed = false,
  timeZone?: string
) {
  // Keep date-only deadlines on the same day in every timezone.
  const date =
    value && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? parseDateOnly(value)
        ? value
        : undefined
      : value
        ? zonedDateTime(value, timeZone)?.date
        : undefined;
  if (filters.deadline === "no-date") return !date;
  if (filters.deadline === "all" && !filters.dueFrom && !filters.dueTo) return true;
  if (!date) return false;
  if (filters.dueFrom && date < filters.dueFrom) return false;
  if (filters.dueTo && date > filters.dueTo) return false;
  if (filters.deadline === "overdue") return !completed && date < today;
  if (filters.deadline === "today") return date === today;
  if (filters.deadline === "upcoming") return date > today;
  return true;
}

export function filterIssues(issues: Issue[], filters: IssueFilters, query: string, today: string, timeZone?: string) {
  if (deadlineFilterError(filters)) return [];
  return issues.filter(
    (issue) =>
      (!filters.statuses.length || filters.statuses.includes(issue.status)) &&
      (!filters.priorities.length || filters.priorities.includes(issue.priority)) &&
      (!filters.projectIds.length ||
        filters.projectIds.includes(issue.scope === "workspace" ? WORKSPACE_TASKS : (issue.projectId ?? ""))) &&
      (!filters.assigneeIds.length || filters.assigneeIds.includes(issue.assignee?.id ?? UNASSIGNED)) &&
      matchesDeadline(issue.dueDate, filters, today, issue.status === "Done", timeZone) &&
      matchesRecordSearch(query, [
        issue.id,
        issue.name,
        issueReference(issue),
        issue.projectName,
        issue.assignee?.displayName,
        ...(issue.labels ?? []),
        issue.scope === "workspace" ? "خارج از پروژه" : undefined,
      ])
  );
}

export function matchesProjectTab(project: Project, tab: ProjectTab) {
  if (tab === "all") return !project.archivedAt;
  if (tab === "active") return !project.archivedAt && (project.progress ?? 0) < 100;
  if (tab === "completed") return (project.progress ?? 0) === 100;
  return Boolean(project.archivedAt);
}

export function filterProjects(
  projects: Project[],
  filters: ProjectFilters,
  query: string,
  tab: ProjectTab,
  today: string,
  timeZone?: string
) {
  if (projectFilterError(filters)) return [];
  return projects.filter(
    (project) =>
      matchesProjectTab(project, tab) &&
      (!filters.memberIds.length || filters.memberIds.some((id) => project.memberIds?.includes(id))) &&
      (!filters.leadIds.length ||
        filters.leadIds.includes(project.projectLeadId ?? project.projectLead?.id ?? UNASSIGNED)) &&
      (filters.progressMin === "" || (project.progress ?? 0) >= Number(filters.progressMin)) &&
      (filters.progressMax === "" || (project.progress ?? 0) <= Number(filters.progressMax)) &&
      matchesDeadline(project.targetDate, filters, today, (project.progress ?? 0) === 100, timeZone) &&
      matchesRecordSearch(query, [project.id, project.name, project.identifier, project.description])
  );
}

export const issueFilterCount = (filters: IssueFilters) =>
  [
    filters.statuses.length,
    filters.priorities.length,
    filters.projectIds.length,
    filters.assigneeIds.length,
    filters.deadline !== "all" || filters.dueFrom || filters.dueTo,
  ].filter(Boolean).length;
export const projectFilterCount = (filters: ProjectFilters) =>
  [
    filters.memberIds.length,
    filters.leadIds.length,
    filters.progressMin !== "" || filters.progressMax !== "",
    filters.deadline !== "all" || filters.dueFrom || filters.dueTo,
  ].filter(Boolean).length;
