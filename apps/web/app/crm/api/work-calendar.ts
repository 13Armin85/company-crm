/** Work calendar: schedules, events, self-reported presence and own confirmations. Server re-checks every permission. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, toastError, toastSuccess, useSlug } from "./client";

export type WorkMode = "" | "onsite" | "remote" | "hybrid";
export type ScheduleSource = "company" | "team" | "person" | "exception";
export type AvailabilityReason = "schedule" | "off_schedule" | "event" | "absence" | null;
export type WorkEventKind = "meeting" | "mission" | "event";

export interface TimeRange {
  start: string;
  end: string;
}

export interface ScheduleDay {
  date: string;
  is_working: boolean;
  start: string | null;
  end: string | null;
  breaks: TimeRange[];
  work_mode: WorkMode;
  source: ScheduleSource;
  source_id?: string | null;
  reason?: string;
  builtin?: boolean;
}

export interface WeekDayInput {
  weekday: number;
  is_working: boolean;
  start: string;
  end: string;
  breaks: TimeRange[];
  work_mode: WorkMode;
}

export interface ScheduleVersion {
  id: string;
  scope: "company" | "unit" | "person";
  effective_from: string;
  effective_to: string | null;
  reason: string;
  days: (Omit<WeekDayInput, "start" | "end"> & { start: string | null; end: string | null })[];
}

export interface ScheduleException {
  id: string;
  user_id: string;
  date_from: string;
  date_to: string;
  is_working: boolean;
  start: string | null;
  end: string | null;
  reason: string;
  status: "active" | "cancelled";
}

export interface WorkEventView {
  id: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  status: "planned" | "cancelled";
  label: string;
  restricted: boolean;
  kind?: WorkEventKind;
  title?: string;
  description?: string;
  private_note?: string;
  participants?: { id: string; name: string }[];
  can_manage?: boolean;
  outside_working_hours?: boolean;
}

export interface PresenceView {
  id: string;
  user_id: string;
  date: string;
  declared_at: string;
  time_zone: string;
  status: "active" | "cancelled";
  label: string;
  notice: string;
}

export interface AbsenceView {
  id: string;
  starts_at: string;
  ends_at: string;
  reason: string;
  label: string;
}

export interface AvailabilitySegment {
  start: string;
  end: string;
  available: boolean;
  reason: AvailabilityReason;
  label: string;
}

export interface WorkCalendarData {
  user: { id: string; name: string };
  time_zone: string;
  today: string;
  restricted: boolean;
  can_view_details: boolean;
  is_self?: boolean;
  can_edit?: boolean;
  can_edit_past?: boolean;
  can_schedule?: boolean;
  events: WorkEventView[];
  availability: AvailabilitySegment[];
  days?: ScheduleDay[];
  exceptions?: ScheduleException[];
  absences?: AbsenceView[];
  presence?: PresenceView[];
  presence_today?: { can_declare: boolean; is_working_day: boolean; declaration: PresenceView | null };
}

export interface CalendarPerson {
  id: string;
  name: string;
  relation: "self" | "direct" | "ancestor" | null;
  can_view: boolean;
  can_edit: boolean;
  can_schedule: boolean;
}

export interface PendingItem {
  source_type: "event" | "presence";
  source_id: string;
  kind: WorkEventKind | "presence";
  title: string;
  starts_at: string;
  ends_at: string;
}

const base = (slug?: string) => `/api/workspaces/${slug ?? ""}/work-calendar/`;

export const useWorkCalendar = (userId: string | undefined, start: string, end: string) => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["work-calendar", slug, userId ?? "me", start, end],
    enabled: Boolean(slug && start && end),
    queryFn: async ({ signal }): Promise<WorkCalendarData> =>
      (await api.get(base(slug), { params: { user: userId || undefined, start, end }, signal })).data,
  });
};

export const useWorkCalendarPeople = () => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["work-calendar-people", slug],
    enabled: Boolean(slug),
    queryFn: async ({ signal }): Promise<{ people: CalendarPerson[]; can_manage_defaults: boolean }> =>
      (await api.get(`${base(slug)}people/`, { signal })).data,
  });
};

export const useScheduleVersions = (userId: string | undefined, enabled = true) => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["work-schedule-versions", slug, userId ?? "me"],
    enabled: Boolean(slug) && enabled,
    queryFn: async ({ signal }): Promise<ScheduleVersion[]> =>
      (await api.get(`${base(slug)}schedules/`, { params: { user: userId || undefined }, signal })).data.versions,
  });
};

export const usePendingActivities = () => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["work-calendar-pending", slug],
    enabled: Boolean(slug),
    queryFn: async ({ signal }): Promise<PendingItem[]> =>
      (await api.get(`${base(slug)}pending/`, { signal })).data.items,
  });
};

const useCalendarMutation = <T>(
  request: (slug: string, payload: T) => Promise<{ data: unknown }>,
  success: string,
  failure: string
) => {
  const slug = useSlug();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (payload: T) => (await request(slug ?? "", payload)).data as Record<string, unknown>,
    onSuccess: async (data) => {
      await Promise.all(
        ["work-calendar", "work-schedule-versions", "work-calendar-pending"].map((key) =>
          client.invalidateQueries({ queryKey: [key, slug] })
        )
      );
      const warnings = (data?.warnings as { message: string }[] | undefined) ?? [];
      toastSuccess(warnings.length ? `${success} — ${warnings.map((item) => item.message).join(" ")}` : success);
    },
    onError: (error) => toastError(error, failure),
  });
};

export const useSaveScheduleVersion = () =>
  useCalendarMutation(
    (
      slug,
      payload: { user: string; effective_from: string; effective_to?: string; reason: string; days: WeekDayInput[] }
    ) => api.post(`${base(slug)}schedules/`, payload),
    "نسخهٔ جدید برنامهٔ کاری ثبت شد",
    "ثبت برنامهٔ کاری انجام نشد"
  );

export const useCreateScheduleException = () =>
  useCalendarMutation(
    (
      slug,
      payload: {
        user: string;
        date_from: string;
        date_to: string;
        is_working: boolean;
        start?: string;
        end?: string;
        reason: string;
      }
    ) => api.post(`${base(slug)}exceptions/`, payload),
    "استثنای تاریخ‌دار ثبت شد",
    "ثبت استثنا انجام نشد"
  );

export const useCancelScheduleException = () =>
  useCalendarMutation(
    (slug, payload: { id: string; reason: string }) =>
      api.post(`${base(slug)}exceptions/${payload.id}/cancel/`, { reason: payload.reason }),
    "استثنا لغو شد",
    "لغو استثنا انجام نشد"
  );

export const useCreateWorkEvent = () =>
  useCalendarMutation(
    (
      slug,
      payload: {
        kind: WorkEventKind;
        title: string;
        description: string;
        private_note: string;
        starts_at: string;
        ends_at: string;
        all_day: boolean;
        participant_ids: string[];
      }
    ) => api.post(`${base(slug)}events/`, payload),
    "رویداد ثبت شد",
    "ثبت رویداد انجام نشد"
  );

export const useCancelWorkEvent = () =>
  useCalendarMutation(
    (slug, payload: { id: string; reason: string }) =>
      api.post(`${base(slug)}events/${payload.id}/cancel/`, { reason: payload.reason }),
    "رویداد لغو شد",
    "لغو رویداد انجام نشد"
  );

export const useDeclarePresence = () =>
  useCalendarMutation(
    (slug, _payload: void) => api.post(`${base(slug)}presence/`, {}),
    "اعلام حضور امروز ثبت شد",
    "ثبت اعلام حضور انجام نشد"
  );

export const useCancelPresence = () =>
  useCalendarMutation(
    (slug, payload: { id: string; reason?: string }) =>
      api.post(`${base(slug)}presence/${payload.id}/cancel/`, { reason: payload.reason ?? "" }),
    "اعلام حضور لغو شد",
    "لغو اعلام حضور انجام نشد"
  );

export const useConfirmActivity = () =>
  useCalendarMutation(
    (
      slug,
      payload: {
        source_type: PendingItem["source_type"];
        source_id: string;
        outcome: "done" | "not_done";
        summary: string;
      }
    ) => api.post(`${base(slug)}pending/`, payload),
    "وضعیت مورد ثبت شد",
    "ثبت وضعیت انجام نشد"
  );
