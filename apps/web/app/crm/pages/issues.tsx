import { useMemo, useState } from "react";
import { LayoutDashboard, List, Plus } from "lucide-react";
import { Navigate } from "react-router";
import { zonedDateTime } from "@plane/ui";
import {
  useCurrentUser,
  useIssues,
  useMembers,
  useProjects,
  useUpdateIssueStatus,
  useWorkspaceAccess,
  useTaskHistory,
  useReassignIssue,
} from "../api";
import { Button, EmptyState, PageHeader, SearchBox, Skeleton, TabBar } from "../components";
import { WorkTable } from "../engine/work-table";
import { DataFilterButton, IssueFilterDialog } from "../filter-controls";
import { emptyIssueFilters, filterIssues, issueFilterCount } from "../filter-rules";
import { IssueKanbanBoard } from "../kanban";
import { useUIStore } from "../store";
import { toFa } from "../utils";
import { isCurrentReceivedIssue, isPersonalHistoryIssue } from "../task-access";

export default function IssuesPage() {
  const [view, setView] = useState<"list" | "board">("list");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(emptyIssueFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [tab, setTab] = useState("received");
  const { data: access, isLoading: accessLoading } = useWorkspaceAccess();
  const isAdmin = access?.is_admin === true;
  const currentIssues = useIssues(undefined, undefined, isAdmin);
  const history = useTaskHistory(Boolean(access) && !isAdmin);
  const issues = (isAdmin ? currentIssues.data : history.data) ?? [];
  const isLoading = isAdmin ? currentIssues.isLoading : history.isLoading;
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const { data: members = [], isLoading: membersLoading } = useMembers();
  const { data: currentUser } = useCurrentUser();
  const slug = useUIStore((state) => state.workspaceSlug) ?? "";
  const updateStatus = useUpdateIssueStatus(slug);
  const reassign = useReassignIssue(slug);
  const canCreate = access?.can("Issue.Create") === true;
  const setCreate = useUIStore((state) => state.setCreateOpen);
  const loading = isLoading || projectsLoading;
  const today = zonedDateTime(new Date(), currentUser?.timeZone)!.date;
  const received = issues.filter((issue) => isCurrentReceivedIssue(issue, currentUser?.id));
  const personalHistory = issues.filter((issue) => isPersonalHistoryIssue(issue, currentUser?.id));
  const sent = issues.filter((issue) => issue.senderId === currentUser?.id && issue.assignee?.id !== currentUser?.id);
  const tabIssues = isAdmin ? issues : tab === "history" ? personalHistory : tab === "sent" ? sent : received;
  const filtered = useMemo(
    () => filterIssues(tabIssues, filters, query, today, currentUser?.timeZone),
    [tabIssues, query, filters, today, currentUser?.timeZone]
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
          active={tab}
          onChange={setTab}
          items={[
            { id: "received", label: "دریافتی‌های فعلی", count: received.length },
            { id: "history", label: "تاریخچهٔ من (همهٔ زمان‌ها)", count: personalHistory.length },
            { id: "sent", label: "ارسالی‌های من", count: sent.length },
          ]}
        />
      )}
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
          {toFa(filtered.length)} از {toFa(tabIssues.length)} کار
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
    </div>
  );
}
