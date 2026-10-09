import type { ReactNode } from "react";
import { Menu } from "@headlessui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  permissions: [] as string[],
  authenticated: false,
  loading: false,
  projects: vi.fn(),
}));
vi.mock("../api", () => ({
  useWorkspaceAccess: () => ({ data: { can: (code: string) => state.permissions.includes(code) }, isLoading: false }),
  useOrganizationRoles: () => ({
    data: [
      { id: "support", name: "پشتیبانی", description: "نقش سازمانی", isActive: false, permissionIds: [], userCount: 3 },
    ],
    isLoading: false,
  }),
  useOrganizationPermissions: () => ({
    data: [
      {
        id: "permission",
        code: "User.View",
        name: "مشاهده کاربران",
        description: "فهرست اعضا",
        category: "User",
        isActive: true,
      },
    ],
  }),
  useSaveOrganizationRole: () => ({ isPending: false }),
  useDeactivateOrganizationRole: () => ({ isPending: false }),
  useOrganizationUnits: () => ({
    data: [{ id: "sales-unit", title: "واحد فروش", memberIds: [], isActive: true }],
    isLoading: false,
  }),
  useSaveOrganizationUnit: () => ({ isPending: false }),
  useDeactivateOrganizationUnit: () => ({ isPending: false }),
  useCreateWorkspaceUser: () => ({ isPending: false }),
  useMembers: () => ({
    data: [
      {
        id: "user",
        displayName: "کاربر آزمایشی",
        email: "user@example.com",
        initials: "ک",
        avatarColor: "#000",
        isActive: false,
        roles: [
          { id: "support", name: "پشتیبانی" },
          { id: "sales", name: "فروش" },
        ],
      },
    ],
    isLoading: false,
  }),
  useCurrentUser: () => ({
    data: state.authenticated ? { id: "user" } : undefined,
    isLoading: state.loading,
    error: undefined,
    refetch: vi.fn(),
  }),
  useProjects: state.projects,
  useNotifications: vi.fn(),
  useWorkspaces: vi.fn(),
  useAppearance: vi.fn(),
  useSelectWorkspace: vi.fn(),
  useUpdateAppearance: vi.fn(),
  clearClientSession: vi.fn(),
  api: { interceptors: { response: { use: vi.fn(), eject: vi.fn() } } },
}));
vi.mock("./api", () => ({
  useAccessMutation: () => ({ isPending: false }),
  useUserAccess: () => ({
    data: {
      explanations: [
        { code: "User.View", name: "مشاهده کاربران", source: "user_deny", granted: false, has_conflict: true },
      ],
    },
  }),
  useUserExceptions: () => ({
    data: [
      {
        id: "exception",
        permission: "permission",
        permission_code: "User.View",
        effect: "DENY",
        starts_at: null,
        ends_at: null,
        is_active: true,
      },
    ],
  }),
}));
vi.mock("../components", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: ReactNode }) => (
    <header>
      {title}
      {actions}
    </header>
  ),
  Button: ({ children }: { children?: ReactNode }) => <button>{children}</button>,
  SearchBox: () => <input type="search" />,
  Skeleton: () => <span>Loading</span>,
  Avatar: () => <span>Avatar</span>,
  EmptyState: () => <span>Empty</span>,
  Breadcrumb: () => null,
  CommandPalette: () => null,
  CreateModal: () => null,
  IconButton: () => null,
  NotificationDrawer: () => null,
  ToastRegion: () => null,
}));

import RolesPage from "../pages/roles";
import OrganizationPage from "../pages/organization";
import { UserAccessPanel } from "./user-access";
import TeamPage, { UserActionItems } from "../pages/team";
import type { Member } from "../types";
import { AuthenticationBoundary } from "../layout";

const renderPage = (children: ReactNode) => {
  const router = createMemoryRouter([{ id: "test", path: "*", element: children }]);
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
};

