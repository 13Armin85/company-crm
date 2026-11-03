/** Hooks for the signed-in user: identity, profile, avatar, appearance and personal preferences. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormValues } from "@plane/ui";
import { publishSessionEnd } from "../access/session-events";
import type { ActivityItem, Member, Workspace } from "../types";
import { api, clearClientSession, toastError, toastSuccess, unwrap, workspaceHeaders } from "./client";
import { mapMember } from "./mappers";

export const useWorkspaces = () =>
  useQuery({
    queryKey: ["workspaces"],
    queryFn: async ({ signal }): Promise<Workspace[]> =>
      unwrap<Record<string, unknown>[]>((await api.get("/api/users/me/workspaces/", { signal })).data).map((item) => ({
        id: String(item.id),
        name: String(item.name),
        slug: String(item.slug),
        logo: item.logo_url ? String(item.logo_url) : undefined,
      })),
    retry: false,
  });
export const useCurrentUser = () =>
  useQuery({
    queryKey: ["current-user"],
    queryFn: async ({ signal }): Promise<Member> =>
      mapMember((await api.get("/api/users/me/", { signal, headers: { "Cache-Control": "no-cache" } })).data),
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
  });

export const useSignOut = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/auth/sign-out/", {}),
    onSuccess: async () => {
      publishSessionEnd();
      await clearClientSession(client);
      window.location.replace("/login");
    },
    onError: (error) => toastError(error, "خروج از حساب انجام نشد"),
  });
};

export const useUpdateUserProfile = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      display_name: string;
      first_name?: string;
      last_name?: string;
      custom_values?: FormValues;
    }) => api.patch("/api/users/me/", payload, workspaceHeaders()),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["current-user"] });
      client.invalidateQueries({ queryKey: ["members"] });
      client.invalidateQueries({ queryKey: ["entity-engine"] });
      toastSuccess("پروفایل ذخیره شد");
    },
    onError: (error) => toastError(error, "ذخیره پروفایل انجام نشد"),
  });
};

export const useUploadAvatar = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      if (!file.type.startsWith("image/")) throw new Error("The operation failed. Please try again.");
      if (file.size > 5 * 1024 * 1024) throw new Error("The operation failed. Please try again.");
      const response = await api.post<{
        asset_id: string;
        asset_url: string;
        upload_data: { url: string; fields: Record<string, string> };
      }>("/api/assets/v2/user-assets/", {
        name: file.name,
        type: file.type,
        size: file.size,
        entity_type: "USER_AVATAR",
      });
      const formData = new FormData();
      Object.entries(response.data.upload_data.fields).forEach(([key, value]) => formData.append(key, value));
      formData.append("file", file);
      const uploaded = await fetch(response.data.upload_data.url, { method: "POST", body: formData });
      if (!uploaded.ok) {
        await api.delete(`/api/assets/v2/user-assets/${response.data.asset_id}/`);
        throw new Error("The operation failed. Please try again.");
      }
      await api.patch(`/api/assets/v2/user-assets/${response.data.asset_id}/`, {});
      return response.data.asset_url;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["current-user"] });
      client.invalidateQueries({ queryKey: ["members"] });
      toastSuccess("تصویر پروفایل ذخیره شد");
    },
    onError: (error) => toastError(error, "بارگذاری تصویر انجام نشد"),
  });
};

export const useRemoveAvatar = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete("/api/users/me/avatar/"),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["current-user"] });
      client.invalidateQueries({ queryKey: ["members"] });
      client.invalidateQueries({ queryKey: ["organization-user-profile"] });
      toastSuccess("تصویر پروفایل حذف شد");
    },
    onError: (error) => toastError(error, "حذف تصویر انجام نشد"),
  });
};

export interface AppearancePreferences {
  theme: "light" | "dark" | "system";
  accent: string;
  density: "comfortable" | "compact";
  lastWorkspaceId?: string;
  /** The stored profile theme, kept so a save never drops keys this client does not know about. */
  raw?: Record<string, unknown>;
}
export const useAppearance = () =>
  useQuery({
    queryKey: ["appearance"],
    queryFn: async (): Promise<AppearancePreferences> => {
      const data = (await api.get("/api/users/me/profile/")).data as {
        theme?: Record<string, unknown>;
        last_workspace_id?: string;
      };
      const value = data.theme ?? {};
      const selectedTheme = String(value.theme ?? "system");
      return {
        theme: (["light", "dark", "system"].includes(selectedTheme)
          ? selectedTheme
          : "system") as AppearancePreferences["theme"],
        accent: String(value.hamkar_accent ?? "#4F46E5"),
        density: value.hamkar_density === "compact" ? "compact" : "comfortable",
        lastWorkspaceId: data.last_workspace_id ? String(data.last_workspace_id) : undefined,
        raw: value,
      };
    },
  });

