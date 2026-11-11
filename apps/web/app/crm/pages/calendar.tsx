import { jalaliToDateOnly, parseDateOnly, SearchableSelect, zonedDateTime } from "@plane/ui";
import { useMemo, useState } from "react";
import { jalaaliMonthLength } from "jalaali-js";
import { CalendarPlus, CalendarRange, Clock, Plus } from "lucide-react";
import {
  useCancelPresence,
  useConfirmActivity,
  useCreateScheduleException,
  useCreateWorkEvent,
  useCurrentUser,
  useDeclarePresence,
  useIssues,
  usePendingActivities,
  useProjects,
  useSaveScheduleVersion,
  useScheduleVersions,
  useWorkCalendar,
  useWorkCalendarPeople,
  useWorkspaceAccess,
} from "../api";
import type { WeekDayInput } from "../api/work-calendar";
import { Button, PageHeader } from "../components";
import { IssueCalendar } from "../issue-calendar";
import { useUIStore } from "../store";
import {
  ExceptionForm,
  LayerChips,
  LayerFilter,
  PendingConfirmations,
  PersonPicker,
  PresenceToday,
  WeeklyScheduleEditor,
  WorkEventForm,
} from "../work-calendar/components";
import { ALL_LAYERS, dayChips } from "../work-calendar/model";
import type { LayerId } from "../work-calendar/model";

/** First and last Gregorian dates of the Jalali month containing `value`. */
export function monthRange(value: string) {
  const parsed = parseDateOnly(value)!;
  return {
    start: jalaliToDateOnly(parsed.jy, parsed.jm, 1),
    end: jalaliToDateOnly(parsed.jy, parsed.jm, jalaaliMonthLength(parsed.jy, parsed.jm)),
  };
}

type Panel = "schedule" | "exception" | "event" | null;

