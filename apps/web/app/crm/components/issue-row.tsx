/** A work-item row with its inline actions menu. */
import { IdentifierBadge, SearchableSelect } from "@plane/ui";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { useContext, useMemo } from "react";
import { ChoiceLabelsContext } from "../choice-label-context";
import { Link, useNavigate } from "react-router";
import { CircleDot, Clock3, FolderKanban, Inbox, MoreHorizontal } from "lucide-react";
import {
  useCurrentUser,
  useDeleteIssue,
  useMembers,
  useProjects,
  useReassignIssue,
  useUpdateIssueStatus,
  useWorkspaceAccess,
} from "../api";
import { useUIStore } from "../store";
import type { Issue, Member, Project, Status } from "../types";
import { persianDate, statusFa } from "../utils";
import { issueReference, matchesRecordSearch } from "../identifiers";
import { canChangeIssueStatus, canTransferIssue } from "../task-access";
import { Avatar, StatusBadge, PriorityBadge } from "./primitives";

export function IssueRow({
  issue,
  compact = false,
  table = false,
  readOnly = false,
  allowTransfer = false,
  project,
}: {
  issue: Issue;
  compact?: boolean;
  table?: boolean;
  readOnly?: boolean;
  allowTransfer?: boolean;
  project?: Project;
}) {
  const slug = useUIStore((state) => state.workspaceSlug) ?? "";
  const { data: access } = useWorkspaceAccess();
  const { data: currentUser } = useCurrentUser();
  const updateStatus = useUpdateIssueStatus(slug);
  const navigate = useNavigate();
  const canEdit = access?.can("Issue.Edit") === true;
  const ownsIssue = Boolean(currentUser?.id) && issue.assignee?.id === currentUser?.id;
  const canChangeStatus = !readOnly && access?.can("Issue.Status.Edit") === true && (canEdit || ownsIssue);
  const statusOptions: Status[] = ["Todo", "In Progress", "Review", "Done", "Blocked"];

  return (
    <div className={`issue-row ${compact ? "is-compact" : ""} ${table ? "is-table" : ""}`}>
      <button
        className="issue-check"
        aria-label="تکمیل کار"
        disabled={!canChangeStatus || updateStatus.isPending || issue.status === "Done"}
        onClick={() => issue.status !== "Done" && updateStatus.mutate({ issue, status: "Done" })}
      >
        <CircleDot size={16} />
      </button>
      <button
        type="button"
        className={`issue-main issue-main-button ${issue.scope === "project" ? "is-clickable" : ""}`}
        disabled={readOnly || !issue.projectId}
        onClick={() => issue.projectId && navigate(`/projects/${issue.projectId}?tab=issues`)}
      >
        <strong>{issue.name}</strong>
        <span className="issue-people">
          فرستنده: {issue.sender?.displayName || "نامشخص"} · مسئول: {issue.assignee?.displayName || "بدون مسئول"}
        </span>
        {readOnly && issue.createdAt && <span className="issue-people">تاریخ ثبت: {persianDate(issue.createdAt)}</span>}
        {!table && (
          <span className="issue-code" dir="ltr">
            {issueReference(issue)}
          </span>
        )}
      </button>
      {table && (
        <span className="issue-project" dir="ltr">
          <IdentifierBadge value={issueReference(issue)} label="شناسه کار" />
        </span>
      )}
      {table && (
        <span
          className={`issue-context ${issue.scope === "workspace" ? "is-workspace" : "is-project"}`}
          title={issue.scope === "workspace" ? "این کار خارج از پروژه ثبت شده است" : issue.projectName}
        >
          {issue.scope === "workspace" ? <Inbox size={14} /> : <FolderKanban size={14} />}
          <span>{issue.scope === "workspace" ? "خارج از پروژه" : issue.projectName || issue.projectIdentifier}</span>
        </span>
      )}
      {canChangeStatus ? (
        <div
          className={`status status-${issue.status.replace(" ", "-").toLowerCase()} issue-status-control`}
          aria-busy={updateStatus.isPending}
        >
          <i aria-hidden="true" />
          <SearchableSelect
            label={`تغییر وضعیت ${issue.name}`}
            wrapOptions={false}
            value={issue.status}
            disabled={updateStatus.isPending}
            onChange={(value) => {
              const status = statusOptions.find((option) => option === value);
              if (status && status !== issue.status && !updateStatus.isPending) {
                updateStatus.mutate({ issue, status });
              }
            }}
            options={statusOptions.map((status) => ({ id: status, title: statusFa[status] }))}
          />
          {updateStatus.isPending && (
            <span className="sr-only" role="status">
              در حال ذخیره وضعیت کار…
            </span>
          )}
        </div>
      ) : (
        !issue.hiddenFields?.some((f) => f === "status" || f === "state_id") && (
          <StatusBadge
            status={issue.status}
            code={issue.statusCode}
            label={issue.statusLabel}
            color={issue.statusColor}
          />
        )
      )}
      {!issue.hiddenFields?.includes("priority") && (
        <PriorityBadge priority={issue.priority} code={issue.priorityCode} />
      )}
      <span className="issue-date">
        <Clock3 size={14} />
        {persianDate(issue.dueDate)}
      </span>
      <div className="issue-actions">
        <span className={table ? "issue-assignee" : ""}>
          <Avatar member={issue.assignee} size="sm" />
          {table && <span>{issue.assignee?.displayName || "بدون مسئول"}</span>}
        </span>
        <IssueActionsMenu
          issue={issue}
          readOnly={readOnly}
          allowTransfer={allowTransfer}
          project={project}
          statusMutation={updateStatus}
        />
      </div>
    </div>
  );
}

