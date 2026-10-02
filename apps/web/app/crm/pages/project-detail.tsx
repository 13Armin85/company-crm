import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  Activity,
  Archive,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  Clock3,
  MoreHorizontal,
  Plus,
  Save,
  Settings2,
  Target,
  Trash2,
  Users,
} from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import {
  useActivities,
  useAddProjectMember,
  useArchiveProject,
  useCreateCycle,
  useCurrentUser,
  useDeleteProject,
  useIssues,
  useMembers,
  useProject,
  useRemoveProjectMember,
  useUpdateIssueStatus,
  useUpdateProject,
  useWorkspaceAccess,
  useCycles,
} from "../api";
import { Avatar, AvatarStack, Button, EmptyState, IssueRow, PersianDateInput, Skeleton, TabBar } from "../components";
import { useUIStore } from "../store";
import type { Status } from "../types";
import { persianDate, statusFa, toFa } from "../utils";

const tabs = [
  { id: "overview", label: "نمای کلی" },
  { id: "issues", label: "کارها" },
  { id: "board", label: "برد" },
  { id: "cycles", label: "چرخه‌ها" },
  { id: "calendar", label: "تقویم" },
  { id: "activity", label: "فعالیت" },
  { id: "settings", label: "تنظیمات" },
];
const statuses: Status[] = ["Todo", "In Progress", "Review", "Done", "Blocked"];