export default function CalendarPage() {
  const { data: currentUser } = useCurrentUser();
  const [projectFilter, setProjectFilter] = useState("all");
  const setCreate = useUIStore((state) => state.setCreateOpen);
  const { data: issues = [], isLoading } = useIssues();
  const { data: projects = [] } = useProjects();
  const { data: access } = useWorkspaceAccess();
  const [date, setDate] = useState(() => zonedDateTime(new Date(), currentUser?.timeZone)!.date);
  const [personId, setPersonId] = useState("");
  const [layers, setLayers] = useState<Set<LayerId>>(ALL_LAYERS);
  const [panel, setPanel] = useState<Panel>(null);
  const range = useMemo(() => monthRange(date), [date]);
  const { data: peopleData } = useWorkCalendarPeople();
  const people = peopleData?.people ?? [];
  const selectedId = personId || currentUser?.id || "";
  const isSelf = !personId || personId === currentUser?.id;
  const { data: calendar, isLoading: calendarLoading } = useWorkCalendar(
    isSelf ? undefined : personId,
    range.start,
    range.end
  );
  const { data: versions = [] } = useScheduleVersions(isSelf ? undefined : personId, Boolean(calendar?.can_edit));
  const { data: pending = [] } = usePendingActivities();
  const saveVersion = useSaveScheduleVersion();
  const createException = useCreateScheduleException();
  const createEvent = useCreateWorkEvent();
  const declare = useDeclarePresence();
  const cancelPresence = useCancelPresence();
  const confirm = useConfirmActivity();
  const zone = calendar?.time_zone ?? currentUser?.timeZone;
  const today = calendar?.today;
  const latest = versions.find((version) => !version.effective_to) ?? versions[0];
  const initialWeek: WeekDayInput[] | undefined = latest?.days.map((day) => ({
    ...day,
    start: day.start ?? "08:00",
    end: day.end ?? "16:00",
  }));
  const visibleIssues = layers.has("tasks")
    ? issues.filter((issue) => projectFilter === "all" || issue.projectId === projectFilter)
    : [];

  return (
    <div className="work-calendar-page">
      <PageHeader
        eyebrow="برنامه تیم"
        title="تقویم"
        description="موعد کارها، برنامهٔ کاری، رویدادها، اعلام حضور و مرخصی در یک تقویم"
        actions={
          <>
            {calendar?.can_schedule && (
              <Button
                icon={CalendarPlus}
                variant="secondary"
                onClick={() => setPanel(panel === "event" ? null : "event")}
              >
                رویداد جدید
              </Button>
            )}
            {access?.can("Issue.Create") ? (
              <Button icon={Plus} onClick={() => setCreate(true, "issue")}>
                کار جدید
              </Button>
            ) : undefined}
          </>
        }
      />
      <div className="work-calendar-controls">
        <PersonPicker
          people={people}
          value={selectedId}
          onChange={(id) => {
            setPersonId(id);
            setPanel(null);
          }}
        />
        <LayerFilter enabled={layers} onChange={setLayers} />
      </div>
      {calendar?.restricted && (
        <p className="work-restricted-note" role="note">
          شما فقط بازه‌های «در دسترس / در دسترس نیست» این فرد را می‌بینید؛ جزئیات برنامه و رویدادها محرمانه است.
        </p>
      )}
      {isSelf && (
        <PresenceToday
          state={calendar?.presence_today}
          busy={declare.isPending || cancelPresence.isPending}
          onDeclare={() => declare.mutate()}
          onCancel={(id) => cancelPresence.mutate({ id })}
        />
      )}
      {calendar?.can_edit && (
        <div className="work-calendar-actions">
          <Button icon={Clock} variant="secondary" onClick={() => setPanel(panel === "schedule" ? null : "schedule")}>
            ویرایش برنامهٔ هفتگی
          </Button>
          <Button
            icon={CalendarRange}
            variant="secondary"
            onClick={() => setPanel(panel === "exception" ? null : "exception")}
          >
            استثنای تاریخ‌دار
          </Button>
        </div>
      )}
      {panel === "schedule" && calendar?.can_edit && (
        <WeeklyScheduleEditor
          key={`${selectedId}-${latest?.id ?? "default"}`}
          initial={initialWeek}
          minDate={calendar.can_edit_past ? undefined : today}
          timeZone={zone}
          saving={saveVersion.isPending}
          onCancel={() => setPanel(null)}
          onSubmit={(payload) =>
            saveVersion.mutate({ user: calendar.user.id, ...payload }, { onSuccess: () => setPanel(null) })
          }
        />
      )}
      {panel === "exception" && calendar?.can_edit && (
        <ExceptionForm
          minDate={calendar.can_edit_past ? undefined : today}
          timeZone={zone}
          saving={createException.isPending}
          onCancel={() => setPanel(null)}
          onSubmit={(payload) =>
            createException.mutate({ user: calendar.user.id, ...payload }, { onSuccess: () => setPanel(null) })
          }
        />
      )}
      {panel === "event" && calendar?.can_schedule && (
        <WorkEventForm
          people={
            people.length
              ? people
              : [
                  {
                    id: selectedId,
                    name: calendar.user.name,
                    relation: "self",
                    can_view: true,
                    can_edit: false,
                    can_schedule: true,
                  },
                ]
          }
          defaultParticipant={calendar.user.id}
          timeZone={zone}
          saving={createEvent.isPending}
          onCancel={() => setPanel(null)}
          onSubmit={(payload) => createEvent.mutate(payload, { onSuccess: () => setPanel(null) })}
        />
      )}
      <IssueCalendar
        issues={visibleIssues}
        projects={projects}
        timeZone={currentUser?.timeZone}
        isLoading={isLoading || calendarLoading}
        value={date}
        onValueChange={setDate}
        emptyHidden
        renderDay={(day) => <LayerChips chips={dayChips(calendar, day, layers)} />}
        toolbarEnd={
          layers.has("tasks") ? (
            <div className="calendar-project-filter">
              <label htmlFor="calendar-project-filter">نمایش کارهای پروژه</label>
              <SearchableSelect
                id="calendar-project-filter"
                label="فیلتر پروژه"
                value={projectFilter}
                onChange={setProjectFilter}
                options={[
                  { id: "all", title: "همه پروژه‌ها" },
                  ...projects.map((project) => ({ id: project.id, title: project.name })),
                ]}
              />
            </div>
          ) : undefined
        }
      />
      <PendingConfirmations
        items={pending}
        busy={confirm.isPending}
        onConfirm={(item, outcome, summary) =>
          confirm.mutate({ source_type: item.source_type, source_id: item.source_id, outcome, summary })
        }
      />
    </div>
  );
}
