import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { NavigationContext } from "../navigation";
import type { NavigationDocument } from "../navigation-paths";
import { useUIStore } from "../store";
import { EntityDirectoryPage } from "./record-pages";

vi.mock("../api", async () => ({
  ...(await vi.importActual<typeof import("../api")>("../api")),
  useWorkspaceAccess: () => ({ data: { can: () => false } }),
}));

const navigation = {
  categories: [{ id: "data", title: "داده‌ها و فرم‌ها", items: [] }],
  entities: [
    { code: "ticket", category: "work", to: "/sections/work/issues" },
    { code: "contract", category: "data", to: "/sections/data/entities/contract" },
  ],
  routes: [],
} as unknown as NavigationDocument;

describe("member page directory", () => {
  it("uses authorized server pages and URLs without exposing designer actions", () => {
    const client = new QueryClient();
    useUIStore.setState({ workspaceSlug: "" });
    client.setQueryData(["entity-engine", "", "catalog", "catalog/"], {
      entities: [
        { id: "ticket", code: "ticket", title: "کارهای من", adapter: "ticket", is_active: true },
        { id: "contract", code: "contract", title: "قراردادهای مجاز", adapter: "", is_active: true },
        { id: "hidden", code: "hidden", title: "صفحهٔ غیرمجاز", adapter: "", is_active: true },
      ],
    });

    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <NavigationContext.Provider value={navigation}>
            <EntityDirectoryPage />
          </NavigationContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>
    );
    client.clear();
    expect(html).toContain("همه صفحه‌ها");
    expect(html).toContain('href="/sections/work/issues"');
    expect(html).toContain('href="/sections/data/entities/contract"');
    for (const label of ["صفحهٔ غیرمجاز", "مدیریت فرم‌ها", "ساخت صفحهٔ جدید", "حذف صفحه", "نمایش صفحه‌های غیرفعال"])
      expect(html).not.toContain(label);
  });
});
