import { useQueryClient } from "@tanstack/react-query";
import {
  api,
  mapIssue,
  mapMember,
  mapOrganizationRole,
  mapProject,
  mapState,
  mapTicketRoutingRule,
  mapWorkspaceTask,
  unwrap,
} from "./api";
import { useUIStore } from "./store";
import type { Absence, PermissionException } from "./access/types";
import type { IssueFilters, ProjectFilters, ProjectTab } from "./filter-rules";
import { usePagedTable } from "./table-query";
import type { Issue } from "./types";

type Paging = { page: number; pageSize: number; enabled?: boolean };
type Raw = Record<string, unknown>;

export const useRolesTable = ({ q, ...paging }: Paging & { q: string }) =>
  usePagedTable({
    key: "organization-roles",
    path: (slug) => `/api/workspaces/${slug}/organization/roles/`,
    params: { q },
    ...paging,
    map: (rows: Raw[]) => rows.map(mapOrganizationRole),
  });

export const useRoutingRulesTable = ({ q, ...paging }: Paging & { q: string }) =>
  usePagedTable({
    key: "ticket-routing-rules",
    path: (slug) => `/api/workspaces/${slug}/organization/routing-rules/`,
    params: { q },
    ...paging,
    map: (rows: Raw[]) => rows.map(mapTicketRoutingRule),
  });

export const useMembersTable = ({ q, ...paging }: Paging & { q: string }) =>
  usePagedTable({
    key: "members",
    path: (slug) => `/api/workspaces/${slug}/members/`,
    params: { q },
    ...paging,
    map: (rows: Raw[]) => rows.map(mapMember),
  });

export const useAbsencesTable = ({ q, ...paging }: Paging & { q: string }) =>
  usePagedTable<Absence, Absence, { manageable_user_ids: string[] }>({
    key: "absences",
    path: (slug) => `/api/workspaces/${slug}/organization/absences/`,
    params: { q },
    ...paging,
  });

export const useUserExceptionsTable = ({ userId, q, ...paging }: Paging & { userId: string; q: string }) =>
  usePagedTable<PermissionException>({
    key: "user-exceptions",
    path: (slug) => `/api/workspaces/${slug}/organization/users/${userId}/exceptions/`,
    params: { q, active: 1 },
    ...paging,
    enabled: Boolean(userId) && paging.enabled !== false,
  });

export const useProjectsTable = ({
  q,
  tab,
  filters,
  today,
  ...paging
}: Paging & { q: string; tab: ProjectTab; filters: ProjectFilters; today: string }) =>
  usePagedTable<Raw, ReturnType<typeof mapProject>, { tab_counts: Record<ProjectTab, number> }>({
    key: "projects",
    path: (slug) => `/api/workspaces/${slug}/projects/table/`,
    params: {
      q,
      tab,
      today,
      member_ids: filters.memberIds,
      lead_ids: filters.leadIds,
      progress_min: filters.progressMin,
      progress_max: filters.progressMax,
      deadline: filters.deadline,
      due_from: filters.dueFrom,
      due_to: filters.dueTo,
    },
    ...paging,
    map: (rows) => rows.map(mapProject),
  });

export function useTasksTable({
  view,
  tab,
  q,
  filters,
  today,
  preset,
  ...paging
}: Paging & {
  view: "all" | "mine";
  tab: string;
  q: string;
  filters?: IssueFilters;
  today: string;
  preset?: string;
}) {
  const client = useQueryClient();
  return usePagedTable<
    { kind: "issue" | "task"; item: Raw; deadline?: Issue["deadline"]; category?: Issue["category"] },
    Issue,
    {
      tab_counts: Record<string, number>;
      stats?: { completed_this_week: number };
      is_admin: boolean;
      preset_counts?: Record<string, number>;
    }
  >({
    key: "issues",
    path: (slug) => `/api/workspaces/${slug}/tasks/table/`,
    params: {
      view,
      tab,
      q,
      today,
      statuses: filters?.statuses,
      priorities: filters?.priorities,
      project_ids: filters?.projectIds,
      assignee_ids: filters?.assigneeIds,
      deadline: filters?.deadline,
      due_from: filters?.dueFrom,
      due_to: filters?.dueTo,
      preset: preset && preset !== "all" ? preset : undefined,
    },
    ...paging,
    map: async (rows) => {
      const workspace = useUIStore.getState().workspaceSlug || "";
      // Status menus need each project's states; they are cached between pages.
      const projectIds = [
        ...new Set(rows.filter((row) => row.kind === "issue").map((row) => String(row.item.project_id))),
      ];
      const states = Object.fromEntries(
        await Promise.all(
          projectIds.map(async (id) => [
            id,
            await client.fetchQuery({
              queryKey: ["project-states", workspace, id],
              staleTime: 5 * 60_000,
              queryFn: async () =>
                unwrap<Raw[]>((await api.get(`/api/workspaces/${workspace}/projects/${id}/states/`)).data).map(
                  mapState
                ),
            }),
          ])
        )
      );
      return rows.map((row) => ({
        ...(row.kind === "issue"
          ? mapIssue(row.item, String(row.item.project_id), states[String(row.item.project_id)] ?? [])
          : mapWorkspaceTask(row.item, [])),
        deadline: row.deadline ?? null,
        category: row.category ?? null,
      }));
    },
  });
}
