import { useState } from "react";
import { TicketPresetBar } from "../ticket/preset-bar";
import type { PresetId } from "../ticket/model";
import { LayoutDashboard, List, Plus } from "lucide-react";
import { Navigate } from "react-router";
import { zonedDateTime } from "@plane/ui";
import {
  useCurrentUser,
  useMembers,
  useProjects,
  useUpdateIssueStatus,
  useWorkspaceAccess,
  useReassignIssue,
} from "../api";
import { Button, EmptyState, PageHeader, SearchBox, Skeleton, TabBar } from "../components";
import { WorkTable } from "../engine/work-table";
import { DataFilterButton, IssueFilterDialog } from "../filter-controls";
import { deadlineFilterError, emptyIssueFilters, issueFilterCount } from "../filter-rules";
import { IssueKanbanBoard } from "../kanban";
import { useUIStore } from "../store";
import { toFa } from "../utils";
import { useTasksTable } from "../table-hooks";
import { useDebouncedValue, useTablePaging } from "../table-query";
import { TablePagination } from "../table-pagination";

export default function IssuesPage() {
  const [view, setView] = useState<"list" | "board">("list");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(emptyIssueFilters);
  const [draft, setDraft] = useState(filters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [tab, setTab] = useState("received");
  const [preset, setPreset] = useState<PresetId>("all");
  const { data: access, isLoading: accessLoading } = useWorkspaceAccess();
  const isAdmin = access?.is_admin === true;
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const { data: members = [], isLoading: membersLoading } = useMembers();
  const { data: currentUser } = useCurrentUser();
  const slug = useUIStore((state) => state.workspaceSlug) ?? "";
  const updateStatus = useUpdateIssueStatus(slug);
  const reassign = useReassignIssue(slug);
  const canCreate = access?.can("Issue.Create") === true;
  const setCreate = useUIStore((state) => state.setCreateOpen);
  const today = zonedDateTime(new Date(), currentUser?.timeZone)!.date;
  const search = useDebouncedValue(query);
  const activeTab = isAdmin ? "all" : tab;
  const paging = useTablePaging("issues", [search, activeTab, filters, preset]);
  const table = useTasksTable({
    view: "all",
    tab: activeTab,
    q: search,
    filters,
    today,
    preset,
    ...paging,
    enabled: Boolean(access),
  });
  // The filter dialog previews how many tasks its draft would match.
  const preview = useTasksTable({
    view: "all",
    tab: activeTab,
    q: search,
    filters: draft,
    today,
    page: 1,
    pageSize: 10,
    enabled: filterOpen && !deadlineFilterError(draft),
  });
  const filtered = table.data?.rows ?? [];
  const counts = table.data?.tab_counts ?? {};
  const loading = table.isLoading || projectsLoading;
  const pager = (
    <TablePagination
      page={table.data?.page ?? 1}
      pages={table.data?.pages ?? 1}
      count={table.data?.count ?? 0}
      pageSize={paging.pageSize}
      onPage={paging.setPage}
      onPageSize={paging.setPageSize}
      loading={table.isFetching}
      label="کار"
    />
  );
  if (accessLoading) return <Skeleton rows={7} />;
  if (!access?.can("Issue.View")) return <Navigate to="/my-work" replace />;
  return (
    <div>
      <PageHeader
        eyebrow="مرکز کارها"
        title="همه کارها"
        description="کارهای خود و کارهایی که به دیگران فرستاده‌اید را مدیریت کنید"
        actions={
          canCreate ? (
            <Button icon={Plus} onClick={() => setCreate(true, "issue")}>
              کار جدید
            </Button>
          ) : undefined
        }
      />
      {!isAdmin && (
        <TabBar
          chooserKey="issues-status"
          active={tab}
          onChange={setTab}
          items={[
            { id: "received", label: "دریافتی‌های فعلی", count: counts.received },
            { id: "history", label: "تاریخچهٔ من (همهٔ زمان‌ها)", count: counts.history },
            { id: "sent", label: "ارسالی‌های من", count: counts.sent },
          ]}
        />
      )}
      <TicketPresetBar value={preset} counts={table.data?.preset_counts} onChange={setPreset} />
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
          <DataFilterButton
            count={issueFilterCount(filters)}
            open={filterOpen}
            onClick={() => {
              setDraft(filters);
              setFilterOpen(true);
            }}
          />
        </div>
      </div>
      {!loading && (
        <p className="filter-results" role="status">
          {toFa(table.data?.count ?? 0)} از {toFa(counts[activeTab] ?? 0)} کار
        </p>
      )}
      {filterOpen && (
        <IssueFilterDialog
          filters={filters}
          issues={filtered}
          projects={projects}
          members={members}
          query={query}
          today={today}
          timeZone={currentUser?.timeZone}
          loading={preview.isFetching || membersLoading}
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
        <Skeleton rows={7} />
      ) : !filtered.length ? (
        <EmptyState
          title="کاری پیدا نشد"
          description="جستجو یا انتخاب‌های دکمهٔ فیلتر را تغییر دهید، یا یک کار تازه بسازید."
          action={
            canCreate ? (
              <Button icon={Plus} onClick={() => setCreate(true, "issue")}>
                کار جدید
              </Button>
            ) : undefined
          }
        />
      ) : view === "list" ? (
        <div className="table-card issue-list-card">
          <WorkTable issues={filtered} readOnly={!isAdmin && tab === "history"} />
          {pager}
        </div>
      ) : (
        <IssueKanbanBoard
          issues={filtered}
          onStatusChange={(issue, nextStatus) => updateStatus.mutate({ issue, status: nextStatus })}
          readOnly={!isAdmin && tab === "history"}
          onCreate={canCreate ? () => setCreate(true, "issue") : undefined}
          transferMembers={members}
          transferDisabled={reassign.isPending}
          onAssigneeChange={(issue, assigneeId) => reassign.mutate({ issue, assigneeId })}
        />
      )}
      {view === "board" && !loading && filtered.length > 0 && <div className="table-card">{pager}</div>}
    </div>
  );
}
