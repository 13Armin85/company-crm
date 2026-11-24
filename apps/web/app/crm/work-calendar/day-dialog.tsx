import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { zonedDateTime } from "@plane/ui";
import { CalendarDays, CalendarPlus, Clock3, SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";
import {
  useCancelPresence,
  useConfirmActivity,
  useCreateScheduleException,
  useCreateWorkEvent,
  useDeclarePresence,
  usePendingActivities,
  useSaveScheduleVersion,
  useScheduleVersions,
  useWorkCalendar,
  useWorkCalendarPeople,
} from "../api/work-calendar";
import { persianDate } from "../utils";
import {
  ExceptionForm,
  LayerFilter,
  PendingConfirmations,
  PersonPicker,
  PresenceToday,
  WeeklyScheduleEditor,
  WorkEventForm,
} from "./components";
import { touchesCalendarDay } from "./model";
import type { LayerId } from "./model";

type Section = "day" | "event" | "exception" | "schedule" | "settings";

export function WorkCalendarDayDialog({
  date,
  personId,
  onPersonChange,
  layers,
  onLayersChange,
  onClose,
}: {
  date: string;
  personId: string;
  onPersonChange: (id: string) => void;
  layers: Set<LayerId>;
  onLayersChange: (layers: Set<LayerId>) => void;
  onClose: () => void;
}) {
  const { data: calendar, isLoading } = useWorkCalendar(personId || undefined, date, date);
  const { data: peopleData } = useWorkCalendarPeople();
  const { data: pending = [] } = usePendingActivities();
  const { data: versions = [] } = useScheduleVersions(personId || undefined, Boolean(calendar?.can_edit));
  const createEvent = useCreateWorkEvent();
  const createException = useCreateScheduleException();
  const saveVersion = useSaveScheduleVersion();
  const declare = useDeclarePresence();
  const cancelPresence = useCancelPresence();
  const confirm = useConfirmActivity();
  const [section, setSection] = useState<Section>("day");
  const zone = calendar?.time_zone;
  const events =
    calendar?.events.filter(
      (event) =>
        event.status !== "cancelled" && touchesCalendarDay(event.starts_at, event.ends_at, date, zone || "Asia/Tehran")
    ) ?? [];
  const dayPending = pending.filter((item) => zonedDateTime(item.starts_at, zone)?.date === date);
  const latest = versions.find((version) => !version.effective_to) ?? versions[0];
  const people = peopleData?.people ?? [];
  const participants = people.length
    ? people
    : calendar
      ? [
          {
            id: calendar.user.id,
            name: calendar.user.name,
            relation: "self" as const,
            can_view: true,
            can_edit: false,
            can_schedule: true,
          },
        ]
      : [];
  const tabs: { id: Section; label: string; visible: boolean }[] = [
    { id: "day", label: "برنامهٔ روز", visible: true },
    { id: "event", label: "ثبت رویداد", visible: Boolean(calendar?.can_schedule) },
    { id: "exception", label: "استثنای روز", visible: Boolean(calendar?.can_edit) },
    { id: "schedule", label: "برنامهٔ هفتگی", visible: Boolean(calendar?.can_edit) },
    { id: "settings", label: "نمایش", visible: true },
  ];

  return (
    <Dialog open onClose={onClose} className="work-day-dialog">
      <div className="work-day-backdrop" aria-hidden="true" />
      <DialogPanel className="work-day-panel" dir="rtl">
        <header className="work-day-header">
          <div className="work-day-header-icon">
            <CalendarDays size={22} aria-hidden="true" />
          </div>
          <div>
            <span>برنامهٔ انتخاب‌شده</span>
            <DialogTitle>{persianDate(date, { weekday: "long", year: "numeric" })}</DialogTitle>
            <p>رویدادها و اقدام‌های این روز از سامانه دریافت و در آن ثبت می‌شوند.</p>
          </div>
          <button type="button" className="work-day-close" aria-label="بستن" onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        {isLoading ? (
          <p className="work-day-state">در حال دریافت برنامهٔ روز…</p>
        ) : !calendar ? (
          <p className="work-day-state" role="alert">
            دریافت برنامهٔ این روز انجام نشد.
          </p>
        ) : (
          <>
            <nav className="work-day-tabs" aria-label="بخش‌های روز">
              {tabs
                .filter((tab) => tab.visible)
                .map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={section === tab.id ? "active" : ""}
                    aria-current={section === tab.id ? "page" : undefined}
                    onClick={() => setSection(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
            </nav>
            <div className="work-day-content">
              {section === "day" && (
                <div className="work-day-overview">
                  <div className="work-day-summary">
                    <strong>{events.length.toLocaleString("fa-IR")} رویداد در این روز</strong>
                    {calendar.can_schedule && (
                      <button type="button" onClick={() => setSection("event")}>
                        <CalendarPlus size={16} /> ثبت رویداد
                      </button>
                    )}
                  </div>
                  {calendar.restricted && (
                    <p className="work-day-state">
                      جزئیات برنامهٔ این فرد محرمانه است و فقط بازه‌های در دسترس بودن نمایش داده می‌شود.
                    </p>
                  )}
                  {events.length ? (
                    <ol className="work-day-events">
                      {events.map((event) => (
                        <li key={event.id}>
                          <span className="work-day-event-marker" />
                          <div>
                            <strong>{event.title || event.label}</strong>
                            <small>{event.description || event.label}</small>
                          </div>
                          <time dateTime={event.starts_at}>
                            <Clock3 size={14} /> {persianDate(event.starts_at, { hour: "2-digit", minute: "2-digit" })}
                          </time>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="work-day-state">برای این روز هنوز رویدادی ثبت نشده است.</p>
                  )}
                  {date === calendar.today && calendar.is_self && (
                    <PresenceToday
                      state={calendar.presence_today}
                      busy={declare.isPending || cancelPresence.isPending}
                      onDeclare={() => declare.mutate()}
                      onCancel={(id) => cancelPresence.mutate({ id })}
                    />
                  )}
                  {dayPending.length > 0 && (
                    <PendingConfirmations
                      items={dayPending}
                      busy={confirm.isPending}
                      onConfirm={(item, outcome, summary) =>
                        confirm.mutate({ source_type: item.source_type, source_id: item.source_id, outcome, summary })
                      }
                    />
                  )}
                </div>
              )}
              {section === "event" && calendar.can_schedule && (
                <WorkEventForm
                  key={`${date}-${calendar.user.id}`}
                  fixedDate={date}
                  people={participants}
                  defaultParticipant={calendar.user.id}
                  timeZone={zone}
                  saving={createEvent.isPending}
                  onCancel={() => setSection("day")}
                  onSubmit={(payload) => createEvent.mutate(payload, { onSuccess: () => setSection("day") })}
                />
              )}
              {section === "exception" && calendar.can_edit && (
                <ExceptionForm
                  key={`${date}-${calendar.user.id}`}
                  fixedDate={date}
                  minDate={calendar.can_edit_past ? undefined : calendar.today}
                  timeZone={zone}
                  saving={createException.isPending}
                  onCancel={() => setSection("day")}
                  onSubmit={(payload) =>
                    createException.mutate(
                      { user: calendar.user.id, ...payload },
                      { onSuccess: () => setSection("day") }
                    )
                  }
                />
              )}
              {section === "schedule" && calendar.can_edit && (
                <WeeklyScheduleEditor
                  key={`${date}-${calendar.user.id}-${latest?.id ?? "default"}`}
                  initialDate={date}
                  initial={latest?.days.map((day) =>
                    Object.assign({}, day, { start: day.start ?? "08:00", end: day.end ?? "16:00" })
                  )}
                  minDate={calendar.can_edit_past ? undefined : calendar.today}
                  timeZone={zone}
                  saving={saveVersion.isPending}
                  onCancel={() => setSection("day")}
                  onSubmit={(payload) =>
                    saveVersion.mutate({ user: calendar.user.id, ...payload }, { onSuccess: () => setSection("day") })
                  }
                />
              )}
              {section === "settings" && (
                <div className="work-day-settings">
                  <div className="work-day-settings-title">
                    <SlidersHorizontal size={18} />
                    <strong>نمایش تقویم</strong>
                  </div>
                  <PersonPicker
                    people={people}
                    value={calendar.user.id}
                    onChange={(id) => {
                      onPersonChange(id);
                      setSection("day");
                    }}
                  />
                  <LayerFilter enabled={layers} onChange={onLayersChange} />
                </div>
              )}
            </div>
          </>
        )}
      </DialogPanel>
    </Dialog>
  );
}
