import { useMemo, useState } from "react";
import { Filter, Grid2X2, List, MoreHorizontal, Plus } from "lucide-react";
import { Link } from "react-router";
import { useIssues, useMembers, useProjects, useWorkspaceAccess } from "../api";
import { AvatarStack, Button, EmptyState, PageHeader, ProjectCard, SearchBox, Skeleton } from "../components";
import { useUIStore } from "../store";
import { persianDate, toFa } from "../utils";

export default function ProjectsPage() {
  const [view, setView] = useState<"grid" | "list">("grid");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("همه پروژه‌ها");
  const { data: projects = [], isLoading } = useProjects();
  const { data: issues = [], isLoading: issuesLoading } = useIssues();
  const { data: members = [], isLoading: membersLoading } = useMembers();
  const { data: access } = useWorkspaceAccess();
  const isAdmin = access?.isAdmin === true;
  const setCreate = useUIStore((state) => state.setCreateOpen);
  const filtered = useMemo(
    () =>
      projects
        .map((project) => {
          const projectIssues = issues.filter((issue) => issue.projectId === project.id);
          const completedIssues = projectIssues.filter((issue) => issue.status === "Done").length;
          return Object.assign({}, project, {
            members: members.filter((member) => project.memberIds?.includes(member.id)),
            totalIssues: projectIssues.length,
            completedIssues,
            progress: projectIssues.length ? Math.round((completedIssues / projectIssues.length) * 100) : 0,
          });
        })
        .filter((project) => {
          const matchesQuery =
            project.name.includes(query) || project.identifier.toLowerCase().includes(query.toLowerCase());
          const matchesFilter =
            (filter === "همه پروژه‌ها" && !project.archivedAt) ||
            (filter === "فعال" && !project.archivedAt && (project.progress ?? 0) < 100) ||
            (filter === "تکمیل‌شده" && (project.progress ?? 0) === 100) ||
            (filter === "بایگانی‌شده" && Boolean(project.archivedAt));
          return matchesQuery && matchesFilter;
        }),
    [filter, issues, members, projects, query]
  );
  return (
    <div>
      <PageHeader
        eyebrow="مدیریت فضای کاری"
        title="پروژه‌ها"
        description={`${toFa(projects.length)} پروژه برای برنامه‌ریزی و پیگیری کارهای تیم`}
        actions={
          isAdmin ? (
            <Button icon={Plus} onClick={() => setCreate(true, "project")}>
              پروژه جدید
            </Button>
          ) : undefined
        }
      />
      <div className="content-toolbar">
        <div className="filter-tabs">
          {["همه پروژه‌ها", "فعال", "تکمیل‌شده", "بایگانی‌شده"].map((item) => (
            <button className={filter === item ? "active" : ""} key={item} onClick={() => setFilter(item)}>
              {item}
              {item === "همه پروژه‌ها" && <span>{toFa(projects.length)}</span>}
            </button>
          ))}
        </div>
        <div className="toolbar-actions">
          <SearchBox value={query} onChange={setQuery} placeholder="جستجوی پروژه..." />
          <button
            className="filter-button"
            onClick={() => {
              setQuery("");
              setFilter("همه پروژه‌ها");
            }}
          >
            <Filter size={16} /> پاک‌کردن فیلتر
          </button>
          <div className="view-toggle">
            <button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}>
              <Grid2X2 size={17} />
            </button>
            <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>
              <List size={18} />
            </button>
          </div>
        </div>
      </div>
      {isLoading || issuesLoading || membersLoading ? (
        <Skeleton rows={6} cards={view === "grid"} />
      ) : !filtered.length ? (
        <EmptyState
          title="پروژه‌ای پیدا نشد"
          description="عبارت جستجو یا فیلتر انتخابی را تغییر دهید."
          action={
            isAdmin ? (
              <Button icon={Plus} onClick={() => setCreate(true, "project")}>
                ساخت پروژه
              </Button>
            ) : undefined
          }
        />
      ) : view === "grid" ? (
        <div className="project-grid page-projects">
          {filtered.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      ) : (
        <div className="table-card project-table">
          <table>
            <thead>
              <tr>
                <th>نام پروژه</th>
                <th>پیشرفت</th>
                <th>اعضا</th>
                <th>موعد</th>
                <th>به‌روزرسانی</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((project) => (
                <tr key={project.id}>
                  <td>
                    <Link className="project-name-cell" to={`/projects/${project.id}`}>
                      <span style={{ background: `${project.color}18`, color: project.color }}>
                        {project.identifier[0]}
                      </span>
                      <div>
                        <b>{project.name}</b>
                        <small>{project.identifier}</small>
                      </div>
                    </Link>
                  </td>
                  <td>
                    <div className="table-progress">
                      <div>
                        <i style={{ width: `${project.progress}%`, background: project.color }} />
                      </div>
                      <span>{toFa(project.progress ?? 0)}٪</span>
                    </div>
                  </td>
                  <td>
                    <AvatarStack members={project.members} />
                  </td>
                  <td>{persianDate(project.targetDate)}</td>
                  <td>{persianDate(project.updatedAt, { year: "numeric" })}</td>
                  <td>
                    {isAdmin && (
                      <Link
                        className="plain-icon"
                        to={`/projects/${project.id}?tab=settings`}
                        aria-label="تنظیمات پروژه"
                      >
                        <MoreHorizontal size={18} />
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