export default function ProjectDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") || "overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const slug = useUIStore((state) => state.workspaceSlug) ?? "";
  const setCreate = useUIStore((state) => state.setCreateOpen);
  const projectQuery = useProject(id);
  const issuesQuery = useIssues(undefined, id);
  const membersQuery = useMembers(undefined, id);
  const workspaceMembersQuery = useMembers();
  const { data: access } = useWorkspaceAccess();
  const { data: currentUser } = useCurrentUser();
  const isAdmin = access?.isAdmin === true;
  const cyclesQuery = useCycles(id);
  const project = projectQuery.data;
  const issues = issuesQuery.data ?? [];
  const members = membersQuery.data ?? [];
  const activityQuery = useActivities(id, issues);
  const updateStatus = useUpdateIssueStatus(slug);
  const archive = useArchiveProject(slug, id);
  const deleteProject = useDeleteProject(slug, id);
  const complete = issues.filter((item) => item.status === "Done").length;
  const progress = issues.length ? Math.round((complete / issues.length) * 100) : 0;

  useEffect(() => {
    if (access && !isAdmin && tab === "settings") setTab("overview");
  }, [access, isAdmin, tab]);

  if (projectQuery.isLoading) return <Skeleton rows={5} />;
  if (!project) return <EmptyState title="پروژه پیدا نشد" description="پروژه حذف شده یا به آن دسترسی ندارید." />;
  return (
    <div>
      <div className="project-hero">
        <div className="project-title">
          <span style={{ background: `${project.color}18`, color: project.color }}>{project.identifier[0]}</span>
          <div>
            <small>{project.identifier}</small>
            <h1>{project.name}</h1>
            <p>{project.description || "برای این پروژه توضیحی ثبت نشده است."}</p>
          </div>
        </div>
        <div className="page-actions">
          <Button variant="secondary" icon={Users} onClick={() => setTab("overview")}>
            اعضای پروژه ({toFa(members.length)})
          </Button>
          {isAdmin && (
            <Button icon={Plus} onClick={() => setCreate(true, "issue")}>
              کار جدید
            </Button>
          )}
          {isAdmin && (
            <div className="menu-anchor">
              <button className="icon-button" aria-label="منوی پروژه" onClick={() => setMenuOpen((value) => !value)}>
                <MoreHorizontal size={19} />
              </button>
              {menuOpen && (
                <div className="action-menu">
                  <button
                    onClick={() => {
                      setTab("settings");
                      setMenuOpen(false);
                    }}
                  >
                    ویرایش مشخصات
                  </button>
                  <button
                    onClick={() => {
                      archive.mutate();
                      setMenuOpen(false);
                    }}
                  >
                    <Archive size={15} /> بایگانی پروژه
                  </button>
                  <button
                    className="danger-action"
                    disabled={deleteProject.isPending}
                    onClick={() => {
                      setMenuOpen(false);
                      if (window.confirm(`پروژه «${project.name}» و همه اطلاعات وابسته به آن حذف شود؟`)) {
                        deleteProject.mutate(undefined, { onSuccess: () => navigate("/projects", { replace: true }) });
                      }
                    }}
                  >
                    <Trash2 size={15} /> حذف پروژه
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <TabBar
        items={tabs
          .filter((item) => item.id !== "settings" || isAdmin)
          .map((item) => ({
            id: item.id,
            label: item.label,
            count: item.id === "issues" ? issues.length : undefined,
          }))}
        active={tab}
        onChange={setTab}
      />
      {tab === "overview" && (
        <Overview
          project={project}
          issues={issues}
          members={members}
          progress={progress}
          loading={issuesQuery.isLoading}
          onIssues={() => setTab("issues")}
        />
      )}
      {tab === "issues" && (
        <div className="panel tab-content">
          {issuesQuery.isLoading ? (
            <Skeleton rows={6} />
          ) : issues.length ? (
            issues.map((issue) => <IssueRow key={issue.id} issue={issue} />)
          ) : (
            <EmptyState
              title="هنوز کاری ثبت نشده"
              description="اولین کار این پروژه را ایجاد کنید."
              action={
                isAdmin ? (
                  <Button icon={Plus} onClick={() => setCreate(true, "issue")}>
                    کار جدید
                  </Button>
                ) : undefined
              }
            />
          )}
        </div>
      )}
      {tab === "board" && (
        <div className="project-board">
          {statuses.map((status) => (
            <section className="kanban-column" key={status}>
              <header>
                <span>
                  <i />
                  {statusFa[status]} <b>{toFa(issues.filter((i) => i.status === status).length)}</b>
                </span>
              </header>
              <div>
                {issues
                  .filter((i) => i.status === status)
                  .map((issue) => (
                    <article className="kanban-card" key={issue.id}>
                      <h3>{issue.name}</h3>
                      <small dir="ltr">
                        {project.identifier}-{issue.sequenceId}
                      </small>
                      <select
                        value={issue.status}
                        disabled={!isAdmin && issue.assignee?.id !== currentUser?.id}
                        onChange={(event) => updateStatus.mutate({ issue, status: event.target.value as Status })}
                      >
                        {statuses.map((value) => (
                          <option key={value} value={value}>
                            {statusFa[value]}
                          </option>
                        ))}
                      </select>
                    </article>
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {tab === "cycles" && (
        <CyclesTab
          slug={slug}
          projectId={id}
          cycles={cyclesQuery.data ?? []}
          loading={cyclesQuery.isLoading}
          canManage={isAdmin}
        />
      )}
      {tab === "calendar" && (
        <div className="panel tab-content">
          <h2>موعدهای پروژه</h2>
          {issues.filter((item) => item.dueDate).length ? (
            issues
              .filter((item) => item.dueDate)
              .map((issue) => (
                <div className="calendar-agenda-row" key={issue.id}>
                  <CalendarDays size={17} />
                  <time>{persianDate(issue.dueDate)}</time>
                  <IssueRow issue={issue} compact />
                </div>
              ))
          ) : (
            <EmptyState
              icon={CalendarDays}
              title="موعدی ثبت نشده"
              description="برای کارها تاریخ پایان تعیین کنید تا اینجا نمایش داده شوند."
            />
          )}
        </div>
      )}
      {tab === "activity" && (
        <div className="panel tab-content">
          <h2>تاریخچه فعالیت واقعی</h2>
          {activityQuery.isLoading ? (
            <Skeleton rows={5} />
          ) : activityQuery.data?.length ? (
            activityQuery.data.map((item) => (
              <article className="activity-row" key={item.id}>
                <span>
                  <Activity size={17} />
                </span>
                <div>
                  <strong>{item.actor}</strong>
                  <p>{item.message}</p>
                  <time>{persianDate(item.createdAt)}</time>
                </div>
              </article>
            ))
          ) : (
            <EmptyState
              icon={Activity}
              title="فعالیتی ثبت نشده"
              description="تغییرات کارها در این بخش نمایش داده می‌شود."
            />
          )}
        </div>
      )}
      {tab === "settings" && isAdmin && (
        <ProjectSettings
          slug={slug}
          project={project}
          members={members}
          workspaceMembers={workspaceMembersQuery.data ?? []}
        />
      )}
    </div>
  );
}

function Overview({
  project,
  issues,
  members,
  progress,
  loading,
  onIssues,
}: {
  project: NonNullable<ReturnType<typeof useProject>["data"]>;
  issues: NonNullable<ReturnType<typeof useIssues>["data"]>;
  members: NonNullable<ReturnType<typeof useMembers>["data"]>;
  progress: number;
  loading: boolean;
  onIssues: () => void;
}) {
  const lead = project.projectLead ?? members.find((member) => member.id === project.projectLeadId);
  return (
    <div className="project-overview redesigned-overview">
      <section className="overview-main">
        <div className="stats-grid project-stats">
          <article>
            <span className="stat-icon blue">
              <CircleDot size={21} />
            </span>
            <div>
              <p>کل کارها</p>
              <strong>{toFa(issues.length)}</strong>
            </div>
          </article>
          <article>
            <span className="stat-icon green">
              <CheckCircle2 size={21} />
            </span>
            <div>
              <p>تکمیل‌شده</p>
              <strong>{toFa(issues.filter((i) => i.status === "Done").length)}</strong>
            </div>
          </article>
          <article>
            <span className="stat-icon orange">
              <Clock3 size={21} />
            </span>
            <div>
              <p>در جریان</p>
              <strong>{toFa(issues.filter((i) => i.status === "In Progress").length)}</strong>
            </div>
          </article>
        </div>
        <div className="panel">
          <div className="section-header">
            <div>
              <h2>کارهای اخیر</h2>
              <p>داده مستقیم از پروژه</p>
            </div>
            <button onClick={onIssues}>مشاهده همه</button>
          </div>
          {loading ? <Skeleton /> : issues.slice(0, 5).map((issue) => <IssueRow key={issue.id} issue={issue} />)}
        </div>
      </section>
      <aside>
        <div className="panel project-about-new">
          <header>
            <span>
              <Target size={18} />
            </span>
            <div>
              <h2>درباره پروژه</h2>
              <p>نمای زنده وضعیت و تیم</p>
            </div>
          </header>
          <div className="about-progress">
            <div>
              <strong>{toFa(progress)}٪</strong>
              <span>پیشرفت کل</span>
            </div>
            <span className="progress">
              <i style={{ width: `${progress}%`, background: project.color }} />
            </span>
            <small>
              {toFa(issues.filter((i) => i.status === "Done").length)} از {toFa(issues.length)} کار تکمیل شده
            </small>
          </div>
          <div className="about-meta">
            <div>
              <span>
                <CalendarDays size={16} /> تاریخ پایان
              </span>
              <strong>{persianDate(project.targetDate)}</strong>
            </div>
            <div>
              <span>
                <Settings2 size={16} /> مدیر پروژه
              </span>
              <strong>{lead?.displayName || "تعیین نشده"}</strong>
            </div>
          </div>
          <div className="about-team">
            <div>
              <span>اعضای پروژه</span>
              <b>{toFa(members.length)} نفر</b>
            </div>
            <AvatarStack members={members} max={6} />
            <div className="member-names">
              {members.slice(0, 4).map((member) => (
                <span key={member.id}>
                  <Avatar member={member} size="sm" />
                  {member.displayName}
                </span>
              ))}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function CyclesTab({
  slug,
  projectId,
  cycles,
  loading,
  canManage,
}: {
  slug: string;
  projectId: string;
  cycles: NonNullable<ReturnType<typeof useCycles>["data"]>;
  loading: boolean;
  canManage: boolean;
}) {
  const [name, setName] = useState(""),
    [start, setStart] = useState(""),
    [end, setEnd] = useState("");
  const createCycle = useCreateCycle(slug, projectId);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim())
      createCycle.mutate(
        { name, start_date: start || undefined, end_date: end || undefined },
        {
          onSuccess: () => {
            setName("");
            setStart("");
            setEnd("");
          },
        }
      );
  };
  return (
    <div className={canManage ? "split-tab" : ""}>
      {canManage && (
        <form className="panel cycle-form" onSubmit={submit}>
          <h2>چرخه جدید</h2>
          <label>
            <span>نام چرخه</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label htmlFor="cycle-start-day">
            <span>شروع</span>
            <PersianDateInput id="cycle-start" value={start} onChange={setStart} />
          </label>
          <label htmlFor="cycle-end-day">
            <span>پایان</span>
            <PersianDateInput id="cycle-end" value={end} onChange={setEnd} />
          </label>
          <Button type="submit" icon={Plus} disabled={createCycle.isPending}>
            ساخت چرخه
          </Button>
        </form>
      )}
      <section className="panel tab-content">
        <h2>چرخه‌های پروژه</h2>
        {loading ? (
          <Skeleton />
        ) : cycles.length ? (
          cycles.map((cycle) => (
            <article className="cycle-card" key={cycle.id}>
              <div>
                <strong>{cycle.name}</strong>
                <p>{cycle.description || "بدون توضیح"}</p>
              </div>
              <span>
                {persianDate(cycle.startDate)} تا {persianDate(cycle.endDate)}
              </span>
            </article>
          ))
        ) : (
          <EmptyState title="چرخه‌ای وجود ندارد" description="اولین چرخه زمانی پروژه را بسازید." />
        )}
      </section>
    </div>
  );
}

function ProjectSettings({
  slug,
  project,
  members,
  workspaceMembers,
}: {
  slug: string;
  project: NonNullable<ReturnType<typeof useProject>["data"]>;
  members: NonNullable<ReturnType<typeof useMembers>["data"]>;
  workspaceMembers: NonNullable<ReturnType<typeof useMembers>["data"]>;
}) {
  const [name, setName] = useState(project.name),
    [identifier, setIdentifier] = useState(project.identifier),
    [description, setDescription] = useState(project.description || ""),
    [targetDate, setTargetDate] = useState(project.targetDate || ""),
    [lead, setLead] = useState(project.projectLeadId || "");
  const update = useUpdateProject(slug, project.id);
  const addMember = useAddProjectMember(slug, project.id);
  const removeMember = useRemoveProjectMember(slug, project.id);
  const [memberToAdd, setMemberToAdd] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    update.mutate({ name, identifier, description, targetDate, projectLeadId: lead });
  };
  return (
    <form className="panel project-settings-form" onSubmit={submit}>
      <header>
        <div>
          <h2>تنظیمات پروژه</h2>
          <p>تمام تغییرات مستقیماً در بک‌اند ذخیره می‌شوند.</p>
        </div>
        <Button type="submit" icon={Save} disabled={update.isPending}>
          ذخیره تغییرات
        </Button>
      </header>
      <div className="form-grid">
        <label>
          <span>نام پروژه</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span>شناسه</span>
          <input dir="ltr" value={identifier} onChange={(e) => setIdentifier(e.target.value.toUpperCase())} />
        </label>
        <label className="wide">
          <span>توضیحات</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label htmlFor="project-target-date-day">
          <span>تاریخ پایان</span>
          <PersianDateInput id="project-target-date" value={targetDate} onChange={setTargetDate} />
        </label>
        <label>
          <span>مدیر پروژه</span>
          <select value={lead} onChange={(e) => setLead(e.target.value)}>
            <option value="">تعیین نشده</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName}
              </option>
            ))}
          </select>
        </label>
      </div>
      <section className="project-member-settings">
        <h3>اعضای پروژه</h3>
        <div className="add-project-member">
          <select value={memberToAdd} onChange={(event) => setMemberToAdd(event.target.value)}>
            <option value="">انتخاب عضو فضای کاری</option>
            {workspaceMembers
              .filter((candidate) => !members.some((member) => member.id === candidate.id))
              .map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName}
                </option>
              ))}
          </select>
          <Button
            icon={Plus}
            disabled={!memberToAdd || addMember.isPending}
            onClick={() => addMember.mutate(memberToAdd, { onSuccess: () => setMemberToAdd("") })}
          >
            افزودن به پروژه
          </Button>
        </div>
        <div className="project-member-list">
          {members.map((member) => (
            <div key={member.id}>
              <span>
                <Avatar member={member} size="sm" />
                {member.displayName}
              </span>
              <button
                type="button"
                disabled={!member.membershipId}
                onClick={() =>
                  member.membershipId &&
                  window.confirm(`حذف ${member.displayName} از پروژه؟`) &&
                  removeMember.mutate(member.membershipId)
                }
              >
                حذف
              </button>
            </div>
          ))}
        </div>
      </section>
    </form>
  );
}
