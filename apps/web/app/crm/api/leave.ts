/** Leave requests, Word templates and signature images (ticket 6). The server enforces every rule. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, toastError, toastSuccess, useSlug } from "./client";

export type LeaveMode = "daily" | "hourly";
export type LeaveStatus = "draft" | "pending" | "returned" | "approved" | "rejected" | "cancelled";

export interface Person {
  id: string;
  name: string;
}

export interface LeaveAttachment {
  id: string;
  name: string;
  size: number;
}

export interface LeaveVersion {
  id: string;
  number: number;
  mode: LeaveMode;
  mode_label: string;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  starts_at: string;
  ends_at: string;
  period_text: string;
  reason: string;
  substitute: Person | null;
  attachments: LeaveAttachment[];
  duration_days: number | null;
  duration_minutes: number | null;
  duration_text: string;
  is_locked: boolean;
  signed_at: string | null;
  signed_by: Person | null;
  template: { id: string; number: number; title: string } | null;
  has_document: boolean;
  created_at: string;
}

export interface LeaveHolder {
  step: string;
  people: Person[];
  acting_delegate?: Person | null;
  error: string;
}

export interface LeaveActions {
  can_edit: boolean;
  can_new_version: boolean;
  can_sign: boolean;
  sign_blockers: string[];
  can_cancel: boolean;
}

export interface LeaveRequestSummary {
  id: string;
  number: string;
  status: LeaveStatus;
  status_label: string;
  revision: number;
  requester: Person;
  created_at: string;
  current: LeaveVersion | null;
  holder: LeaveHolder | null;
  is_mine: boolean;
}

export interface LeaveRequestDetail extends LeaveRequestSummary {
  versions: LeaveVersion[];
  workflow: { instance_id: string; status: string; revision: number } | null;
  absence: { id: string; status: string; starts_at: string; ends_at: string } | null;
  cancel_reason: string;
  actions: LeaveActions;
}

export interface LeaveMeta {
  modes: { code: LeaveMode; title: string }[];
  statuses: { code: LeaveStatus; title: string }[];
  members: Person[];
  attachment: { max_file_size: number; extensions: string[] };
  signature_notice: string;
  can_create: boolean;
  has_workflow: boolean;
  today: string;
}

export interface LeaveFormValues {
  mode: LeaveMode;
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  reason: string;
  substitute: string;
  attachments: string[];
}

export interface LeavePreview {
  html: string;
  fingerprint: string;
  signed: boolean;
  version: number;
  template: { id: string; number: number };
}

export interface TemplateIssue {
  code: string;
  level: string;
  message: string;
}

export interface LeaveTemplate {
  id: string;
  number: number;
  title: string;
  original_name: string;
  size: number;
  status: "inactive" | "active" | "deprecated";
  status_label: string;
  expires_at: string | null;
  expires_text: string;
  is_expired: boolean;
  placeholders: string[];
  issues: TemplateIssue[];
  warnings: string[];
  can_activate: boolean;
  note: string;
  created_at: string;
  created_by: Person | null;
}

export interface TemplateOverview {
  versions: LeaveTemplate[];
  active_problem: string | null;
  has_active: boolean;
  placeholders: { key: string; title: string; required: boolean }[];
}

export interface SignatureInfo {
  id: string;
  uploaded_at: string;
  content_type: string;
  size: number;
  has_consent: boolean;
  consent_at: string | null;
  consent_revoked_at: string | null;
  uploaded_by?: Person;
}

export interface SignatureEvent {
  id: string;
  type: string;
  at: string;
  actor: Person | null;
  signature_id: string | null;
}

export const leavePath = (slug?: string) => `/api/workspaces/${slug ?? ""}/leave/`;
export const signatureImageUrl = (slug: string | undefined, userId: string, signatureId?: string) =>
  `${leavePath(slug)}signatures/${userId}/image/${signatureId ? `?signature=${signatureId}` : ""}`;
export const documentUrl = (slug: string | undefined, requestId: string, versionId: string) =>
  `${leavePath(slug)}requests/${requestId}/versions/${versionId}/document/`;
export const attachmentUrl = (slug: string | undefined, requestId: string, assetId: string) =>
  `${leavePath(slug)}requests/${requestId}/files/${assetId}/`;
export const templateFileUrl = (slug: string | undefined, templateId: string) =>
  `${leavePath(slug)}templates/${templateId}/file/`;
export const templateSampleUrl = (slug: string | undefined) => `${leavePath(slug)}templates/sample/`;

const KEYS = ["leave-requests", "leave-request", "leave-preview", "leave-history", "workflow-record", "workflow-inbox"];

function useLeaveMutation<T, R = unknown>(
  request: (slug: string, payload: T) => Promise<{ data: R }>,
  success: string | null,
  failure: string,
  extraKeys: string[] = []
) {
  const slug = useSlug();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (payload: T) => (await request(slug ?? "", payload)).data,
    onSuccess: async () => {
      await Promise.all([...KEYS, ...extraKeys].map((key) => client.invalidateQueries({ queryKey: [key, slug] })));
      if (success) toastSuccess(success);
    },
    onError: (error) => toastError(error, failure),
  });
}

export const useLeaveMeta = () => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["leave-meta", slug],
    enabled: Boolean(slug),
    queryFn: async ({ signal }): Promise<LeaveMeta> => (await api.get(`${leavePath(slug)}meta/`, { signal })).data,
  });
};

export const useLeaveRequests = (scope: string, status = "") => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["leave-requests", slug, scope, status],
    enabled: Boolean(slug),
    queryFn: async ({ signal }): Promise<LeaveRequestSummary[]> =>
      (await api.get(`${leavePath(slug)}requests/`, { params: { scope, status: status || undefined }, signal })).data
        .results,
  });
};

export const useLeaveRequest = (id?: string) => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["leave-request", slug, id],
    enabled: Boolean(slug && id),
    retry: false,
    queryFn: async ({ signal }): Promise<LeaveRequestDetail> =>
      (await api.get(`${leavePath(slug)}requests/${id}/`, { signal })).data,
  });
};

export const useLeavePreview = (id: string | undefined, versionId: string | undefined, enabled: boolean) => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["leave-preview", slug, id, versionId ?? ""],
    enabled: Boolean(slug && id) && enabled,
    retry: false,
    queryFn: async ({ signal }): Promise<LeavePreview> =>
      (await api.get(`${leavePath(slug)}requests/${id}/preview/`, { params: { version: versionId }, signal })).data,
  });
};

export const useLeaveHistory = (id?: string) => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["leave-history", slug, id],
    enabled: Boolean(slug && id),
    queryFn: async ({
      signal,
    }): Promise<{
      events: { id: string; type: string; actor: Person | null; at: string; reason: string; version: number | null }[];
    }> => (await api.get(`${leavePath(slug)}requests/${id}/history/`, { signal })).data,
  });
};

export const useLeaveDuration = () => {
  const slug = useSlug();
  return useMutation({
    mutationFn: async (
      values: Partial<LeaveFormValues>
    ): Promise<{ duration_days: number | null; duration_minutes: number | null; duration_text: string }> =>
      (await api.post(`${leavePath(slug)}duration/`, values)).data,
  });
};

export const useCreateLeave = () =>
  useLeaveMutation<LeaveFormValues, LeaveRequestDetail>(
    (slug, values) => api.post(`${leavePath(slug)}requests/`, values),
    "درخواست مرخصی به‌صورت پیش‌نویس ذخیره شد.",
    "ثبت درخواست مرخصی انجام نشد"
  );

export const useUpdateLeave = (id: string) =>
  useLeaveMutation<LeaveFormValues & { revision: number }, LeaveRequestDetail>(
    (slug, values) => api.patch(`${leavePath(slug)}requests/${id}/`, values),
    "تغییرات درخواست ذخیره شد.",
    "ذخیرهٔ درخواست انجام نشد"
  );

export const useLeaveAction = (id: string) =>
  useLeaveMutation<{ action: "new-version" | "sign" | "cancel"; body: Record<string, unknown> }, LeaveRequestDetail>(
    (slug, { action, body }) => api.post(`${leavePath(slug)}requests/${id}/${action}/`, body),
    null,
    "انجام این اقدام ممکن نشد"
  );

export const useUploadLeaveAttachment = () => {
  const slug = useSlug();
  return useMutation({
    mutationFn: async (file: File): Promise<LeaveAttachment> => {
      const data = new FormData();
      data.append("file", file);
      return (await api.post(`${leavePath(slug)}attachments/`, data)).data;
    },
    onError: (error) => toastError(error, "بارگذاری پیوست انجام نشد"),
  });
};

export const useLeaveTemplates = (enabled = true) => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["leave-templates", slug],
    enabled: Boolean(slug) && enabled,
    queryFn: async ({ signal }): Promise<TemplateOverview> =>
      (await api.get(`${leavePath(slug)}templates/`, { signal })).data,
  });
};

export const useUploadTemplate = () =>
  useLeaveMutation<{ file: File; title: string; expires_at: string; note: string }, LeaveTemplate>(
    (slug, { file, title, expires_at, note }) => {
      const data = new FormData();
      data.append("file", file);
      data.append("title", title);
      if (expires_at) data.append("expires_at", expires_at);
      data.append("note", note);
      return api.post(`${leavePath(slug)}templates/`, data);
    },
    "نسخهٔ تازهٔ قالب بارگذاری شد؛ گزارش بررسی را ببینید.",
    "بارگذاری قالب انجام نشد",
    ["leave-templates"]
  );

export const useTemplateAction = () =>
  useLeaveMutation<{ id: string; action: "activate" | "update"; body?: Record<string, unknown> }, LeaveTemplate>(
    (slug, { id, action, body }) =>
      action === "activate"
        ? api.post(`${leavePath(slug)}templates/${id}/activate/`)
        : api.patch(`${leavePath(slug)}templates/${id}/`, body ?? {}),
    "نسخهٔ قالب به‌روز شد.",
    "تغییر نسخهٔ قالب انجام نشد",
    ["leave-templates"]
  );

export const useMySignature = () => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["my-signature", slug],
    enabled: Boolean(slug),
    queryFn: async ({ signal }): Promise<{ signature: SignatureInfo | null; notice: string }> =>
      (await api.get(`${leavePath(slug)}signatures/me/`, { signal })).data,
  });
};

export const useSignatureConsent = () =>
  useLeaveMutation<{ grant: boolean; signature_id?: string; confirm?: boolean }>(
    (slug, body) => api.post(`${leavePath(slug)}signatures/me/consent/`, body),
    null,
    "ثبت اجازهٔ امضا انجام نشد",
    ["my-signature"]
  );

export const useSignatures = (enabled: boolean) => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["signatures", slug],
    enabled: Boolean(slug) && enabled,
    queryFn: async ({
      signal,
    }): Promise<{
      results: { user: Person; signature: SignatureInfo | null }[];
      notice: string;
    }> => (await api.get(`${leavePath(slug)}signatures/`, { signal })).data,
  });
};

export const useSignatureHistory = (userId?: string) => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["signature-history", slug, userId],
    enabled: Boolean(slug && userId),
    queryFn: async ({ signal }): Promise<SignatureEvent[]> =>
      (await api.get(`${leavePath(slug)}signatures/${userId}/history/`, { signal })).data.results,
  });
};

export const useUploadSignature = () =>
  useLeaveMutation<{ userId: string; file: File }, SignatureInfo>(
    (slug, { userId, file }) => {
      const data = new FormData();
      data.append("file", file);
      return api.post(`${leavePath(slug)}signatures/${userId}/`, data);
    },
    "تصویر امضا ذخیره شد؛ کاربر باید دوباره اجازهٔ درج آن را بدهد.",
    "بارگذاری تصویر امضا انجام نشد",
    ["signatures", "signature-history"]
  );
