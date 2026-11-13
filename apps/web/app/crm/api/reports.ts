/** Daily reports and reports (ticket 8). The server enforces every permission, scope and lock rule;
 * these hooks only carry its decisions to the screen. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, toastError, toastSuccess, useSlug } from "./client";

export type ItemKind = "done" | "in_progress" | "blocker" | "next_step";
export type DayStatus = "submitted" | "late" | "draft" | "missing" | "not_required" | "off" | "future";
export type Requirement = "required" | "not_required" | "off" | "future";

export interface Person {
  id: string;
  name: string;
}

export interface ReportItem {
  id?: string;
  kind: ItemKind;
  kind_label?: string;
  text: string;
  needs_help: boolean;
  issue: { id: string | null; title: string; number?: string; hidden?: boolean } | null;
  project: { id: string; name: string } | null;
  effort_minutes: number | null;
  source_kind: string;
  source_id: string;
  position?: number;
}

export interface DayLeave {
  id: string;
  number: string;
  mode: "daily" | "hourly";
  mode_label: string;
  period_text: string;
  duration_text: string;
  full_day: boolean;
  url: string;
}

export interface DayEvent {
  id: string;
  kind: "meeting" | "mission" | "event";
  kind_label: string;
  title: string;
  starts_at: string;
  ends_at: string;
  time_text: string;
  past: boolean;
  confirmation: "done" | "not_done" | null;
}

export interface DayPayload {
  date: string;
  date_text: string;
  weekday: string;
  today: string;
  person: Person;
  is_mine: boolean;
  schedule: {
    is_working: boolean;
    start: string | null;
    end: string | null;
    breaks: { start: string; end: string }[];
    work_mode: string;
    source: string;
    label: string;
  };
  leaves: DayLeave[];
  requirement: Requirement;
  requirement_text: string;
  events: DayEvent[];
  presence: { declared_at: string; label: string; kind: "self_reported" } | null;
  report: {
    id: string;
    status: "draft" | "submitted";
    status_label: string;
    revision: number;
    submitted_at: string | null;
    first_submitted_at: string | null;
    is_late: boolean;
    items: ReportItem[];
  } | null;
  locked: boolean;
  lock_text: string;
  editable_until: string;
  editable_until_text: string;
  deadline_text: string;
  effort_label: string;
  can: { edit: boolean };
}

export interface Suggestion {
  key: string;
  kind: ItemKind;
  text: string;
  source_kind: string;
  source_id: string;
  source_label: string;
  issue: { id: string; number: string; title: string } | null;
  link: string | null;
  at: string;
}

export interface HistoryEvent {
  id: string;
  type: string;
  title: string;
  actor: Person | null;
  at: string;
  revision: number | null;
  is_late: boolean;
  added: string[];
  removed: string[];
  changed: number;
}

export interface DailyMeta {
  today: string;
  kinds: { code: ItemKind; title: string }[];
  effort_label: string;
  presence_label: string;
  statuses: Record<DayStatus, string>;
  deadline_time: string;
  edit_window: { mode: "working_days" | "week_end"; days: number };
  can: { submit: boolean; team: boolean; manage_reminders: boolean };
}

export interface WorkOptions {
  tickets: { id: string; number: string; title: string; status: string; project: { id: string; name: string } | null }[];
  projects: { id: string; name: string }[];
}

export interface PersonalTemplate {
  id: string;
  title: string;
  kind: ItemKind;
  text: string;
}

export interface TeamDay {
  date: string;
  date_text: string;
  summary: Record<DayStatus, number>;
  titles: Record<DayStatus, string>;
  people: {
    person: Person;
    status: DayStatus;
    status_label: string;
    submitted_at: string | null;
    leaves: DayLeave[];
    blockers: ReportItem[];
    help: ReportItem[];
    counts: Record<ItemKind, number>;
  }[];
  empty: string | null;
}

export interface ReminderValue {
  enabled?: boolean;
  time?: string;
  weekdays?: number[];
}

export interface ReminderSettings {
  effective: Required<ReminderValue>;
  source: "workspace" | "unit" | "personal";
  source_label: string;
  allow_personal: boolean;
  personal: ReminderValue | null;
  workspace: Record<string, unknown> | null;
  can_manage_workspace: boolean;
  units: { id: string; title: string; reminder: ReminderValue | null; allow_personal: boolean | null }[];
  channels: { code: string; title: string; enabled: boolean; note: string }[];
}

// ---------------------------------------------------------------- reports

export type FieldType = "text" | "number" | "date" | "datetime" | "choice" | "person" | "bool";

export interface SourceField {
  key: string;
  label: string;
  type: FieldType;
  filter: boolean;
  group: boolean;
  agg: boolean;
  ops: { code: string; title: string }[];
  choices: { code: string; title: string }[];
  method: string;
}

export interface ReportRange {
  type: "relative" | "absolute";
  days?: number;
  from?: string;
  to?: string;
}

export interface FilterRule {
  field: string;
  op: string;
  value: unknown;
}

export interface ReportDefinition {
  columns: string[];
  filters: FilterRule[];
  range: ReportRange | null;
  sort: { field: string; dir: "asc" | "desc" }[];
  group_by: string[];
  aggregates: { fn: "count" | "sum" | "avg"; field?: string }[];
}

export interface ReportSource {
  code: string;
  title: string;
  description: string;
  note: string;
  version: number;
  date_field: string;
  date_label: string;
  range_required: boolean;
  team: boolean;
  default: ReportDefinition;
  fields: SourceField[];
}

export interface ReportCatalog {
  sources: ReportSource[];
  can: { build: boolean; share: boolean; export: boolean; team: boolean };
  aggregates: { code: string; title: string }[];
}

export type Cell = string | number | null;

export interface AggregateValue {
  fn: "count" | "sum" | "avg";
  field?: string;
  label: string;
  value: number | null;
  method: string;
}

export interface ReportResult {
  source: string;
  title: string;
  note: string;
  definition: ReportDefinition;
  columns: { key: string; label: string; type: FieldType; method: string }[];
  rows: { cells: Cell[]; link: string | null }[];
  total: number;
  page: number;
  pages: number;
  page_size: number;
  aggregates: AggregateValue[];
  groups: { keys: { field: string; label: string; value: Cell }[]; count: number; aggregates: AggregateValue[] }[];
  range: { from: string; to: string; from_text: string; to_text: string; field: string } | null;
  scope: { team: boolean; people: number; all: boolean };
  generated_at: string;
  saved?: SavedReport;
}

export interface SavedReport {
  id: string;
  name: string;
  description: string;
  source: string;
  source_title: string;
  definition: Partial<ReportDefinition>;
  schema_version: number;
  visibility: "personal" | "shared";
  shared_roles: string[];
  shared_units: string[];
  owner: Person;
  mine: boolean;
  revision: number;
  can: { edit: boolean; delete: boolean; share: boolean; copy: boolean; export: boolean };
  updated_at: string;
}

export interface ExportJob {
  id: string;
  status: "pending" | "running" | "ready" | "failed";
  progress: number;
  error: string;
  row_count: number;
  format: "csv" | "xlsx";
  source: string;
  expires_at: string;
  created_at: string;
}

const daily = (slug?: string) => `/api/workspaces/${slug ?? ""}/daily-reports/`;
const reports = (slug?: string) => `/api/workspaces/${slug ?? ""}/reports/`;
export const exportDownloadUrl = (slug: string | undefined, id: string) => `${reports(slug)}exports/${id}/download/`;

export const useDailyMeta = () => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["daily-meta", slug],
    enabled: Boolean(slug),
    queryFn: async ({ signal }): Promise<DailyMeta> => (await api.get(`${daily(slug)}meta/`, { signal })).data,
  });
};

export const useDay = (date: string, user?: string) => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["daily-day", slug, date, user ?? ""],
    enabled: Boolean(slug && date),
    retry: false,
    queryFn: async ({ signal }): Promise<DayPayload> =>
      (await api.get(`${daily(slug)}day/${date}/`, { params: { user: user || undefined }, signal })).data,
  });
};

export const useDayHistory = (date: string, user: string | undefined, enabled: boolean) => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["daily-history", slug, date, user ?? ""],
    enabled: Boolean(slug && date) && enabled,
    queryFn: async ({ signal }): Promise<{ events: HistoryEvent[] }> =>
      (await api.get(`${daily(slug)}day/${date}/history/`, { params: { user: user || undefined }, signal })).data,
  });
};

export const useSaveDay = (date: string) => {
  const slug = useSlug();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: { items: ReportItem[]; revision?: number; submit?: boolean }): Promise<DayPayload> =>
      (await api.put(`${daily(slug)}day/${date}/`, body)).data,
    onSuccess: async (data, body) => {
      client.setQueryData(["daily-day", slug, date, ""], data);
      await client.invalidateQueries({ queryKey: ["daily-history", slug, date] });
      toastSuccess(body.submit ? "گزارش روزانه ثبت شد." : "تغییرات گزارش ذخیره شد.");
    },
    onError: (error) => toastError(error, "ذخیرهٔ گزارش روزانه ممکن نشد"),
  });
};

export const useDraft = (date: string) => {
  const slug = useSlug();
  return useMutation({
    mutationFn: async (): Promise<{ suggestions: Suggestion[]; empty: string | null }> =>
      (await api.get(`${daily(slug)}day/${date}/draft/`)).data,
    onError: (error) => toastError(error, "ساخت پیش‌نویس ممکن نشد"),
  });
};

export const usePrevious = (before: string) => {
  const slug = useSlug();
  return useMutation({
    mutationFn: async (): Promise<{ previous: { date: string; date_text: string; items: ReportItem[] } | null }> =>
      (await api.get(`${daily(slug)}previous/`, { params: { before } })).data,
    onError: (error) => toastError(error, "خواندن گزارش قبلی ممکن نشد"),
  });
};

export const useWorkOptions = (query: string, enabled: boolean) => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["daily-options", slug, query],
    enabled: Boolean(slug) && enabled,
    staleTime: 30_000,
    queryFn: async ({ signal }): Promise<WorkOptions> =>
      (await api.get(`${daily(slug)}options/`, { params: { q: query || undefined }, signal })).data,
  });
};

export const useTemplates = () => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["daily-templates", slug],
    enabled: Boolean(slug),
    queryFn: async ({ signal }): Promise<PersonalTemplate[]> =>
      (await api.get(`${daily(slug)}templates/`, { signal })).data.templates,
  });
};

export const useSaveTemplates = () => {
  const slug = useSlug();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (templates: PersonalTemplate[]): Promise<PersonalTemplate[]> =>
      (await api.put(`${daily(slug)}templates/`, { templates })).data.templates,
    onSuccess: (data) => {
      client.setQueryData(["daily-templates", slug], data);
      toastSuccess("قالب‌های شخصی ذخیره شد.");
    },
    onError: (error) => toastError(error, "ذخیرهٔ قالب ممکن نشد"),
  });
};

export const useTeamDay = (date: string, enabled = true) => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["daily-team", slug, date],
    enabled: Boolean(slug && date) && enabled,
    retry: false,
    queryFn: async ({ signal }): Promise<TeamDay> =>
      (await api.get(`${daily(slug)}team/`, { params: { date }, signal })).data,
  });
};

export const useReminderSettings = () => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["daily-reminder", slug],
    enabled: Boolean(slug),
    queryFn: async ({ signal }): Promise<ReminderSettings> => (await api.get(`${daily(slug)}reminder/`, { signal })).data,
  });
};

export const useSaveReminder = () => {
  const slug = useSlug();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (
      payload:
        | { level: "personal"; reminder: ReminderValue | null }
        | { level: "unit"; unit: string; reminder: ReminderValue | null; allow_personal: boolean | null }
        | { level: "workspace"; data: Record<string, unknown> }
    ): Promise<ReminderSettings> => {
      if (payload.level === "personal") return (await api.put(`${daily(slug)}reminder/`, { reminder: payload.reminder })).data;
      if (payload.level === "unit")
        return (
          await api.put(`${daily(slug)}reminder/units/${payload.unit}/`, {
            reminder: payload.reminder,
            allow_personal: payload.allow_personal,
          })
        ).data;
      return (await api.put(`${daily(slug)}settings/`, payload.data)).data;
    },
    onSuccess: (data) => {
      client.setQueryData(["daily-reminder", slug], data);
      toastSuccess("تنظیمات یادآوری ذخیره شد.");
    },
    onError: (error) => toastError(error, "ذخیرهٔ تنظیمات یادآوری ممکن نشد"),
  });
};

// ---------------------------------------------------------------- reports

export const useReportCatalog = () => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["report-catalog", slug],
    enabled: Boolean(slug),
    retry: false,
    queryFn: async ({ signal }): Promise<ReportCatalog> => (await api.get(`${reports(slug)}sources/`, { signal })).data,
  });
};

export const useSavedReports = () => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["saved-reports", slug],
    enabled: Boolean(slug),
    retry: false,
    queryFn: async ({ signal }): Promise<SavedReport[]> =>
      (await api.get(`${reports(slug)}saved/`, { signal })).data.results,
  });
};

export const useSavedReport = (id?: string) => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["saved-report", slug, id],
    enabled: Boolean(slug && id),
    retry: false,
    queryFn: async ({ signal }): Promise<SavedReport> => (await api.get(`${reports(slug)}saved/${id}/`, { signal })).data,
  });
};

/** Runs a base report or a saved report; every call is recomputed on the server (never cached). */
export const useRunReport = (
  args: { source?: string; savedId?: string; definition: Partial<ReportDefinition> | null; page: number },
  enabled: boolean
) => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["report-run", slug, args.savedId ?? args.source, JSON.stringify(args.definition), args.page],
    enabled: Boolean(slug) && enabled,
    retry: false,
    staleTime: 0,
    queryFn: async ({ signal }): Promise<ReportResult> =>
      args.savedId
        ? (
            await api.post(
              `${reports(slug)}saved/${args.savedId}/run/`,
              { overrides: args.definition ?? {}, page: args.page, page_size: 50 },
              { signal }
            )
          ).data
        : (
            await api.post(
              `${reports(slug)}run/`,
              { source: args.source, definition: args.definition ?? {}, page: args.page, page_size: 50 },
              { signal }
            )
          ).data,
  });
};

