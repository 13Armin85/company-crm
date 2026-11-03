/** Hooks for projects and everything scoped to one project: states, cycles, activity and project members. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormValues } from "@plane/ui";
import type { ActivityItem, Cycle, Issue, Project, ProjectState } from "../types";
import { api, toastError, toastSuccess, unwrap, useSlug } from "./client";
import { mapProject, mapState } from "./mappers";

export const useProjects = (providedSlug?: string) => {
  const slug = useSlug(providedSlug);
  return useQuery({
    queryKey: ["projects", slug],
    enabled: Boolean(slug),
    refetchInterval: 15_000,
    queryFn: async (): Promise<Project[]> =>
      unwrap<Record<string, unknown>[]>((await api.get(`/api/workspaces/${slug}/projects/details/`)).data).map(
        mapProject
      ),
  });
};
export const useProject = (projectId: string, providedSlug?: string) => {
  const slug = useSlug(providedSlug);
  return useQuery({
    queryKey: ["project", slug, projectId],
    enabled: Boolean(slug && projectId),
    refetchInterval: 15_000,
    queryFn: async () => mapProject((await api.get(`/api/workspaces/${slug}/projects/${projectId}/`)).data),
  });
};
export const useStates = (projectId?: string, providedSlug?: string) => {
  const slug = useSlug(providedSlug);
  return useQuery({
    queryKey: ["states", slug, projectId],
    enabled: Boolean(slug && projectId),
    queryFn: async (): Promise<ProjectState[]> =>
      unwrap<Record<string, unknown>[]>(
        (await api.get(`/api/workspaces/${slug}/projects/${projectId}/states/`)).data
      ).map(mapState),
  });
};

export const useCycles = (projectId: string, providedSlug?: string) => {
  const slug = useSlug(providedSlug);
  return useQuery({
    queryKey: ["cycles", slug, projectId],
    enabled: Boolean(slug && projectId),
    queryFn: async (): Promise<Cycle[]> =>
      unwrap<Record<string, unknown>[]>(
        (await api.get(`/api/workspaces/${slug}/projects/${projectId}/cycles/`)).data
      ).map((item) => ({
        id: String(item.id),
        name: String(item.name),
        description: String(item.description ?? ""),
        startDate: item.start_date ? String(item.start_date) : undefined,
        endDate: item.end_date ? String(item.end_date) : undefined,
        progress: Number(item.progress ?? 0),
      })),
  });
};
export const useActivities = (projectId: string, issues: Issue[], providedSlug?: string) => {
  const slug = useSlug(providedSlug);
  return useQuery({
    queryKey: ["activities", slug, projectId, issues.map((i) => i.id).join(",")],
    enabled: Boolean(slug && issues.length),
    queryFn: async (): Promise<ActivityItem[]> => {
      const rows = (
        await Promise.all(
          issues
            .slice(0, 8)
            .map((issue) =>
              api
                .get(`/api/workspaces/${slug}/projects/${projectId}/issues/${issue.id}/history/`)
                .then(({ data }) => unwrap<Record<string, unknown>[]>(data))
            )
        )
      ).flat();
      return rows.map((item) => ({
        id: String(item.id),
        message: String(item.verb ?? item.field ?? "به‌روزرسانی کار"),
        actor: String((item.actor_detail as { display_name?: string } | undefined)?.display_name ?? "عضو تیم"),
        createdAt: item.created_at ? String(item.created_at) : undefined,
      }));
    },
  });
};

export const useCreateProject = (slug: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Pick<Project, "name" | "description">) =>
      mapProject((await api.post(`/api/workspaces/${slug}/projects/`, payload)).data),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["projects", slug] });
      toastSuccess("پروژه با موفقیت ساخته شد");
    },
    onError: (error) => toastError(error, "ساخت پروژه انجام نشد"),
  });
};
export const useUpdateProject = (slug: string, projectId: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<Pick<Project, "name" | "description" | "targetDate" | "projectLeadId">>) =>
      mapProject(
        (
          await api.patch(`/api/workspaces/${slug}/projects/${projectId}/`, {
            name: payload.name,
            description: payload.description,
            target_date: payload.targetDate || null,
            project_lead: payload.projectLeadId || null,
          })
        ).data
      ),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["project", slug, projectId] });
      client.invalidateQueries({ queryKey: ["projects", slug] });
      toastSuccess("تغییرات پروژه ذخیره شد");
    },
    onError: (error) => toastError(error, "ذخیره پروژه انجام نشد"),
  });
};
export const useArchiveProject = (slug: string, projectId: string, archived = false) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      archived
        ? api.delete(`/api/workspaces/${slug}/projects/${projectId}/archive/`)
        : api.post(`/api/workspaces/${slug}/projects/${projectId}/archive/`),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["projects", slug] });
      client.invalidateQueries({ queryKey: ["project", slug, projectId] });
      toastSuccess(archived ? "پروژه از بایگانی خارج شد" : "پروژه بایگانی شد");
    },
    onError: (error) => toastError(error, "بایگانی پروژه انجام نشد"),
  });
};
export const useDeleteProject = (slug: string, projectId: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`/api/workspaces/${slug}/projects/${projectId}/`),
    onSuccess: () => {
      client.removeQueries({ queryKey: ["project", slug, projectId] });
      client.invalidateQueries({ queryKey: ["projects", slug] });
      client.invalidateQueries({ queryKey: ["issues", slug] });
      client.invalidateQueries({ queryKey: ["task-history", slug] });
      toastSuccess("پروژه حذف شد");
    },
    onError: (error) => toastError(error, "حذف پروژه انجام نشد"),
  });
};

export const useCreateCycle = (slug: string, projectId: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: { name: string; start_date?: string; end_date?: string; custom_values?: FormValues }) =>
      api.post(`/api/workspaces/${slug}/projects/${projectId}/cycles/`, payload),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["cycles", slug, projectId] });
      client.invalidateQueries({ queryKey: ["entity-engine", slug] });
      toastSuccess("چرخه ساخته شد");
    },
    onError: (error) => toastError(error, "ساخت چرخه انجام نشد"),
  });
};

export const useAddProjectMember = (slug: string, projectId: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) =>
      api.post(`/api/workspaces/${slug}/projects/${projectId}/members/`, {
        members: [{ member_id: memberId, role: 15 }],
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["members", slug, projectId] });
      client.invalidateQueries({ queryKey: ["projects", slug] });
      toastSuccess("عضو به پروژه اضافه شد");
    },
    onError: (error) => toastError(error, "افزودن عضو به پروژه انجام نشد"),
  });
};
export const useRemoveProjectMember = (slug: string, projectId: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (membershipId: string) =>
      api.delete(`/api/workspaces/${slug}/projects/${projectId}/members/${membershipId}/`),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["members", slug, projectId] });
      client.invalidateQueries({ queryKey: ["projects", slug] });
      toastSuccess("عضو از پروژه حذف شد");
    },
    onError: (error) => toastError(error, "حذف عضو پروژه انجام نشد"),
  });
};