export function IssueActionsMenu({
  issue,
  project,
  readOnly = false,
  allowTransfer = false,
  transferMembers,
  transferDisabled = false,
  onAssigneeChange,
  statusMutation,
}: {
  issue: Issue;
  project?: Project;
  readOnly?: boolean;
  allowTransfer?: boolean;
  transferMembers?: Member[];
  transferDisabled?: boolean;
  onAssigneeChange?: (issue: Issue, assigneeId: string) => void;
  statusMutation?: ReturnType<typeof useUpdateIssueStatus>;
}) {
  const slug = useUIStore((state) => state.workspaceSlug) ?? "";
  const { data: access } = useWorkspaceAccess();
  const { data: currentUser } = useCurrentUser();
  const { data: projects = [] } = useProjects();
  const { data: members = [] } = useMembers(undefined, issue.scope === "project" ? issue.projectId : undefined);
  const ownStatusMutation = useUpdateIssueStatus(slug);
  const businessChoices = useContext(ChoiceLabelsContext);
  const updateStatus = statusMutation ?? ownStatusMutation;
  const deleteIssue = useDeleteIssue(slug);
  const reassignIssue = useReassignIssue(slug);
  const can = (code: string) => access?.can(code) === true;
  const protectedFields = new Set([...(issue.hiddenFields ?? []), ...(issue.readonlyFields ?? [])]);
  const canChangeStatus =
    !readOnly &&
    !protectedFields.has(issue.scope === "project" ? "state_id" : "status") &&
    canChangeIssueStatus(issue, currentUser?.id, can);
  const canTransfer =
    (!readOnly || allowTransfer) &&
    !protectedFields.has(issue.scope === "project" ? "assignee_ids" : "assignee_id") &&
    canTransferIssue(issue, currentUser?.id, can, project ? [project] : projects);
  const canDelete = !readOnly && can("Issue.Delete");
  const pending = transferDisabled || reassignIssue.isPending;
  const eligibleMembers = issue.scope === "project" ? members : (transferMembers ?? members);
  const transferOptions = eligibleMembers
    .filter((member) => access?.is_admin || member.id !== currentUser?.id)
    .map((member) => ({
      id: member.id,
      title: member.displayName,
      description: member.email,
      disabled: member.isActive === false || member.id === issue.assignee?.id,
    }));
  const statuses: Status[] = ["Todo", "In Progress", "Review", "Done", "Blocked"];
  const semanticStatus: Record<string, Status> = {
    todo: "Todo",
    in_progress: "In Progress",
    review: "Review",
    done: "Done",
    blocked: "Blocked",
  };
  const statusChoices =
    issue.scope === "project" && issue.statusOptions?.length
      ? issue.statusOptions.map((option) => ({ ...option, title: statusFa[option.title as Status] || option.title }))
      : businessChoices.task_status.length
        ? businessChoices.task_status
            .filter((option) => !option.disabled)
            .map((option) => ({
              id: option.id,
              title: option.title,
              status: semanticStatus[option.id] || ("Todo" as Status),
            }))
        : statuses.map((status) => ({ id: status, title: statusFa[status], status }));
  if (!canChangeStatus && !canTransfer && !canDelete) return null;
  return (
    <Popover className="issue-actions" onPointerDown={(event) => event.stopPropagation()}>
      {({ close }) => (
        <>
          <PopoverButton className="plain-icon" aria-label="عملیات کار" aria-haspopup="menu">
            <MoreHorizontal size={16} />
          </PopoverButton>
          <PopoverPanel className="action-menu issue-action-menu" role="menu" anchor="bottom end" portal dir="rtl">
            <Link to={`/edit/${issue.scope === "project" ? "ticket" : "task"}/${issue.id}`} onClick={() => close()}>
              جزئیات و فرم کامل
            </Link>
            {canChangeStatus && <small>تغییر وضعیت</small>}
            {canChangeStatus &&
              statusChoices.map((option) => (
                <button
                  key={option.id}
                  disabled={option.id === (issue.stateId || issue.statusCode || issue.status) || updateStatus.isPending}
                  onClick={() => {
                    updateStatus.mutate({
                      issue,
                      status: option.status,
                      ...(option.id !== option.status ? { nativeValue: option.id } : {}),
                    });
                    close();
                  }}
                >
                  {option.title}
                </button>
              ))}
            {canTransfer && (
              <div className="issue-transfer-control">
                <label htmlFor={`issue-transfer-${issue.id}`}>انتقال به شخص دیگر</label>
                <SearchableSelect
                  id={`issue-transfer-${issue.id}`}
                  label="انتقال به عضو دیگر"
                  optionClassName="member-transfer-options"
                  containedOptions
                  value={issue.assignee?.id ?? ""}
                  selectedLabel={issue.assignee?.displayName ?? "بدون مسئول"}
                  placeholder="نام شخص را جستجو کنید"
                  disabled={pending || !transferOptions.some((option) => !option.disabled)}
                  onChange={(id) => {
                    if (id && id !== issue.assignee?.id && !pending) {
                      if (onAssigneeChange) onAssigneeChange(issue, id);
                      else reassignIssue.mutate({ issue, assigneeId: id });
                      close();
                    }
                  }}
                  options={transferOptions}
                />
              </div>
            )}
            {canDelete && (
              <button
                className="danger-action"
                disabled={deleteIssue.isPending}
                onClick={() => {
                  if (window.confirm(`کار «${issue.name}» حذف شود؟`)) deleteIssue.mutate(issue);
                  close();
                }}
              >
                حذف کار
              </button>
            )}
          </PopoverPanel>
        </>
      )}
    </Popover>
  );
}

export function useFilteredIssues(issues: Issue[], query: string) {
  return useMemo(
    () => issues.filter((issue) => matchesRecordSearch(query, [issue.id, issue.name, issueReference(issue)])),
    [issues, query]
  );
}
