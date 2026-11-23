import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ workflowError: false, extensionError: false }));

vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  errorMessage: (_error: unknown, fallback: string) => fallback,
  useWorkspaceAccess: () => ({ data: { can: () => false } }),
}));
vi.mock("../components", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../components")>()),
  PageHeader: ({ title }: { title: string }) => title,
}));
vi.mock("../api/workflow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/workflow")>()),
  useWorkflowInbox: () => ({
    data: { steps: [], extensions: [] },
    isLoading: false,
    isError: state.workflowError,
    error: new Error("network"),
    refetch: vi.fn(),
  }),
}));
vi.mock("../api/ticket", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/ticket")>()),
  useTicketExtensionInbox: () => ({
    data: [],
    isLoading: false,
    isError: state.extensionError,
    error: new Error("network"),
    refetch: vi.fn(),
  }),
}));

import WorkflowInboxPage from "./inbox-page";
import { TicketExtensionInbox } from "../ticket/extension-inbox";

beforeEach(() => {
  state.workflowError = false;
  state.extensionError = false;
});

describe("items awaiting my action", () => {
  it("shows the empty state only when the workflow inbox loaded successfully", () => {
    const html = renderToStaticMarkup(
      <RouterProvider router={createMemoryRouter([{ path: "/", element: <WorkflowInboxPage /> }])} />
    );
    expect(html).toContain("موردی منتظر شما نیست");
  });

  it("shows a retry action when the workflow inbox fails", () => {
    state.workflowError = true;
    const html = renderToStaticMarkup(
      <RouterProvider router={createMemoryRouter([{ path: "/", element: <WorkflowInboxPage /> }])} />
    );
    expect(html).toContain('class="error-state"');
    expect(html).toContain("تلاش دوباره");
    expect(html).not.toContain("موردی منتظر شما نیست");
  });

  it("shows a retry action when ticket extensions fail to load", () => {
    state.extensionError = true;
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TicketExtensionInbox />
      </MemoryRouter>
    );
    expect(html).toContain('class="error-state"');
    expect(html).toContain("تلاش دوباره");
  });
});
