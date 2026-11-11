import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkCalendarData } from "../api/work-calendar";
import { IssueCalendar } from "../issue-calendar";
import { monthRange } from "../pages/calendar";
import { LayerChips, LayerFilter, PendingConfirmations, PresenceToday, WeeklyScheduleEditor } from "./components";
import { ALL_LAYERS, dayChips, defaultWeek, validateWeek } from "./model";
import type { LayerId } from "./model";

afterEach(() => {
  vi.useRealTimers();
});

const base: WorkCalendarData = {
  user: { id: "u1", name: "کارمند" },
  time_zone: "Asia/Tehran",
  today: "2027-01-07",
  restricted: false,
  can_view_details: true,
  events: [],
  availability: [],
  days: [
    {
      date: "2027-01-02",
      is_working: true,
      start: "08:00",
      end: "16:00",
      breaks: [{ start: "12:00", end: "12:30" }],
      work_mode: "onsite",
      source: "person",
      reason: "تنظیم",
    },
    { date: "2027-01-03", is_working: true, start: "10:00", end: "16:00", breaks: [], work_mode: "", source: "person" },
    {
      date: "2027-01-05",
      is_working: true,
      start: "12:00",
      end: "18:00",
      breaks: [],
      work_mode: "",
      source: "exception",
      reason: "جلسه بیرونی",
    },
    { date: "2027-01-07", is_working: false, start: null, end: null, breaks: [], work_mode: "", source: "person" },
  ],
  presence: [
    {
      id: "p1",
      user_id: "u1",
      date: "2027-01-07",
      declared_at: "2027-01-07T06:30:00+00:00",
      time_zone: "Asia/Tehran",
      status: "active",
      label: "اعلام‌شده توسط خود فرد",
      notice: "",
    },
  ],
  absences: [
    {
      id: "a1",
      starts_at: "2027-01-08T04:30:00+00:00",
      ends_at: "2027-01-09T04:30:00+00:00",
      reason: "مرخصی استحقاقی",
      label: "مرخصی",
    },
  ],
};

const event = (kind: "meeting" | "mission" | "event", title: string, start: string, end: string, extra = {}) => ({
  id: `${kind}-${title}`,
  kind,
  title,
  starts_at: start,
  ends_at: end,
  all_day: false,
  status: "planned" as const,
  label: "در دسترس نیست",
  restricted: false,
  ...extra,
});

