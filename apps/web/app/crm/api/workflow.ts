/** Workflow engine API. The server re-checks every permission; the UI only mirrors the flags it returns. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Condition } from "@plane/ui";
import { api, toastError, toastSuccess, useSlug } from "./client";

export type StepType = "start" | "normal" | "approval" | "end";
export type TransitionKind = "approve" | "reject" | "return" | "refer" | "end" | "advance";
export type AssigneeType = "user" | "role" | "record_field" | "subject" | "direct_manager" | "upper_manager" | "none";
export type PauseKind = "customer" | "formal";

export interface AssigneeRule {
  type: AssigneeType;
  user_id?: string;
  role_id?: string;
  field?: string;
}

export interface WorkflowStep {
  code: string;
  title: string;
  help?: string;
  type: StepType;
  status_code: string;
  assignee: AssigneeRule;
  target_minutes?: number | null;
  required_fields?: string[];
  editable_fields?: string[];
  lock_fields?: boolean;
  pause?: Partial<Record<PauseKind, boolean>>;
  reminder?: { type: "percent" | "minutes"; value: number } | null;
  absence_policy?: "delegate" | "keep";
}

export interface WorkflowTransition {
  code: string;
  from: string;
  to: string;
  kind: TransitionKind;
  label: string;
  condition?: Condition | null;
  reason_required?: boolean;
  auto?: boolean;
}

export interface WorkflowGraph {
  steps: WorkflowStep[];
  transitions: WorkflowTransition[];
}

export interface Person {
  id: string;
  name: string;
}

export interface WorkflowVersion {
  id: string;
  number: number;
  status: "draft" | "published" | "retired";
  graph: WorkflowGraph;
  change_note: string;
  published_at: string | null;
  published_by: Person | null;
  is_editable: boolean;
}

export interface WorkflowDefinition {
  id: string;
  entity: string;
  subtype: string | null;
  title: string;
  kind: "standard" | "fast_path";
  is_active: boolean;
  settings: {
    require_manager_close?: boolean;
    instance_target_minutes?: number;
    status_field?: string;
    subject_field?: string;
  };
  versions: WorkflowVersion[];
}

export interface ValidationIssue {
  step: string | null;
  transition: string | null;
  message: string;
}

export interface SimulatedStep {
  step: string;
  title: string;
  type: StepType;
  status_code: string;
  assignee: Person | null;
  candidates: Person[];
  assignment_reason: string;
  error: string | null;
  entered_at: string;
  target_at: string | null;
  target_text: string;
  transition?: { code: string; label: string; auto: boolean };
}

export interface WorkflowMeta {
  entities: { code: string; title: string; adapter: string; subtypes: { code: string; title: string }[] }[];
  step_types: Record<StepType, string>;
  transition_kinds: Record<TransitionKind, string>;
  assignee_types: Record<AssigneeType, string>;
  pause_kinds: Record<PauseKind, string>;
  max_auto_steps: number;
  roles: Person[];
  members: Person[];
  statuses?: { code: string; title: string }[];
  fields?: { code: string; title: string; kind: string }[];
}

export interface StepRunView {
  id: string;
  step: string;
  title: string;
  assignee: Person | null;
  candidates: Person[];
  assignment_reason: string;
  entered_at: string;
  target_at: string | null;
  target_text: string;
  paused: boolean;
  pause_kind: string;
  near_due: boolean;
  overdue: boolean;
  remaining_minutes: number | null;
  has_delay_report: boolean;
}

export interface ExtensionView {
  id: string;
  scope: "step" | "instance";
  status: "pending" | "approved" | "rejected";
  requested_by: Person | null;
  previous_target_at: string | null;
  previous_target_text: string;
  requested_target_at: string;
  requested_target_text: string;
  reason: string;
  decided_by: Person | null;
  decision_reason: string;
  created_at: string;
}

export interface TimelineEntry {
  id: string;
  kind: string;
  transition: string;
  from_step: string;
  to_step: string;
  actor: Person | null;
  version: number;
  reason: string;
  changed_values: Record<string, { before: unknown; after: unknown }>;
  data: Record<string, unknown>;
  at: string;
  at_text: string;
}

export interface InstanceActions {
  transitions: {
    code: string;
    label: string;
    kind: TransitionKind;
    to: string;
    reason_required: boolean;
    blocked: boolean;
  }[];
  can_pause: boolean;
  pause_kinds: PauseKind[];
  can_resume: boolean;
  can_report_delay: boolean;
  can_request_extension: boolean;
  can_decide_extension: boolean;
  can_reassign: boolean;
  can_contact_resolve: boolean;
  can_to_standard: boolean;
  can_migrate: boolean;
}

export interface WorkflowInstanceView {
  id: string;
  status: "running" | "completed" | "cancelled" | "error";
  revision: number;
  error_message: string;
  definition: { id: string; title: string; kind: "standard" | "fast_path" };
  version: { id: string; number: number };
  current_step: { code: string; title: string; type: StepType };
  steps: { code: string; title: string; type: StepType }[];
  run: StepRunView | null;
  subject: Person | null;
  target_at: string | null;
  target_text: string;
  my_role: "assignee" | "candidate" | "delegate" | null;
  actions: InstanceActions;
  pending_extension: ExtensionView | null;
  extensions: ExtensionView[];
  timeline: TimelineEntry[];
  contact_channels: { code: string; title: string }[];
  /** Latest published version when the viewer may move this record onto it. */
  migration_target: { id: string; number: number; steps: { code: string; title: string }[] } | null;
}

