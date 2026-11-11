import { ErrorState } from "../error-state";
import { TicketPresetBar } from "../ticket/preset-bar";
import type { PresetId } from "../ticket/model";
import { useState } from "react";
import { CalendarClock, Check, CheckCheck, ArrowUpLeft, LayoutDashboard, List, ListTodo } from "lucide-react";
import { zonedDateTime } from "@plane/ui";
import { useCurrentUser, useUpdateIssueStatus, useWorkspaceAccess, useMembers, useReassignIssue } from "../api";
import { EmptyState, PageHeader, SearchBox, Skeleton, TabBar } from "../components";
import { WorkTable } from "../engine/work-table";
import { IssueKanbanBoard } from "../kanban";
import { useUIStore } from "../store";
import { toFa } from "../utils";
import { useTasksTable } from "../table-hooks";
import { useDebouncedValue, useTablePaging } from "../table-query";
import { TablePagination } from "../table-pagination";

export default function MyWorkPage() {
  const [tab, setTab] = useState("all");
  const [view, setView] = useState<"list" | "board">("list");
  const [query, setQuery] = useState("");
  const { data: currentUser, isLoading: userLoading } = useCurrentUser();
  const { data: access } = useWorkspaceAccess();
  const isAdmin = access?.is_admin === true;
  const slug = useUIStore((state) => state.workspaceSlug) ?? "";
  const updateStatus = useUpdateIssueStatus(slug);
  const reassign = useReassignIssue(slug);
  const { data: members = [] } = useMembers();
  const today = zonedDateTime(new Date(), currentUser?.timeZone)!.date;
  const search = useDebouncedValue(query);
  const [preset, setPreset] = useState<PresetId>("all");
  const paging = useTablePaging("my-work", [search, tab, preset]);
  const table = useTasksTable({ view: "mine", tab, q: search, today, preset, ...paging, enabled: Boolean(access) });
  const visible = table.data?.rows ?? [];
  const counts = table.data?.tab_counts ?? {};
  const isLoading = !access || table.isLoading;
  const items = [
    { id: "all", label: "دریافتی‌های فعلی", count: counts.all },
    { id: "today", label: "امروز و عقب‌افتاده", count: counts.today },
    { id: "upcoming", label: "پیش‌رو", count: counts.upcoming },
    ...(isAdmin ? [{ id: "done", label: "انجام‌شده", count: counts.done }] : []),
  ];
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
  return (
    <div className="my-work-page">
      <PageHeader
        eyebrow="فضای شخصی"
        title="کارهای من"
        description="کارهای دریافتی، موعدها و اولویت‌های شما در یک نگاه"
      />
      <div className="my-work-overview" aria-label="خلاصه کارهای من">
        {[
          {
            id: "all",
            title: "کارهای باز",
            count: counts.all ?? 0,
            icon: ListTodo,
            tone: "accent",
            note: "دریافتی‌های فعلی شما",
          },
          {
            id: "today",
            title: "امروز و عقب‌افتاده",
            count: counts.today ?? 0,
            icon: CalendarClock,
            tone: "warm",
            note: "نیازمند توجه شما",
          },
          {
            id: "upcoming",
            title: "پیش‌رو",
            count: counts.upcoming ?? 0,
            icon: ArrowUpLeft,
            tone: "blue",
            note: "موعدهای بعدی و بدون موعد",
          },
        ].map(({ id, title, count, icon: Icon, tone, note }) => (
          <button
            key={id}
            type="button"
            className={`my-work-stat tone-${tone}`}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            <span className="my-work-stat-icon">
              <Icon size={20} />
            </span>
            <span className="my-work-stat-copy">
              <span>{title}</span>
              <strong>{isLoading || userLoading ? "—" : toFa(count)}</strong>
              <small>{note}</small>
            </span>
          </button>
        ))}
        <div className="my-work-stat tone-green">
          <span className="my-work-stat-icon">
            <CheckCheck size={20} />
          </span>
          <span className="my-work-stat-copy">
            <span>انجام‌شده این هفته</span>
            <strong>{isLoading || userLoading ? "—" : toFa(table.data?.stats?.completed_this_week ?? 0)}</strong>
            <small>در هفت روز گذشته</small>
          </span>
        </div>
      </div>
      <section className="panel my-work-content" aria-label="فهرست کارهای من">
        <div className="my-work-content-heading">
          <div>
            <h2>فهرست کارها</h2>
            <p>جزئیات هر کار و انتقال به همکاران از منوی عملیات در دسترس است.</p>
          </div>
          <div className="view-switcher" aria-label="نمای کارها">
            <button
              type="button"
              aria-pressed={view === "list"}
              className={view === "list" ? "active" : ""}
              onClick={() => setView("list")}
            >
              <List size={17} /> لیست
            </button>
            <button
              type="button"
              aria-pressed={view === "board"}
              className={view === "board" ? "active" : ""}
              onClick={() => setView("board")}
            >
              <LayoutDashboard size={17} /> برد کانبان
            </button>
          </div>
        </div>
        <div className="my-work-filters">
          <TabBar chooserKey="my-work-status" items={items} active={tab} onChange={setTab} />
          <TicketPresetBar value={preset} counts={table.data?.preset_counts} onChange={setPreset} />
          <SearchBox value={query} onChange={setQuery} placeholder="جستجوی عنوان، شناسه یا فرستنده…" />
        </div>
        <div className="my-work-results" role="status">
          {isLoading || userLoading
            ? "در حال دریافت کارها…"
            : `${toFa(table.data?.count ?? 0)} کار${search ? ` از ${toFa(counts[tab] ?? 0)} کار` : ""}`}
        </div>
        {isLoading || userLoading ? (
          <Skeleton rows={5} />
        ) : table.error ? (
          <ErrorState message="دریافت کارها انجام نشد." />
        ) : !visible.length ? (
          <EmptyState
            icon={Check}
            title={query ? "کاری با این مشخصات پیدا نشد" : "در این بخش کاری ندارید"}
            description={
              query
                ? "عنوان، شناسه یا نام فرستنده دیگری را جستجو کنید."
                : "کارهای دریافتی شما با توجه به موعد، در این بخش نمایش داده می‌شوند."
            }
          />
        ) : view === "board" ? (
          <IssueKanbanBoard
            issues={visible}
            onStatusChange={(issue, status) => updateStatus.mutate({ issue, status })}
            readOnly={!isAdmin}
            allowTransfer
            transferMembers={members}
            transferDisabled={reassign.isPending}
            onAssigneeChange={(issue, assigneeId) => reassign.mutate({ issue, assigneeId })}
          />
        ) : (
          <WorkTable issues={visible} code="task" readOnly={!isAdmin} allowTransfer personal />
        )}
        {!isLoading && visible.length > 0 && pager}
      </section>
    </div>
  );
}
