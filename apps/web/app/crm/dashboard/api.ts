import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useUIStore } from "../store";
import type { DashboardPayload, DashboardTab, DashboardWidget, TeamData } from "./types";

const base = (slug: string) => `/api/workspaces/${slug}/dashboard/`;

export function useDashboard(roleId?: string) {
  const slug = useUIStore((state) => state.workspaceSlug) || "";
  return useQuery({
    queryKey: ["dashboard", slug, roleId || "personal"],
    enabled: Boolean(slug),
    queryFn: async (): Promise<DashboardPayload> =>
      (await api.get(roleId ? `${base(slug)}defaults/${roleId}/` : base(slug))).data,
  });
}

export function useSaveDashboard(roleId?: string) {
  const slug = useUIStore((state) => state.workspaceSlug) || "";
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { tabs: DashboardTab[]; revision: number }) =>
      (await api.put(roleId ? `${base(slug)}defaults/${roleId}/` : base(slug), payload)).data as DashboardPayload,
    onSuccess: () => client.invalidateQueries({ queryKey: ["dashboard", slug] }),
  });
}

export function useWidgetData(widget: DashboardWidget) {
  const slug = useUIStore((state) => state.workspaceSlug) || "";
  const seconds = Number(widget.config.refresh_seconds || 0);
  return useQuery({
    queryKey: ["dashboard-widget", slug, widget.id, widget],
    enabled: Boolean(slug),
    retry: false,
    refetchInterval: [30, 60, 300].includes(seconds) ? seconds * 1000 : false,
    queryFn: async (): Promise<Record<string, unknown>> =>
      (await api.post(`${base(slug)}widgets/data/`, { widget })).data,
  });
}

export function useTeamData(options: Record<string, string | boolean>) {
  const slug = useUIStore((state) => state.workspaceSlug) || "";
  return useQuery({
    queryKey: ["dashboard-team", slug, options],
    enabled: Boolean(slug),
    refetchInterval: 45_000,
    retry: false,
    queryFn: async (): Promise<TeamData> =>
      (await api.get(`${base(slug)}team/`, { params: options })).data,
  });
}

export const dashboardUrl = base;
