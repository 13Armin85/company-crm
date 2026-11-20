import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Breadcrumb } from "./breadcrumb";
import { NavigationContext } from "../navigation";
import type { NavigationDocument } from "../navigation-paths";

const state = vi.hoisted(() => ({
  permissions: ["Role.View"],
  role: { id: "role-1", name: "پشتیبانی" },
  isError: false,
  isLoading: false,
  roleQuery: vi.fn(),
}));

vi.mock("../api", () => ({
  useWorkspaceAccess: () => ({ data: { can: (code: string) => state.permissions.includes(code) } }),
  useOrganizationRole: (id: string, enabled: boolean) => {
    state.roleQuery(id, enabled);
    return { data: state.role, isError: state.isError, isLoading: state.isLoading };
  },
}));

const render = (path = "/roles/role-1/permissions") =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <Breadcrumb />
    </MemoryRouter>
  );

beforeEach(() => {
  state.permissions = ["Role.View"];
  state.role = { id: "role-1", name: "پشتیبانی" };
  state.isError = false;
  state.isLoading = false;
  state.roleQuery.mockClear();
});

describe("role breadcrumb", () => {
  it("renders database category and page titles with categorized parent links", () => {
    const document = {
      categories: [{ id: "company", title: "دسته از دیتابیس", to: "/sections/company" }],
      routes: [
        { path: "/roles", category: "company", label: "نقش‌های شرکت" },
        { path: "/", category: "home" },
      ],
      entities: [],
      design_pages: [],
    } as unknown as NavigationDocument;
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/sections/company/roles/role-1/permissions"]}>
        <NavigationContext.Provider value={document}>
          <Breadcrumb />
        </NavigationContext.Provider>
      </MemoryRouter>
    );
    expect(html).toContain("دسته از دیتابیس");
    expect(html).toContain("نقش‌های شرکت");
    expect(html).toContain("پشتیبانی");
    expect(html).toContain('href="/sections/company"');
    expect(html).toContain('href="/sections/company/roles"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });
  it("uses the database role name and real parent links with one current page", () => {
    const html = render();
    expect(html).toContain('aria-label="مسیر صفحه"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('href="/roles"');
    expect(html).toContain('href="/"');
    expect(html).toContain("پشتیبانی");
    expect(html).not.toContain("role-1");
    expect(html).not.toContain("مجوزهای نقش");
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(state.roleQuery).toHaveBeenCalledWith("role-1", true);
  });

  it("follows route changes without displaying the previous role", () => {
    expect(render("/roles/role-2/permissions")).not.toContain("پشتیبانی");
    expect(state.roleQuery).toHaveBeenLastCalledWith("role-2", true);
    state.role = { id: "role-2", name: "فروش" };
    expect(render("/roles/role-2/permissions")).toContain("فروش");
  });

  it("hides cached names and disables fetching when access is revoked", () => {
    state.permissions = [];
    const html = render();
    expect(html).not.toContain("پشتیبانی");
    expect(html).not.toContain('href="/roles"');
    expect(state.roleQuery).toHaveBeenCalledWith("role-1", false);
  });

  it("allows permission managers to read the role without linking to a forbidden list", () => {
    state.permissions = ["Role.Permission.Assign"];
    const html = render();
    expect(html).toContain("پشتیبانی");
    expect(html).not.toContain('href="/roles"');
    expect(state.roleQuery).toHaveBeenCalledWith("role-1", true);
  });

  it("does not reveal cached names after a failed request", () => {
    state.isError = true;
    expect(render()).not.toContain("پشتیبانی");
  });

  it("escapes database titles as text", () => {
    state.role.name = '<script>alert("x")</script>';
    const html = render();
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
