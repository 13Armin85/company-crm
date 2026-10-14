import { displayPersianDate, parseDateOnly, PersianCalendarNavigation, persianMonths, zonedDateTime } from "@plane/ui";
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { jalaaliMonthLength, toGregorian } from "jalaali-js";
import { EmptyState, IssueRow, Skeleton } from "./components";
import type { Issue, Project } from "./types";
import { toFa } from "./utils";

const weekdays = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];

export function IssueCalendar({
  issues,
  projects,
  timeZone,
  isLoading,
  toolbarEnd,
  showAgenda = false,
}: {
  issues: Issue[];
  projects: Project[];
  timeZone?: string;
  isLoading?: boolean;
  toolbarEnd?: ReactNode;
  showAgenda?: boolean;
}) {
  const todayValue = zonedDateTime(new Date(), timeZone)!.date;
  const today = parseDateOnly(todayValue)!;
  const [date, setDate] = useState<string>();
  const currentDate = date ?? todayValue;
  const chosen = parseDateOnly(currentDate)!;
  const selected = { year: chosen.jy, month: chosen.jm };
  const days = jalaaliMonthLength(selected.year, selected.month);
  const first = toGregorian(selected.year, selected.month, 1);
  const firstWeekday = (new Date(Date.UTC(first.gy, first.gm - 1, first.gd)).getUTCDay() + 1) % 7;
  const cells = Array.from(
    { length: Math.ceil((firstWeekday + days) / 7) * 7 },
    (_, index) => index - firstWeekday + 1
  );
  const events = useMemo(() => {
    const grouped = new Map<number, Issue[]>();
    for (const issue of issues) {
      if (!issue.dueDate) continue;
      const jalali = displayPersianDate(issue.dueDate, timeZone);
      if (!jalali || jalali.jy !== selected.year || jalali.jm !== selected.month) continue;
      grouped.set(jalali.jd, [...(grouped.get(jalali.jd) ?? []), issue]);
    }
    return grouped;
  }, [issues, selected.month, selected.year, timeZone]);

  return (
    <div className="issue-calendar">
      <div className="calendar-toolbar">
        <PersianCalendarNavigation
          value={currentDate}
          onChange={setDate}
          timeZone={timeZone}
          description={
            isLoading
              ? "در حال دریافت موعدها…"
              : `${toFa(Array.from(events.values()).reduce((count, items) => count + items.length, 0))} کار در این ماه`
          }
        />
        {toolbarEnd}
      </div>
      {isLoading ? (
        <Skeleton rows={6} />
      ) : (
        <div className="calendar-card">
          <div className="weekdays">
            {weekdays.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="calendar-grid" aria-label={`${persianMonths[selected.month - 1]} ${toFa(selected.year)}`}>
            {cells.map((day) => (
              <div
                key={`${selected.year}-${selected.month}-${day}`}
                className={`${day < 1 || day > days ? "outside" : ""} ${day === today.jd && selected.month === today.jm && selected.year === today.jy ? "today" : ""} ${day === chosen.jd ? "selected-calendar-day" : ""}`}
                data-selected={day === chosen.jd || undefined}
                aria-label={
                  day >= 1 && day <= days
                    ? `${toFa(day)} ${persianMonths[selected.month - 1]} ${toFa(selected.year)}`
                    : undefined
                }
              >
                <span>{day >= 1 && day <= days ? toFa(day) : ""}</span>
                {events.get(day)?.map((issue) => {
                  const project = projects.find((item) => item.id === issue.projectId);
                  return (
                    <article
                      key={issue.id}
                      title={issue.name}
                      style={{ "--event-color": project?.color ?? "#4f46e5" } as CSSProperties}
                    >
                      <b>{issue.name}</b>
                      <small dir="ltr">
                        {project?.identifier ?? issue.projectIdentifier}-{issue.sequenceId}
                      </small>
                    </article>
                  );
                })}
              </div>
            ))}
          </div>
          {!events.size && (
            <EmptyState
              title="موعدی در این ماه ثبت نشده"
              description="ماه و سال را تغییر دهید یا برای کارها موعد تعیین کنید."
            />
          )}
        </div>
      )}
      {showAgenda && !isLoading && events.size > 0 && (
        <div className="issue-list" aria-label="کارهای این ماه">
          {Array.from(events.entries())
            // This is a fresh array; keep sorting compatible with the ES2022 target.
            // oxlint-disable-next-line unicorn/no-array-sort
            .sort(([firstDay], [secondDay]) => firstDay - secondDay)
            .flatMap(([, dayIssues]) => dayIssues)
            .map((issue) => (
              <IssueRow key={issue.id} issue={issue} compact />
            ))}
        </div>
      )}
    </div>
  );
}
