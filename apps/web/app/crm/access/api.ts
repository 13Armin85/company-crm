import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../api";
import { useUIStore } from "../store";
import type { Absence, EffectiveAccess, PermissionException } from "./types";

export const useAccess = (providedSlug?: string) => {
  const slug = useUIStore((state) => providedSlug || state.workspaceSlug);
  const query = useQuery({
    queryKey: ["workspace-access", slug],
    enabled: Boolean(slug),
    retry: false,
    staleTime: 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }): Promise<EffectiveAccess> => {
      const { data } = await api.get<Omit<EffectiveAccess, "can">>(`/api/workspaces/${slug}/access/me/`, { signal });
      const permissions = new Set(data.permissions);
      return { ...data, can: (code) => permissions.has(code) };
    },
  });
  return { ...query, data: query.isError ? undefined : query.data };
};

export const useUserAccess = (userId: string, enabled: boolean) => {
  const slug = useUIStore((state) => state.workspaceSlug);
  return useQuery({
    queryKey: ["user-effective-access", slug, userId],
    enabled: Boolean(slug && userId) && enabled,
    queryFn: async ({ signal }) =>
      (
        await api.get<Omit<EffectiveAccess, "can">>(
          `/api/workspaces/${slug}/organization/users/${userId}/effective-permissions/`,
          { signal }
        )
      ).data,
  });
};

export const useUserExceptions = (userId: string, enabled: boolean) => {
  const slug = useUIStore((state) => state.workspaceSlug);
  return useQuery({
    queryKey: ["user-exceptions", slug, userId],
    enabled: Boolean(slug && userId) && enabled,
    queryFn: async ({ signal }) =>
      (
        await api.get<PermissionException[]>(`/api/workspaces/${slug}/organization/users/${userId}/exceptions/`, {
          signal,
        })
      ).data,
  });
};

export const useAccessMutation = () => {
  const client = useQueryClient();
  const slug = useUIStore((state) => state.workspaceSlug) ?? "";
  return useMutation({
    mutationFn: ({
      path,
      method = "post",
      body,
    }: {
      path: string;
      method?: "post" | "put" | "patch" | "delete";
      body?: unknown;
    }) => api.request({ url: `/api/workspaces/${slug}/organization/${path}`, method, data: body }),
    onSuccess: () => {
      for (const key of [
        "workspace-access",
        "user-effective-access",
        "user-exceptions",
        "organization-units",
        "absences",
        "delegates",
        "members",
        "organization-user-profile",
        "projects",
        "issues",
        "ticket-role-queue",
      ])
        void client.invalidateQueries({ queryKey: [key, slug] });
      useUIStore.getState().toast("تغییرات ذخیره شد");
    },
    onError: (error) => useUIStore.getState().toast(errorMessage(error, "ذخیره تغییرات انجام نشد"), "error"),
  });
};

export const useAbsences = (enabled: boolean) => {
  const slug = useUIStore((state) => state.workspaceSlug);
  return useQuery({
    queryKey: ["absences", slug],
    enabled: Boolean(slug) && enabled,
    queryFn: async () =>
      (
        await api.get<{
          absences: Absence[];
          manageable_user_ids: string[];
          delegations: {
            unit_id: string;
            unit_name: string;
            manager_id: string;
            manager_name: string;
            user_id: string;
            user_name: string;
            reason: string;
            ends_at: string;
          }[];
        }>(`/api/workspaces/${slug}/organization/absences/`)
      ).data,
  });
};

export const useDelegates = (unitId?: string) => {
  const slug = useUIStore((state) => state.workspaceSlug);
  return useQuery({
    queryKey: ["delegates", slug, unitId],
    enabled: Boolean(slug && unitId),
    queryFn: async () =>
      (
        await api.get<{
          delegates: { id: string; user_id: string; name: string; priority: number }[];
          active_delegation: { user_id: string; reason: string; ends_at: string } | null;
        }>(`/api/workspaces/${slug}/organization/units/${unitId}/delegates/`)
      ).data,
  });
};
