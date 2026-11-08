/** Hooks for work items: project issues and workspace tasks share one Issue model. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Issue, Status } from "../types";
import { api, toastError, toastSuccess, unwrap, useSlug } from "./client";
import { mapIssue, mapState, mapWorkspaceTask } from "./mappers";
import { statusFa } from "../utils";
import { useProjects } from "./projects";
import { workspaceMembers } from "./workspace";

export const useIssues = (providedSlug?: string, projectId?: string, enabled = true) => {
  const slug = useSlug(providedSlug),
    client = useQueryClient(),
    projectsQuery = useProjects(slug);
  return useQuery({
    queryKey: ["issues", slug, projectId ?? "all", projectsQuery.data?.map((p) => p.id).join(",")],
    enabled: enabled && Boolean(slug && (projectId || projectsQuery.data)),
    queryFn: async (): Promise<Issue[]> => {
      const [members, workspaceTaskResponse] = await Promise.all([
        // Shares the cached member list instead of downloading it once per issue query.
        client.ensureQueryData({ queryKey: ["members", slug, "workspace"], queryFn: () => workspaceMembers(slug) }),
        projectId ? Promise.resolve({ data: [] }) : api.get(`/api/workspaces/${slug}/tasks/`),
      ]);
      const projectIssues = (
        await Promise.all(
          (projectId ? [projectId] : (projectsQuery.data ?? []).map((p) => p.id)).map(async (id) => {
            const [issueResponse, stateResponse] = await Promise.all([
              api.get(`/api/workspaces/${slug}/projects/${id}/issues/?expand=state,assignees,labels,project`),
              api.get(`/api/workspaces/${slug}/projects/${id}/states/`),
            ]);
            const states = unwrap<Record<string, unknown>[]>(stateResponse.data).map(mapState);
            const project = projectsQuery.data?.find((candidate) => candidate.id === id);
            return unwrap<Record<string, unknown>[]>(issueResponse.data).map((item) =>
              mapIssue(item, id, states, members, project?.identifier, project?.name)
            );
          })
        )
      ).flat();
      const workspaceTasks = unwrap<Record<string, unknown>[]>(workspaceTaskResponse.data).map((item) =>
        mapWorkspaceTask(item, members)
      );
      return [...projectIssues, ...workspaceTasks];
    },
  });
};
export const useTaskHistory = (enabled = true) => {
  const slug = useSlug();
  return useQuery({
    queryKey: ["task-history", slug],
    enabled: enabled && Boolean(slug),
    refetchInterval: 15_000,
    queryFn: async (): Promise<Issue[]> => {
      const { data } = await api.get<{
        project_issues: Record<string, unknown>[];
        workspace_tasks: Record<string, unknown>[];
      }>(`/api/workspaces/${slug}/tasks/history/`);
      return [
        ...data.project_issues.map((item) => mapIssue(item, String(item.project_id))),
        ...data.workspace_tasks.map((item) => mapWorkspaceTask(item, [])),
        // The supported TypeScript target predates Array.toSorted; this array is newly allocated.
        // eslint-disable-next-line unicorn/no-array-sort
      ].sort(
        (left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? "") || left.id.localeCompare(right.id)
      );
    },
  });
};

export const useCreateIssue = (slug: string, projectId?: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (
      payload: Pick<Issue, "name" | "priority"> & {
        targetDate?: string;
        assigneeId?: string;
        routingRuleId?: string;
      }
    ) => {
      const requestPayload = {
        name: payload.name,
        priority: payload.priority.toLowerCase(),
        target_date: payload.targetDate || null,
      };
      if (!projectId) {
        const response = await api.post(`/api/workspaces/${slug}/tasks/`, {
          ...requestPayload,
          assignee_id: payload.assigneeId,
        });
        return mapWorkspaceTask(response.data, []);
      }
      return mapIssue(
        (
          await api.post(`/api/workspaces/${slug}/projects/${projectId}/issues/`, {
            ...requestPayload,
            assignee_ids: payload.assigneeId ? [payload.assigneeId] : [],
            routing_rule_id: payload.routingRuleId || undefined,
          })
        ).data,
        projectId
      );
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["issues", slug] });
      client.invalidateQueries({ queryKey: ["task-history", slug] });
      toastSuccess("تغییرات با موفقیت انجام شد");
      client.invalidateQueries({ queryKey: ["notifications", slug] });
    },
    onError: (error) => toastError(error, "ساخت کار انجام نشد"),
  });
};
export const useUpdateIssueStatus = (slug: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ issue, status, nativeValue }: { issue: Issue; status: Status; nativeValue?: string }) => {
      if (issue.scope === "workspace") {
        const rawStatus = {
          Todo: "todo",
          "In Progress": "in_progress",
          Review: "review",
          Done: "done",
          Blocked: "blocked",
        }[status];
        await api.patch(`/api/workspaces/${slug}/tasks/${issue.id}/`, { status: nativeValue || rawStatus });
        return { issue, status };
      }
      const states = unwrap<Record<string, unknown>[]>(
        (await api.get(`/api/workspaces/${slug}/projects/${issue.projectId}/states/`)).data
      ).map(mapState);
      const target = states.find((state) => (nativeValue ? state.id === nativeValue : state.status === status));
      if (!target)
        throw new Error(
          `پروژهٔ «${issue.projectName || issue.projectIdentifier}» وضعیتی از نوع «${statusFa[status]}» ندارد؛ در تنظیمات پروژه، بخش وضعیت‌ها، آن را اضافه کنید یا کار را به ستون دیگری ببرید.`
        );
      await api.patch(`/api/workspaces/${slug}/projects/${issue.projectId}/issues/${issue.id}/`, {
        state_id: target.id,
      });
      return { issue, status };
    },
    onMutate: async ({ issue, status, nativeValue }) => {
      await client.cancelQueries({ queryKey: ["issues", slug] });
      const snapshots = client.getQueriesData<Issue[]>({ queryKey: ["issues", slug] });
      // Project boards group cards by state id, so move that too or the card snaps back until refetch.
      const moved = issue.scope === "project" && nativeValue ? { status, stateId: nativeValue } : { status };
      client.setQueriesData<Issue[]>({ queryKey: ["issues", slug] }, (old) =>
        Array.isArray(old) ? old.map((item) => (item.id === issue.id ? { ...item, ...moved } : item)) : old
      );
      return { snapshots };
    },
    onError: (error, _variables, context) => {
      context?.snapshots.forEach(([key, value]) => client.setQueryData(key, value));
      toastError(error, "تغییر وضعیت ذخیره نشد");
    },
    onSuccess: () => toastSuccess("تغییرات با موفقیت انجام شد"),
    onSettled: () => {
      return Promise.all([
        client.invalidateQueries({ queryKey: ["notifications", slug] }),
        client.invalidateQueries({ queryKey: ["issues", slug] }),
        client.invalidateQueries({ queryKey: ["task-history", slug] }),
      ]);
    },
  });
};
export const useDeleteIssue = (slug: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (issue: Issue) =>
      issue.scope === "workspace"
        ? api.delete(`/api/workspaces/${slug}/tasks/${issue.id}/`)
        : api.delete(`/api/workspaces/${slug}/projects/${issue.projectId}/issues/${issue.id}/`),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["issues", slug] });
      client.invalidateQueries({ queryKey: ["task-history", slug] });
      toastSuccess("کار حذف شد");
    },
    onError: (error) => toastError(error, "حذف کار انجام نشد"),
  });
};
export const useReassignIssue = (slug: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ issue, assigneeId }: { issue: Issue; assigneeId: string }) =>
      issue.scope === "workspace"
        ? api.patch(`/api/workspaces/${slug}/tasks/${issue.id}/`, { assignee_id: assigneeId })
        : api.patch(`/api/workspaces/${slug}/projects/${issue.projectId}/issues/${issue.id}/`, {
            assignee_ids: [assigneeId],
          }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["issues", slug] });
      client.invalidateQueries({ queryKey: ["task-history", slug] });
      toastSuccess("مسئول کار تغییر کرد");
      client.invalidateQueries({ queryKey: ["notifications", slug] });
    },
    onError: (error) => toastError(error, "انتقال کار انجام نشد"),
  });
};