export const useUpdateAppearance = () => {
  const client = useQueryClient();
  return useMutation({
    // Saves run one after another so quick clicks cannot overwrite each other's theme.
    scope: { id: "appearance" },
    onMutate: async (payload: Partial<AppearancePreferences> & { custom_values?: FormValues }) => {
      await client.cancelQueries({ queryKey: ["appearance"] });
      const previous = client.getQueryData<AppearancePreferences>(["appearance"]);
      client.setQueryData<AppearancePreferences>(["appearance"], (current) =>
        current
          ? {
              ...current,
              ...(payload.theme ? { theme: payload.theme } : {}),
              ...(payload.accent ? { accent: payload.accent } : {}),
              ...(payload.density ? { density: payload.density } : {}),
            }
          : current
      );
      return { previous };
    },
    mutationFn: async (payload: Partial<AppearancePreferences> & { custom_values?: FormValues }) => {
      const cached = client.getQueryData<AppearancePreferences>(["appearance"]);
      const theme = cached?.raw
        ? { ...cached.raw }
        : { ...((await api.get("/api/users/me/profile/")).data as { theme?: Record<string, unknown> }).theme };
      if (cached)
        Object.assign(theme, { theme: cached.theme, hamkar_accent: cached.accent, hamkar_density: cached.density });
      if (payload.theme) theme.theme = payload.theme;
      if (payload.accent) theme.hamkar_accent = payload.accent;
      if (payload.density) theme.hamkar_density = payload.density;
      await api.patch("/api/users/me/profile/", { theme, custom_values: payload.custom_values }, workspaceHeaders());
      client.setQueryData<AppearancePreferences>(["appearance"], (current) =>
        current ? { ...current, raw: theme } : current
      );
      return payload;
    },
    onSuccess: (_result, payload) => {
      // Only custom appearance fields affect engine schemas.
      if (payload?.custom_values) client.invalidateQueries({ queryKey: ["entity-engine"] });
      toastSuccess("تغییرات با موفقیت انجام شد");
    },
    onError: (error, _payload, context) => {
      if (context?.previous) client.setQueryData(["appearance"], context.previous);
      toastError(error, "ذخیره ترجیحات انجام نشد");
    },
  });
};

export const useUserActivities = () =>
  useQuery({
    queryKey: ["user-activities"],
    queryFn: async (): Promise<ActivityItem[]> =>
      unwrap<Record<string, unknown>[]>((await api.get("/api/users/me/activities/")).data).map((item) => ({
        id: String(item.id),
        message: String(item.verb ?? item.field ?? "به‌روزرسانی کار"),
        actor: String((item.actor_detail as { display_name?: string } | undefined)?.display_name ?? "عضو تیم"),
        createdAt: item.created_at ? String(item.created_at) : undefined,
      })),
  });

export interface NotificationPreferences {
  property_change: boolean;
  state_change: boolean;
  comment: boolean;
  mention: boolean;
  issue_completed: boolean;
}
export const useNotificationPreferences = () =>
  useQuery({
    queryKey: ["notification-preferences"],
    queryFn: async (): Promise<NotificationPreferences> =>
      (await api.get("/api/users/me/notification-preferences/")).data,
  });
export const useUpdateNotificationPreferences = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<NotificationPreferences> & { custom_values?: FormValues }) =>
      api.patch("/api/users/me/notification-preferences/", payload, workspaceHeaders()),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["notification-preferences"] });
      client.invalidateQueries({ queryKey: ["entity-engine"] });
      toastSuccess("تنظیمات اعلان ذخیره شد");
    },
    onError: (error) => toastError(error, "ذخیره اعلان‌ها انجام نشد"),
  });
};
export const useChangePassword = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: { old_password: string; new_password: string; custom_values?: FormValues }) =>
      api.post("/auth/change-password/", payload, workspaceHeaders()),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["entity-engine"] });
      toastSuccess("رمز عبور تغییر کرد");
    },
    onError: (error) => toastError(error, "تغییر رمز عبور انجام نشد"),
  });
};

export const useSelectWorkspace = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (workspaceId: string) => api.patch("/api/users/me/profile/", { last_workspace_id: workspaceId }),
    onMutate: (workspaceId) => {
      const previous = client.getQueryData<AppearancePreferences>(["appearance"]);
      client.setQueryData<AppearancePreferences>(["appearance"], (current) =>
        current ? { ...current, lastWorkspaceId: workspaceId } : current
      );
      return { previous };
    },
    onSuccess: () => toastSuccess("فضای کاری فعال ذخیره شد"),
    onError: (error, _workspaceId, context) => {
      client.setQueryData(["appearance"], context?.previous);
      toastError(error, "ذخیره شرکت انتخاب‌شده انجام نشد");
    },
  });
};
