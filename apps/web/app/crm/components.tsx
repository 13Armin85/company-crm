import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
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
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { jalaaliMonthLength, toGregorian, toJalaali } from "jalaali-js";
import {
  useArchiveProject,
  useCreateIssue,
  useCreateProject,
  useCurrentUser,
  useDeleteIssue,
  useDeleteProject,
  useIssues,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useMembers,
  useNotifications,
  useProjects,
  useReassignIssue,
  useTicketRoutingRules,
  useUpdateIssueStatus,
  useWorkspaceAccess,
} from "./api";
import { useUIStore } from "./store";
import type { Issue, Member, Priority, Project, Status } from "./types";
import { persianDate, priorityFa, statusFa, toFa } from "./utils";

export function IconButton({
  children,
  label,
  onClick,
  className = "",
}: {
  children: ReactNode;
  label: string;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button className={`icon-button ${className}`} aria-label={label} title={label} onClick={onClick}>
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

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`status status-${status.replace(" ", "-").toLowerCase()}`}>
      <i />
      {statusFa[status]}
    </span>
  );
}
export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={`priority priority-${priority.toLowerCase()}`}>
      <CircleAlert size={13} />
      {priorityFa[priority]}
    </span>
  );
}

export function IssueRow({
  issue,
  compact = false,
  table = false,
}: {
  issue: Issue;
  compact?: boolean;
  table?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const slug = useUIStore((state) => state.workspaceSlug) ?? "";
  const { data: access } = useWorkspaceAccess();
  const { data: currentUser } = useCurrentUser();
  const updateStatus = useUpdateIssueStatus(slug);
  const deleteIssue = useDeleteIssue(slug);
  const reassignIssue = useReassignIssue(slug);
  const { data: teamMembers = [] } = useMembers();
  const { data: projectMembers = [] } = useMembers(undefined, issue.scope === "project" ? issue.projectId : undefined);
  const navigate = useNavigate();
  const isAdmin = access?.isAdmin === true;
  const eligibleMembers = isAdmin && issue.scope === "project" ? projectMembers : teamMembers;
  const canChangeStatus = isAdmin || issue.assignee?.id === currentUser?.id;
  const canTransfer = isAdmin || issue.assignee?.id === currentUser?.id;
  const statusOptions: Status[] = ["Todo", "In Progress", "Review", "Done", "Blocked"];

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuContainerRef.current?.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  return (
    <div
      className={`issue-row ${compact ? "is-compact" : ""} ${table ? "is-table" : ""} ${menuOpen ? "has-open-menu" : ""}`}
    >
      <button
        className="issue-check"
        aria-label="تکمیل کار"
        disabled={!canChangeStatus}
        onClick={() => issue.status !== "Done" && updateStatus.mutate({ issue, status: "Done" })}
      >
        <CircleDot size={16} />
      </button>
      <button
        type="button"
        className={`issue-main issue-main-button ${issue.scope === "project" ? "is-clickable" : ""}`}
        disabled={!issue.projectId}
        onClick={() => issue.projectId && navigate(`/projects/${issue.projectId}?tab=issues`)}
      >
        <strong>{issue.name}</strong>
        {!table && (
          <span className="issue-code" dir="ltr">
            {issue.scope === "workspace" ? "خارج از پروژه" : `${issue.projectIdentifier}-${toFa(issue.sequenceId)}`}
          </span>
        )}
      </button>
      {table && (
        <span className="issue-project" dir="ltr">
          {issue.scope === "workspace"
            ? `TEAM-${toFa(issue.sequenceId)}`
            : `${issue.projectIdentifier}-${toFa(issue.sequenceId)}`}
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
      <StatusBadge status={issue.status} />
      <PriorityBadge priority={issue.priority} />
      <span className="issue-date">
        <Clock3 size={14} />
        {persianDate(issue.dueDate)}
      </span>
      <div className="issue-actions" ref={menuContainerRef}>
        <span className={table ? "issue-assignee" : ""}>
          <Avatar member={issue.assignee} size="sm" />
          {table && <span>{issue.assignee?.displayName || "بدون مسئول"}</span>}
        </span>
        {canChangeStatus && (
          <button
            ref={menuButtonRef}
            className="plain-icon"
            aria-label="عملیات کار"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <MoreHorizontal size={16} />
          </button>
        )}
        {canChangeStatus && menuOpen && (
          <div className="action-menu issue-action-menu" role="menu">
            <small>تغییر وضعیت</small>
            {statusOptions.map((status) => (
              <button
                key={status}
                disabled={status === issue.status}
                onClick={() => {
                  updateStatus.mutate({ issue, status });
                  setMenuOpen(false);
                }}
              >
                {statusFa[status]}
              </button>
            ))}
            {canTransfer && eligibleMembers.length > 1 && (
              <label className="issue-transfer-control">
                <small>انتقال به عضو دیگر</small>
                <select
                  value={issue.assignee?.id ?? ""}
                  disabled={reassignIssue.isPending}
                  onChange={(event) => {
                    if (event.target.value && event.target.value !== issue.assignee?.id) {
                      reassignIssue.mutate({ issue, assigneeId: event.target.value });
                      setMenuOpen(false);
                    }
                  }}
                >
                  {eligibleMembers.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.displayName}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {isAdmin && (
              <button
                className="danger-action"
                onClick={() => {
                  if (window.confirm(`کار «${issue.name}» حذف شود؟`)) deleteIssue.mutate(issue);
                  setMenuOpen(false);
                }}
              >
                حذف کار
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function ProjectCard({ project }: { project: Project }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const slug = useUIStore((state) => state.workspaceSlug) ?? "";
  const { data: access } = useWorkspaceAccess();
  const isAdmin = access?.isAdmin === true;
  const archiveProject = useArchiveProject(slug, project.id, Boolean(project.archivedAt));
  const deleteProject = useDeleteProject(slug, project.id);
  return (
    <article className="project-card">
      <div className="project-card-head">
        <span className="project-symbol" style={{ background: `${project.color}18`, color: project.color }}>
          {project.identifier.slice(0, 1)}
        </span>
        {isAdmin && (
          <button className="plain-icon" aria-label="منوی پروژه" onClick={() => setMenuOpen((value) => !value)}>
            •••
          </button>
        )}
        {isAdmin && menuOpen && (
          <div className="action-menu">
            {!project.archivedAt && <Link to={`/projects/${project.id}?tab=settings`}>ویرایش پروژه</Link>}
            <button
              onClick={() => {
                archiveProject.mutate();
                setMenuOpen(false);
              }}
            >
              {project.archivedAt ? "خروج از بایگانی" : "بایگانی پروژه"}
            </button>
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
          </div>
        )}
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

const notificationIcons = {
  mention: MessageSquare,
  assignment: CheckCircle2,
  update: Sparkles,
  comment: MessageSquare,
};
export function NotificationDrawer() {
  const open = useUIStore((state) => state.notificationOpen);
  const setOpen = useUIStore((state) => state.setNotificationOpen);
  const { data = [], isLoading } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  return (
    <>
      <button className={`overlay ${open ? "is-open" : ""}`} aria-label="بستن اعلان‌ها" onClick={() => setOpen(false)} />
      <aside className={`notification-drawer ${open ? "is-open" : ""}`}>
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
          <button className="active">همه</button>
          <button onClick={() => markAll.mutate()} disabled={markAll.isPending}>
            خواندن همه
          </button>
        </div>
        <div className="notification-list">
          {isLoading ? (
            <Skeleton rows={5} />
          ) : data.length ? (
            data.map((item) => {
              const Icon = notificationIcons[item.type];
              return (
                <button
                  type="button"
                  key={item.id}
                  className={item.read ? "" : "unread"}
                  onClick={() => !item.read && markRead.mutate(item.id)}
                >
                  <span className="notification-icon">
                    <Icon size={17} />
                  </span>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.description}</p>
                    <time>{persianDate(item.time, { year: "numeric" })}</time>
                  </div>
                  {!item.read && <i />}
                </button>
              );
            })
          ) : (
            <EmptyState
              icon={Bell}
              title="اعلانی ندارید"
              description="همه‌چیز آرام است؛ اعلان‌های تازه اینجا دیده می‌شوند."
            />
          )}
        </div>
        <Link to="/inbox" onClick={() => setOpen(false)} className="drawer-all">
          مشاهده همه اعلان‌ها
        </Link>
      </aside>
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
  const normalizedQuery = query.trim().toLocaleLowerCase("fa");
  const filtered = commands.filter((item) => item.label.includes(query));
  const projectResults = normalizedQuery
    ? projects
        .filter(
          (project) =>
            project.name.toLocaleLowerCase("fa").includes(normalizedQuery) ||
            project.identifier.toLowerCase().includes(normalizedQuery)
        )
        .slice(0, 5)
    : [];
  const issueResults = normalizedQuery
    ? issues
        .filter(
          (issue) =>
            issue.name.toLocaleLowerCase("fa").includes(normalizedQuery) ||
            `${issue.projectIdentifier}-${issue.sequenceId}`.toLowerCase().includes(normalizedQuery)
        )
        .slice(0, 5)
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
              <kbd>
                {issue.scope === "workspace" ? "خارج از پروژه" : `${issue.projectIdentifier}-${toFa(issue.sequenceId)}`}
              </kbd>
            </button>
          ))}
          {normalizedQuery && !filtered.length && !projectResults.length && !issueResults.length && (
            <p className="command-empty">نتیجه‌ای در داده‌های فضای کاری پیدا نشد.</p>
          )}
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
  const location = useLocation();
  const open = useUIStore((state) => state.createOpen);
  const createKind = useUIStore((state) => state.createKind);
  const setOpen = useUIStore((state) => state.setCreateOpen);
  const setFormDirty = useUIStore((state) => state.setFormDirty);
  const [kind, setKind] = useState<"project" | "issue">("issue");
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [projectId, setProjectId] = useState("");
  const [priority, setPriority] = useState<Priority>("Medium");
  const [targetDate, setTargetDate] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [routingRuleId, setRoutingRuleId] = useState("");
  const slug = useUIStore((state) => state.workspaceSlug) ?? "";
  const { data: access } = useWorkspaceAccess();
  const { data: projects = [] } = useProjects();
  const activeProjects = useMemo(() => projects.filter((project) => !project.archivedAt), [projects]);
  const routeProjectId = location.pathname.match(/^\/projects\/([^/]+)/)?.[1];
  const selectedScope =
    projectId ||
    (activeProjects.some((project) => project.id === routeProjectId) ? (routeProjectId ?? "workspace") : "workspace");
  const selectedProjectId = selectedScope === "workspace" ? undefined : selectedScope;
  const { data: members = [] } = useMembers(undefined, selectedProjectId);
  const { data: routingRules = [] } = useTicketRoutingRules(undefined, access?.isAdmin === true);
  const activeRoutingRules = useMemo(() => routingRules.filter((rule) => rule.isActive), [routingRules]);
  const createProject = useCreateProject(slug);
  const createIssue = useCreateIssue(slug, selectedProjectId);
  useEffect(() => {
    if (open) {
      setKind(createKind);
      setProjectId(
        activeProjects.some((project) => project.id === routeProjectId) ? (routeProjectId ?? "") : "workspace"
      );
    }
  }, [activeProjects, createKind, open, routeProjectId]);
  useEffect(() => {
    setFormDirty("quick-create", open && Boolean(name || identifier || targetDate || assigneeId || routingRuleId));
    return () => setFormDirty("quick-create", false);
  }, [assigneeId, identifier, name, open, routingRuleId, setFormDirty, targetDate]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    const done = () => {
      setName("");
      setIdentifier("");
      setProjectId("");
      setTargetDate("");
      setAssigneeId("");
      setRoutingRuleId("");
      setPriority("Medium");
      setOpen(false);
    };
    if (kind === "project") createProject.mutate({ name, identifier, description: "" }, { onSuccess: done });
    else createIssue.mutate({ name, priority, targetDate, assigneeId, routingRuleId }, { onSuccess: done });
  };
  if (!open || !access?.isAdmin) return null;
  return (
    <div
      className="modal-layer"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}
    >
      <form className="create-modal" onSubmit={submit}>
        <header>
          <div>
            <span className="modal-kicker">ایجاد سریع</span>
            <h2>{kind === "issue" ? "کار جدید" : "پروژه جدید"}</h2>
          </div>
          <IconButton label="بستن" onClick={() => setOpen(false)}>
            <X size={19} />
          </IconButton>
        </header>
        <div className="segmented">
          <button type="button" className={kind === "issue" ? "active" : ""} onClick={() => setKind("issue")}>
            کار
          </button>
          <button type="button" className={kind === "project" ? "active" : ""} onClick={() => setKind("project")}>
            پروژه
          </button>
        </div>
        <label>
          <span>عنوان</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={kind === "issue" ? "مثلاً طراحی صفحه پرداخت" : "مثلاً نسخه جدید محصول"}
          />
        </label>
        {kind === "project" ? (
          <label>
            <span>شناسه پروژه</span>
            <input
              dir="ltr"
              value={identifier}
              maxLength={12}
              onChange={(event) => setIdentifier(event.target.value.toUpperCase())}
              placeholder="NEW"
              required
            />
          </label>
        ) : (
          <>
            <label>
              <span>پروژه</span>
              <select
                value={selectedScope}
                onChange={(event) => {
                  setProjectId(event.target.value);
                  setAssigneeId("");
                  setRoutingRuleId("");
                }}
              >
                <option value="workspace">خارج از پروژه (کار مستقل)</option>
                {activeProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-grid">
              <label>
                <span>اولویت</span>
                <select value={priority} onChange={(event) => setPriority(event.target.value as Priority)}>
                  <option value="Urgent">فوری</option>
                  <option value="High">زیاد</option>
                  <option value="Medium">متوسط</option>
                  <option value="Low">کم</option>
                </select>
              </label>
              <label htmlFor="issue-target-date-day">
                <span>تاریخ پایان</span>
                <PersianDateInput id="issue-target-date" value={targetDate} onChange={setTargetDate} />
              </label>
              <label className="wide">
                <span>مسئول مستقیم</span>
                <select
                  value={assigneeId}
                  onChange={(event) => {
                    setAssigneeId(event.target.value);
                    if (event.target.value) setRoutingRuleId("");
                  }}
                >
                  <option value="">بدون مسئول</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.displayName}
                    </option>
                  ))}
                </select>
              </label>
              {selectedProjectId && (
                <label className="wide">
                  <span>یا قانون ارجاع هوشمند</span>
                  <select
                    value={routingRuleId}
                    onChange={(event) => {
                      setRoutingRuleId(event.target.value);
                      if (event.target.value) setAssigneeId("");
                    }}
                  >
                    <option value="">بدون مسیریابی خودکار</option>
                    {activeRoutingRules.map((rule) => (
                      <option key={rule.id} value={rule.id}>
                        {rule.name} — {rule.unitTitle} / {rule.roleName} (Level {toFa(rule.requiredLevel)})
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </>
        )}
        <footer>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            انصراف
          </Button>
          <Button
            type="submit"
            icon={Plus}
            disabled={
              !name.trim() ||
              !slug ||
              (kind === "project" && !identifier.trim()) ||
              (kind === "issue" && !assigneeId && !routingRuleId) ||
              createIssue.isPending ||
              createProject.isPending
            }
          >
            ایجاد {kind === "issue" ? "کار" : "پروژه"}
          </Button>
        </footer>
      </form>
    </div>
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

const persianMonths = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
];

type JalaliParts = { year: number | ""; month: number | ""; day: number | "" };
const jalaliPartsFromValue = (value?: string): JalaliParts => {
  if (!value) return { year: "", month: "", day: "" };
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return { year: "", month: "", day: "" };
  const jalali = toJalaali(year, month, day);
  return { year: jalali.jy, month: jalali.jm, day: jalali.jd };
};

export function PersianDateInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value?: string;
  onChange: (value: string) => void;
}) {
  const [parts, setParts] = useState<JalaliParts>(() => jalaliPartsFromValue(value));
  const now = new Date();
  const currentYear = toJalaali(now.getFullYear(), now.getMonth() + 1, now.getDate()).jy;
  const years = Array.from({ length: 31 }, (_, index) => currentYear - 10 + index);
  if (typeof parts.year === "number" && !years.includes(parts.year)) years.push(parts.year);
  years.sort((a, b) => a - b);

  useEffect(() => setParts(jalaliPartsFromValue(value)), [value]);
  const update = (next: JalaliParts) => {
    if (typeof next.year === "number" && typeof next.month === "number" && typeof next.day === "number") {
      const safeDay = Math.min(next.day, jalaaliMonthLength(next.year, next.month));
      const gregorian = toGregorian(next.year, next.month, safeDay);
      const iso = `${gregorian.gy}-${String(gregorian.gm).padStart(2, "0")}-${String(gregorian.gd).padStart(2, "0")}`;
      setParts({ ...next, day: safeDay });
      onChange(iso);
      return;
    }
    setParts(next);
    onChange("");
  };
  const dayCount =
    typeof parts.year === "number" && typeof parts.month === "number"
      ? jalaaliMonthLength(parts.year, parts.month)
      : 31;
  return (
    <div className="persian-date-input" dir="rtl">
      <select
        id={`${id}-day`}
        aria-label="روز"
        value={parts.day}
        onChange={(event) => update({ ...parts, day: event.target.value ? Number(event.target.value) : "" })}
      >
        <option value="">روز</option>
        {Array.from({ length: dayCount }, (_, index) => index + 1).map((day) => (
          <option key={day} value={day}>
            {toFa(day)}
          </option>
        ))}
      </select>
      <select
        id={`${id}-month`}
        aria-label="ماه"
        value={parts.month}
        onChange={(event) => update({ ...parts, month: event.target.value ? Number(event.target.value) : "" })}
      >
        <option value="">ماه</option>
        {persianMonths.map((month, index) => (
          <option key={month} value={index + 1}>
            {month}
          </option>
        ))}
      </select>
      <select
        id={`${id}-year`}
        aria-label="سال"
        value={parts.year}
        onChange={(event) => update({ ...parts, year: event.target.value ? Number(event.target.value) : "" })}
      >
        <option value="">سال</option>
        {years.map((year) => (
          <option key={year} value={year}>
            {toFa(year)}
          </option>
        ))}
      </select>
      {value && (
        <button type="button" onClick={() => update({ year: "", month: "", day: "" })}>
          پاک‌کردن
        </button>
      )}
    </div>
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
  };
  const chunks = location.pathname.split("/").filter(Boolean);
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
    () =>
      issues.filter(
        (issue) =>
          issue.name.includes(query) ||
          `${issue.projectIdentifier}-${issue.sequenceId}`.toLowerCase().includes(query.toLowerCase())
      ),
    [issues, query]
  );
}
