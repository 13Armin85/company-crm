/** Ticket 7 — internal side of the customer portal: ticket correspondence tab, triage, quotes, settings
 * and portal accounts. The server re-checks every permission; the UI only mirrors the `can` flags. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, toastError, toastSuccess, useSlug } from "./client";

export type MessageAccess = "INTERNAL" | "EXTERNAL";

export interface PortalThreadFile {
  id: string;
  name: string;
  size: number;
  content_type: string;
}

export interface PortalThreadMessage {
  id: string;
  access: MessageAccess;
  kind: string;
  author: { kind: "customer" | "staff"; name: string };
  text: string;
  created_at: string | null;
  created_text: string;
  files: PortalThreadFile[];
}

export interface InternalQuote {
  id: string;
  number: string;
  version: number;
  amount: string;
  items: string;
  valid_until: string;
  status: { code: string; title: string };
  decided_at: string | null;
  decision_comment: string;
  decided_by: string | null;
  can_decide: boolean;
  can_edit: boolean;
  can_send: boolean;
}

export interface TicketPortalSummary {
  is_portal: boolean;
  stage: "" | "pending" | "accepted" | "awaiting_customer" | "rejected";
  stage_title: string;
  customer_status: { code: string; title: string } | null;
  account: { display_name: string; customer: string } | null;
  messages: PortalThreadMessage[];
  quotes: InternalQuote[];
  feedback: { rating: number; comment: string; submitted_at: string | null; edited: boolean } | null;
  can: { note: boolean; reply: boolean; triage: boolean; quote: boolean; feedback: boolean };
  staff_name: "team" | "display_name";
  team_name: string;
}

export interface PortalLabel {
  code: string;
  title: string;
}

export interface PortalSettingsDoc {
  labels: PortalLabel[];
  status_map: Record<string, string>;
  stage_labels: Record<string, string>;
  default_label: string;
  staff_name: "team" | "display_name";
  team_name: string;
  feedback_edit_hours: number;
  files: { max_count: number; max_size: number; extensions: string[] };
  session: { idle_minutes: number; absolute_hours: number };
  lockout: { attempts: number; minutes: number };
  notify_channels: { email: boolean; sms: boolean };
}

export interface PortalSettingsPayload {
  settings: PortalSettingsDoc;
  categories: { key: string; title: string }[];
  statuses: { key: string; title: string; category: string }[];
  stages: { code: string; title: string }[];
  supported_extensions: string[];
  server_channels: string[];
  can_edit: boolean;
}

export interface PortalAccountRow {
  id: string;
  username: string;
  display_name: string;
  email: string;
  phone: string;
  is_active: boolean;
  has_password: boolean;
  locked: boolean;
  last_login_at: string | null;
  customer: { id: string; title: string };
  contact: { id: string; title: string } | null;
}

export interface SetupLink {
  path: string;
  expires_at: string;
}

const ticketBase = (slug: string, id: string) => `/api/workspaces/${slug}/tickets/${id}/`;
export const portalFileUrl = (slug: string, ticketId: string, fileId: string) =>
  `${ticketBase(slug, ticketId)}portal/files/${fileId}/`;

export function useTicketPortal(id: string, enabled = true) {
  const slug = useSlug();
  return useQuery({
    queryKey: ["ticket-portal", slug, id],
    enabled: Boolean(slug && id && enabled),
    queryFn: async () => (await api.get<TicketPortalSummary>(`${ticketBase(slug ?? "", id)}portal/`)).data,
  });
}

function usePortalMutation<Body>(
  id: string,
  request: (slug: string, body: Body) => Promise<unknown>,
  messages: { success: string; error: string }
) {
  const slug = useSlug();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Body) => request(slug ?? "", body),
    onSuccess: () => {
      toastSuccess(messages.success);
      void client.invalidateQueries({ queryKey: ["ticket-portal", slug, id] });
      void client.invalidateQueries({ queryKey: ["ticket-core", slug, id] });
      void client.invalidateQueries({ queryKey: ["ticket-history", slug, id] });
    },
    onError: (error) => toastError(error, messages.error),
  });
}

export const usePortalNote = (id: string) =>
  usePortalMutation<{ text: string; access: MessageAccess; files: File[] }>(
    id,
    (slug, { text, access, files }) => {
      const body = new FormData();
      body.append("text", text);
      body.append("access", access);
      for (const file of files) body.append("files", file);
      return api.post(`${ticketBase(slug, id)}portal/messages/`, body);
    },
    { success: "پیام ثبت شد", error: "ثبت پیام انجام نشد" }
  );

export const usePortalTriage = (id: string) =>
  usePortalMutation<{ action: "approve" | "reject" | "need_info"; message?: string }>(
    id,
    (slug, body) => api.post(`${ticketBase(slug, id)}portal/triage/`, body),
    { success: "تصمیم تریاژ ثبت شد", error: "ثبت تریاژ انجام نشد" }
  );

export const useCreateQuote = (id: string) =>
  usePortalMutation<{ amount?: string; items?: string; valid_until?: string }>(
    id,
    (slug, body) => api.post(`${ticketBase(slug, id)}quotes/`, body),
    { success: "پیش‌نویس برآورد ساخته شد", error: "ساخت برآورد انجام نشد" }
  );

export const useUpdateQuote = (id: string) =>
  usePortalMutation<{ quoteId: string; amount?: string; items?: string; valid_until?: string }>(
    id,
    (slug, { quoteId, ...body }) => api.patch(`/api/workspaces/${slug}/quotes/${quoteId}/`, body),
    { success: "پیش‌نویس ذخیره شد", error: "ذخیرهٔ پیش‌نویس انجام نشد" }
  );

export const useSendQuote = (id: string) =>
  usePortalMutation<{ quoteId: string }>(
    id,
    (slug, { quoteId }) => api.post(`/api/workspaces/${slug}/quotes/${quoteId}/send/`),
    { success: "برآورد برای مشتری ارسال شد", error: "ارسال برآورد انجام نشد" }
  );

// ---------------------------------------------------------------- settings and accounts

export function usePortalAdminSettings(enabled = true) {
  const slug = useSlug();
  return useQuery({
    queryKey: ["portal-settings", slug],
    enabled: Boolean(slug && enabled),
    queryFn: async () => (await api.get<PortalSettingsPayload>(`/api/workspaces/${slug}/portal/settings/`)).data,
  });
}

export function useSavePortalSettings() {
  const slug = useSlug();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: PortalSettingsDoc) =>
      (await api.put<{ settings: PortalSettingsDoc }>(`/api/workspaces/${slug}/portal/settings/`, body)).data,
    onSuccess: () => {
      toastSuccess("تنظیمات درگاه ذخیره شد");
      void client.invalidateQueries({ queryKey: ["portal-settings", slug] });
    },
    onError: (error) => toastError(error, "ذخیرهٔ تنظیمات درگاه انجام نشد"),
  });
}

export function usePortalAccounts(enabled = true) {
  const slug = useSlug();
  return useQuery({
    queryKey: ["portal-accounts", slug],
    enabled: Boolean(slug && enabled),
    queryFn: async () => (await api.get<PortalAccountRow[]>(`/api/workspaces/${slug}/portal/accounts/`)).data,
  });
}

export function usePortalAccountOptions(enabled = true) {
  const slug = useSlug();
  return useQuery({
    queryKey: ["portal-account-options", slug],
    enabled: Boolean(slug && enabled),
    queryFn: async () =>
      (
        await api.get<Record<"customer" | "contact", { id: string; title: string; number: string }[]>>(
          `/api/workspaces/${slug}/portal/accounts/options/`
        )
      ).data,
  });
}

export function useCreatePortalAccount() {
  const slug = useSlug();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      username: string;
      display_name: string;
      email?: string;
      phone?: string;
      customer_record_id: string;
      contact_record_id?: string;
    }) =>
      (await api.post<PortalAccountRow & { setup: SetupLink }>(`/api/workspaces/${slug}/portal/accounts/`, body)).data,
    onSuccess: () => {
      toastSuccess("حساب درگاه ساخته شد");
      void client.invalidateQueries({ queryKey: ["portal-accounts", slug] });
    },
    onError: (error) => toastError(error, "ساخت حساب درگاه انجام نشد"),
  });
}

export function useUpdatePortalAccount() {
  const slug = useSlug();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string; is_active?: boolean; display_name?: string }) =>
      (await api.patch<PortalAccountRow>(`/api/workspaces/${slug}/portal/accounts/${id}/`, body)).data,
    onSuccess: () => void client.invalidateQueries({ queryKey: ["portal-accounts", slug] }),
    onError: (error) => toastError(error, "به‌روزرسانی حساب انجام نشد"),
  });
}

export function useIssuePortalLink() {
  const slug = useSlug();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.post<{ setup: SetupLink }>(`/api/workspaces/${slug}/portal/accounts/${id}/link/`)).data.setup,
    onError: (error) => toastError(error, "صدور پیوند انجام نشد"),
  });
}
