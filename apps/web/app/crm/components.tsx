import { useDismissMenu } from "./use-dismiss-menu";
import { IdentifierBadge, PersianDatePicker, SearchableSelect } from "@plane/ui";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { Fragment, lazy, Suspense, useContext, useEffect, useMemo, useState } from "react";
import { ChoiceLabelsContext } from "./choice-label-context";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  Archive,
  Bell,
  CheckCircle2,
  CircleAlert,
  CircleDot,
  Clock3,
  FolderKanban,
  Inbox,
  MessageSquare,
  MoreHorizontal,
  Search,
  Sparkles,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  useArchiveProject,
  useCurrentUser,
  useDeleteIssue,
  useDeleteProject,
  useIssues,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useMembers,
  useNotifications,
  useNotificationDetails,
  useOrganizationRoles,
  useOrganizationUnits,
  useProjects,
  useReassignIssue,
  useTicketRoutingRules,
  useUpdateIssueStatus,
  useWorkspaceAccess,
} from "./api";
import { AccessModal } from "./access/components";
import { useUIStore } from "./store";
import type { Issue, Member, NotificationItem, Priority, Project, Status } from "./types";
import { persianDate, priorityFa, statusFa, toFa } from "./utils";
import { issueReference, matchesRecordSearch } from "./identifiers";
import { canChangeIssueStatus, canTransferIssue } from "./task-access";

const EngineQuickCreate = lazy(() => import("./engine/quick-create"));

export function IconButton({
  children,
  label,
  onClick,
  className = "",
  disabled = false,
}: {
  children: ReactNode;
  label: string;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`icon-button ${className}`}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="section-header">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  icon: Icon,
  onClick,
  type = "button",
  disabled,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  icon?: LucideIcon;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button className={`button button-${variant}`} type={type} onClick={onClick} disabled={disabled}>
      {Icon && <Icon size={16} />}
      {children}
    </button>
  );
}

export function Avatar({ member, size = "md" }: { member?: Member; size?: "sm" | "md" | "lg" }) {
  if (!member) return <span className={`avatar avatar-${size} avatar-empty`}>؟</span>;
  return (
    <span className={`avatar avatar-${size}`} style={{ background: member.avatarColor }} title={member.displayName}>
      {member.avatarUrl ? <img src={member.avatarUrl} alt={member.displayName} /> : member.initials}
      {member.online && <i />}
    </span>
  );
}

export function AvatarStack({ members = [], max = 3 }: { members?: Member[]; max?: number }) {
  return (
    <div className="avatar-stack">
      {members.slice(0, max).map((member) => (
        <Avatar key={member.id} member={member} size="sm" />
      ))}
      {members.length > max && <span className="avatar avatar-sm avatar-more">+{toFa(members.length - max)}</span>}
    </div>
  );
}

export function StatusBadge({
  status,
  code,
  label,
  color,
}: {
  status: Status;
  code?: string;
  label?: string;
  color?: string;
}) {
  const choices = useContext(ChoiceLabelsContext);
  const option = choices.task_status.find((o) => o.id === code);
  const title =
    label && !["Backlog", "Todo", "In Progress", "Review", "Done", "Blocked", "Cancelled"].includes(label)
      ? label
      : label
        ? statusFa[status]
        : option?.title || statusFa[status];
  return (
    <span
      className={`status status-${status.replace(" ", "-").toLowerCase()}`}
      style={{ color: color || option?.color }}
    >
      <i />
      {title}
    </span>
  );
}
export function PriorityBadge({ priority, code }: { priority: Priority; code?: string }) {
  const choices = useContext(ChoiceLabelsContext);
  const option = choices.priority.find((o) => o.id === (code || priority.toLowerCase()));
  return (
    <span className={`priority priority-${priority.toLowerCase()}`} style={{ color: option?.color }}>
      <CircleAlert size={13} />
      {option?.title ||
        (code && !["urgent", "high", "medium", "low", "none"].includes(code) ? code : priorityFa[priority])}
    </span>
  );
}

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
            .map((option) => ({ ...option, status: semanticStatus[option.id] || ("Todo" as Status) }))
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

