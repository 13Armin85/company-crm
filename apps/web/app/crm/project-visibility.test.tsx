import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  useProject: () => ({ data: { id: "revoked", name: "Previously cached project" }, isError: true, isLoading: false }),
  useIssues: () => ({ data: [] }),
  useMembers: () => ({ data: [] }),
  useWorkspaceAccess: () => ({ data: { is_admin: false, can: () => true } }),
  useCurrentUser: () => ({ data: { id: "member" } }),
  useCycles: () => ({ data: [] }),
  useActivities: () => ({ data: [] }),
  useUpdateIssueStatus: () => ({ mutate: vi.fn() }),
  useArchiveProject: () => ({ mutate: vi.fn() }),
  useDeleteProject: () => ({ mutate: vi.fn() }),
  useReassignIssue: () => ({ mutate: vi.fn() }),
}));
import ProjectDetailPage from "./pages/project-detail";

describe("project membership visibility", () => {
  it("hides previously cached project details after access is revoked", () => {
    const router = createMemoryRouter([{ path: "/projects/:id", element: <ProjectDetailPage /> }], {
      initialEntries: ["/projects/revoked"],
    });
    const html = renderToStaticMarkup(<RouterProvider router={router} />);
    expect(html).not.toContain("Previously cached project");
    expect(html).toContain("پروژه پیدا نشد");
  });
});
