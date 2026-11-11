/** Ticket 5 API: deadline card, target, extension, delay, contact, referral, history and routing rules.
 * The server re-checks every permission; the UI only mirrors the `can` / `why` flags it returns. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Condition } from "@plane/ui";
import { api, toastError, toastSuccess, unwrap, useSlug } from "./client";

export type DeadlineState = "none" | "not_started" | "running" | "near_due" | "overdue" | "closed";
export type WorkCategory = "todo" | "in_progress" | "done";
export type CalendarSource = "person" | "exception" | "team" | "company" | null;

export interface TicketExtension {
  id: string;
  status: "pending" | "approved" | "rejected";
  status_title: string;
  minutes: number | null;
  reason: string;
  decision_reason: string;
  previous_target_at: string | null;
  previous_target_text: string;
  requested_target_at: string | null;
  requested_target_text: string;
  requested_by: string;
  approver: string;
  decided_by: string;
  decided_at: string | null;
  created_at: string | null;
}

export interface TicketDelayReport {
  id: string;
  reason: string;
  progress: string;
  expected_at: string | null;
  expected_text: string;
  target_at: string | null;
  reporter: string;
  created_at: string | null;
}

export interface TicketDeadline {
  state: DeadlineState;
  category: WorkCategory;
  category_title: string;
  target_minutes: number | null;
  target_origin: "ticket" | "type" | null;
  ticket_minutes: number | null;
  type_minutes: number | null;
  total_minutes: number | null;
  started_at: string | null;
  started_text: string;
  target_at: string | null;
  target_text: string;
  remaining_minutes: number | null;
  overdue_minutes: number;
  spent_minutes: number | null;
  calendar: { source: CalendarSource; label: string; help: string; source_id: string | null; builtin: boolean };
  overdue_flagged_at: string | null;
  pending_extension: TicketExtension | null;
  extensions: TicketExtension[];
  last_delay_report: TicketDelayReport | null;
  delay_report_needed: boolean;
  can: { set_target: boolean; request_extension: boolean; report_delay: boolean; decide_extension: boolean };
  why: { request_extension: string; report_delay: string };
}

export interface ReferralStep {
  id: string;
  outcome: "assigned" | "queued" | "referred";
  method: string;
  rule: string;
  to: string;
  to_id: string | null;
  by: string;
  reason: string;
  response: "" | "pending" | "accepted" | "rejected" | "forwarded";
  response_title: string;
  response_reason: string;
  responded_at: string | null;
  created_at: string | null;
  created_text: string;
}

export interface TicketDetails {
  customers?: { id: string; title: string }[];
  creator: string;
  type: string | null;
  project: string | null;
  priority: string;
  due_date: string | null;
  estimate: string | number | null;
  labels: string[];
  parent: { id: string; name: string } | null;
  parent_hidden: boolean;
  children: { id: string; name: string }[];
}

export interface TicketStatusOption {
  id: string;
  title: string;
  category: WorkCategory;
}

export interface TicketCard {
  id: string;
  title?: string;
  number?: string;
  status?: {
    field: string | null;
    current: string | null;
    category: WorkCategory;
    options: TicketStatusOption[];
    can_change: boolean;
    why: string;
  };
  details: TicketDetails;
  deadline: TicketDeadline;
  referrals: ReferralStep[];
  active_referral: { id: string; to_id: string; to: string; by: string; reason: string; mine: boolean } | null;
  read_only: boolean;
  contact_channels: { code: string; title: string }[];
  can: { refer: boolean; contact: boolean };
}

export interface HistoryEvent {
  id: string;
  type: string;
  kind: string;
  field: string;
  before: unknown;
  after: unknown;
  metadata: Record<string, unknown>;
  reason: string;
  actor: string;
  created_at: string | null;
  created_text: string;
}

export interface ExtensionPreview {
  current_target_at: string;
  current_target_text: string;
  requested_target_at: string;
  requested_target_text: string;
  minutes: number;
  approver: { id: string; name: string; relation: string };
}

export interface InboxExtension extends TicketExtension {
  issue_id: string;
  issue_name: string;
  history: TicketExtension[];
}

const base = (slug: string, id: string) => `/api/workspaces/${slug}/tickets/${id}/`;

export const ticketKey = (slug: string, id: string) => ["ticket-core", slug, id];

export function useTicketCard(id: string, enabled = true) {
  const slug = useSlug() ?? "";
  return useQuery({
    queryKey: ticketKey(slug, id),
    enabled: Boolean(slug && id) && enabled,
    queryFn: async ({ signal }) => (await api.get<TicketCard>(`${base(slug, id)}core/`, { signal })).data,
  });
}

export function useTicketHistory(id: string, kind: string) {
  const slug = useSlug() ?? "";
  return useQuery({
    queryKey: ["ticket-history", slug, id, kind],
    enabled: Boolean(slug && id),
    queryFn: async ({ signal }) =>
      (await api.get<HistoryEvent[]>(`${base(slug, id)}history/`, { params: kind ? { kind } : {}, signal })).data,
  });
}

function useTicketMutation<TBody, TResult = unknown>(
  id: string,
  path: (slug: string) => string,
  messages: { success: string; error: string }
) {
  const slug = useSlug() ?? "";
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: TBody) => (await api.post<TResult>(path(slug), body)).data,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["ticket-core", slug, id] });
      void client.invalidateQueries({ queryKey: ["ticket-history", slug, id] });
      void client.invalidateQueries({ queryKey: ["entity-engine"] });
      void client.invalidateQueries({ queryKey: ["ticket-extension-inbox", slug] });
      toastSuccess(messages.success);
    },
    onError: (error) => toastError(error, messages.error),
  });
}

export const useSetTicketTarget = (id: string) =>
  useTicketMutation<{ minutes: number | null; reason: string }>(id, (slug) => `${base(slug, id)}target/`, {
    success: "مدت هدف ذخیره شد",
    error: "تغییر مدت هدف انجام نشد",
  });

export const useSetTicketParent = (id: string) =>
  useTicketMutation<{ parent_id: string | null }>(id, (slug) => `${base(slug, id)}parent/`, {
    success: "تیکت والد ذخیره شد",
    error: "تغییر تیکت والد انجام نشد",
  });

/** Status goes through the normal record save: permissions, workflow lock and history stay the server's. */
export function useChangeTicketStatus(id: string) {
  const slug = useSlug() ?? "";
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ field, value }: { field: string; value: string }) => {
      const path = `/api/workspaces/${slug}/engine/entities/ticket/records/${id}/`;
      const record = (await api.get<{ revision: number }>(path)).data;
      return (await api.patch(path, { revision: record.revision, values: { [field]: value } })).data;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["ticket-core", slug, id] });
      void client.invalidateQueries({ queryKey: ["ticket-history", slug, id] });
      void client.invalidateQueries({ queryKey: ["entity-engine"] });
      void client.invalidateQueries({ queryKey: ["issues"] });
      toastSuccess("وضعیت تغییر کرد");
    },
    onError: (error) => toastError(error, "تغییر وضعیت انجام نشد"),
  });
}