export function ProjectCard({ project }: { project: Project }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useDismissMenu(menuOpen, () => setMenuOpen(false));
  const slug = useUIStore((state) => state.workspaceSlug) ?? "";
  const { data: access } = useWorkspaceAccess();
  const canEdit = access?.can("Project.Edit") === true;
  const canDelete = access?.can("Project.Delete") === true;
  const archiveProject = useArchiveProject(slug, project.id, Boolean(project.archivedAt));
  const deleteProject = useDeleteProject(slug, project.id);
  return (
    <article className="project-card">
      <div className="project-card-head">
        <span className="project-symbol" style={{ background: `${project.color}18`, color: project.color }}>
          {project.identifier.slice(0, 1)}
        </span>
        <div className="menu-anchor" ref={menuRef}>
          {(canEdit || canDelete) && (
            <button
              className="plain-icon"
              aria-label="منوی پروژه"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((value) => !value)}
            >
              •••
            </button>
          )}
          {(canEdit || canDelete) && menuOpen && (
            <div className="action-menu">
              {canEdit && !project.archivedAt && <Link to={`/projects/${project.id}?tab=settings`}>ویرایش پروژه</Link>}
              {canEdit && (
                <button
                  onClick={() => {
                    archiveProject.mutate();
                    setMenuOpen(false);
                  }}
                >
                  {project.archivedAt ? "خروج از بایگانی" : "بایگانی پروژه"}
                </button>
              )}
              {canDelete && (
                <button
                  className="danger-action"
                  disabled={deleteProject.isPending}
                  onClick={() => {
                    if (window.confirm(`پروژه «${project.name}» و همه اطلاعات وابسته به آن حذف شود؟`)) {
                      deleteProject.mutate();
                    }
                    setMenuOpen(false);
                  }}
                >
                  <Trash2 size={15} /> حذف پروژه
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <Link to={project.archivedAt ? "/projects" : `/projects/${project.id}`} className="project-card-link">
        <h3>{project.name}</h3>
        <p>{project.description || "توضیحی برای این پروژه ثبت نشده است."}</p>
        <div className="project-progress-label">
          <span>{toFa(project.progress ?? 0)}٪ پیشرفت</span>
          <span>
            {toFa(project.completedIssues ?? 0)} از {toFa(project.totalIssues ?? 0)} کار
          </span>
        </div>
        <div className="progress">
          <i style={{ width: `${project.progress ?? 0}%`, background: project.color }} />
        </div>
        <footer>
          <AvatarStack members={project.members} />
          <span>
            <Clock3 size={14} /> {persianDate(project.targetDate)}
          </span>
        </footer>
      </Link>
      <IdentifierBadge value={project.identifier} label="شناسه پروژه" />
    </article>
  );
}

export function Skeleton({ rows = 3, cards = false }: { rows?: number; cards?: boolean }) {
  return (
    <div className={cards ? "skeleton-grid" : "skeleton-list"}>
      {Array.from({ length: rows }, (_, index) => `skeleton-${index + 1}`).map((id) => (
        <div className={cards ? "skeleton-card" : "skeleton-row"} key={id}>
          <i />
          <span />
          <b />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon: Icon = Archive,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span>
        <Icon size={24} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function ToastRegion() {
  const toasts = useUIStore((state) => state.toasts);
  const remove = useUIStore((state) => state.removeToast);
  return (
    <div className="toast-region" aria-live="polite">
      {toasts.map((toast) => (
        <button key={toast.id} className={`toast toast-${toast.kind}`} onClick={() => remove(toast.id)}>
          <CheckCircle2 size={18} />
          <span>{toast.message}</span>
          <X size={14} />
        </button>
      ))}
    </div>
  );
}

export function NotificationDetails({
  notification: selected,
  onClose,
}: {
  notification: NotificationItem;
  onClose: () => void;
}) {
  const notification = useNotificationDetails(selected.id);
  const { data: currentUser } = useCurrentUser();
  const details = notification.data ?? selected;
  return (
    <AccessModal title="جزئیات اعلان" onClose={() => onClose()}>
      <section className="notification-details">
        <h3>{details.title}</h3>
        <IdentifierBadge value={details.id} label="شناسه اعلان" />
        <dl>
          {details.eventLabel && (
            <>
              <dt>نوع رویداد</dt>
              <dd>{details.eventLabel}</dd>
            </>
          )}
          {details.entityName && (
            <>
              <dt>کار مرتبط</dt>
              <dd>{details.entityName}</dd>
            </>
          )}
          {details.projectName && (
            <>
              <dt>پروژه</dt>
              <dd>{details.projectName}</dd>
            </>
          )}
          {details.actor && (
            <>
              <dt>انجام‌دهنده</dt>
              <dd>{details.actor}</dd>
            </>
          )}
          <dt>زمان</dt>
          <dd>
            {persianDate(details.time, {
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              timeZone: currentUser?.timeZone,
            })}
          </dd>
        </dl>
        {details.changes && (
          <dl aria-label="جزئیات تغییر">
            {details.changes.map((change) => (
              <Fragment key={change.label}>
                <dt>{change.label}</dt>
                <dd>{change.value}</dd>
              </Fragment>
            ))}
          </dl>
        )}
        {notification.isLoading && <p role="status">در حال دریافت متن کامل…</p>}
        {notification.isError && (
          <div role="alert" className="inline-error">
            جزئیات اعلان دریافت نشد.
            <Button variant="secondary" onClick={() => void notification.refetch()}>
              تلاش دوباره
            </Button>
          </div>
        )}
        <p className="notification-message">{details.description || "متن تکمیلی برای این اعلان ثبت نشده است."}</p>
      </section>
      <footer>
        {details.actionHref ? (
          <Link className="button button-secondary" to={details.actionHref} onClick={() => onClose()}>
            {details.actionLabel}
          </Link>
        ) : (
          details.projectId && (
            <Link
              className="button button-secondary"
              to={`/projects/${details.projectId}?tab=issues`}
              onClick={() => onClose()}
            >
              مشاهده کارهای پروژه
            </Link>
          )
        )}
        <Button onClick={() => onClose()}>بستن</Button>
      </footer>
    </AccessModal>
  );
}

const notificationIcons = {
  mention: MessageSquare,
  assignment: CheckCircle2,
  update: Sparkles,
  comment: MessageSquare,
  security: ShieldCheck,
};
export function NotificationDrawer() {
  const open = useUIStore((state) => state.notificationOpen);
  const setOpen = useUIStore((state) => state.setNotificationOpen);
  const { data = [], isLoading, isError, refetch } = useNotifications();
  const [tab, setTab] = useState<"all" | "unread">("all");
  const shown = tab === "unread" ? data.filter((item) => !item.read) : data;
  useEffect(() => {
    if (open) void refetch();
  }, [open, refetch]);
  const [selected, setSelected] = useState<NotificationItem>();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  return (
    <>
      <button className={`overlay ${open ? "is-open" : ""}`} aria-label="بستن اعلان‌ها" onClick={() => setOpen(false)} />
      <aside
        className={`notification-drawer ${open ? "is-open" : ""}`}
        aria-label="اعلان‌های شما"
        aria-hidden={!open}
        inert={!open}
      >
        <header>
          <div>
            <h2>اعلان‌ها</h2>
            <span>{toFa(data.filter((item) => !item.read).length)} خوانده‌نشده</span>
          </div>
          <IconButton label="بستن" onClick={() => setOpen(false)}>
            <X size={19} />
          </IconButton>
        </header>
        <div className="drawer-filter">
          <button
            type="button"
            className={tab === "all" ? "active" : ""}
            aria-pressed={tab === "all"}
            onClick={() => setTab("all")}
          >
            همه
          </button>
          <button
            type="button"
            className={tab === "unread" ? "active" : ""}
            aria-pressed={tab === "unread"}
            onClick={() => setTab("unread")}
          >
            خوانده‌نشده
          </button>
          <button
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending || isLoading || data.every((item) => item.read)}
          >
            خواندن همه
          </button>
        </div>
        <div className="notification-list">
          {isError && (
            <div role="alert" className="inline-error">
              اعلان‌ها دریافت نشدند.
              <Button variant="secondary" onClick={() => void refetch()}>
                تلاش دوباره
              </Button>
            </div>
          )}
          {isLoading ? (
            <Skeleton rows={5} />
          ) : shown.length ? (
            shown.map((item) => {
              const Icon = notificationIcons[item.type];
              return (
                <button
                  type="button"
                  key={item.id}
                  className={item.read ? "" : "unread"}
                  onClick={() => {
                    setSelected(item);
                    setOpen(false);
                    if (!item.read) markRead.mutate(item.id);
                  }}
                >
                  <span className="notification-icon">
                    <Icon size={17} />
                  </span>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.preview ?? item.description}</p>
                    {(item.entityName || item.projectName) && (
                      <small className="notification-context">
                        {[
                          item.entityName ? `کار: ${item.entityName}` : undefined,
                          item.projectName ? `پروژه: ${item.projectName}` : undefined,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    )}
                    <time>{persianDate(item.time, { year: "numeric" })}</time>
                  </div>
                  {!item.read && <i />}
                </button>
              );
            })
          ) : !isError ? (
            <EmptyState
              icon={Bell}
              title={tab === "unread" ? "اعلان خوانده‌نشده‌ای ندارید" : "اعلانی ندارید"}
              description="اعلان‌های تازه اینجا دیده می‌شوند."
            />
          ) : null}
        </div>
        <Link to="/inbox" onClick={() => setOpen(false)} className="drawer-all">
          مشاهده همه اعلان‌ها
        </Link>
      </aside>
      {selected && <NotificationDetails notification={selected} onClose={() => setSelected(undefined)} />}
    </>
  );
}

const commands = [
  { label: "رفتن به خانه", hint: "G H", path: "/", icon: Sparkles },
  { label: "مشاهده پروژه‌ها", hint: "G P", path: "/projects", icon: FolderKanban },
  { label: "کارهای من", hint: "G M", path: "/my-work", icon: CheckCircle2 },
  { label: "صندوق ورودی", hint: "", path: "/inbox", icon: Inbox },
];
export function CommandPalette() {
  const open = useUIStore((state) => state.commandOpen);
  const setOpen = useUIStore((state) => state.setCommandOpen);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const { data: projects = [] } = useProjects();
  const { data: issues = [] } = useIssues();
  const { data: access } = useWorkspaceAccess();
  const { data: members = [] } = useMembers(undefined, undefined, open && access?.can("User.View") === true);
  const { data: roles = [] } = useOrganizationRoles(undefined, open && access?.can("Role.View") === true);
  const { data: units = [] } = useOrganizationUnits(undefined, open && access?.can("OrganizationUnit.View") === true);
  const { data: rules = [] } = useTicketRoutingRules(undefined, open && access?.can("Routing.View") === true);
  const filtered = commands.filter((item) => matchesRecordSearch(query, [item.label]));
  const projectResults = query.trim()
    ? projects
        .filter((project) => matchesRecordSearch(query, [project.id, project.name, project.identifier]))
        .slice(0, 5)
    : [];
  const issueResults = query.trim()
    ? issues.filter((issue) => matchesRecordSearch(query, [issue.id, issue.name, issueReference(issue)])).slice(0, 5)
    : [];
  const recordResults = query.trim()
    ? [
        ...(access?.can("User.View")
          ? members
              .filter((member) =>
                matchesRecordSearch(query, [member.id, member.membershipId, member.displayName, member.email])
              )
              .map((member) => ({ id: member.id, name: `کاربر: ${member.displayName}`, path: `/team/${member.id}` }))
          : []),
        ...(access?.can("Role.View")
          ? roles
              .filter((role) => matchesRecordSearch(query, [role.id, role.name, role.description]))
              .map((role) => ({
                id: role.id,
                name: `نقش: ${role.name}`,
                path: `/roles?search=${encodeURIComponent(role.id)}`,
              }))
          : []),
        ...(access?.can("OrganizationUnit.View")
          ? units
              .filter((unit) => matchesRecordSearch(query, [unit.id, unit.title]))
              .map((unit) => ({
                id: unit.id,
                name: `واحد: ${unit.title}`,
                path: `/organization?search=${encodeURIComponent(unit.id)}`,
              }))
          : []),
        ...(access?.can("Routing.Manage")
          ? rules
              .filter((rule) => matchesRecordSearch(query, [rule.id, rule.name]))
              .map((rule) => ({
                id: rule.id,
                name: `ارجاع: ${rule.name}`,
                path: `/routing?search=${encodeURIComponent(rule.id)}`,
              }))
          : []),
      ].slice(0, 10)
    : [];
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);
  if (!open) return null;
  return (
    <div
      className="modal-layer"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}
    >
      <section className="command-modal">
        <div className="command-input">
          <Search size={20} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="جستجو یا اجرای یک دستور..."
          />
          <kbd>ESC</kbd>
        </div>
        <div className="command-results">
          <small>پیشنهادها</small>
          {filtered.map(({ label, hint, path, icon: Icon }) => (
            <button
              key={path}
              onClick={() => {
                navigate(path);
                setOpen(false);
              }}
            >
              <Icon size={18} />
              <span>{label}</span>
              {hint && <kbd>{hint}</kbd>}
            </button>
          ))}
          {projectResults.length > 0 && <small>پروژه‌ها</small>}
          {projectResults.map((project) => (
            <button
              key={`project-${project.id}`}
              onClick={() => {
                navigate(`/projects/${project.id}`);
                setOpen(false);
              }}
            >
              <FolderKanban size={18} />
              <span>{project.name}</span>
              <kbd>{project.identifier}</kbd>
            </button>
          ))}
          {issueResults.length > 0 && <small>کارها</small>}
          {issueResults.map((issue) => (
            <button
              key={`issue-${issue.id}`}
              onClick={() => {
                navigate(issue.projectId ? `/projects/${issue.projectId}?tab=issues` : "/my-work");
                setOpen(false);
              }}
            >
              <CircleDot size={18} />
              <span>{issue.name}</span>
              <kbd>{issueReference(issue)}</kbd>
            </button>
          ))}
          {recordResults.length > 0 && <small>سازمان</small>}
          {recordResults.map((record) => (
            <button
              key={record.path}
              onClick={() => {
                navigate(record.path);
                setOpen(false);
              }}
            >
              <Search size={18} />
              <span>{record.name}</span>
              <kbd dir="ltr" title={record.id}>
                {record.id}
              </kbd>
            </button>
          ))}
          {query.trim() &&
            !filtered.length &&
            !projectResults.length &&
            !issueResults.length &&
            !recordResults.length && <p className="command-empty">نتیجه‌ای در داده‌های فضای کاری پیدا نشد.</p>}
        </div>
        <footer>
          <span>
            <b>↑↓</b> پیمایش
          </span>
          <span>
            <b>Enter</b> انتخاب
          </span>
          <span>
            <b>Esc</b> بستن
          </span>
        </footer>
      </section>
    </div>
  );
}

export function CreateModal() {
  const open = useUIStore((state) => state.createOpen);
  const createKind = useUIStore((state) => state.createKind);
  const location = useLocation();
  const { data: access } = useWorkspaceAccess();
  if (
    !open ||
    !access?.can(createKind === "project" ? "Project.Create" : "Issue.Create") ||
    (createKind !== "project" && location.pathname.replace(/\/+$/, "") === "/my-work")
  )
    return null;
  return (
    <Suspense fallback={<Skeleton rows={3} />}>
      <EngineQuickCreate />
    </Suspense>
  );
}

export function TabBar({
  items,
  active,
  onChange,
}: {
  items: { id: string; label: string; count?: number }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="tab-bar">
      {items.map((item) => (
        <button key={item.id} className={item.id === active ? "active" : ""} onClick={() => onChange(item.id)}>
          {item.label}
          {item.count !== undefined && <span>{toFa(item.count)}</span>}
        </button>
      ))}
    </div>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder = "جستجو...",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="search-box">
      <Search size={17} />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

export function PersianDateInput({
  id,
  value,
  onChange,
  disabled,
  label,
}: {
  id: string;
  value?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const { data: user } = useCurrentUser();
  return (
    <PersianDatePicker
      label={label}
      disabled={disabled}
      id={id}
      value={value}
      onChange={onChange}
      timeZone={user?.timeZone}
    />
  );
}

export function Breadcrumb() {
  const location = useLocation();
  const names: Record<string, string> = {
    projects: "پروژه‌ها",
    issues: "همه کارها",
    "my-work": "کارهای من",
    inbox: "صندوق ورودی",
    calendar: "تقویم",
    team: "اعضای تیم",
    organization: "ساختار سازمانی",
    roles: "نقش‌های سازمانی",
    routing: "ارجاع هوشمند",
    settings: "تنظیمات",
    edit: "فرم",
    task: "وظیفه",
    ticket: "کار پروژه",
    project: "پروژه",
    leave: "عدم حضور",
    engine: "طراحی فرم‌ها و جدول‌ها",
  };
  const chunks = location.pathname.startsWith("/entities")
    ? []
    : location.pathname
        .split("/")
        .filter(Boolean)
        .filter((_, index) => !location.pathname.startsWith("/edit/") || index < 2);
  return (
    <div className="breadcrumb">
      <Link to="/">خانه</Link>
      {chunks.map((chunk, index) => (
        <span key={chunk}>
          / <b>{index === 1 && chunks[0] === "projects" ? "جزئیات پروژه" : (names[chunk] ?? chunk)}</b>
        </span>
      ))}
    </div>
  );
}

export function useFilteredIssues(issues: Issue[], query: string) {
  return useMemo(
    () => issues.filter((issue) => matchesRecordSearch(query, [issue.id, issue.name, issueReference(issue)])),
    [issues, query]
  );
}
