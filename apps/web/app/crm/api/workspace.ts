/** Hooks for workspace settings, invitations and workspace membership. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormValues } from "@plane/ui";
import type { Member } from "../types";
import { api, toastError, toastSuccess, unwrap, useSlug } from "./client";
import { mapMember } from "./mappers";
import { invalidateOrganizationAccess } from "./organization";

export const useWorkspaceInvites = (providedSlug?: string) => {
  const slug = useSlug(providedSlug);
  return useQuery({
    queryKey: ["workspace-invites", slug],
    enabled: Boolean(slug),
    retry: false,
    queryFn: async (): Promise<Record<string, unknown>[]> =>
      unwrap<Record<string, unknown>[]>((await api.get(`/api/workspaces/${slug}/invitations/`)).data),
  });
};

export const useProjectMemberCounts = (providedSlug?: string) => {
  const slug = useSlug(providedSlug);
  return useQuery({
    queryKey: ["project-member-counts", slug],
    enabled: Boolean(slug),
    queryFn: async (): Promise<Record<string, number>> => {
      const data = (await api.get(`/api/workspaces/${slug}/project-members/`)).data as Record<
        string,
        Record<string, unknown>[]
      >;
      const counts: Record<string, number> = {};
      Object.values(data)
        .flat()
        .forEach((membership) => {
          const memberId = String(membership.member ?? "");
          counts[memberId] = (counts[memberId] ?? 0) + 1;
        });
      return counts;
    },
  });
};

export const workspaceMembers = async (slug?: string): Promise<Member[]> =>
  unwrap<Record<string, unknown>[]>((await api.get(`/api/workspaces/${slug}/members/`)).data).map(mapMember);
export const useMembers = (providedSlug?: string, projectId?: string, enabled = true) => {
  const slug = useSlug(providedSlug);
  return useQuery({
    queryKey: ["members", slug, projectId ?? "workspace"],
    enabled: Boolean(slug) && enabled,
    queryFn: async (): Promise<Member[]> => {
      if (!projectId) return workspaceMembers(slug);
      const members = await workspaceMembers(slug);
      const projectRows = unwrap<Record<string, unknown>[]>(
        (await api.get(`/api/workspaces/${slug}/projects/${projectId}/members/`)).data
      );
      return projectRows.flatMap((membership) => {
        const memberId = String(membership.member ?? "");
        const member = members.find((candidate) => candidate.id === memberId);
        if (!member) return [];
        return [{ ...member, membershipId: String(membership.id) }];
      });
    },
  });
};

export const useUpdateWorkspace = (slug: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: { name: string; custom_values?: FormValues }) =>
      api.patch(`/api/workspaces/${slug}/`, payload),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["workspaces"] });
      client.invalidateQueries({ queryKey: ["entity-engine"] });
      toastSuccess("مشخصات شرکت ذخیره شد");
    },
    onError: (error) => toastError(error, "ذخیره مشخصات شرکت انجام نشد"),
  });
};

export const useInviteMember = (slug: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (email: string) => api.post(`/api/workspaces/${slug}/invitations/`, { emails: [{ email, role: 15 }] }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["workspace-invites", slug] });
      toastSuccess("دعوت‌نامه ارسال شد");
    },
    onError: (error) => toastError(error, "ارسال دعوت‌نامه انجام نشد"),
  });
};
export const useCreateWorkspaceUser = (slug: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      email: string;
      username: string;
      password?: string;
      display_name: string;
      role_ids?: string[];
      unit_ids?: string[];
      custom_values?: FormValues;
    }) => api.post(`/api/workspaces/${slug}/members/`, payload),
    onSuccess: async () => {
      await invalidateOrganizationAccess(client, slug);
      toastSuccess("حساب کاربر ساخته و به فضای کاری اضافه شد");
    },
    onError: (error) => toastError(error, "ساخت حساب کاربر انجام نشد"),
  });
};
export const useRemoveMember = (slug: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (membershipId: string) => api.delete(`/api/workspaces/${slug}/members/${membershipId}/`),
    onSuccess: async () => {
      await invalidateOrganizationAccess(client, slug);
      toastSuccess("عضو از فضای کاری حذف شد");
    },
    onError: (error) => toastError(error, "حذف عضو انجام نشد"),
  });
};
