import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, createMemoryRouter, RouterProvider } from "react-router";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Issue, Member } from "./types";

const state = vi.hoisted(() => ({ issues: [] as Issue[], admin: false }));
const user: Member = {
  id: "owner",
  displayName: "Receiver",
  email: "receiver@example.com",
  initials: "R",
  avatarColor: "#fff",
  role: "Member",
};
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  useCurrentUser: () => ({ data: user, isLoading: false }),
  useWorkspaceAccess: () => ({ data: { is_admin: state.admin, can: () => true }, isLoading: false }),
  useTaskHistory: () => ({ data: state.issues, isLoading: false }),
  useIssues: () => ({ data: state.issues, isLoading: false }),
  useProjects: () => ({ data: [], isLoading: false }),
  useMembers: () => ({ data: [user, { ...user, id: "recipient", displayName: "Recipient" }], isLoading: false }),
  useUpdateIssueStatus: () => ({ isPending: false, mutate: vi.fn() }),
  useReassignIssue: () => ({ isPending: false, mutate: vi.fn() }),
  useDeleteIssue: () => ({ isPending: false, mutate: vi.fn() }),
}));
import MyWorkPage from "./pages/my-work";
import IssuesPage from "./pages/issues";
import { IssueKanbanBoard } from "./kanban";

const task = (id: string, values: Partial<Issue> = {}): Issue => ({
  id,
  name: id,
  scope: "workspace",
  sequenceId: 1,
  projectIdentifier: "TEAM",
  priority: "Medium",
  status: "Todo",
  assignee: user,
  senderId: "manager",
  wasAssignedToMe: true,
  ...values,
});
const renderPage = (element: ReactNode) =>
  renderToStaticMarkup(<RouterProvider router={createMemoryRouter([{ path: "*", element }])} />);
beforeEach(() => {
  state.admin = false;
  state.issues = [
    task("received-from-manager"),
    task("legacy-self-created", { senderId: user.id }),
    task("historical-completed", { status: "Done", createdAt: "2011-01-01" }),
    task("historical-transferred", { assignee: { ...user, id: "next-owner" } }),
  ];
});

describe("member task pages", () => {
  it("shows current received work with transfer actions but no creation or status controls in My Work", () => {
    const html = renderPage(<MyWorkPage />);
    expect(html).toContain("received-from-manager");
    expect(html).not.toContain("legacy-self-created");
    expect(html).not.toContain("historical-completed");
    expect(html).not.toContain("historical-transferred");
    expect(html).toContain('aria-label="انتقال به عضو دیگر"');
    expect(html).not.toContain('aria-label="تغییر وضعیت');
    expect(html).not.toContain("افزودن کار");
    expect(html).not.toContain('aria-label="عملیات کار"');
    expect(html).toContain("has-inline-transfer");
  });
  it("exposes current work, complete history and sent-work tabs in All Tasks", () => {
    const html = renderPage(<IssuesPage />);
    expect(html).toContain("received-from-manager");
    expect(html).toContain("تاریخچهٔ من (همهٔ زمان‌ها)");
    expect(html).toContain("ارسالی‌های من");
    expect(html).toContain("کار جدید");
  });
  it("disables dragging and creation on read-only kanban cards", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <IssueKanbanBoard issues={[state.issues[0]]} readOnly onStatusChange={vi.fn()} onCreate={vi.fn()} />
      </MemoryRouter>
    );
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain('aria-label="افزودن کار به');
    expect(html).not.toContain('role="combobox"');
  });
  it.each([false, true])("offers My Work transfers for administrator=%s", (admin) => {
    state.admin = admin;
    const html = renderPage(<MyWorkPage />);
    expect(html).toContain('aria-label="انتقال به عضو دیگر"');
    expect(html).toContain("has-inline-transfer");
    expect(html).toContain("انتقال به شخص دیگر");
    expect(html).not.toContain("افزودن کار");
    expect(html).not.toContain("کار جدید");
  });
  it.each([false, true])("offers task creation in All Tasks for administrator=%s", (admin) => {
    state.admin = admin;
    expect(renderPage(<IssuesPage />)).toContain("کار جدید");
  });
  it("enables only transfer controls on My Work kanban while status dragging and creation remain disabled", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <IssueKanbanBoard
          issues={[state.issues[0]]}
          readOnly
          allowTransfer
          transferMembers={[user, { ...user, id: "recipient", displayName: "Recipient" }]}
          onAssigneeChange={vi.fn()}
          onStatusChange={vi.fn()}
          onCreate={vi.fn()}
        />
      </MemoryRouter>
    );
    expect(html).toContain("انتقال به شخص دیگر");
    expect(html).toContain('role="combobox"');
    expect(html).not.toContain('aria-label="افزودن کار به');
  });
});
