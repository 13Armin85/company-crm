/** Customer-portal API hooks. Every payload is a server-side whitelist; nothing here can widen it. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { portalApi, setPortalCsrf } from "./client";

export interface PortalStatus {
  code: string;
  title: string;
}

export interface PortalProfile {
  display_name: string;
  username: string;
  customer: string;
  notify: { portal: boolean; email: boolean; sms: boolean };
  channels_available: { email: boolean; sms: boolean };
  idle_minutes: number;
}

export interface PortalFile {
  id: string;
  name: string;
  size: number;
  content_type: string;
  url: string | null;
}

export interface PortalMessage {
  id: string;
  author: { kind: "customer" | "staff"; name: string };
  kind: string;
  text: string;
  created_at: string | null;
  created_text: string;
  files: PortalFile[];
}

export type QuoteStatus = "sent" | "approved" | "rejected" | "revision_requested" | "draft";

export interface PortalQuote {
  id: string;
  number: string;
  version: number;
  amount: string;
  items: string;
  valid_until: string;
  status: { code: QuoteStatus; title: string };
  decided_at: string | null;
  decision_comment: string;
  can_decide: boolean;
}

export interface PortalFeedback {
  rating: number;
  comment: string;
  submitted_at: string | null;
  edited: boolean;
  editable_until: string | null;
  can_edit: boolean;
}

export interface PortalRequestSummary {
  id: string;
  number: string;
  subject: string;
  status: PortalStatus;
  created_at: string | null;
  updated_at: string | null;
  unread: boolean;
}

export interface PortalRequestDetail extends PortalRequestSummary {
  messages: PortalMessage[];
  quotes: PortalQuote[];
  feedback: PortalFeedback | null;
  can_feedback: boolean;
  can_message: boolean;
  files: { max_count: number; max_size: number; extensions: string[] };
}

export interface PortalRequestList {
  results: PortalRequestSummary[];
  count: number;
  page: number;
  pages: number;
  statuses: { code: string; title: string }[];
  unread: number;
}

export const portalKeys = {
  session: ["portal", "session"] as const,
  list: (params: Record<string, string | number>) => ["portal", "requests", params] as const,
  detail: (id: string) => ["portal", "request", id] as const,
};

export function usePortalSession() {
  return useQuery({
    queryKey: portalKeys.session,
    queryFn: async () => {
      const { data } = await portalApi.get<{ account: PortalProfile; csrf_token: string }>("session/");
      setPortalCsrf(data.csrf_token);
      return data.account;
    },
    retry: false,
    staleTime: Infinity,
  });
}

export function usePortalLogin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: { username: string; password: string }) =>
      (await portalApi.post<{ account: PortalProfile; csrf_token: string }>("auth/login/", body)).data,
    onSuccess: (data) => {
      setPortalCsrf(data.csrf_token);
      client.setQueryData(portalKeys.session, data.account);
    },
  });
}

export function usePortalLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => (await portalApi.post("auth/logout/")).data,
    onSettled: () => {
      setPortalCsrf(undefined);
      client.clear();
    },
  });
}

export function usePortalSetup() {
  return useMutation({
    mutationFn: async (body: { token: string; password: string }) =>
      (await portalApi.post<{ username: string }>("auth/setup/", body)).data,
  });
}

export function usePortalRequests(params: { page: number; status?: string; q?: string }) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, value]) => value !== "" && value !== undefined));
  return useQuery({
    queryKey: portalKeys.list(clean as Record<string, string | number>),
    queryFn: async () => (await portalApi.get<PortalRequestList>("requests/", { params: clean })).data,
    placeholderData: (previous) => previous,
  });
}

export function usePortalRequest(id: string) {
  return useQuery({
    queryKey: portalKeys.detail(id),
    queryFn: async () => (await portalApi.get<PortalRequestDetail>(`requests/${id}/`)).data,
    retry: false,
  });
}

const form = (fields: Record<string, string>, files: File[]) => {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  for (const file of files) body.append("files", file);
  return body;
};

export function useCreatePortalRequest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ subject, description, files }: { subject: string; description: string; files: File[] }) =>
      (await portalApi.post<PortalRequestDetail>("requests/", form({ subject, description }, files))).data,
    onSuccess: () => void client.invalidateQueries({ queryKey: ["portal", "requests"] }),
  });
}

export function usePortalMessage(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ text, files }: { text: string; files: File[] }) =>
      (await portalApi.post<PortalMessage>(`requests/${id}/messages/`, form({ text }, files))).data,
    onSuccess: () => void client.invalidateQueries({ queryKey: ["portal"] }),
  });
}

export function useQuoteDecision(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ quoteId, decision, comment }: { quoteId: string; decision: string; comment: string }) =>
      (await portalApi.post<PortalQuote>(`quotes/${quoteId}/decision/`, { decision, comment })).data,
    onSettled: () => void client.invalidateQueries({ queryKey: portalKeys.detail(id) }),
  });
}

export function usePortalFeedback(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ rating, comment, edit }: { rating: number; comment: string; edit: boolean }) =>
      (
        await portalApi.request<PortalFeedback>({
          url: `requests/${id}/feedback/`,
          method: edit ? "patch" : "post",
          data: { rating, comment },
        })
      ).data,
    onSettled: () => void client.invalidateQueries({ queryKey: portalKeys.detail(id) }),
  });
}

export function usePortalSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: Partial<PortalProfile["notify"]>) =>
      (await portalApi.patch<PortalProfile>("settings/", body)).data,
    onSuccess: (data) => client.setQueryData(portalKeys.session, data),
  });
}