export interface InboxItem {
  instance_id: string;
  entity: string;
  entity_title: string;
  record_id: string;
  record_title: string;
  step_title: string;
  target_at: string | null;
  target_text: string;
  near_due: boolean;
  overdue: boolean;
  remaining_minutes: number | null;
}

const base = (slug?: string) => `/api/workspaces/${slug}/workflows/`;

export const useWorkflowMeta = (entity?: string) => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["workflow-meta", slug, entity ?? ""],
    enabled: Boolean(slug),
    queryFn: async ({ signal }): Promise<WorkflowMeta> =>
      (await api.get(`${base(slug)}meta/`, { params: { entity: entity || undefined }, signal })).data,
  });
};

export const useWorkflowDefinitions = (entity: string) => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["workflow-definitions", slug, entity],
    enabled: Boolean(slug && entity),
    queryFn: async ({ signal }): Promise<WorkflowDefinition[]> =>
      (await api.get(`${base(slug)}definitions/`, { params: { entity }, signal })).data.results,
  });
};

export const useRecordWorkflow = (entity: string, recordId: string, enabled = true) => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["workflow-record", slug, entity, recordId],
    enabled: Boolean(slug && entity && recordId) && enabled,
    retry: false,
    queryFn: async ({ signal }): Promise<{ instance: WorkflowInstanceView | null; can_start: boolean }> =>
      (await api.get(`${base(slug)}records/${entity}/${recordId}/`, { signal })).data,
  });
};

export const useWorkflowInbox = () => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["workflow-inbox", slug],
    enabled: Boolean(slug),
    queryFn: async ({ signal }): Promise<{ steps: InboxItem[]; extensions: (InboxItem & ExtensionView)[] }> =>
      (await api.get(`${base(slug)}inbox/`, { signal })).data,
  });
};

export const useWorkflowInstances = (status?: string) => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["workflow-instances", slug, status ?? ""],
    enabled: Boolean(slug),
    queryFn: async ({ signal }) =>
      (await api.get(`${base(slug)}runs/`, { params: { status: status || undefined }, signal })).data.results as {
        id: string;
        entity: string;
        record_id: string;
        record_title: string;
        definition: string;
        version: number;
        status: string;
        current_step: string;
        error_message: string;
      }[],
  });
};

export interface MigrationPreview {
  before: { version: number; step: string; assignee: Person | null; target_at: string | null };
  after: {
    version: number;
    step: string;
    step_title: string;
    assignee: Person | null;
    target_text: string;
  } | null;
  problems: string[];
  can_migrate: boolean;
}

export const useMigrationPreview = (instanceId: string, version: string, step = "") => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["workflow-migration", slug, instanceId, version, step],
    enabled: Boolean(slug && instanceId && version),
    retry: false,
    queryFn: async ({ signal }): Promise<MigrationPreview> =>
      (
        await api.get(`${base(slug)}runs/${instanceId}/migration-preview/`, {
          params: { version, step: step || undefined },
          signal,
        })
      ).data,
  });
};
const invalidateAll = (client: ReturnType<typeof useQueryClient>, slug?: string) =>
  Promise.all(
    ["workflow-definitions", "workflow-record", "workflow-inbox", "workflow-instances", "entity-engine"].map((key) =>
      client.invalidateQueries({ queryKey: [key, slug] })
    )
  );

