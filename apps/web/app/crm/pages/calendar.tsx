import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { jalaaliMonthLength, toGregorian, toJalaali } from "jalaali-js";
import { useIssues, useProjects, useWorkspaceAccess } from "../api";
import { Button, EmptyState, PageHeader, Skeleton } from "../components";
import { useUIStore } from "../store";
import { toFa } from "../utils";

const weekdays = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];
const months = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];

const shiftedMonth = (year: number, month: number, offset: number) => {
  const absolute = year * 12 + month - 1 + offset;
  return { year: Math.floor(absolute / 12), month: (absolute % 12) + 1 };
};

export default function CalendarPage() {
  const initialDate = new Date();
  const initialJalali = toJalaali(initialDate.getFullYear(), initialDate.getMonth() + 1, initialDate.getDate());
  const [selectedYear, setSelectedYear] = useState(initialJalali.jy);
  const [selectedMonth, setSelectedMonth] = useState(initialJalali.jm);
  const [projectFilter, setProjectFilter] = useState("all");
  const setCreate = useUIStore((state) => state.setCreateOpen);
  const { data: issues = [], isLoading } = useIssues();
  const { data: projects = [] } = useProjects();
  const { data: access } = useWorkspaceAccess();
  const now = new Date();
  const today = toJalaali(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const selected = { year: selectedYear, month: selectedMonth };
  const selectableYears = Array.from({ length: 31 }, (_, index) => today.jy - 10 + index);
  if (!selectableYears.includes(selectedYear)) selectableYears.push(selectedYear);
  selectableYears.sort((a, b) => a - b);
  const days = jalaaliMonthLength(selected.year, selected.month);
  const firstGregorian = toGregorian(selected.year, selected.month, 1);
  const firstWeekday = (new Date(firstGregorian.gy, firstGregorian.gm - 1, firstGregorian.gd).getDay() + 1) % 7;
  const cells = Array.from(
    { length: Math.ceil((firstWeekday + days) / 7) * 7 },
    (_, index) => index - firstWeekday + 1
  );
  const events = useMemo(() => {
    const grouped = new Map<number, typeof issues>();
    issues
      .filter((issue) => issue.dueDate && (projectFilter === "all" || issue.projectId === projectFilter))
      .forEach((issue) => {
        const date = new Date(issue.dueDate!);
        const jalali = toJalaali(date.getFullYear(), date.getMonth() + 1, date.getDate());
        if (jalali.jy !== selected.year || jalali.jm !== selected.month) return;
        grouped.set(jalali.jd, [...(grouped.get(jalali.jd) ?? []), issue]);
      });
    return grouped;
  }, [issues, projectFilter, selected.month, selected.year]);
  return (
    <div>
      <PageHeader
        eyebrow="برنامه تیم"
        title="تقویم"
        description="موعدهای واقعی کارها در همه پروژه‌ها"
        actions={
          access?.isAdmin ? (
            <Button icon={Plus} onClick={() => setCreate(true, "issue")}>
              کار جدید
            </Button>
          ) : undefined
        }
      />
      <div className="calendar-toolbar">
        <div>
          <button
            className="button button-secondary"
            onClick={() => {
              setSelectedYear(today.jy);
              setSelectedMonth(today.jm);
            }}
          >
            امروز
          </button>
          <div className="calendar-nav">
            <button
              onClick={() => {
                const next = shiftedMonth(selected.year, selected.month, 1);
                setSelectedYear(next.year);
                setSelectedMonth(next.month);
              }}
            >
              <ChevronRight size={18} />
            </button>
            <div className="calendar-period-selects">
              <select value={selectedMonth} onChange={(event) => setSelectedMonth(Number(event.target.value))}>
                {months.map((month, index) => (
                  <option key={month} value={index + 1}>
                    {month}
                  </option>
                ))}
              </select>
              <select value={selectedYear} onChange={(event) => setSelectedYear(Number(event.target.value))}>
                {selectableYears.map((year) => (
                  <option key={year} value={year}>
                    {toFa(year)}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={() => {
                const previous = shiftedMonth(selected.year, selected.month, -1);
                setSelectedYear(previous.year);
                setSelectedMonth(previous.month);
              }}
            >
              <ChevronLeft size={18} />
            </button>
          </div>
        </div>
        <select
          className="select-filter"
          value={projectFilter}
          onChange={(event) => setProjectFilter(event.target.value)}
        >
          <option value="all">همه پروژه‌ها</option>
          {projects.map((project) => (
            <option value={project.id} key={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </div>
      {isLoading ? (
        <Skeleton rows={6} />
      ) : !issues.some((issue) => issue.dueDate) ? (
        <EmptyState title="هیچ موعدی ثبت نشده" description="برای کارها تاریخ پایان تعیین کنید تا در تقویم دیده شوند." />
      ) : (
        <div className="calendar-card">
          <div className="weekdays">
            {weekdays.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="calendar-grid">
            {cells.map((day) => (
              <div
                key={`${selected.year}-${selected.month}-${day}`}
                className={`${day < 1 || day > days ? "outside" : ""} ${day === today.jd && selected.month === today.jm && selected.year === today.jy ? "today" : ""}`}
              >
                <span>{day >= 1 && day <= days ? toFa(day) : ""}</span>
                {events.get(day)?.map((issue) => {
                  const project = projects.find((item) => item.id === issue.projectId);
                  return (
                    <article
                      key={issue.id}
                      style={{ "--event-color": project?.color ?? "#4f46e5" } as React.CSSProperties}
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
        </div>
      )}
    </div>
  );
}
