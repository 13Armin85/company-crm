import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { DayPayload, ReportItem, Suggestion, TeamDay } from "../api/reports";
import { canAccessPath, reportPermissions } from "../access/permission-map";
import { presentNotification } from "../notification-presentation";
import { groupForPath, type ShellGroup } from "../shell-nav";
import { AbsenceBanner, DayContext, FullLeaveNotice, ItemSection, LeaveBanner, SuggestionCard } from "./components";
import {
  EFFORT_LABEL,
  PRESENCE_LABEL,
  dayBadge,
  emptyItem,
  itemErrors,
  itemFromSuggestion,
  itemsFromPrevious,
  parseEffort,
  pendingSuggestions,
  savePayload,
  shiftDate,
} from "./model";
import { TeamResults, TeamSummary, TeamTable } from "./team-page";

const noop = () => undefined;
const can = (codes: string[]) => (code: string) => codes.includes(code);
const render = (node: ReactElement) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>
  );

const day = (overrides: Partial<DayPayload> = {}): DayPayload => ({
  date: "2027-01-09",
  date_text: "۱۴۰۵/۱۰/۱۹",
  weekday: "شنبه",
  today: "2027-01-09",
  person: { id: "u1", name: "کارمند" },
  is_mine: true,
  schedule: {
    is_working: true,
    start: "08:00",
    end: "16:00",
    breaks: [],
    work_mode: "",
    source: "company",
    label: "روز کاری",
  },
  leaves: [],
  requirement: "required",
  requirement_text: "",
  events: [],
  presence: null,
  report: null,
  locked: false,
  lock_text: "",
  editable_until: "2027-01-11T00:00:00+03:30",
  editable_until_text: "۱۴۰۵/۱۰/۲۰",
  deadline_text: "",
  effort_label: EFFORT_LABEL,
  can: { edit: true },
  ...overrides,
});

const suggestion: Suggestion = {
  key: "issue:1",
  kind: "done",
  text: "T-12 «نصب سرور»: تغییر وضعیت به «انجام‌شده»",
  source_kind: "issue",
  source_id: "1",
  source_label: "تیکت T-12 — وضعیت فعلی: انجام‌شده",
  issue: { id: "1", number: "T-12", title: "نصب سرور" },
  link: "/edit/ticket/1",
  at: "2027-01-09T09:00:00+03:30",
};

describe("daily report — read-only leave and calendar", () => {
  it("shows approved leave with its period and a link, and never a leave category", () => {
    const html = render(
      <LeaveBanner
        leaves={[
          {
            id: "L1",
            number: "LRQ-00001",
            mode: "hourly",
            mode_label: "ساعتی",
            period_text: "۱۴۰۵/۱۰/۱۹ از ساعت ۱۰:۰۰ تا ۱۲:۰۰",
            duration_text: "۲ ساعت کاری",
            full_day: false,
            url: "/leave-requests/L1",
          },
        ]}
      />
    );
    expect(html).toContain("مرخصی ساعتی تأییدشده");
    expect(html).toContain('href="/leave-requests/L1"');
    expect(html).toContain("بخشی از روز");
    expect(html).not.toContain("دسته");
  });

  it("explains a full-leave day needs no report but allows a voluntary one", () => {
    const html = render(<FullLeaveNotice onVolunteer={noop} volunteering={false} />);
    expect(html).toContain("مرخصی یا عدم حضور تمام‌روز — گزارش لازم نیست");
    expect(html).toContain("با این حال گزارش می‌نویسم");
  });
  it("shows directly recorded absence separately from an approved leave request", () => {
    const html = render(
      <AbsenceBanner absences={[{ id: "absence", period_text: "شنبه از ۸ تا ۱۶", full_day: true, url: "/absences" }]} />
    );
    expect(html).toContain("عدم حضور ثبت‌شده");
    expect(html).toContain("کل روز کاری");
    expect(html).toContain('href="/absences"');
    expect(html).not.toContain("مرخصی روزانه تأییدشده");
    const restricted = render(
      <AbsenceBanner absences={[{ id: "absence", period_text: "۸ تا ۱۰", full_day: false, url: null }]} />
    );
    expect(restricted).toContain("بخشی از روز");
    expect(restricted).not.toContain("href=");
  });

  it("labels presence as self-reported and never offers a future event as done", () => {
    const html = render(
      <DayContext
        canSuggest
        onAddEvent={noop}
        day={day({
          presence: { declared_at: "2027-01-09T08:00:00+03:30", label: PRESENCE_LABEL, kind: "self_reported" },
          events: [
            {
              id: "e1",
              kind: "meeting",
              kind_label: "جلسه",
              title: "صبح",
              starts_at: "",
              ends_at: "",
              time_text: "",
              past: true,
              confirmation: null,
            },
            {
              id: "e2",
              kind: "mission",
              kind_label: "مأموریت",
              title: "عصر",
              starts_at: "",
              ends_at: "",
              time_text: "",
              past: false,
              confirmation: null,
            },
          ],
        })}
      />
    );
    expect(html).toContain("خوداظهاری — حضور تأییدشده نیست");
    expect(html.match(/افزودن به انجام‌شده/g)).toHaveLength(1);
    expect(html).toContain("برنامه‌ریزی‌شده — هنوز انجام‌شده نیست");
  });
});

