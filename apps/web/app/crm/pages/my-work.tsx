import { useMemo, useState } from "react";
import { CalendarClock, Check, Circle, LayoutDashboard, List, ListTodo, Plus } from "lucide-react";
import {
  useCurrentUser,
  useIssues,
  useMembers,
  useReassignIssue,
  useUpdateIssueStatus,
  useWorkspaceAccess,
} from "../api";
import { Button, EmptyState, IssueRow, PageHeader, Skeleton, TabBar } from "../components";
import { IssueKanbanBoard } from "../kanban";
import { useUIStore } from "../store";
import { toFa } from "../utils";

export default function MyWorkPage() {
  const [tab, setTab] = useState("today");
  const [view, setView] = useState<"list" | "board">("list");
  const { data: issues = [], isLoading } = useIssues();
  const { data: currentUser, isLoading: userLoading } = useCurrentUser();
  const { data: access } = useWorkspaceAccess();
  const { data: teamMembers = [] } = useMembers();
  const slug = useUIStore((state) => state.workspaceSlug) ?? "";
  const updateStatus = useUpdateIssueStatus(slug);
  const reassignIssue = useReassignIssue(slug);
  const setCreate = useUIStore((state) => state.setCreateOpen);
  const myIssues = useMemo(
    () => (currentUser ? issues.filter((issue) => issue.assignee?.id === currentUser.id) : []),
    [currentUser, issues]
  );
  const endToday = new Date();
  endToday.setHours(23, 59, 59, 999);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const openIssues = myIssues.filter((issue) => issue.status !== "Done");
  const dueToday = openIssues.filter((issue) => issue.dueDate && new Date(issue.dueDate) <= endToday);
  const upcoming = openIssues.filter((issue) => !issue.dueDate || new Date(issue.dueDate) > endToday);
  const completedThisWeek = myIssues.filter((issue) => issue.completedAt && new Date(issue.completedAt) >= weekAgo);
  const completedOnTime = completedThisWeek.filter(
    (issue) => !issue.dueDate || new Date(issue.completedAt!) <= new Date(issue.dueDate)
  );
  const visible = useMemo(
    () =>
      tab === "done" ? myIssues.filter((issue) => issue.status === "Done") : tab === "upcoming" ? upcoming : dueToday,
    [dueToday, myIssues, tab, upcoming]
  );
  const items = [
    { id: "today", label: "امروز و عقب‌افتاده", count: dueToday.length },
    { id: "upcoming", label: "پیش‌رو", count: upcoming.length },
    { id: "done", label: "انجام‌شده", count: myIssues.filter((i) => i.status === "Done").length },
  ];
  return (
    <div>
      <PageHeader
        eyebrow="فضای شخصی"
        title="کارهای من"
        description="روزت را برنامه‌ریزی کن و روی مهم‌ترین کارها تمرکز داشته باش"
        actions={
          access?.isAdmin ? (
            <Button icon={Plus} onClick={() => setCreate(true, "issue")}>
              افزودن کار
            </Button>
          ) : undefined
        }
      />
      <div className="content-toolbar my-work-toolbar">
        <div className="view-switcher">
          <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>
            <List size={17} /> لیست
          </button>
          <button className={view === "board" ? "active" : ""} onClick={() => setView("board")}>
            <LayoutDashboard size={17} /> برد کانبان
          </button>
        </div>
      </div>
      {view === "board" ? (
        isLoading || userLoading ? (
          <Skeleton rows={5} />
        ) : myIssues.length ? (
          <IssueKanbanBoard
            issues={myIssues}
            onStatusChange={(issue, status) => updateStatus.mutate({ issue, status })}
            onCreate={access?.isAdmin ? () => setCreate(true, "issue") : undefined}
            transferMembers={access && !access.isAdmin ? teamMembers : undefined}
            transferDisabled={reassignIssue.isPending}
            onAssigneeChange={(issue, assigneeId) => reassignIssue.mutate({ issue, assigneeId })}
          />
        ) : (
          <EmptyState
            icon={Check}
            title="کاری به شما واگذار نشده"
            description="کارهای واگذارشده اینجا نمایش داده می‌شوند."
          />
        )
      ) : (
        <div className="my-work-layout">
          <main>
            <TabBar items={items} active={tab} onChange={setTab} />
            <div className="panel my-work-list">
              {isLoading || userLoading ? (
                <Skeleton rows={5} />
              ) : visible.length ? (
                visible.map((issue) => <IssueRow key={issue.id} issue={issue} />)
              ) : (
                <EmptyState
                  icon={Check}
                  title="همه کارها تمام شد"
                  description="عالی بود! فعلاً کار دیگری در این بخش ندارید."
                />
              )}
            </div>
          </main>
          <aside>
            <div className="focus-card">
              <span>
                <ListTodo size={21} />
              </span>
              <h3>تمرکز امروز</h3>
              <strong>{toFa(dueToday.length)} کار</strong>
              <div className="progress">
                <i
                  style={{
                    width: `${myIssues.length ? Math.round((completedThisWeek.length / myIssues.length) * 100) : 0}%`,
                  }}
                />
              </div>
              <p>
                {dueToday.length ? "کارهای سررسیدشده امروز و موارد عقب‌افتاده." : "برای امروز کار سررسیدشده‌ای ندارید."}
              </p>
            </div>
            <div className="panel personal-summary">
              <h3>خلاصه این هفته</h3>
              <dl>
                <div>
                  <dt>
                    <Check size={16} /> تکمیل‌شده
                  </dt>
                  <dd>{toFa(completedThisWeek.length)}</dd>
                </div>
                <div>
                  <dt>
                    <CalendarClock size={16} /> در موعد
                  </dt>
                  <dd>
                    {toFa(
                      completedThisWeek.length
                        ? Math.round((completedOnTime.length / completedThisWeek.length) * 100)
                        : 0
                    )}
                    ٪
                  </dd>
                </div>
                <div>
                  <dt>
                    <Circle size={16} /> باقی‌مانده
                  </dt>
                  <dd>{toFa(openIssues.length)}</dd>
                </div>
              </dl>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
