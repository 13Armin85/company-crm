import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Issue, Project } from "./types";

const state = vi.hoisted(() => ({
  permissions: ["Issue.Assign"] as string[],
  userId: "project-owner",
  project: {} as Project,
}));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  useProject: () => ({ data: state.project, isLoading: false }),
  // Detail pages must not depend on the separately loaded project collection for ownership.
  useProjects: () => ({ data: [] }),
  useIssues: () => ({
    data: [
      {
        id: "task",
        name: "کار تیم",
        scope: "project",
        projectId: "project",
        projectIdentifier: "PRJ",
        sequenceId: 1,
        status: "Todo",
        priority: "Medium",
        assignee: { id: "assignee", displayName: "مسئول فعلی" },
      } as Issue,
    ],
  }),
  useMembers: () => ({
    data: ["assignee", "recipient"].map((id) => ({
      id,
      displayName: id,
      email: `${id}@example.com`,
      initials: id[0],
      role: "Member",
      avatarColor: "#fff",
    })),
  }),
  useWorkspaceAccess: () => ({ data: { can: (code: string) => state.permissions.includes(code) } }),
  useCurrentUser: () => ({ data: { id: state.userId } }),
  useCycles: () => ({ data: [] }),
  useActivities: () => ({ data: [] }),
  useUpdateIssueStatus: () => ({ mutate: vi.fn(), isPending: false }),
  useReassignIssue: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteIssue: () => ({ mutate: vi.fn(), isPending: false }),
  useArchiveProject: () => ({ mutate: vi.fn() }),
  useDeleteProject: () => ({ mutate: vi.fn() }),
}));
import ProjectDetailPage from "./pages/project-detail";

const renderTab = (tab: string) => {
  const router = createMemoryRouter([{ path: "/projects/:id", element: <ProjectDetailPage /> }], {
    initialEntries: [`/projects/project?tab=${tab}`],
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
};

beforeEach(() => {
  state.permissions = ["Issue.Assign"];
  state.userId = "project-owner";
  state.project = { id: "project", name: "پروژه", identifier: "PRJ", createdById: "project-owner" };
});

describe.each(["overview", "issues", "board"])("project task menu in %s", (tab) => {
  it.each(["createdById", "projectLeadId"])("offers transfers for the %s owner using the current project", (field) => {
    state.project = { id: "project", name: "پروژه", identifier: "PRJ", [field]: "project-owner" };
    const html = renderTab(tab);
    if (tab === "board") {
      expect(html).not.toContain('aria-label="عملیات کار"');
      expect(html).toContain("kanban-transfer-control");
    } else {
      expect(html).toContain('aria-label="عملیات کار"');
      expect(html).toContain('aria-haspopup="menu"');
      expect(html).not.toContain("kanban-transfer-control");
    }
    expect(html).not.toContain("issue-status-control");
  });

  it("offers the same menu to the assignee and authorized editor", () => {
    state.userId = "assignee";
    const control = tab === "board" ? "kanban-transfer-control" : 'aria-label="عملیات کار"';
    expect(renderTab(tab)).toContain(control);
    state.userId = "editor";
    state.permissions.push("Issue.Edit");
    expect(renderTab(tab)).toContain(control);
  });

  it("does not offer another member's task actions or bypass the assignment permission", () => {
    state.userId = "unrelated";
    expect(renderTab(tab)).not.toContain('aria-label="عملیات کار"');
    expect(renderTab(tab)).not.toContain("kanban-transfer-control");
    state.userId = "project-owner";
    state.permissions = [];
    expect(renderTab(tab)).not.toContain('aria-label="عملیات کار"');
    expect(renderTab(tab)).not.toContain("kanban-transfer-control");
  });
});