describe("work calendar layers", () => {
  it("labels schedule, exception, non-working day, presence and leave with distinct layers", () => {
    const chips = (date: string) => dayChips(base, date, ALL_LAYERS);
    expect(chips("2027-01-02")).toEqual([
      expect.objectContaining({ layer: "schedule", label: "۰۸:۰۰ تا ۱۶:۰۰", detail: expect.stringContaining("حضوری") }),
    ]);
    expect(chips("2027-01-02")[0].detail).toContain("استراحت ۱۲:۰۰–۱۲:۳۰");
    expect(chips("2027-01-03")[0].label).toBe("۱۰:۰۰ تا ۱۶:۰۰");
    expect(chips("2027-01-05")[0]).toMatchObject({ layer: "exception", label: "استثنا: ۱۲:۰۰ تا ۱۸:۰۰" });
    expect(chips("2027-01-07").map((chip) => [chip.layer, chip.label])).toEqual([
      ["off", "روز غیرکاری"],
      ["presence", "اعلام‌شده توسط خود فرد"],
    ]);
    expect(chips("2027-01-07")[1].detail).toContain("حضور فیزیکی را اثبات نمی‌کند");
    expect(chips("2027-01-08").map((chip) => chip.layer)).toEqual(["absence"]);
    // A leave ending exactly at local midnight-adjacent 08:00 still touches the next day only once.
    expect(chips("2027-01-09").map((chip) => chip.layer)).toEqual(["absence"]);
  });

  it("shows meetings, missions and events in their own layers and flags out-of-hours", () => {
    const data = {
      ...base,
      events: [
        event("meeting", "جلسهٔ بودجه", "2027-01-02T06:30:00+00:00", "2027-01-02T07:30:00+00:00"),
        event("mission", "مأموریت تبریز", "2027-01-02T04:30:00+00:00", "2027-01-03T12:30:00+00:00"),
        event("event", "سمینار", "2027-01-02T15:30:00+00:00", "2027-01-02T16:30:00+00:00", {
          outside_working_hours: true,
        }),
        event("meeting", "لغوشده", "2027-01-02T06:30:00+00:00", "2027-01-02T07:30:00+00:00", { status: "cancelled" }),
      ],
    };
    const chips = dayChips(data, "2027-01-02", ALL_LAYERS);
    expect(chips.map((chip) => [chip.layer, chip.label])).toEqual([
      ["schedule", "۰۸:۰۰ تا ۱۶:۰۰"],
      ["meeting", "جلسهٔ بودجه"],
      ["mission", "مأموریت تبریز"],
      ["event", "سمینار"],
    ]);
    expect(chips[1].detail).toBe("۱۰:۰۰ تا ۱۱:۰۰");
    expect(chips[3].flag).toBe("خارج از ساعت کاری");
    expect(dayChips(data, "2027-01-03", ALL_LAYERS).map((chip) => chip.layer)).toContain("mission");
    const onlyMeetings = new Set<LayerId>(["meeting"]);
    expect(dayChips(data, "2027-01-02", onlyMeetings).map((chip) => chip.label)).toEqual(["جلسهٔ بودجه"]);
  });

  it("renders only 'unavailable' without any title for an unauthorized colleague", () => {
    const restricted: WorkCalendarData = {
      user: { id: "u1", name: "کارمند" },
      time_zone: "Asia/Tehran",
      today: "2027-01-07",
      restricted: true,
      can_view_details: false,
      availability: [],
      events: [
        {
          id: "e1",
          starts_at: "2027-01-04T06:30:00+00:00",
          ends_at: "2027-01-04T07:30:00+00:00",
          all_day: false,
          status: "planned",
          label: "در دسترس نیست",
          restricted: true,
        },
      ],
    };
    const chips = dayChips(restricted, "2027-01-04", ALL_LAYERS);
    expect(chips).toEqual([
      expect.objectContaining({ layer: "busy", label: "در دسترس نیست", detail: "۱۰:۰۰ تا ۱۱:۰۰" }),
    ]);
    const html = renderToStaticMarkup(<LayerChips chips={chips} />);
    expect(html).toContain("در دسترس نیست");
    expect(html).not.toContain("جلسه");
  });

  it("lists every layer with a Persian label in the filter", () => {
    const html = renderToStaticMarkup(<LayerFilter enabled={new Set<LayerId>(["tasks"])} onChange={() => undefined} />);
    for (const label of [
      "موعد کارها",
      "برنامهٔ هفتگی",
      "استثنای تاریخ‌دار",
      "روز غیرکاری",
      "جلسه",
      "مأموریت",
      "رویداد کاری",
      "اعلام حضور موردی",
      "مرخصی",
    ])
      expect(html).toContain(label);
    expect(html.match(/checked=""/g)).toHaveLength(1);
  });

  it("passes each Jalali cell's Gregorian date to renderDay", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-01-07T08:00:00Z"));
    const seen: string[] = [];
    renderToStaticMarkup(
      <IssueCalendar
        issues={[]}
        projects={[]}
        timeZone="Asia/Tehran"
        emptyHidden
        renderDay={(date) => {
          seen.push(date);
          return null;
        }}
      />
    );
    expect(seen[0]).toBe("2026-12-22"); // 1 Dey 1405
    expect(seen).toContain("2027-01-07");
    expect(seen).toHaveLength(30);
    expect(monthRange("2027-01-07")).toEqual({ start: "2026-12-22", end: "2027-01-20" });
  });
});

