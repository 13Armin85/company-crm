import {
  ArrowLeft,
  ArrowUpLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FolderKanban,
  ListChecks,
  Plus,
  Sparkles,
  Users,
} from "lucide-react";
import { Link, useNavigate } from "react-router";
import { useCurrentUser, useIssues, useMembers, useProjects, useUserActivities, useWorkspaceAccess } from "../api";
import { Avatar, AvatarStack, Button, EmptyState, IssueRow, ProjectCard, SectionHeader, Skeleton } from "../components";
import { useUIStore } from "../store";
import { greeting, persianDate, toFa } from "../utils";

export default function HomePage() {
  const setCreate = useUIStore((state) => state.setCreateOpen);
  const navigate = useNavigate();
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const { data: issues = [], isLoading: issuesLoading } = useIssues();
  const { data: members = [], isLoading: membersLoading } = useMembers();
  const { data: currentUser, isLoading: userLoading } = useCurrentUser();
  const { data: access } = useWorkspaceAccess();
  const isAdmin = access?.isAdmin === true;
  const { data: activities = [], isLoading: activitiesLoading } = useUserActivities();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const threeDaysLater = new Date(now.getTime() + 3 * 86_400_000);
  const myIssues = currentUser ? issues.filter((issue) => issue.assignee?.id === currentUser.id) : [];
  const done = issues.filter((issue) => issue.status === "Done").length;
  const weekDone = myIssues.filter((issue) => issue.completedAt && new Date(issue.completedAt) >= weekAgo).length;
  const urgent = myIssues.filter(
    (issue) =>
      issue.status !== "Done" &&
      (issue.priority === "Urgent" || (issue.dueDate && new Date(issue.dueDate) <= threeDaysLater))
  ).length;
  const activeProjects = projects.filter((project) => !project.archivedAt);
  const newProjects = activeProjects.filter(
    (project) =>
      project.createdAt &&
      new Date(project.createdAt).getMonth() === now.getMonth() &&
      new Date(project.createdAt).getFullYear() === now.getFullYear()
  ).length;
  const progress = issues.length ? Math.round((done / issues.length) * 100) : 0;
  const projectsWithMetrics = activeProjects.map((project) => {
    const projectIssues = issues.filter((issue) => issue.projectId === project.id);
    const completedIssues = projectIssues.filter((issue) => issue.status === "Done").length;
    return Object.assign({}, project, {
      members: members.filter((member) => project.memberIds?.includes(member.id)),
      totalIssues: projectIssues.length,
      completedIssues,
      progress: projectIssues.length ? Math.round((completedIssues / projectIssues.length) * 100) : 0,
    });
  });
  const todayLabel = new Intl.DateTimeFormat("fa-IR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
  return (
    <div className="dashboard-page">
      <section className="welcome-row">
        <div>
          <span className="eyebrow">
            <Sparkles size={14} /> {todayLabel}
          </span>
          <h1>
            {greeting()}، {currentUser?.displayName || "همکار"} <span>👋</span>
          </h1>
          <p>امروز روز خوبی برای پیش‌بردن کارهای مهم است.</p>
        </div>
        <div className="welcome-actions">
          <Button variant="secondary" icon={CalendarDays} onClick={() => navigate("/calendar")}>
            برنامه امروز
          </Button>
          {isAdmin && (
            <Button icon={Plus} onClick={() => setCreate(true, "issue")}>
              ایجاد کار جدید
            </Button>
          )}
        </div>
      </section>
      <section className="stats-grid">
        <article>
          <span className="stat-icon indigo">
            <FolderKanban size={21} />
          </span>
          <div>
            <p>پروژه‌های فعال</p>
            <strong>{toFa(activeProjects.length)}</strong>
            <small>{toFa(newProjects)} پروژه ایجادشده در این ماه</small>
          </div>
        </article>
        <article>
          <span className="stat-icon blue">
            <ListChecks size={21} />
          </span>
          <div>
            <p>کارهای باز من</p>
            <strong>{toFa(myIssues.filter((issue) => issue.status !== "Done").length)}</strong>
            <small>از {toFa(myIssues.length)} کار واگذار‌شده</small>
          </div>
        </article>
        <article>
          <span className="stat-icon green">
            <CheckCircle2 size={21} />
          </span>
          <div>
            <p>تکمیل‌شده این هفته</p>
            <strong>{toFa(weekDone)}</strong>
            <small>بر اساس تاریخ تکمیل واقعی</small>
          </div>
        </article>
        <article>
          <span className="stat-icon orange">
            <Clock3 size={21} />
          </span>
          <div>
            <p>نیازمند توجه</p>
            <strong>{toFa(urgent)}</strong>
            <small className="warning">فوری یا نزدیک به موعد</small>
          </div>
        </article>
      </section>
      <section className="dashboard-grid">
        <div className="dashboard-main">
          <div className="panel projects-panel">
            <SectionHeader
              title="پروژه‌های اخیر"
              subtitle="آخرین پروژه‌هایی که روی آن‌ها کار کرده‌اید"
              action={
                <Link to="/projects">
                  مشاهده همه <ArrowLeft size={15} />
                </Link>
              }
            />
            {projectsLoading || issuesLoading || membersLoading ? (
              <Skeleton rows={3} cards />
            ) : projectsWithMetrics.length ? (
              <div className="project-grid home-projects">
                {projectsWithMetrics.slice(0, 3).map((project) => (
                  <ProjectCard key={project.id} project={project} />
                ))}
              </div>
            ) : (
              <EmptyState
                title="پروژه‌ای وجود ندارد"
                description="اولین پروژه واقعی فضای کاری را ایجاد کنید."
                action={
                  isAdmin ? (
                    <Button icon={Plus} onClick={() => setCreate(true, "project")}>
                      پروژه جدید
                    </Button>
                  ) : undefined
                }
              />
            )}
          </div>
          <div className="panel my-tasks-panel">
            <SectionHeader
              title="کارهای من"
              subtitle="اولویت‌های امروز شما"
              action={
                <Link to="/my-work">
                  مشاهده همه <ArrowLeft size={15} />
                </Link>
              }
            />
            {issuesLoading || userLoading ? (
              <Skeleton rows={4} />
            ) : myIssues.some((issue) => issue.status !== "Done") ? (
              <div className="issue-table">
                {myIssues
                  .filter((issue) => issue.status !== "Done")
                  .slice(0, 5)
                  .map((issue) => (
                    <IssueRow key={issue.id} issue={issue} compact />
                  ))}
              </div>
            ) : (
              <EmptyState
                title="کار بازی ندارید"
                description="کار جدیدی ایجاد کنید یا از پروژه‌ها یک کار به خودتان اختصاص دهید."
              />
            )}
          </div>
        </div>
        <aside className="dashboard-aside">
          <div className="panel progress-panel">
            <SectionHeader title="نمای کلی هفته" subtitle="پیشرفت کارهای تیم" />
            <div className="donut-wrap">
              <div className="donut" style={{ "--progress": `${progress}%` } as React.CSSProperties}>
                <span>
                  <b>{toFa(progress)}٪</b>
                  <small>پیشرفت</small>
                </span>
              </div>
              <div className="donut-legend">
                <p>
                  <i className="done" /> تکمیل‌شده <b>{toFa(done)}</b>
                </p>
                <p>
                  <i className="active" /> در حال انجام{" "}
                  <b>{toFa(issues.filter((i) => i.status === "In Progress").length)}</b>
                </p>
                <p>
                  <i className="todo" /> شروع‌نشده <b>{toFa(issues.filter((i) => i.status === "Todo").length)}</b>
                </p>
              </div>
            </div>
          </div>
          <div className="panel activity-panel">
            <SectionHeader title="فعالیت‌های اخیر" />
            <div className="activity-list">
              {activitiesLoading ? (
                <Skeleton rows={3} />
              ) : activities.length ? (
                activities.slice(0, 5).map((activity) => (
                  <article key={activity.id}>
                    <Avatar member={currentUser} size="sm" />
                    <div>
                      <p>
                        <strong>{activity.actor}</strong> {activity.message}
                      </p>
                      <time>{persianDate(activity.createdAt)}</time>
                    </div>
                  </article>
                ))
              ) : (
                <EmptyState
                  title="فعالیتی ثبت نشده"
                  description="پس از ایجاد یا ویرایش کارها، فعالیت‌ها اینجا نمایش داده می‌شوند."
                />
              )}
            </div>
          </div>
          <div className="panel team-card">
            <div>
              <SectionHeader title="تیم شما" subtitle={`${toFa(members.length)} عضو در فضای کاری`} />
              <AvatarStack members={members} max={5} />
            </div>
            {isAdmin && (
              <Link to="/team">
                <Users size={17} /> مدیریت تیم <ArrowUpLeft size={15} />
              </Link>
            )}
          </div>
          <div className="quick-links">
            <Link to="/calendar">
              <CalendarDays size={18} />
              <span>تقویم تیم</span>
              <ArrowLeft size={15} />
            </Link>
            {isAdmin && (
              <Link to="/issues">
                <ListChecks size={18} />
                <span>همه کارها</span>
                <ArrowLeft size={15} />
              </Link>
            )}
          </div>
        </aside>
      </section>
    </div>
  );
}
