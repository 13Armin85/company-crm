import { useState } from "react";
import { CalendarClock, Check, CheckCheck, ArrowUpLeft, LayoutDashboard, List, ListTodo } from "lucide-react";
import { zonedDateTime } from "@plane/ui";
import {
  useCurrentUser,
  useIssues,
  useTaskHistory,
  useUpdateIssueStatus,
  useWorkspaceAccess,
  useMembers,
  useReassignIssue,
} from "../api";
import { EmptyState, PageHeader, SearchBox, Skeleton, TabBar } from "../components";
import { issueReference, matchesRecordSearch } from "../identifiers";
import { WorkTable } from "../engine/work-table";
import { IssueKanbanBoard } from "../kanban";
import { useUIStore } from "../store";
import { toFa } from "../utils";
import { isCurrentReceivedIssue } from "../task-access";

export default function MyWorkPage() {
  const [tab, setTab] = useState("all");
  const [view, setView] = useState<"list" | "board">("list");
  const [query, setQuery] = useState("");
  const { data: currentUser, isLoading: userLoading } = useCurrentUser();
  const { data: access } = useWorkspaceAccess();
  const isAdmin = access?.is_admin === true;
  const currentIssues = useIssues(undefined, undefined, isAdmin);
  const history = useTaskHistory(Boolean(access) && !isAdmin);
  const issues = (isAdmin ? currentIssues.data : history.data) ?? [];
  const isLoading = !access || (isAdmin ? currentIssues.isLoading : history.isLoading);
  const slug = useUIStore((state) => state.workspaceSlug) ?? "";
  const updateStatus = useUpdateIssueStatus(slug);
  const reassign = useReassignIssue(slug);
  const { data: members = [] } = useMembers();
  const myIssues = currentUser
    ? issues.filter((issue) =>
        isAdmin ? issue.assignee?.id === currentUser.id : isCurrentReceivedIssue(issue, currentUser.id)
      )
    : [];
  const today = zonedDateTime(new Date(), currentUser?.timeZone)!.date;
  const dueDay = (date: string) => zonedDateTime(date, currentUser?.timeZone)?.date;
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const openIssues = myIssues.filter((issue) => issue.status !== "Done");
  const dueToday = openIssues.filter((issue) => issue.dueDate && (dueDay(issue.dueDate) || "9999") <= today);
  const upcoming = openIssues.filter((issue) => !issue.dueDate || (dueDay(issue.dueDate) || "9999") > today);
  const completedThisWeek = issues.filter(
    (issue) =>
      issue.assignee?.id === currentUser?.id &&
      (isAdmin || issue.senderId !== currentUser?.id) &&
      issue.completedAt &&
      new Date(issue.completedAt) >= weekAgo
  );
  const selected =
    tab === "all"
      ? openIssues
      : tab === "done"
        ? myIssues.filter((issue) => issue.status === "Done")
        : tab === "upcoming"
          ? upcoming
          : dueToday;
  const visible = selected.filter((issue) =>
    matchesRecordSearch(query, [issue.name, issueReference(issue), issue.projectName, issue.sender?.displayName])
  );
  const items = [
    { id: "all", label: "دریافتی‌های فعلی", count: openIssues.length },
    { id: "today", label: "امروز و عقب‌افتاده", count: dueToday.length },
    { id: "upcoming", label: "پیش‌رو", count: upcoming.length },
    ...(isAdmin ? [{ id: "done", label: "انجام‌شده", count: myIssues.filter((i) => i.status === "Done").length }] : []),
  ];
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
            count: openIssues.length,
            icon: ListTodo,
            tone: "accent",
            note: "دریافتی‌های فعلی شما",
          },
          {
            id: "today",
            title: "امروز و عقب‌افتاده",
            count: dueToday.length,
            icon: CalendarClock,
            tone: "warm",
            note: "نیازمند توجه شما",
          },
          {
            id: "upcoming",
            title: "پیش‌رو",
            count: upcoming.length,
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
            <strong>{isLoading || userLoading ? "—" : toFa(completedThisWeek.length)}</strong>
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
          <TabBar items={items} active={tab} onChange={setTab} />
          <SearchBox value={query} onChange={setQuery} placeholder="جستجوی عنوان، شناسه یا فرستنده…" />
        </div>
        <div className="my-work-results" role="status">
          {isLoading || userLoading
            ? "در حال دریافت کارها…"
            : `${toFa(visible.length)} کار${query ? ` از ${toFa(selected.length)} کار` : ""}`}
        </div>
        {isLoading || userLoading ? (
          <Skeleton rows={5} />
        ) : (isAdmin ? currentIssues.error : history.error) ? (
          <p className="my-work-error" role="alert">
            دریافت کارها انجام نشد. صفحه را دوباره بارگذاری کنید.
          </p>
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
      </section>
    </div>
  );
}
