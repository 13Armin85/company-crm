import { useContext } from "react";
import { Link } from "react-router";
import { IdentifierBadge, SearchableSelect } from "@plane/ui";
import { CalendarDays, Check, Circle, Folder, UserRound } from "lucide-react";
import { Avatar, IssueActionsMenu, PriorityBadge, StatusBadge } from "../components";
import type { Issue, Project, Status } from "../types";
import { issueReference } from "../identifiers";
import { persianDate, statusFa } from "../utils";
import { SurfaceTable } from "./surface";
import { useCurrentUser, useUpdateIssueStatus, useWorkspaceAccess } from "../api";
import { useUIStore } from "../store";
import { canChangeIssueStatus } from "../task-access";
import { ChoiceLabelsContext } from "../choice-label-context";

const statusOptions: Status[] = ["Todo", "In Progress", "Review", "Done", "Blocked"];
const semanticStatus: Record<string, Status> = {
  todo: "Todo",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
  blocked: "Blocked",
};

function WorkStatus({ issue, readOnly }: { issue: Issue; readOnly: boolean }) {
  const { data: user } = useCurrentUser(),
    { data: access } = useWorkspaceAccess();
  const choices = useContext(ChoiceLabelsContext);
  const slug = useUIStore((state) => state.workspaceSlug) || "";
  const update = useUpdateIssueStatus(slug);
  const source = issue.scope === "project" ? "state_id" : "status";
  if (issue.hiddenFields?.includes(source)) return null;
  const canChange =
    !readOnly &&
    !issue.readonlyFields?.includes(source) &&
    canChangeIssueStatus(issue, user?.id, (permission) => access?.can(permission) === true);
  const options =
    issue.scope === "project" && issue.statusOptions?.length
      ? issue.statusOptions.map((option) => ({
          id: option.id,
          title: statusFa[option.title as Status] || option.title,
          status: option.status,
        }))
      : choices.task_status.length
        ? choices.task_status
            .filter((option) => !option.disabled)
            .map((option) => ({
              id: option.id,
              title: option.title,
              status: semanticStatus[option.id] || ("Todo" as Status),
            }))
        : statusOptions.map((status) => ({ id: status, title: statusFa[status], status }));
  const value = issue.stateId || issue.statusCode || issue.status;
  return canChange ? (
    <div className={`status status-${issue.status.replace(" ", "-").toLowerCase()} issue-status-control`}>
      <i aria-hidden="true" />
      <SearchableSelect
        label={`تغییر وضعیت ${issue.name}`}
        wrapOptions={false}
        value={value}
        disabled={update.isPending}
        options={
          options.some((option) => option.id === value)
            ? options
            : [{ id: value, title: issue.statusLabel || statusFa[issue.status], disabled: true }, ...options]
        }
        onChange={(next) => {
          const selected = options.find((option) => option.id === next);
          if (selected && next !== value)
            update.mutate({
              issue,
              status: selected.status,
              ...(selected.id !== selected.status ? { nativeValue: selected.id } : {}),
            });
        }}
      />
    </div>
  ) : (
    <StatusBadge status={issue.status} code={issue.statusCode} label={issue.statusLabel} color={issue.statusColor} />
  );
}

export function WorkTable({
  issues,
  code = "ticket",
  readOnly = false,
  allowTransfer = false,
  project,
  personal = false,
}: {
  issues: Issue[];
  code?: "ticket" | "task";
  readOnly?: boolean;
  allowTransfer?: boolean;
  project?: Project;
  personal?: boolean;
}) {
  return (
    <SurfaceTable code={code} className={`surface-work-table${personal ? " personal-work-table" : ""}`}>
      <thead>
        <tr>
          <th>عنوان کار</th>
          <th>شناسه</th>
          <th>پروژه</th>
          <th>وضعیت</th>
          <th>اولویت</th>
          <th>موعد</th>
          <th>مسئول</th>
          <th>عملیات</th>
        </tr>
      </thead>
      <tbody>
        {issues.map((issue) => (
          <tr
            key={issue.id}
            className={
              personal ? `personal-work-row state-${issue.status.replaceAll(" ", "-").toLowerCase()}` : undefined
            }
          >
            <td className={personal ? "personal-work-name" : undefined}>
              <div className={personal ? "personal-work-title-wrap" : undefined}>
                {personal && (
                  <span className="personal-work-marker" aria-hidden="true">
                    {issue.status === "Done" ? <Check size={17} /> : <Circle size={17} />}
                  </span>
                )}
                <div>
                  {readOnly ? (
                    <strong className="surface-work-title">{issue.name}</strong>
                  ) : (
                    <Link
                      className="surface-work-title"
                      to={`/edit/${issue.scope === "workspace" ? "task" : "ticket"}/${issue.id}`}
                    >
                      {issue.name}
                    </Link>
                  )}
                  <small className="surface-work-sender">
                    {personal && <UserRound size={12} aria-hidden="true" />} فرستنده:{" "}
                    {issue.sender?.displayName || "نامشخص"}
                  </small>
                </div>
              </div>
            </td>
            <td>
              <IdentifierBadge value={issueReference(issue)} label="شناسه کار" />
            </td>
            <td>
              <span className={personal ? "personal-work-project" : undefined}>
                {personal && <Folder size={14} aria-hidden="true" />}
                {issue.scope === "workspace" ? "خارج از پروژه" : issue.projectName || issue.projectIdentifier}
              </span>
            </td>
            <td>
              <WorkStatus issue={issue} readOnly={readOnly} />
            </td>
            <td>
              {!issue.hiddenFields?.includes("priority") && (
                <PriorityBadge priority={issue.priority} code={issue.priorityCode} />
              )}
            </td>
            <td>
              <span className={personal ? `personal-work-due${!issue.dueDate ? " no-date" : ""}` : undefined}>
                {personal && <CalendarDays size={14} aria-hidden="true" />}
                {persianDate(issue.dueDate)}
              </span>
            </td>
            <td>
              <div className="surface-work-assignee">
                <Avatar member={issue.assignee} size="sm" />
                <span>{issue.assignee?.displayName || "بدون مسئول"}</span>
              </div>
            </td>
            <td>
              <IssueActionsMenu issue={issue} readOnly={readOnly} allowTransfer={allowTransfer} project={project} />
            </td>
          </tr>
        ))}
      </tbody>
    </SurfaceTable>
  );
}