const useWorkflowMutation = <T, R = unknown>(
  request: (slug: string, payload: T) => Promise<{ data: R }>,
  success: string | null,
  failure: string
) => {
  const slug = useSlug();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (payload: T) => (await request(slug ?? "", payload)).data,
    onSuccess: async () => {
      // Record form, summary and history are "entity-engine" queries; a workflow step changes the status.
      await invalidateAll(client, slug);
      if (success) toastSuccess(success);
    },
    onError: (error) => toastError(error, failure),
  });
};

export const useCreateWorkflow = () =>
  useWorkflowMutation(
    (slug, payload: { entity: string; title: string; kind: string; subtype?: string; settings?: object }) =>
      api.post<WorkflowDefinition>(`${base(slug)}definitions/`, payload),
    "گردش‌کار ساخته شد",
    "ساخت گردش‌کار انجام نشد"
  );

export const useNewWorkflowDraft = () =>
  useWorkflowMutation(
    (slug, definitionId: string) => api.post<WorkflowVersion>(`${base(slug)}definitions/${definitionId}/versions/`, {}),
    "نسخهٔ جدید (پیش‌نویس) ساخته شد",
    "ساخت نسخهٔ جدید انجام نشد"
  );

export const useSaveWorkflowDraft = () =>
  useWorkflowMutation(
    (slug, payload: { id: string; graph: WorkflowGraph }) =>
      api.put<WorkflowVersion>(`${base(slug)}versions/${payload.id}/`, { graph: payload.graph }),
    "پیش‌نویس ذخیره شد",
    "ذخیرهٔ پیش‌نویس انجام نشد"
  );

export const usePublishWorkflow = () =>
  useWorkflowMutation(
    (slug, payload: { id: string; change_note?: string }) =>
      api.post<WorkflowVersion>(`${base(slug)}versions/${payload.id}/publish/`, payload),
    "نسخه منتشر شد",
    "انتشار انجام نشد"
  );

export const useValidateWorkflow = () => {
  const slug = useSlug();
  return useMutation({
    mutationFn: async (payload: { id: string; graph: WorkflowGraph }) =>
      (await api.post(`${base(slug)}versions/${payload.id}/validate/`, { graph: payload.graph })).data as {
        valid: boolean;
        issues: ValidationIssue[];
      },
    onError: (error) => toastError(error, "بررسی گردش‌کار انجام نشد"),
  });
};

export const useSimulateWorkflow = () => {
  const slug = useSlug();
  return useMutation({
    mutationFn: async (payload: { id: string; graph: WorkflowGraph; values: object; subject?: string }) =>
      (await api.post(`${base(slug)}versions/${payload.id}/simulate/`, payload)).data as {
        issues: ValidationIssue[];
        path: SimulatedStep[];
      },
    onError: (error) => toastError(error, "آزمایش گردش‌کار انجام نشد"),
  });
};

export const useStartWorkflow = () =>
  useWorkflowMutation(
    (slug, payload: { entity: string; recordId: string }) =>
      api.post(`${base(slug)}records/${payload.entity}/${payload.recordId}/`, {}),
    "گردش‌کار شروع شد",
    "شروع گردش‌کار انجام نشد"
  );

export type InstanceAction =
  | "transition"
  | "reassign"
  | "pause"
  | "resume"
  | "delay-report"
  | "extension"
  | "contact-resolve"
  | "to-standard"
  | "migrate";

export const useWorkflowAction = () =>
  useWorkflowMutation(
    (slug, payload: { instanceId: string; action: InstanceAction; body: Record<string, unknown> }) =>
      api.post(`${base(slug)}runs/${payload.instanceId}/${payload.action}/`, payload.body),
    "اقدام ثبت شد",
    "ثبت اقدام انجام نشد"
  );

export const useUpdateWorkflow = () =>
  useWorkflowMutation(
    (slug, payload: { id: string; is_active?: boolean; settings?: Record<string, unknown>; reason?: string }) =>
      api.patch<WorkflowDefinition>(`${base(slug)}definitions/${payload.id}/`, payload),
    "تنظیمات گردش‌کار ذخیره شد",
    "ذخیرهٔ تنظیمات گردش‌کار انجام نشد"
  );

export const useDecideExtension = () =>
  useWorkflowMutation(
    (slug, payload: { id: string; approve: boolean; reason: string; revision: number }) =>
      api.post(`${base(slug)}extensions/${payload.id}/decide/`, payload),
    "نتیجهٔ درخواست تمدید ثبت شد",
    "بررسی درخواست تمدید انجام نشد"
  );
