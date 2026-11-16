import { SurfaceTable } from "../engine/surface";
/** «گزارش روزانهٔ تیم»: who has (not) reported, blockers and help requests — only the manager's own scope. */
import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { LifeBuoy, OctagonAlert } from "lucide-react";
import { useWorkspaceAccess } from "../api";
import { useDailyMeta, useTeamDay } from "../api/reports";
import type { DayStatus, TeamDay, TeamDayFilter } from "../api/reports";
import { EmptyState, PageHeader, PersianDateInput, Skeleton } from "../components";
import { errorMessage } from "../api/client";
import { toFa } from "../utils";
import { Pill } from "./components";
import { DAY_STATUS_TONES } from "./model";
import { useTablePaging } from "../table-query";
import { TablePagination } from "../table-pagination";

const GROUPS: { id: TeamDayFilter; label: string }[] = [
  { id: "all", label: "همه" },
  { id: "missing", label: "ثبت‌نشده" },
  { id: "late", label: "دیرهنگام" },
  { id: "submitted", label: "ثبت‌شده" },
  { id: "not_required", label: "لازم نیست" },
];

export function TeamSummary({ team }: { team: TeamDay }) {
  return (
    <div className="dr-summary" role="list" aria-label="خلاصهٔ وضعیت ثبت">
      {(["submitted", "late", "draft", "missing", "not_required"] as DayStatus[]).map((status) => (
        <div role="listitem" key={status} className={`dr-summary-card dr-tone-${DAY_STATUS_TONES[status]}`}>
          <strong>{toFa(team.summary[status] ?? 0)}</strong>
          <span>{team.titles[status]}</span>
        </div>
      ))}
    </div>
  );
}

export function TeamTable({ team, date }: { team: TeamDay; date: string }) {
  const people = team.people;
  if (!people.length)
    return <EmptyState title="کسی در این فهرست نیست" description="برای این روز و این فیلتر موردی پیدا نشد." />;
  return (
    <div className="dr-table-scroll" role="region" aria-label="وضعیت گزارش روزانهٔ تیم" tabIndex={0}>
      <SurfaceTable code="daily-team" className="dr-table">
        <thead>
          <tr>
            <th>فرد</th>
            <th>وضعیت</th>
            <th>مرخصی</th>
            <th>نیاز به کمک</th>
            <th>مانع</th>
            <th>انجام‌شده</th>
          </tr>
        </thead>
        <tbody>
          {people.map((row) => (
            <tr key={row.person.id}>
              <td>
                <Link to={`/daily-report?date=${date}&user=${row.person.id}`}>{row.person.name}</Link>
              </td>
              <td>
                <Pill tone={DAY_STATUS_TONES[row.status]}>{row.status_label}</Pill>
              </td>
              <td>
                {[
                  ...row.leaves.map((leave) => `${leave.mode_label}: ${leave.period_text}`),
                  ...(row.absences ?? []).map((absence) => `عدم حضور: ${absence.period_text}`),
                ].join("، ") || "—"}
              </td>
              <td>
                {row.help.length ? (
                  <ul className="dr-cell-list dr-help">
                    {row.help.map((item) => (
                      <li key={item.id}>
                        <LifeBuoy size={13} aria-hidden="true" /> {item.text}
                      </li>
                    ))}
                  </ul>
                ) : (
                  "—"
                )}
              </td>
              <td>
                {row.blockers.length ? (
                  <ul className="dr-cell-list">
                    {row.blockers.map((item) => (
                      <li key={item.id}>
                        <OctagonAlert size={13} aria-hidden="true" /> {item.text}
                      </li>
                    ))}
                  </ul>
                ) : (
                  "—"
                )}
              </td>
              <td>{toFa(row.counts.done ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </SurfaceTable>
    </div>
  );
}

export function TeamResults({
  team,
  onPage,
  onPageSize,
  loading = false,
}: {
  team: TeamDay;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  loading?: boolean;
}) {
  return (
    <section className="dr-team-results" aria-label="نتایج گزارش روزانهٔ تیم" aria-busy={loading}>
      <TeamSummary team={team} />
      <TeamTable team={team} date={team.date} />
      <TablePagination
        page={team.page}
        pages={team.pages}
        count={team.count}
        pageSize={team.page_size}
        onPage={onPage}
        onPageSize={onPageSize}
        loading={loading}
        label="نفر"
      />
    </section>
  );
}

export default function DailyReportTeamPage() {
  const { data: access, isLoading } = useWorkspaceAccess();
  const meta = useDailyMeta();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<TeamDayFilter>("all");
  const date = params.get("date") || meta.data?.today || "";
  const paging = useTablePaging("daily-team", [date, filter]);
  const allowed = Boolean(meta.data?.can.team);
  const team = useTeamDay(date, allowed, { page: paging.page, pageSize: paging.pageSize, filter });
  if (isLoading || meta.isLoading) return <Skeleton rows={6} />;
  if (meta.isError)
    return (
      <EmptyState
        title="گزارش تیم در دسترس نیست"
        description={errorMessage(meta.error, "خواندن تنظیمات گزارش ممکن نشد.")}
      />
    );
  if (!access || !allowed) return <Navigate to="/daily-report" replace />;
  return (
    <div className="dr-page" dir="rtl">
      <PageHeader
        eyebrow="گزارش روزانه"
        title="گزارش روزانهٔ تیم"
        description="وضعیت ثبت گزارش افراد زیرمجموعهٔ شما، مانع‌ها و درخواست‌های کمک. افراد خارج از دامنهٔ مدیریتی شما نمایش داده نمی‌شوند."
      />
      <div className="dr-daybar">
        <div className="dr-date">
          <PersianDateInput
            id="team-report-date"
            label="روز"
            value={date}
            onChange={(value) => {
              if (value) {
                paging.setPage(1);
                setParams({ date: value });
              }
            }}
          />
        </div>
        <div className="tab-bar" role="tablist" aria-label="فیلتر وضعیت">
          {GROUPS.map((group) => (
            <button
              key={group.id}
              role="tab"
              aria-selected={filter === group.id}
              className={filter === group.id ? "active" : ""}
              onClick={() => {
                paging.setPage(1);
                setFilter(group.id);
              }}
            >
              {group.label}
            </button>
          ))}
        </div>
      </div>
      {team.isError && (
        <EmptyState title="در دسترس نیست" description={errorMessage(team.error, "مشاهدهٔ گزارش تیم ممکن نشد.")} />
      )}
      {team.isLoading && <Skeleton rows={5} />}
      {team.data &&
        (team.data.empty ? (
          <EmptyState title="زیرمجموعه‌ای ندارید" description={team.data.empty} />
        ) : (
          <>
            <TeamResults
              team={team.data}
              onPage={paging.setPage}
              onPageSize={paging.setPageSize}
              loading={team.isFetching}
            />
            <p className="dr-muted">
              گزارش‌های کامل‌تر (بازهٔ چندروزه، تیکت‌های دیرکرده، تمدیدهای در انتظار) در <Link to="/reports">گزارش‌ها</Link>.
            </p>
          </>
        ))}
    </div>
  );
}
