import { useMemo, useState } from "react";
import { LayoutDashboard, List, Plus } from "lucide-react";
import { Navigate } from "react-router";
import { zonedDateTime } from "@plane/ui";
import { useCurrentUser, useIssues, useMembers, useProjects, useUpdateIssueStatus, useWorkspaceAccess } from "../api";
import { Button, EmptyState, IssueRow, PageHeader, SearchBox, Skeleton } from "../components";
import { DataFilterButton, IssueFilterDialog } from "../filter-controls";
import { emptyIssueFilters, filterIssues, issueFilterCount } from "../filter-rules";
import { IssueKanbanBoard } from "../kanban";
import { useUIStore } from "../store";
import { toFa } from "../utils";

export default function IssuesPage() {
  const [view, setView] = useState<"list" | "board">("list");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(emptyIssueFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const { data: issues = [], isLoading } = useIssues();
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const { data: members = [], isLoading: membersLoading } = useMembers();
  const { data: currentUser } = useCurrentUser();
  const { data: access, isLoading: accessLoading } = useWorkspaceAccess();
  const slug = useUIStore((state) => state.workspaceSlug) ?? "";
  const updateStatus = useUpdateIssueStatus(slug);
  const setCreate = useUIStore((state) => state.setCreateOpen);
  const loading = isLoading || projectsLoading;
  const today = zonedDateTime(new Date(), currentUser?.timeZone)!.date;
  const filtered = useMemo(
    () => filterIssues(issues, filters, query, today, currentUser?.timeZone),
    [issues, query, filters, today, currentUser?.timeZone]
  );
  if (accessLoading) return <Skeleton rows={7} />;
  if (!access?.can("Issue.ViewAll")) return <Navigate to="/my-work" replace />;
  return (
    <div>
      <PageHeader
        eyebrow="مرکز کارها"
        title="همه کارها"
        description="تمام کارهای فضای کاری را یکجا ببینید و مدیریت کنید"
        actions={
          <Button icon={Plus} onClick={() => setCreate(true, "issue")}>
            کار جدید
          </Button>
        }
      />
      <div className="content-toolbar issues-toolbar">
        <div className="view-switcher">
          <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>
            <List size={17} /> لیست
          </button>
          <button className={view === "board" ? "active" : ""} onClick={() => setView("board")}>
            <LayoutDashboard size={17} /> برد کانبان
          </button>
        </div>
        <div className="toolbar-actions">
          <SearchBox value={query} onChange={setQuery} placeholder="جستجو در کارها..." />
          <DataFilterButton count={issueFilterCount(filters)} open={filterOpen} onClick={() => setFilterOpen(true)} />
        </div>
      </div>
      {!loading && (
        <p className="filter-results" role="status">
          {toFa(filtered.length)} از {toFa(issues.length)} کار
        </p>
      )}
      {filterOpen && (
        <IssueFilterDialog
          filters={filters}
          issues={issues}
          projects={projects}
          members={members}
          query={query}
          today={today}
          timeZone={currentUser?.timeZone}
          loading={loading || membersLoading}
          onClose={() => setFilterOpen(false)}
          onApply={(next) => {
            setFilters(next);
            setFilterOpen(false);
          }}
        />
      )}
      {loading ? (
        <Skeleton rows={7} />
      ) : !filtered.length ? (
        <EmptyState
          title="کاری پیدا نشد"
          description="جستجو یا انتخاب‌های دکمهٔ فیلتر را تغییر دهید، یا یک کار تازه بسازید."
          action={
            <Button icon={Plus} onClick={() => setCreate(true, "issue")}>
              کار جدید
            </Button>
          }
        />
      ) : view === "list" ? (
        <div className="table-card issue-list-card">
          <div className="issue-list-head">
            <span />
            <span>عنوان کار</span>
            <span>شناسه</span>
            <span>پروژه</span>
            <span>وضعیت</span>
            <span>اولویت</span>
            <span>موعد</span>
            <span>مسئول</span>
          </div>
          {filtered.map((issue) => (
            <IssueRow key={issue.id} issue={issue} table />
          ))}
        </div>
      ) : (
        <IssueKanbanBoard
          issues={filtered}
          onStatusChange={(issue, nextStatus) => updateStatus.mutate({ issue, status: nextStatus })}
          onCreate={() => setCreate(true, "issue")}
        />
      )}
    </div>
  );
}
