import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { useUIStore } from "../store";
import { SidebarPages, customPages, suggestCode } from "./sidebar-pages";
import type { EntityDefinition } from "./api";
import { NavigationContext } from "../navigation";
import type { NavigationDocument } from "../navigation-paths";

const entity = (code: string, title: string, extra: Partial<EntityDefinition> = {}) =>
  ({ id: code, code, title, is_active: true, parent: null, adapter: "", ...extra }) as EntityDefinition;

function render(entities: EntityDefinition[], canCreate: boolean, navigation?: NavigationDocument) {
  const client = new QueryClient();
  useUIStore.setState({ workspaceSlug: "" });
  client.setQueryData(["entity-engine", "", "catalog", "catalog/"], { entities });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NavigationContext.Provider value={navigation}>
          <SidebarPages canCreate={canCreate} collapsed={false} onNavigate={() => {}} />
        </NavigationContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  client.clear();
  return html;
}

describe("sidebar pages", () => {
  it("lists only active custom tables, not system tables or subtypes", () => {
    const pages = customPages([
      entity("product", "محصول"),
      entity("customer", "مشتری"),
      entity("ticket", "کار", { adapter: "ticket" }),
      entity("vip", "مشتری ویژه", { parent: "customer" }),
      entity("old", "قدیمی", { is_active: false }),
    ]);
    expect(pages.map((page) => page.code)).toEqual(["product", "customer"]);
  });

  it("links each page to its records and shows create only with permission", () => {
    const entities = [entity("customer", "مشتری"), entity("contact", "مخاطب")];
    const html = render(entities, true);
    expect(html).toContain("صفحه‌ها");
    expect(html).toContain('href="/entities/customer"');
    expect(html).toContain("مخاطب");
    expect(html).toContain("ساخت صفحهٔ جدید");
    expect(render(entities, false)).not.toContain("ساخت صفحهٔ جدید");
  });

  it("expands long lists without duplicating the all-pages link", () => {
    const entities = Array.from({ length: 10 }, (_, i) => entity(`page-${i}`, `صفحه ${i}`));
    const html = render(entities, false);
    expect(html.match(/href="\/entities\/page-/g)).toHaveLength(8);
    expect(html).toContain("نمایش بیشتر (۱۰)");
    expect(html).not.toContain("همه صفحه‌ها");
  });

  it("keeps authorized pages across categories without a duplicate directory link", () => {
    const entities = Array.from({ length: 10 }, (_, i) => entity(`page-${i}`, `صفحه ${i}`));
    const navigation = {
      categories: [{ id: "data", to: "/sections/data", items: [{ path: "/entities", to: "/sections/data/entities" }] }],
      entities: entities.map((page, index) => ({ code: page.code, category: index % 2 ? "work" : "data" })),
      routes: [],
    } as unknown as NavigationDocument;
    const html = render(entities, false, navigation);
    expect(html.match(/href="\/sections\/(data|work)\/entities\/page-/g)).toHaveLength(8);
    expect(html).not.toContain('href="/entities"');
    expect(html).not.toContain('href="/sections/data/entities"');
    expect(html).toContain("نمایش بیشتر (۱۰)");
  });

  it("keeps the section visible when empty without offering creation to members", () => {
    expect(render([], true)).toContain("اولین صفحه را بسازید");
    expect(render([], false)).toContain("صفحهٔ سفارشی در دسترس نیست.");
    expect(render([], false)).not.toContain("اولین صفحه را بسازید");
  });

  it("suggests a valid English code", () => {
    expect(suggestCode()).toMatch(/^page-[a-z0-9]{1,5}$/);
  });
});
