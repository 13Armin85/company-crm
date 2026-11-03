/** Hooks for the organization model: permissions, roles, units and per-user organization profiles. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { FormValues } from "@plane/ui";
import type { OrganizationPermission, OrganizationRole, OrganizationUnit, OrganizationUserProfile } from "../types";
import { api, toastError, toastSuccess, unwrap, useSlug } from "./client";
import { mapOrganizationPermission, mapOrganizationRole, mapOrganizationUnit } from "./mappers";

export const useOrganizationPermissions = (providedSlug?: string, enabled = true) => {
  const slug = useSlug(providedSlug);
  return useQuery({
    queryKey: ["organization-permissions", slug],
    enabled: Boolean(slug) && enabled,
    queryFn: async (): Promise<OrganizationPermission[]> =>
      unwrap<Record<string, unknown>[]>((await api.get(`/api/workspaces/${slug}/organization/permissions/`)).data).map(
        mapOrganizationPermission
      ),
  });
};

export const useOrganizationRoles = (providedSlug?: string, enabled = true) => {
  const slug = useSlug(providedSlug);
  return useQuery({
    queryKey: ["organization-roles", slug],
    enabled: Boolean(slug) && enabled,
    queryFn: async (): Promise<OrganizationRole[]> =>
      unwrap<Record<string, unknown>[]>((await api.get(`/api/workspaces/${slug}/organization/roles/`)).data).map(
        mapOrganizationRole
      ),
  });
};

export const useOrganizationRole = (roleId: string, enabled = true) => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["organization-role", slug, roleId],
    enabled: Boolean(slug && roleId) && enabled,
    queryFn: async ({ signal }) =>
      mapOrganizationRole((await api.get(`/api/workspaces/${slug}/organization/roles/${roleId}/`, { signal })).data),
  });
};

export const invalidateOrganizationAccess = (client: QueryClient, slug: string) =>
  Promise.all(
    [
      "entity-engine",
      "organization-roles",
      "organization-role",
      "organization-units",
      "organization-user-profile",
      "workspace-access",
      "user-effective-access",
      "user-exceptions",
      "members",
      "delegates",
      "absences",
      "ticket-routing-rules",
      "ticket-role-queue",
      "projects",
      "project",
      "project-member-counts",
      "issues",
    ].map((key) => client.invalidateQueries({ queryKey: [key, slug] }))
  );

export const useDeleteOrganizationObject = (slug: string, kind: "roles" | "units") => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/workspaces/${slug}/organization/${kind}/${id}/`),
    onSuccess: async () => {
      await invalidateOrganizationAccess(client, slug);
      toastSuccess("حذف انجام شد");
    },
    onError: (error) => toastError(error, "حذف انجام نشد"),
  });
};

export const useSaveOrganizationRole = (slug: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      id?: string;
      name?: string;
      description?: string;
      permissionIds?: string[];
      isActive?: boolean;
      custom_values?: FormValues;
    }) => {
      const body = {
        name: payload.name,
        description: payload.description,
        permission_ids: payload.permissionIds,
        is_active: payload.isActive,
        custom_values: payload.custom_values,
      };
      const response = payload.id
        ? await api.patch(`/api/workspaces/${slug}/organization/roles/${payload.id}/`, body, {
            headers: payload.permissionIds !== undefined ? { "X-CRM-Surface": "role-permissions" } : {},
          })
        : await api.post(`/api/workspaces/${slug}/organization/roles/`, body);
      return mapOrganizationRole(response.data);
    },
    onSuccess: async () => {
      await invalidateOrganizationAccess(client, slug);
      toastSuccess("نقش سازمانی ذخیره شد");
    },
    onError: (error) => toastError(error, "ذخیره نقش انجام نشد"),
  });
};

export const useDeactivateOrganizationRole = (slug: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (roleId: string) =>
      api.patch(`/api/workspaces/${slug}/organization/roles/${roleId}/`, { is_active: false }),
    onSuccess: async () => {
      await invalidateOrganizationAccess(client, slug);
      toastSuccess("نقش غیرفعال شد");
    },
    onError: (error) => toastError(error, "غیرفعال‌کردن نقش انجام نشد"),
  });
};

export const useOrganizationUnits = (providedSlug?: string, enabled = true) => {
  const slug = useSlug(providedSlug);
  return useQuery({
    queryKey: ["organization-units", slug],
    enabled: Boolean(slug) && enabled,
    queryFn: async (): Promise<OrganizationUnit[]> =>
      unwrap<Record<string, unknown>[]>((await api.get(`/api/workspaces/${slug}/organization/units/`)).data).map(
        mapOrganizationUnit
      ),
  });
};

export const useSaveOrganizationUnit = (slug: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      id?: string;
      title?: string;
      parentId?: string;
      managerId?: string;
      memberIds?: string[];
      isActive?: boolean;
      custom_values?: FormValues;
    }) => {
      const body = {
        title: payload.title,
        ...(payload.parentId !== undefined ? { parent_id: payload.parentId || null } : {}),
        ...(payload.managerId !== undefined ? { manager_id: payload.managerId || null } : {}),
        member_ids: payload.memberIds,
        is_active: payload.isActive,
        custom_values: payload.custom_values,
      };
      const response = payload.id
        ? await api.patch(`/api/workspaces/${slug}/organization/units/${payload.id}/`, body)
        : await api.post(`/api/workspaces/${slug}/organization/units/`, body);
      return mapOrganizationUnit(response.data);
    },
    onSuccess: async () => {
      await invalidateOrganizationAccess(client, slug);
      toastSuccess("واحد سازمانی ذخیره شد");
    },
    onError: (error) => toastError(error, "ذخیره واحد انجام نشد"),
  });
};

export const useDeactivateOrganizationUnit = (slug: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (unitId: string) =>
      api.patch(`/api/workspaces/${slug}/organization/units/${unitId}/`, { is_active: false }),
    onSuccess: async () => {
      await invalidateOrganizationAccess(client, slug);
      toastSuccess("واحد سازمانی غیرفعال شد");
    },
    onError: (error) => toastError(error, "غیرفعال‌کردن واحد انجام نشد"),
  });
};

export const useOrganizationUserProfile = (userId?: string, providedSlug?: string) => {
  const slug = useSlug(providedSlug);
  return useQuery({
    queryKey: ["organization-user-profile", slug, userId],
    enabled: Boolean(slug && userId),
    queryFn: async (): Promise<OrganizationUserProfile> => {
      const item = (await api.get(`/api/workspaces/${slug}/organization/users/${userId}/`)).data;
      return {
        id: String(item.id),
        membershipId: String(item.membership_id),
        firstName: String(item.first_name ?? ""),
        lastName: String(item.last_name ?? ""),
        displayName: String(item.display_name ?? ""),
        username: String(item.username ?? ""),
        email: String(item.email ?? ""),
        isActive: Boolean(item.is_active),
        roleIds: Array.isArray(item.role_ids) ? item.role_ids.map(String) : [],
        unitIds: Array.isArray(item.unit_ids) ? item.unit_ids.map(String) : [],
      };
    },
  });
};

export const useUpdateOrganizationUserProfile = (slug: string, userId: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      first_name?: string;
      last_name?: string;
      display_name?: string;
      username?: string;
      email?: string;
      is_active?: boolean;
      role_ids?: string[];
      unit_ids?: string[];
      custom_values?: FormValues;
    }) => api.patch(`/api/workspaces/${slug}/organization/users/${userId}/`, payload),
    onSuccess: async () => {
      await invalidateOrganizationAccess(client, slug);
      toastSuccess("پروفایل کاربر ذخیره شد");
    },
    onError: (error) => toastError(error, "ذخیره پروفایل انجام نشد"),
  });
};