describe("CRM access pages", () => {
  beforeEach(() => {
    state.permissions = [];
    state.authenticated = false;
    state.loading = false;
    state.projects.mockClear();
  });

  it("keeps the technical catalog read only and hides role mutation controls", () => {
    state.permissions = ["Role.View", "Permission.View"];
    const html = renderPage(<RolesPage />);
    expect(html).toContain("کاربران");
    expect(html).not.toContain("User.View");
    expect(html).toContain("فقط خواندنی");
    expect(html).not.toContain("نقش جدید");
    expect(html).not.toContain("غیرفعال کردن");
    expect(html).not.toContain('type="number"');
  });

  it("renders an accessible icon for delegates in the organization tree", () => {
    state.permissions = ["OrganizationUnit.View"];
    const html = renderPage(<OrganizationPage />);
    const button = html.match(/<button[^>]*aria-label="جانشینان واحد فروش"[^>]*>[\s\S]*?<\/button>/)?.[0];
    expect(button).toBeDefined();
    expect(button).toContain("<svg");
    expect(button).toContain('aria-expanded="false"');
    expect(button).not.toContain(">جانشینان<");
  });

  it("shows multiple custom role chips and inactive membership status", () => {
    state.permissions = ["User.View"];
    const html = renderPage(<TeamPage />);
    expect(html).toContain("پشتیبانی");
    expect(html).toContain("فروش");
    expect(html).toContain("غیرفعال");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("ساخت کاربر جدید");
  });

  it("shows scoped role membership counts and independent role/catalog searches", () => {
    state.permissions = ["Role.View", "Permission.View"];
    const html = renderPage(<RolesPage />);
    expect(html).toContain("کاربران دارای نقش");
    expect(html).toContain("۳");
    expect(html.match(/type="search"/g)).toHaveLength(2);
    expect(html).toContain("مشاهده مجوزها");
  });

  it("explains deny conflicts and exposes exception editing only to authorized managers", () => {
    state.permissions = ["Access.UserException.View", "Access.EffectivePermission.View"];
    const readonly = renderPage(<UserAccessPanel userId="user" />);
    expect(readonly).toContain("تعارض اجازه و منع؛ منع اولویت دارد.");
    expect(readonly).not.toContain("ویرایش استثنا");
    state.permissions.push("Access.UserException.Manage");
    expect(renderPage(<UserAccessPanel userId="user" />)).toContain("ویرایش استثنا");
  });

  it("allows editing role grants independently of editing role identity", () => {
    state.permissions = ["Role.View", "Role.Permission.Assign", "Permission.View"];
    const html = renderPage(<RolesPage />);
    expect(html).toContain("ویرایش مجوزها");
    expect(html).not.toContain("غیرفعال کردن");
    expect(html).not.toContain("نقش جدید");
  });

  it("shows each user action only with its own permission", () => {
    const member = { id: "user", displayName: "کاربر" } as Member;
    const actions = () =>
      renderPage(
        <Menu as="div">
          <UserActionItems
            member={member}
            can={(code) => state.permissions.includes(code)}
            onChangePassword={vi.fn()}
            onRemove={vi.fn()}
          />
        </Menu>
      );
    state.permissions = ["User.ChangePassword"];
    expect(actions()).toContain("تغییر رمز عبور");
    expect(actions()).not.toContain("حذف کاربر");
    expect(actions()).not.toContain("تغییر اطلاعات هویتی");
    state.permissions = ["User.Edit", "User.Delete"];
    expect(actions()).toContain("تغییر اطلاعات هویتی");
    expect(actions()).toContain("حذف کاربر");
    expect(actions()).not.toContain("تغییر رمز عبور");
    state.permissions = ["User.Role.Assign"];
    expect(actions()).toContain("تغییر اطلاعات هویتی");
    expect(actions()).not.toContain("تغییر رمز عبور");
    expect(actions()).not.toContain("حذف کاربر");
  });

  it("never mounts the private shell or its queries for a logged out user", () => {
    const html = renderPage(<AuthenticationBoundary />);
    expect(html).not.toContain("page-content");
    expect(state.projects).not.toHaveBeenCalled();
  });

  it("waits for session verification even when a user is cached", () => {
    state.authenticated = true;
    const html = renderPage(<AuthenticationBoundary />);
    expect(html).toContain("در حال بررسی حساب");
    expect(html).not.toContain("page-content");
    expect(state.projects).not.toHaveBeenCalled();
  });
});