function useReportMutation<T, R>(request: (slug: string, payload: T) => Promise<{ data: R }>, success: string, failure: string) {
  const slug = useSlug();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (payload: T) => (await request(slug ?? "", payload)).data,
    onSuccess: async () => {
      await Promise.all(
        ["saved-reports", "saved-report", "report-run"].map((key) => client.invalidateQueries({ queryKey: [key, slug] }))
      );
      if (success) toastSuccess(success);
    },
    onError: (error) => toastError(error, failure),
  });
}

export interface SavedReportInput {
  name: string;
  description?: string;
  source: string;
  definition: ReportDefinition;
  visibility?: "personal" | "shared";
  shared_roles?: string[];
  shared_units?: string[];
  revision?: number;
}

export const useCreateSavedReport = () =>
  useReportMutation<SavedReportInput, SavedReport>(
    (slug, body) => api.post(`${reports(slug)}saved/`, body),
    "گزارش ذخیره شد.",
    "ذخیرهٔ گزارش ممکن نشد"
  );

export const useUpdateSavedReport = () =>
  useReportMutation<Partial<SavedReportInput> & { id: string }, SavedReport>(
    (slug, { id, ...body }) => api.patch(`${reports(slug)}saved/${id}/`, body),
    "گزارش به‌روز شد.",
    "به‌روزرسانی گزارش ممکن نشد"
  );

