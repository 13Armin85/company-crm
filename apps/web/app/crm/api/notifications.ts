/** Hooks for the notification inbox and the unread badge. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NotificationItem } from "../types";
import { api, toastError, toastSuccess, unwrap, useSlug } from "./client";
import { mapNotification } from "./mappers";

export const useNotifications = (providedSlug?: string, live = false, enabled = true) => {
  const slug = useSlug(providedSlug);
  return useQuery({
    queryKey: ["notifications", slug],
    enabled: Boolean(slug) && enabled,
    staleTime: 5_000,
    refetchInterval: live ? 15_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    queryFn: async ({ signal }): Promise<NotificationItem[]> =>
      unwrap<Record<string, unknown>[]>(
        (await api.get(`/api/workspaces/${slug}/users/notifications/?all_notifications=true`, { signal })).data
      ).map(mapNotification),
  });
};
// The navigation badge polls a count instead of downloading every notification.
export const useUnreadNotificationCount = (providedSlug?: string) => {
  const slug = useSlug(providedSlug);
  return useQuery({
    queryKey: ["notifications", slug, "unread-count"],
    enabled: Boolean(slug),
    staleTime: 5_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    queryFn: async ({ signal }): Promise<number> =>
      Number(
        (
          await api.get<{ unread?: number }>(
            `/api/workspaces/${slug}/users/notifications/?all_notifications=true&summary=unread`,
            { signal }
          )
        ).data.unread ?? 0
      ),
  });
};
export const useNotificationDetails = (id?: string, providedSlug?: string) => {
  const slug = useSlug(providedSlug);
  return useQuery({
    queryKey: ["notification", slug, id],
    enabled: Boolean(slug && id),
    queryFn: async () =>
      mapNotification(
        (await api.get<Record<string, unknown>>(`/api/workspaces/${slug}/users/notifications/${id}/`)).data
      ),
  });
};

export const useMarkNotificationRead = (providedSlug?: string) => {
  const slug = useSlug(providedSlug),
    client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/api/workspaces/${slug}/users/notifications/${id}/read/`),
    onSuccess: (_, id) => {
      client.setQueryData<NotificationItem[]>(["notifications", slug], (rows) =>
        rows?.map((row) => (row.id === id ? { ...row, read: true } : row))
      );
      client.setQueryData<NotificationItem>(["notification", slug, id], (row) => (row ? { ...row, read: true } : row));
      client.invalidateQueries({ queryKey: ["notifications", slug] });
      toastSuccess("اعلان خوانده شد");
    },
    onError: (error) => toastError(error, "به‌روزرسانی اعلان انجام نشد"),
  });
};
export const useMarkAllNotificationsRead = (providedSlug?: string) => {
  const slug = useSlug(providedSlug),
    client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post(`/api/workspaces/${slug}/users/notifications/mark-all-read/`, { all_notifications: true }),
    onSuccess: () => {
      client.setQueryData<NotificationItem[]>(["notifications", slug], (rows) =>
        rows?.map((row) => ({ ...row, read: true }))
      );
      client.setQueriesData<NotificationItem>({ queryKey: ["notification", slug] }, (row) =>
        row ? { ...row, read: true } : row
      );
      client.invalidateQueries({ queryKey: ["notifications", slug] });
      toastSuccess("همه اعلان‌ها خوانده شدند");
    },
    onError: (error) => toastError(error, "خواندن اعلان‌ها انجام نشد"),
  });
};
