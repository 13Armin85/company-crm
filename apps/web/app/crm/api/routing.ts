/** Hooks for ticket routing rules and the role queue they feed. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import type { FormValues } from "@plane/ui";
import type { TicketRoleQueueEntry, TicketRoutingRule } from "../types";
import { api, toastError, toastSuccess, unwrap, useSlug } from "./client";
import { mapTicketRoleQueueEntry, mapTicketRoutingRule } from "./mappers";

export const useTicketRoutingRules = (providedSlug?: string, enabled = true) => {
  const slug = useSlug(providedSlug);
  return useQuery({
    queryKey: ["ticket-routing-rules", slug],
    enabled: Boolean(slug) && enabled,
    queryFn: async (): Promise<TicketRoutingRule[]> =>
      unwrap<Record<string, unknown>[]>(
        (await api.get(`/api/workspaces/${slug}/organization/routing-rules/`)).data
      ).map(mapTicketRoutingRule),
  });
};

export const useSaveTicketRoutingRule = (slug: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      id?: string;
      name: string;
      unitId: string;
      requiredRoleId: string;
      isActive?: boolean;
      custom_values?: FormValues;
    }) => {
      const body = {
        name: payload.name,
        unit_id: payload.unitId,
        required_role_id: payload.requiredRoleId,
        is_active: payload.isActive,
        custom_values: payload.custom_values,
      };
      const response = payload.id
        ? await api.patch(`/api/workspaces/${slug}/organization/routing-rules/${payload.id}/`, body)
        : await api.post(`/api/workspaces/${slug}/organization/routing-rules/`, body);
      return mapTicketRoutingRule(response.data);
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["ticket-routing-rules", slug] });
      toastSuccess("قانون مسیریابی ذخیره شد");
    },
    onError: (error) => toastError(error, "ذخیره قانون مسیریابی انجام نشد"),
  });
};

export const useDeactivateTicketRoutingRule = (slug: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ruleId: string) => api.delete(`/api/workspaces/${slug}/organization/routing-rules/${ruleId}/`),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["ticket-routing-rules", slug] });
      toastSuccess("قانون مسیریابی غیرفعال شد");
    },
    onError: (error) => toastError(error, "غیرفعال‌کردن قانون مسیریابی انجام نشد"),
  });
};

export const useTicketRoleQueue = (providedSlug?: string, enabled = true) => {
  const slug = useSlug(providedSlug);
  return useQuery({
    queryKey: ["ticket-role-queue", slug],
    enabled: Boolean(slug) && enabled,
    refetchInterval: 30_000,
    queryFn: async ({ signal }): Promise<TicketRoleQueueEntry[]> =>
      unwrap<Record<string, unknown>[]>(
        (await api.get(`/api/workspaces/${slug}/organization/role-queue/`, { signal })).data
      ).map(mapTicketRoleQueueEntry),
  });
};

export const useClaimTicketRoleQueue = (slug: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (queueId: string) => api.post(`/api/workspaces/${slug}/organization/role-queue/${queueId}/claim/`, {}),
    onSuccess: (_response, queueId) => {
      client.setQueryData<TicketRoleQueueEntry[]>(["ticket-role-queue", slug], (entries) =>
        entries?.filter((entry) => entry.id !== queueId)
      );
      client.invalidateQueries({ queryKey: ["ticket-role-queue", slug] });
      client.invalidateQueries({ queryKey: ["issues", slug] });
      client.invalidateQueries({ queryKey: ["task-history", slug] });
      toastSuccess("کار پروژه به شما واگذار شد");
      client.invalidateQueries({ queryKey: ["notifications", slug] });
    },
    onError: (error) => {
      if ((error as AxiosError).response?.status === 409)
        client.invalidateQueries({ queryKey: ["ticket-role-queue", slug] });
      toastError(error, "دریافت کار انجام نشد");
    },
  });
};
