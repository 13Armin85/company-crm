import { useMemo, useState } from "react";
import { Grid2X2, List, MoreHorizontal, Plus } from "lucide-react";
import { Link } from "react-router";
import { IdentifierBadge, zonedDateTime } from "@plane/ui";
import { useCurrentUser, useMembers, useWorkspaceAccess } from "../api";
import { AvatarStack, Button, EmptyState, PageHeader, ProjectCard, SearchBox, Skeleton } from "../components";
import { DataFilterButton, ProjectFilterDialog } from "../filter-controls";
import { emptyProjectFilters, projectFilterCount, projectFilterError } from "../filter-rules";
import type { ProjectTab } from "../filter-rules";
import { useUIStore } from "../store";
import { persianDate, toFa } from "../utils";
import { useProjectsTable } from "../table-hooks";
import { useDebouncedValue, useTablePaging } from "../table-query";
import { TablePagination } from "../table-pagination";

const tabs: { id: ProjectTab; label: string }[] = [
  { id: "all", label: "همه پروژه‌ها" },
  { id: "active", label: "فعال" },
  { id: "completed", label: "تکمیل‌شده" },
  { id: "archived", label: "بایگانی‌شده" },
];

export default function ProjectsPage() {
  const [view, setView] = useState<"grid" | "list">("grid");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<ProjectTab>("all");
  const [filters, setFilters] = useState(emptyProjectFilters);
  const [draft, setDraft] = useState(filters);
  const [filterOpen, setFilterOpen] = useState(false);
  const { data: members = [], isLoading: membersLoading } = useMembers();
  const { data: access } = useWorkspaceAccess();
  const { data: currentUser } = useCurrentUser();
  const canManage = access?.can("Project.Create") === true;
  const setCreate = useUIStore((state) => state.setCreateOpen);
  const today = zonedDateTime(new Date(), currentUser?.timeZone)!.date;
  const search = useDebouncedValue(query);
  const paging = useTablePaging("projects", [search, tab, filters]);
  const table = useProjectsTable({ q: search, tab, filters, today, ...paging });
  // The filter dialog previews how many projects its draft would match.
  const preview = useProjectsTable({
    q: search,
    tab,
    filters: draft,
    today,
    page: 1,
    pageSize: 10,
    enabled: filterOpen && !projectFilterError(draft),
  });
  const filtered = useMemo(
    () =>
      (table.data?.rows ?? []).map((project) =>
        Object.assign({}, project, {
          members: members.filter((member) => project.memberIds?.includes(member.id)),
        })
      ),
    [table.data?.rows, members]
  );
  const loading = table.isLoading || membersLoading;
  const pager = (
    <TablePagination
      page={table.data?.page ?? 1}
      pages={table.data?.pages ?? 1}
      count={table.data?.count ?? 0}
      pageSize={paging.pageSize}
      onPage={paging.setPage}
      onPageSize={paging.setPageSize}
      loading={table.isFetching}
      label="پروژه"
    />
  );
  return (
    <div>
      <PageHeader
        eyebrow="مدیریت فضای کاری"
        title="پروژه‌ها"
        description={`${toFa(table.data?.tab_counts.all ?? 0)} پروژه برای برنامه‌ریزی و پیگیری کارهای تیم`}
        actions={
          canManage ? (
            <Button icon={Plus} onClick={() => setCreate(true, "project")}>
              پروژه جدید
            </Button>
          ) : undefined
        }
      />
      <div className="content-toolbar">
        <div className="filter-tabs">
          {tabs.map((item) => (
            <button className={tab === item.id ? "active" : ""} key={item.id} onClick={() => setTab(item.id)}>
              {item.label}
              {table.data && <span>{toFa(table.data.tab_counts[item.id] ?? 0)}</span>}
            </button>
          ))}
        </div>
        <div className="toolbar-actions">
          <SearchBox value={query} onChange={setQuery} placeholder="جستجوی پروژه..." />
          <DataFilterButton
            count={projectFilterCount(filters)}
            open={filterOpen}
            onClick={() => {
              setDraft(filters);
              setFilterOpen(true);
            }}
          />
          <div className="view-toggle">
            <button
              aria-label="نمای کارت پروژه‌ها"
              className={view === "grid" ? "active" : ""}
              onClick={() => setView("grid")}
            >
              <Grid2X2 size={17} />
            </button>
            <button
              aria-label="نمای لیست پروژه‌ها"
              className={view === "list" ? "active" : ""}
              onClick={() => setView("list")}
            >
              <List size={18} />
            </button>
          </div>
        </div>
      </div>
      {!loading && (
        <p className="filter-results" role="status">
          {toFa(table.data?.count ?? 0)} پروژه در این تب
        </p>
      )}
      {filterOpen && (
        <ProjectFilterDialog
          filters={filters}
          projects={[]}
          members={members}
          query={query}
          tab={tab}
          tabLabel={tabs.find((item) => item.id === tab)!.label}
          today={today}
          timeZone={currentUser?.timeZone}
          loading={preview.isFetching}
          serverCount={preview.data?.count ?? 0}
          onDraftChange={setDraft}
          onClose={() => setFilterOpen(false)}
          onApply={(next) => {
            setFilters(next);
            setFilterOpen(false);
          }}
        />
      )}
      {loading ? (
        <Skeleton rows={6} cards={view === "grid"} />
      ) : !filtered.length ? (
        <EmptyState
          title="پروژه‌ای پیدا نشد"
          description="عبارت جستجو یا فیلتر انتخابی را تغییر دهید."
          action={
            canManage ? (
              <Button icon={Plus} onClick={() => setCreate(true, "project")}>
                ساخت پروژه
              </Button>
            ) : undefined
          }
        />
      ) : view === "grid" ? (
        <>
          <div className="project-grid page-projects">
            {filtered.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
          <div className="table-card project-pager">{pager}</div>
        </>
      ) : (
        <div className="table-card project-table">
          <SurfaceTable code="project">
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
                    <IdentifierBadge value={project.identifier} label="شناسه پروژه" />
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
                    {canManage && (
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
          </SurfaceTable>
          {pager}
        </div>
      )}
    </div>
  );
}
import { SurfaceTable } from "../engine/surface";
