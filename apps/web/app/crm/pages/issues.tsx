import { useMemo, useState } from "react";
import { LayoutDashboard, List, Plus, SlidersHorizontal } from "lucide-react";
import { Navigate } from "react-router";
import { useIssues, useUpdateIssueStatus, useWorkspaceAccess } from "../api";
import { Button, EmptyState, IssueRow, PageHeader, SearchBox, Skeleton } from "../components";
import { ISSUE_STATUS_COLUMNS, IssueKanbanBoard } from "../kanban";
import { useUIStore } from "../store";
import type { Status } from "../types";
import { statusFa } from "../utils";

export default function IssuesPage() {
  const [view, setView] = useState<"list" | "board">("list");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status | "all">("all");
  const { data: issues = [], isLoading } = useIssues();
  const { data: access, isLoading: accessLoading } = useWorkspaceAccess();
  const slug = useUIStore((state) => state.workspaceSlug) ?? "";
  const updateStatus = useUpdateIssueStatus(slug);
  const setCreate = useUIStore((state) => state.setCreateOpen);
  const filtered = useMemo(
    () =>
      issues.filter(
        (issue) =>
          (status === "all" || issue.status === status) &&
          (issue.name.includes(query) ||
            issue.projectIdentifier.toLowerCase().includes(query.toLowerCase()) ||
            issue.projectName?.toLowerCase().includes(query.toLowerCase()) ||
            (issue.scope === "workspace" && "خارج از پروژه".includes(query)))
      ),
    [issues, query, status]
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
          <select
            className="select-filter"
            value={status}
            onChange={(event) => setStatus(event.target.value as Status | "all")}
          >
            <option value="all">همه وضعیت‌ها</option>
            {ISSUE_STATUS_COLUMNS.map((column) => (
              <option key={column.id} value={column.id}>
                {statusFa[column.id]}
              </option>
            ))}
          </select>
          <button
            className="filter-button"
            onClick={() => {
              setQuery("");
              setStatus("all");
            }}
          >
            <SlidersHorizontal size={16} /> پاک‌کردن فیلترها
          </button>
        </div>
      </div>
      {isLoading ? (
        <Skeleton rows={7} />
      ) : !filtered.length ? (
        <EmptyState
          title="کاری پیدا نشد"
          description="فیلترها را پاک کنید یا یک کار تازه بسازید."
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
