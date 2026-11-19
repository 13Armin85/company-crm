import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { useUIStore } from "../store";

vi.mock("../api", async () => ({
  ...(await vi.importActual<typeof import("../api")>("../api")),
  useWorkspaceAccess: () => ({ data: { can: () => true } }),
}));
vi.mock("./page-studio", () => ({ PageEditor: ({ code }: { code: string }) => <div data-editor={code} /> }));

import { DesignWorkspace } from "./design-workspace";

describe("design workspace page picker", () => {
  it("lists API pages and opens the matching full page editor from a direct selection", () => {
    useUIStore.setState({ workspaceSlug: "" });
    const client = new QueryClient();
    client.setQueryData(["entity-engine", "", "catalog", "catalog/"], { entities: [], field_kinds: [] });
    client.setQueryData(["entity-engine", "", "fields", "definitions/fields/"], []);
    client.setQueryData(["entity-engine", "", "surfaces", "surfaces/"], {
      results: [{ code: "roles", title: "نقش‌های سازمانی", path: "/roles", native_columns: ["نام"] }],
    });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/settings/engine?page=roles"]}>
          <DesignWorkspace />
        </MemoryRouter>
      </QueryClientProvider>
    );
    client.clear();
    expect(html).toContain("مدیریت صفحات سایدبار");
    expect(html).toContain("نقش‌های سازمانی");
    expect(html).toContain('data-editor="roles"');
  });
});