describe("weekly schedule editor", () => {
  it("renders a non-working Thursday, a 10:00 Sunday start, breaks and the effective date", () => {
    const week = defaultWeek().map((day) =>
      day.weekday === 3
        ? { ...day, is_working: false }
        : day.weekday === 6
          ? { ...day, start: "10:00", breaks: [{ start: "12:00", end: "12:30" }] }
          : day
    );
    const html = renderToStaticMarkup(<WeeklyScheduleEditor initial={week} onSubmit={() => undefined} />);
    expect(html).toMatch(/data-weekday="3" data-working="false"/);
    expect(html).toMatch(/data-weekday="6" data-working="true"/);
    expect(html).toContain("غیرکاری");
    expect(html).toContain('aria-label="حذف استراحت یکشنبه"');
    expect(html).toContain("معتبر از تاریخ");
    expect(html).toContain("دلیل یا توضیح تغییر");
    expect(html).toContain("نسخهٔ قبلی بسته می‌شود ولی حذف نمی‌شود");
    expect(html.indexOf("شنبه")).toBeLessThan(html.indexOf("یکشنبه"));
  });

  it("validates end-after-start, breaks inside hours and non-overlapping breaks in Persian", () => {
    const week = defaultWeek();
    expect(validateWeek(week)).toEqual([]);
    const broken = week.map((day) =>
      day.weekday === 5
        ? { ...day, start: "16:00", end: "08:00" }
        : day.weekday === 6
          ? { ...day, breaks: [{ start: "07:00", end: "07:30" }] }
          : day.weekday === 0
            ? {
                ...day,
                breaks: [
                  { start: "12:00", end: "13:00" },
                  { start: "12:30", end: "13:30" },
                ],
              }
            : day
    );
    expect(validateWeek(broken)).toEqual([
      "شنبه: ساعت پایان باید بعد از ساعت شروع باشد.",
      "یکشنبه: استراحت باید داخل بازهٔ کاری باشد.",
      "دوشنبه: بازه‌های استراحت نباید با هم هم‌پوشانی داشته باشند.",
    ]);
    // Non-working days are not validated.
    expect(validateWeek(week.map((day) => ({ ...day, is_working: false, start: "16:00", end: "08:00" })))).toEqual([]);
  });
});

describe("presence and pending confirmations", () => {
  it("offers 'I am at work today' only on a non-working day", () => {
    const off = renderToStaticMarkup(
      <PresenceToday
        state={{ can_declare: true, is_working_day: false, declaration: null }}
        onDeclare={() => undefined}
        onCancel={() => undefined}
      />
    );
    expect(off).toContain("امروز در محل کار هستم");
    expect(off).toContain("حضور فیزیکی را اثبات");
    const working = renderToStaticMarkup(
      <PresenceToday
        state={{ can_declare: false, is_working_day: true, declaration: null }}
        onDeclare={() => undefined}
        onCancel={() => undefined}
      />
    );
    expect(working).toBe("");
    const declared = renderToStaticMarkup(
      <PresenceToday
        state={{ can_declare: false, is_working_day: false, declaration: base.presence![0] }}
        onDeclare={() => undefined}
        onCancel={() => undefined}
      />
    );
    expect(declared).toContain("اعلام‌شده توسط خود فرد");
    expect(declared).toContain("لغو اعلام");
    expect(declared).not.toContain("امروز در محل کار هستم");
  });

  it("lists pending items with own done / not-done actions and an empty state", () => {
    const html = renderToStaticMarkup(
      <PendingConfirmations
        items={[
          {
            source_type: "event",
            source_id: "e1",
            kind: "meeting",
            title: "جلسهٔ هفتگی",
            starts_at: "2027-01-04T06:30:00+00:00",
            ends_at: "2027-01-04T07:30:00+00:00",
          },
          {
            source_type: "presence",
            source_id: "p1",
            kind: "presence",
            title: "اعلام حضور در روز غیرکاری",
            starts_at: "2027-01-07T00:00:00+03:30",
            ends_at: "2027-01-08T00:00:00+03:30",
          },
        ]}
        onConfirm={() => undefined}
      />
    );
    expect(html).toContain("موارد منتظر تأیید شما");
    expect(html).toContain("جلسهٔ هفتگی");
    expect(html).toContain("اعلام حضور در روز غیرکاری");
    expect(html.match(/انجام شد</g)).toHaveLength(2);
    expect(html.match(/انجام نشد</g)).toHaveLength(2);
    expect(html).toContain("برنامه‌ریزی‌شده به‌معنای انجام‌شده نیست");
    const empty = renderToStaticMarkup(<PendingConfirmations items={[]} onConfirm={() => undefined} />);
    expect(empty).toContain("موردی منتظر تأیید نیست");
  });
});