describe("daily report — form", () => {
  it("shows the effort label as an estimate and the help checkbox only for blockers", () => {
    const blocker = render(
      <ItemSection kind="blocker" items={[emptyItem("blocker", "دسترسی ندارم")]} onChange={noop} onSearch={noop} />
    );
    const done = render(
      <ItemSection kind="done" items={[emptyItem("done", "انجام شد")]} onChange={noop} onSearch={noop} />
    );
    expect(blocker).toContain("نیاز به کمک دارم");
    expect(done).not.toContain("نیاز به کمک دارم");
    expect(done).toContain("تخمین تلاش (نه ساعت کاری)");
    expect(done).not.toMatch(/ساعت کاری\s*:|اضافه‌کاری|ورود|خروج/);
  });

  it("renders a suggestion card with its source and keep / edit / drop", () => {
    const html = render(<SuggestionCard suggestion={suggestion} onKeep={noop} onDrop={noop} />);
    expect(html).toContain("منبع: تیکت T-12");
    for (const label of ["نگه‌دار", "ویرایش", "حذف"]) expect(html).toContain(label);
    expect(html).toContain('href="/edit/ticket/1"');
  });

  it("keeps a suggestion as a traceable line and hides it from the pending list", () => {
    const kept = itemFromSuggestion(suggestion, "متن ویرایش‌شده");
    expect(kept).toMatchObject({ kind: "done", text: "متن ویرایش‌شده", source_kind: "issue", source_id: "1" });
    expect(pendingSuggestions([suggestion], [kept])).toHaveLength(0);
    expect(pendingSuggestions([suggestion], [])).toHaveLength(1);
  });

  it("builds the save body with the revision and only non-empty lines", () => {
    const items: ReportItem[] = [
      { ...emptyItem("done", " کار "), issue: { id: "i1", title: "ت" } },
      emptyItem("next_step", "  "),
    ];
    const body = savePayload(
      items,
      day({
        report: {
          id: "r",
          status: "draft",
          status_label: "",
          revision: 3,
          submitted_at: null,
          first_submitted_at: null,
          is_late: false,
          items: [],
        },
      }),
      true
    );
    expect(body.revision).toBe(3);
    expect(body.submit).toBe(true);
    expect(body.items).toEqual([
      expect.objectContaining({ kind: "done", text: "کار", issue_id: "i1", project_id: null, needs_help: false }),
    ]);
    expect(body.items[0]).not.toHaveProperty("clientKey");
  });

  it("gives unsaved and copied rows separate stable keys without mutating their source", () => {
    const first = emptyItem("in_progress", "کار اول");
    const second = emptyItem("in_progress", "کار دوم");
    expect(first.clientKey).toBeTruthy();
    expect(first.clientKey).not.toBe(second.clientKey);
    const original = { ...first, id: "saved-item" };
    const copied = itemsFromPrevious([original])[0];
    expect(copied.clientKey).not.toBe(original.clientKey);
    expect(copied.id).toBeUndefined();
    expect(original.id).toBe("saved-item");
    expect(original.source_kind).toBe("");
  });

  it("validates before sending", () => {
    expect(itemErrors([], true)).toEqual(["برای ثبت گزارش دست‌کم یک مورد بنویسید."]);
    expect(itemErrors([{ ...emptyItem("done", "x"), effort_minutes: 5000 }], false)[0]).toContain("۱۴۴۰");
    expect(parseEffort("۹۰")).toBe(90);
    expect(parseEffort("")).toBeNull();
  });

  it("copies open lines from the previous report but not what was already done", () => {
    const copied = itemsFromPrevious([
      emptyItem("done", "قدیمی"),
      emptyItem("next_step", "بعدی"),
      emptyItem("blocker", "مانع"),
    ]);
    expect(copied.map((item) => [item.kind, item.text, item.source_kind])).toEqual([
      ["in_progress", "بعدی", "previous"],
      ["blocker", "مانع", "previous"],
    ]);
  });

  it("names the day status for the header", () => {
    expect(dayBadge(day({ requirement: "not_required" })).label).toBe("مرخصی یا عدم حضور تمام‌روز — گزارش لازم نیست");
    expect(dayBadge(day()).label).toBe("ثبت‌نشده");
    expect(
      dayBadge(
        day({
          report: {
            id: "r",
            status: "submitted",
            status_label: "",
            revision: 2,
            submitted_at: "",
            first_submitted_at: "",
            is_late: true,
            items: [],
          },
        })
      )
    ).toEqual({ label: "ثبت‌شده (دیرهنگام)", tone: "warning" });
    expect(shiftDate("2027-01-09", -1)).toBe("2027-01-08");
  });
});