export const useCopySavedReport = () =>
  useReportMutation<string, SavedReport>(
    (slug, id) => api.post(`${reports(slug)}saved/${id}/copy/`),
    "نسخه‌ای از گزارش ساخته شد.",
    "کپی گزارش ممکن نشد"
  );

export const useDeleteSavedReport = () =>
  useReportMutation<string, unknown>(
    (slug, id) => api.delete(`${reports(slug)}saved/${id}/`),
    "گزارش حذف شد.",
    "حذف گزارش ممکن نشد"
  );

export const useShareOptions = (enabled: boolean) => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["report-share-options", slug],
    enabled: Boolean(slug) && enabled,
    queryFn: async ({ signal }): Promise<{ roles: { id: string; name: string }[]; units: { id: string; name: string }[] }> =>
      (await api.get(`${reports(slug)}share-options/`, { signal })).data,
  });
};

export const useRequestExport = () => {
  const slug = useSlug();
  return useMutation({
    mutationFn: async (body: {
      source?: string;
      saved_id?: string;
      definition: Partial<ReportDefinition>;
      format: "csv" | "xlsx";
    }): Promise<ExportJob> => (await api.post(`${reports(slug)}exports/`, body)).data,
    onError: (error) => toastError(error, "درخواست خروجی ممکن نشد"),
  });
};

export const useExportJob = (id: string | null) => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["report-export", slug, id],
    enabled: Boolean(slug && id),
    refetchInterval: (query) => (["ready", "failed"].includes(query.state.data?.status ?? "") ? false : 1500),
    queryFn: async ({ signal }): Promise<ExportJob> => (await api.get(`${reports(slug)}exports/${id}/`, { signal })).data,
  });
};
