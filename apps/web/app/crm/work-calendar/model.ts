/** Pure helpers for the work-calendar layers and the weekly schedule editor. */
import { zonedDateTime } from "@plane/ui";
import type { TimeRange, WeekDayInput, WorkCalendarData, WorkMode } from "../api/work-calendar";
import { toFa } from "../utils";

export type LayerId =
  | "tasks"
  | "schedule"
  | "exception"
  | "off"
  | "meeting"
  | "mission"
  | "event"
  | "presence"
  | "absence"
  | "busy";

export const LAYERS: { id: LayerId; label: string }[] = [
  { id: "tasks", label: "موعد کارها" },
  { id: "schedule", label: "برنامهٔ هفتگی" },
  { id: "exception", label: "استثنای تاریخ‌دار" },
  { id: "off", label: "روز غیرکاری" },
  { id: "meeting", label: "جلسه" },
  { id: "mission", label: "مأموریت" },
  { id: "event", label: "رویداد کاری" },
  { id: "presence", label: "اعلام حضور موردی" },
  { id: "absence", label: "مرخصی" },
  { id: "busy", label: "در دسترس نیست" },
];

export const ALL_LAYERS = new Set<LayerId>(LAYERS.map((layer) => layer.id));

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  "": "نامشخص",
  onsite: "حضوری",
  remote: "دورکاری",
  hybrid: "ترکیبی",
};

export const SOURCE_LABELS = { company: "برنامهٔ شرکت", team: "برنامهٔ واحد", person: "برنامهٔ فرد", exception: "استثنا" };

/** Iranian week order (Saturday first) mapped to Python weekday numbers (Monday = 0). */
export const WEEK_ORDER: { weekday: number; label: string }[] = [
  { weekday: 5, label: "شنبه" },
  { weekday: 6, label: "یکشنبه" },
  { weekday: 0, label: "دوشنبه" },
  { weekday: 1, label: "سه‌شنبه" },
  { weekday: 2, label: "چهارشنبه" },
  { weekday: 3, label: "پنجشنبه" },
  { weekday: 4, label: "جمعه" },
];

export interface DayChip {
  key: string;
  layer: LayerId;
  label: string;
  detail?: string;
  flag?: string;
}

export const faTime = (value?: string | null) => (value ? toFa(value.slice(0, 5)) : "");
const localTime = (value: string, zone: string) => faTime(zonedDateTime(value, zone)?.time);
const localDate = (value: string, zone: string) => zonedDateTime(value, zone)?.date ?? "";

/** Local dates touched by [start, end); an end at exactly midnight does not touch the next day. */
const touches = (start: string, end: string, date: string, zone: string) => {
  const last = localDate(new Date(Date.parse(end) - 1).toISOString(), zone);
  return localDate(start, zone) <= date && date <= last;
};

export function dayChips(data: WorkCalendarData | undefined, date: string, layers: Set<LayerId>): DayChip[] {
  if (!data) return [];
  const zone = data.time_zone;
  const chips: DayChip[] = [];
  const day = data.days?.find((item) => item.date === date);
  if (day) {
    if (!day.is_working) {
      if (layers.has("off"))
        chips.push({
          key: `off-${date}`,
          layer: day.source === "exception" ? "exception" : "off",
          label: "روز غیرکاری",
          detail: day.reason,
        });
    } else {
      const layer: LayerId = day.source === "exception" ? "exception" : "schedule";
      if (layers.has(layer)) {
        const hours = `${faTime(day.start)} تا ${faTime(day.end)}`;
        const breaks = day.breaks.length
          ? ` · استراحت ${day.breaks.map((item) => `${faTime(item.start)}–${faTime(item.end)}`).join("، ")}`
          : "";
        chips.push({
          key: `${layer}-${date}`,
          layer,
          label: layer === "exception" ? `استثنا: ${hours}` : hours,
          detail: `${SOURCE_LABELS[day.source]}${day.work_mode ? ` · ${WORK_MODE_LABELS[day.work_mode]}` : ""}${breaks}${day.reason ? ` · ${day.reason}` : ""}`,
        });
      }
    }
  }
  for (const event of data.events) {
    if (event.status === "cancelled" || !touches(event.starts_at, event.ends_at, date, zone)) continue;
    const time = event.all_day ? "تمام‌روز" : `${localTime(event.starts_at, zone)} تا ${localTime(event.ends_at, zone)}`;
    if (event.restricted || !event.kind) {
      if (layers.has("busy"))
        chips.push({ key: `busy-${event.id}-${date}`, layer: "busy", label: "در دسترس نیست", detail: time });
      continue;
    }
    if (!layers.has(event.kind)) continue;
    chips.push({
      key: `${event.id}-${date}`,
      layer: event.kind,
      label: event.title ?? "",
      detail: time,
      flag: event.outside_working_hours ? "خارج از ساعت کاری" : undefined,
    });
  }
  if (layers.has("presence"))
    for (const presence of data.presence ?? [])
      if (presence.status === "active" && presence.date === date)
        chips.push({
          key: `presence-${presence.id}`,
          layer: "presence",
          label: "اعلام‌شده توسط خود فرد",
          detail: `ثبت در ساعت ${localTime(presence.declared_at, presence.time_zone)} · این اعلام حضور فیزیکی را اثبات نمی‌کند`,
        });
  if (layers.has("absence"))
    for (const absence of data.absences ?? [])
      if (touches(absence.starts_at, absence.ends_at, date, zone))
        chips.push({ key: `absence-${absence.id}-${date}`, layer: "absence", label: "مرخصی", detail: absence.reason });
  return chips;
}

export const defaultWeek = (): WeekDayInput[] =>
  WEEK_ORDER.map(({ weekday }) => ({
    weekday,
    is_working: weekday !== 4,
    start: "08:00",
    end: "16:00",
    breaks: [],
    work_mode: "",
  }));

const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

/** Mirrors the server rules so the editor can explain problems before submitting. */
export function validateWeek(days: WeekDayInput[]): string[] {
  const errors: string[] = [];
  for (const day of days) {
    if (!day.is_working) continue;
    const label = WEEK_ORDER.find((item) => item.weekday === day.weekday)?.label ?? "";
    if (minutes(day.end) <= minutes(day.start)) {
      errors.push(`${label}: ساعت پایان باید بعد از ساعت شروع باشد.`);
      continue;
    }
    // A fresh array; keep sorting compatible with the ES2022 target.
    // oxlint-disable-next-line unicorn/no-array-sort
    const sorted = [...day.breaks].sort((a: TimeRange, b: TimeRange) => minutes(a.start) - minutes(b.start));
    for (const item of sorted) {
      if (minutes(item.end) <= minutes(item.start)) errors.push(`${label}: پایان استراحت باید بعد از شروع آن باشد.`);
      else if (minutes(item.start) < minutes(day.start) || minutes(item.end) > minutes(day.end))
        errors.push(`${label}: استراحت باید داخل بازهٔ کاری باشد.`);
    }
    for (let index = 1; index < sorted.length; index++)
      if (minutes(sorted[index].start) < minutes(sorted[index - 1].end))
        errors.push(`${label}: بازه‌های استراحت نباید با هم هم‌پوشانی داشته باشند.`);
  }
  return errors;
}