describe("daily report — team view, navigation and reminders", () => {
  const team: TeamDay = {
    date: "2027-01-09",
    date_text: "",
    count: 16,
    page: 2,
    page_size: 10,
    pages: 2,
    summary: { submitted: 12, late: 1, draft: 0, missing: 2, not_required: 1, off: 0, future: 0 },
    titles: {
      submitted: "ثبت‌شده",
      late: "دیرهنگام",
      draft: "پیش‌نویس",
      missing: "ثبت‌نشده",
      not_required: "لازم نیست",
      off: "غیرکاری",
      future: "",
    },
    people: [
      {
        person: { id: "a", name: "الف" },
        status: "missing",
        status_label: "ثبت‌نشده",
        submitted_at: null,
        leaves: [],
        blockers: [],
        help: [{ ...emptyItem("blocker", "منتظر تأیید"), id: "h", needs_help: true }],
        counts: { done: 0, in_progress: 0, blocker: 1, next_step: 0 },
      },
    ],
    empty: null,
  };

  it("summarizes with Persian digits and separates help requests", () => {
    const html = render(
      <>
        <TeamSummary team={team} />
        <TeamTable team={team} date="2027-01-09" />
      </>
    );
    expect(html).toContain("۱۲");
    expect(html).toContain("منتظر تأیید");
    expect(html).toContain('href="/daily-report?date=2027-01-09&amp;user=a"');
  });

  it("uses server totals for the pager and keeps the returned order without filtering a page again", () => {
    const html = render(
      <TeamResults
        team={{
          ...team,
          people: [
            { ...team.people[0], person: { id: "z", name: "نفر اول سرور" }, status: "submitted" },
            { ...team.people[0], person: { id: "a", name: "نفر دوم سرور" } },
          ],
        }}
        onPage={noop}
        onPageSize={noop}
      />
    );
    expect(html).toContain("۱۲"); // Whole-team summary, rather than the two visible rows.
    expect(html).toContain("نمایش <b>۱۱</b> تا <b>۱۶</b> از <b>۱۶</b> نفر");
    expect(html.indexOf("نفر اول سرور")).toBeLessThan(html.indexOf("نفر دوم سرور"));
    expect(html).toContain('aria-current="page" aria-label="صفحه ۲"');
    expect(html).toContain('<option value="10" selected="">۱۰</option>');
  });

  it("retains whole-team counts for an empty filter without showing an invalid pager", () => {
    const html = render(
      <TeamResults team={{ ...team, people: [], count: 0, page: 1, pages: 1 }} onPage={noop} onPageSize={noop} />
    );
    expect(html).toContain("کسی در این فهرست نیست");
    expect(html).toContain("۱۲");
    expect(html).not.toContain('class="table-pagination"');
  });

  it("guards pages by permission and places the team page under reports", () => {
    expect(canAccessPath("/daily-report", can([reportPermissions.submit]))).toBe(true);
    expect(canAccessPath("/daily-report/team", can([reportPermissions.submit]))).toBe(false);
    expect(canAccessPath("/daily-report/team", can([reportPermissions.teamDaily]))).toBe(true);
    expect(canAccessPath("/reports", can([reportPermissions.view]))).toBe(true);
    expect(canAccessPath("/reports/saved/x", can([]))).toBe(false);
    const groups = [
      { id: "home", items: [{ to: "/sections/home/daily-report", path: "/daily-report" }] },
      { id: "reports", items: [{ to: "/sections/reports/daily-report/team", path: "/daily-report/team" }] },
    ] as ShellGroup[];
    expect(groupForPath("/daily-report/team", groups)).toBe("reports");
    expect(groupForPath("/daily-report", groups)).toBe("home");
  });

  it("opens the day from an in-app reminder", () => {
    const item = presentNotification({
      id: "n1",
      sender: "crm:daily_report:reminder",
      title: "یادآوری گزارش روزانه",
      message_stripped: "گزارش کار امروز (۱۴۰۵/۱۰/۱۹) هنوز ثبت نشده است.",
      data: { crm_event: { kind: "daily_report_reminder", link: "/daily-report?date=2027-01-09" } },
    });
    expect(item.eventLabel).toBe("یادآوری گزارش روزانه");
    expect(item.actionHref).toBe("/daily-report?date=2027-01-09");
    const forged = presentNotification({
      id: "n2",
      sender: "crm:daily_report:reminder",
      data: { crm_event: { kind: "daily_report_reminder", link: "https://evil.test" } },
    });
    expect(forged.actionHref).toBe("/daily-report");
  });
});