export const useRequestExtension = (id: string) =>
  useTicketMutation<{ minutes: number; reason: string }>(id, (slug) => `${base(slug, id)}extension/`, {
    success: "درخواست تمدید برای مدیر فرستاده شد",
    error: "ثبت درخواست تمدید انجام نشد",
  });

export const useDelayReport = (id: string) =>
  useTicketMutation<{ reason: string; progress: string; expected_at: string }>(
    id,
    (slug) => `${base(slug, id)}delay-report/`,
    { success: "گزارش تأخیر ثبت شد", error: "ثبت گزارش تأخیر انجام نشد" }
  );

export const useContactResolve = (id: string) =>
  useTicketMutation<{
    channel: string;
    contact_name: string;
    contact_at?: string;
    summary: string;
    resolved: boolean;
  }>(id, (slug) => `${base(slug, id)}contact/`, { success: "تماس ثبت شد", error: "ثبت تماس انجام نشد" });

export const useReferTicket = (id: string) =>
  useTicketMutation<{ user_id: string; reason: string }>(id, (slug) => `${base(slug, id)}refer/`, {
    success: "تیکت ارجاع شد",
    error: "ارجاع انجام نشد",
  });

export const useRespondReferral = (id: string) =>
  useTicketMutation<{ action: "accept" | "reject" | "forward"; reason?: string; user_id?: string }>(
    id,
    (slug) => `${base(slug, id)}referral/respond/`,
    { success: "پاسخ ارجاع ثبت شد", error: "پاسخ به ارجاع انجام نشد" }
  );

export const useDecideTicketExtension = (id: string) => {
  const slug = useSlug() ?? "";
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: { extensionId: string; approve: boolean; reason?: string }) =>
      (
        await api.post(`/api/workspaces/${slug}/ticket-extensions/${body.extensionId}/decide/`, {
          approve: body.approve,
          reason: body.reason ?? "",
        })
      ).data,
    onSuccess: (_data, body) => {
      void client.invalidateQueries({ queryKey: ["ticket-core", slug, id] });
      void client.invalidateQueries({ queryKey: ["ticket-history", slug, id] });
      void client.invalidateQueries({ queryKey: ["ticket-extension-inbox", slug] });
      toastSuccess(body.approve ? "تمدید تأیید شد" : "تمدید رد شد");
    },
    onError: (error) => toastError(error, "ثبت تصمیم تمدید انجام نشد"),
  });
};

export function useExtensionPreview(id: string, minutes: number | null, enabled: boolean) {
  const slug = useSlug() ?? "";
  return useQuery({
    queryKey: ["ticket-extension-preview", slug, id, minutes],
    enabled: Boolean(slug && id && minutes && minutes > 0) && enabled,
    retry: false,
    queryFn: async ({ signal }) =>
      (await api.post<ExtensionPreview>(`${base(slug, id)}extension/preview/`, { minutes }, { signal })).data,
  });
}

