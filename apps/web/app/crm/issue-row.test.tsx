import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Issue } from "./types";

const state = vi.hoisted(() => ({
  permissions: ["Issue.Status.Edit"] as string[],
  userId: "user-1" as string | undefined,
  pending: false,
}));
vi.mock("./api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api")>();
  return {
    ...original,
    useWorkspaceAccess: () => ({ data: { can: (code: string) => state.permissions.includes(code) } }),
    useCurrentUser: () => ({ data: state.userId ? { id: state.userId } : undefined }),
    useMembers: () => ({ data: [] }),
    useUpdateIssueStatus: () => ({ isPending: state.pending, mutate: vi.fn() }),
    useDeleteIssue: () => ({ isPending: false, mutate: vi.fn() }),
    useReassignIssue: () => ({ isPending: false, mutate: vi.fn() }),
  };
});
import { IssueRow } from "./components";

const issue: Issue = {
  id: "task-1",
  name: "کار آزمایشی",
  sequenceId: 1,
  projectIdentifier: "TEAM",
  scope: "workspace",
  status: "Todo",
  priority: "Medium",
  assignee: {
    id: "user-1",
    displayName: "سارا",
    email: "sara@example.com",
    initials: "س",
    role: "عضو",
    avatarColor: "#fff",
  },
};
const render = (values: Partial<Issue> = {}, table = false) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <IssueRow issue={{ ...issue, ...values }} table={table} />
    </MemoryRouter>
  );

beforeEach(() => {
  state.permissions = ["Issue.Status.Edit"];
  state.userId = "user-1";
  state.pending = false;
});

describe("direct status changes in task lists", () => {
  it.each([false, true])("shows the inline status control for an assigned user in table=%s", (table) => {
    const html = render({}, table);
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-label="تغییر وضعیت کار آزمایشی"');
  });
  it("allows an authorized editor to change another user's task", () => {
    state.permissions.push("Issue.Edit");
    state.userId = "editor";
    expect(render()).toContain('aria-label="تغییر وضعیت کار آزمایشی"');
  });
  it("keeps the status readable without exposing a control to an unassigned member", () => {
    state.userId = "other";
    const html = render();
    expect(html).toContain("برای انجام");
    expect(html).not.toContain('role="combobox"');
  });
  it("requires the status permission even when the task belongs to the user", () => {
    state.permissions = ["Issue.Edit"];
    expect(render()).not.toContain('role="combobox"');
  });
  it("does not treat a missing user and missing assignee as ownership", () => {
    state.userId = undefined;
    expect(render({ assignee: undefined })).not.toContain('role="combobox"');
  });
  it("disables repeat changes and announces saving while the request is pending", () => {
    state.pending = true;
    const html = render();
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("در حال ذخیره وضعیت کار");
    expect(html).toMatch(/<input[^>]*disabled/);
  });
});
