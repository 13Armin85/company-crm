import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const state = vi.hoisted(() => ({ permissions: [] as string[], admin: false }));
const mutation = vi.hoisted(() => () => ({ mutate: vi.fn(), isPending: false }));
vi.mock("../api", () => ({
  useWorkspaces: () => ({ data: [{ id: "workspace", slug: "company", name: "شرکت آزمون" }] }),
  useCurrentUser: () => ({ data: { id: "user" } }),
  useWorkspaceAccess: () => ({
    data: { is_admin: state.admin, can: (code: string) => state.permissions.includes(code) },
  }),
  useAppearance: () => ({ data: undefined }),
  useNotificationPreferences: () => ({ data: undefined }),
  useUpdateWorkspace: mutation,
  useSelectWorkspace: mutation,
  useUpdateAppearance: mutation,
  useUpdateNotificationPreferences: mutation,
}));
vi.mock("../engine/surface", () => ({
  SurfaceFields: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("../components", () => ({
  PageHeader: ({ title, actions }: { title: string; actions: ReactNode }) => (
    <header>
      {title}
      {actions}
    </header>
  ),
  Button: ({ children }: { children: ReactNode }) => <button>{children}</button>,
}));

import SettingsPage from "./settings";

function renderSettings() {
  return renderToStaticMarkup(
    <RouterProvider router={createMemoryRouter([{ path: "*", element: <SettingsPage /> }])} />
  );
}

describe("personal settings access", () => {
  it("keeps appearance controls and hides company and access administration for members", () => {
    state.permissions = [];
    state.admin = false;
    const html = renderSettings();
    expect(html).toContain("ظاهر و ترجیحات");
    expect(html).toContain("پروفایل من");
    for (const label of ["مشخصات شرکت", "اعضا و دسترسی", "طراحی فرم‌ها و جدول‌ها", "ذخیره تغییرات"])
      expect(html).not.toContain(label);
  });

  it("shows company and designer controls for the server's administrative permissions", () => {
    state.permissions = ["Workspace.Edit", "User.View", "FormDesigner.View"];
    state.admin = true;
    const html = renderSettings();
    for (const label of ["مشخصات شرکت", "اعضا و دسترسی", "طراحی فرم‌ها و جدول‌ها", "ذخیره تغییرات"])
      expect(html).toContain(label);
  });

  it("keeps the designer hidden from an ordinary user with an old designer grant", () => {
    state.admin = false;
    state.permissions = ["FormDesigner.View", "Relation.View"];
    expect(renderSettings()).not.toContain('href="/settings/engine"');
  });

  it("shows the designer to an ordinary user with the full designer permission", () => {
    state.admin = false;
    state.permissions = ["FormDesigner.Access", "FormDesigner.View"];
    expect(renderSettings()).toContain('href="/settings/engine"');
  });
});