export function useTicketExtensionInbox(enabled = true) {
  const slug = useSlug() ?? "";
  return useQuery({
    queryKey: ["ticket-extension-inbox", slug],
    enabled: Boolean(slug) && enabled,
    queryFn: async ({ signal }) =>
      (await api.get<InboxExtension[]>(`/api/workspaces/${slug}/ticket-extensions/inbox/`, { signal })).data,
  });
}

// ---------------------------------------------------------------- routing rules (ن۸)

export type RoutingMethod = "manager" | "user" | "group" | "round_robin" | "least_loaded";

export interface RoutingConditions {
  type_ids?: string[];
  priorities?: string[];
  customer_ids?: string[];
  project_ids?: string[];
  unit_ids?: string[];
  expression?: Condition | null;
}

export interface RoutingRule {
  id: string;
  name: string;
  unit_id: string | null;
  unit_title: string;
  required_role_id: string | null;
  role_name: string;
  is_active: boolean;
  position: number;
  conditions: RoutingConditions;
  method: RoutingMethod;
  method_title: string;
  target_user_id: string | null;
  target_user_name: string;
  member_ids: string[];
  shadowed_by: string | null;
}

export interface RoutingPreview {
  rule: { id: string; name: string; method: RoutingMethod; method_title: string } | null;
  user: { id: string; name: string } | null;
  queued: boolean;
  reason: string;
  skipped_rules: { rule: string; failed: string[] }[];
}

const rulesUrl = (slug: string) => `/api/workspaces/${slug}/organization/routing-rules/`;

export function useRoutingRules(enabled = true) {
  const slug = useSlug() ?? "";
  return useQuery({
    queryKey: ["routing-rules-ordered", slug],
    enabled: Boolean(slug) && enabled,
    queryFn: async ({ signal }) => unwrap<RoutingRule[]>((await api.get(rulesUrl(slug), { signal })).data),
  });
}

export function useSaveRoutingRule() {
  const slug = useSlug() ?? "";
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (rule: Partial<RoutingRule>) => {
      const body = {
        name: rule.name,
        unit_id: rule.unit_id || null,
        required_role_id: rule.required_role_id || null,
        is_active: rule.is_active,
        position: rule.position,
        conditions: rule.conditions ?? {},
        method: rule.method,
        target_user_id: rule.target_user_id || null,
        member_ids: rule.member_ids ?? [],
      };
      return rule.id
        ? (await api.patch<RoutingRule>(`${rulesUrl(slug)}${rule.id}/`, body)).data
        : (await api.post<RoutingRule>(rulesUrl(slug), body)).data;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["routing-rules-ordered", slug] });
      void client.invalidateQueries({ queryKey: ["ticket-routing-rules", slug] });
      toastSuccess("قاعدهٔ ارجاع ذخیره شد");
    },
    onError: (error) => toastError(error, "ذخیرهٔ قاعدهٔ ارجاع انجام نشد"),
  });
}

export function useReorderRoutingRules() {
  const slug = useSlug() ?? "";
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) =>
      (await api.post<{ ids: string[]; shadowed: Record<string, string> }>(`${rulesUrl(slug)}order/`, { ids })).data,
    onSuccess: () => void client.invalidateQueries({ queryKey: ["routing-rules-ordered", slug] }),
    onError: (error) => toastError(error, "تغییر ترتیب قواعد انجام نشد"),
  });
}

export function usePreviewRouting() {
  const slug = useSlug() ?? "";
  return useMutation({
    mutationFn: async (issueId: string) =>
      (await api.post<RoutingPreview>(`${rulesUrl(slug)}preview/`, { issue_id: issueId })).data,
    onError: (error) => toastError(error, "آزمایش قاعده انجام نشد"),
  });
}

// ---------------------------------------------------------------- ticket types (type default target, ن۲)

export interface TicketTypeRow {
  id: string;
  name: string;
  target_minutes: number | null;
  can_set_target: boolean;
}

export function useTicketTypes(enabled = true) {
  const slug = useSlug() ?? "";
  return useQuery({
    queryKey: ["ticket-types", slug],
    enabled: Boolean(slug) && enabled,
    queryFn: async ({ signal }) =>
      (await api.get<TicketTypeRow[]>(`/api/workspaces/${slug}/ticket-types/`, { signal })).data,
  });
}

export function useSetTypeTarget() {
  const slug = useSlug() ?? "";
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: { typeId: string; minutes: number | null; reason: string }) =>
      (
        await api.post(`/api/workspaces/${slug}/ticket-types/${body.typeId}/target/`, {
          minutes: body.minutes,
          reason: body.reason,
        })
      ).data,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["ticket-types", slug] });
      toastSuccess("مدت هدف پیش‌فرض نوع ذخیره شد");
    },
    onError: (error) => toastError(error, "ذخیرهٔ مدت هدف نوع انجام نشد"),
  });
}
