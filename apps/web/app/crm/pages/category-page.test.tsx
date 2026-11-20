import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { NavigationContext } from "../navigation";
import type { NavigationDocument } from "../navigation-paths";

vi.mock("../components", () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("./home", () => ({ default: () => <div>Home</div> }));
vi.mock("./not-found", () => ({ default: () => <div>Not found</div> }));

import CategoryPage from "./category";

const document = {
  categories: [{ id: "data", title: "داده‌ها و فرم‌ها", items: [] }],
  entities: [{ code: "contracts", title: "قراردادها", category: "data", to: "/sections/data/entities/contracts" }],
} as unknown as NavigationDocument;

describe("member data category", () => {
  it("lists authorized records without requiring page administration permissions", () => {
    const html = renderToStaticMarkup(
      <NavigationContext.Provider value={document}>
        <RouterProvider
          router={createMemoryRouter([{ path: "/sections/:category", element: <CategoryPage /> }], {
            initialEntries: ["/sections/data"],
          })}
        />
      </NavigationContext.Provider>
    );
    expect(html).toContain("داده‌ها و فرم‌ها");
    expect(html).toContain('href="/sections/data/entities/contracts"');
    expect(html).toContain("قراردادها");
    expect(html).not.toContain('href="/entities"');
    expect(html).not.toContain("/settings/engine");
  });
});
