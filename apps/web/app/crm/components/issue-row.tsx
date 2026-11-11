/** A work-item row with its inline actions menu. */
import { IdentifierBadge, SearchableSelect } from "@plane/ui";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { useContext, useMemo, useState } from "react";
import { ChoiceLabelsContext } from "../choice-label-context";
import { Link, useNavigate } from "react-router";
import {
  Check,
  CircleDot,
  Clock3,
  FileText,
  FolderKanban,
  Inbox,
  MoreHorizontal,
  Phone,
  Share2,
  Trash2,
  UserRoundCog,
} from "lucide-react";
import { TicketRowDialog } from "../ticket/row-dialogs";
import type { RowDialog } from "../ticket/row-dialogs";
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
import { stateNameFa } from "../issue-status";
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
  showStatus = true,
}: {
  issue: Issue;
  project?: Project;
  readOnly?: boolean;
  allowTransfer?: boolean;
  transferMembers?: Member[];
  transferDisabled?: boolean;
  onAssigneeChange?: (issue: Issue, assigneeId: string) => void;
  statusMutation?: ReturnType<typeof useUpdateIssueStatus>;
  /** Tables already show an editable status column, so their menu skips the duplicate list. */
  showStatus?: boolean;
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
  // Ticket 5: first-contact resolution and referral straight from the row (the server re-checks both).
  const [ticketDialog, setTicketDialog] = useState<RowDialog | null>(null);
  const ownsTicket =
    Boolean(currentUser?.id) && (issue.assignee?.id === currentUser?.id || issue.sender?.id === currentUser?.id);
  const canContact = !readOnly && issue.status !== "Done" && ownsTicket;
  const canRefer =
    !readOnly && (can("Routing.Route") || (Boolean(currentUser?.id) && issue.assignee?.id === currentUser?.id));
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
      ? issue.statusOptions.map((option) => ({ ...option, title: stateNameFa(option.title) }))
      : businessChoices.task_status.length
        ? businessChoices.task_status
            .filter((option) => !option.disabled)
            .map((option) => ({
              id: option.id,
              title: stateNameFa(option.title),
              status: semanticStatus[option.id] || ("Todo" as Status),
            }))
        : statuses.map((status) => ({ id: status, title: statusFa[status], status }));
  if (!canChangeStatus && !canTransfer && !canDelete && !canContact && !canRefer) return null;
  return (
    <>
    {ticketDialog && (
      <TicketRowDialog issueId={issue.id} kind={ticketDialog} onClose={() => setTicketDialog(null)} />
    )}
    <Popover className="issue-actions" onPointerDown={(event) => event.stopPropagation()}>
      {({ close }) => (
        <>
          <PopoverButton className="plain-icon" aria-label="عملیات کار" aria-haspopup="menu">
            <MoreHorizontal size={16} />
          </PopoverButton>
          <PopoverPanel className="action-menu issue-action-menu" role="menu" anchor="bottom end" portal dir="rtl">
            <header className="issue-action-head">
              <strong title={issue.name}>{issue.name}</strong>
              <small dir="ltr">{issueReference(issue)}</small>
            </header>
            <Link
              className="issue-action-item"
              to={`/edit/${issue.scope === "project" ? "ticket" : "task"}/${issue.id}`}
              onClick={() => close()}
            >
              <FileText size={15} aria-hidden="true" />
              جزئیات و فرم کامل
            </Link>
            {canContact && (
              <button
                className="issue-action-item"
                role="menuitem"
                onClick={() => {
                  setTicketDialog("contact");
                  close();
                }}
              >
                <Phone size={15} aria-hidden="true" />
                حل در تماس
              </button>
            )}
            {canRefer && (
              <button
                className="issue-action-item"
                role="menuitem"
                onClick={() => {
                  setTicketDialog("refer");
                  close();
                }}
              >
                <Share2 size={15} aria-hidden="true" />
                {issue.assignee ? "ارجاع" : "ارجاع تیکت بدون مسئول"}
              </button>
            )}
            {canChangeStatus && showStatus && (
              <section className="issue-action-section" aria-label="تغییر وضعیت">
                <small>تغییر وضعیت</small>
                <div className="issue-action-statuses">
                  {statusChoices.map((option) => {
                    const current = option.id === (issue.stateId || issue.statusCode || issue.status);
                    return (
                      <button
                        key={option.id}
                        role="menuitemradio"
                        aria-checked={current}
                        className={current ? "is-current" : undefined}
                        disabled={current || updateStatus.isPending}
                        onClick={() => {
                          updateStatus.mutate({
                            issue,
                            status: option.status,
                            ...(option.id !== option.status ? { nativeValue: option.id } : {}),
                          });
                          close();
                        }}
                      >
                        {current && <Check size={13} aria-hidden="true" />}
                        {option.title}
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
            {canTransfer && (
              <section className="issue-action-section issue-transfer-control">
                <label htmlFor={`issue-transfer-${issue.id}`}>
                  <UserRoundCog size={14} aria-hidden="true" />
                  انتقال به شخص دیگر
                </label>
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
              </section>
            )}
            {canDelete && (
              <button
                className="danger-action issue-action-item"
                disabled={deleteIssue.isPending}
                onClick={() => {
                  if (window.confirm(`کار «${issue.name}» حذف شود؟`)) deleteIssue.mutate(issue);
                  close();
                }}
              >
                <Trash2 size={15} aria-hidden="true" />
                حذف کار
              </button>
            )}
          </PopoverPanel>
        </>
      )}
    </Popover>
    </>
  );
}

export function useFilteredIssues(issues: Issue[], query: string) {
  return useMemo(
    () => issues.filter((issue) => matchesRecordSearch(query, [issue.id, issue.name, issueReference(issue)])),
    [issues, query]
  );
}
