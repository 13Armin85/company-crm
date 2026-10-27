import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EngineSettingsPage from "./settings-page";
import { ProfileSettings } from "../pages/settings";
import { useUIStore } from "../store";

const state = vi.hoisted(() => ({ avatar: "", removing: false }));
vi.mock("../api", async () => ({
  ...(await vi.importActual<typeof import("../api")>("../api")),
  useWorkspaceAccess: () => ({ data: { can: () => true } }),
  useCurrentUser: () => ({
    data: { id: "me", displayName: "کاربر", initials: "ک", email: "me@example.com", avatarUrl: state.avatar },
  }),
  useUploadAvatar: () => ({ isPending: false, mutate: vi.fn() }),
  useRemoveAvatar: () => ({ isPending: state.removing, mutate: vi.fn() }),
  useUpdateUserProfile: () => ({ isPending: false, mutate: vi.fn() }),
  useSignOut: () => ({ isPending: false, mutate: vi.fn() }),
}));

function renderPage(children: React.ReactNode) {
  const client = new QueryClient();
  useUIStore.setState({ workspaceSlug: "" });
  client.setQueryData(["entity-engine", "", "surfaces", "surfaces/"], {
    results: [
      { code: "ticket", title: "کارها", native_columns: ["عنوان"] },
      { code: "profile", title: "پروفایل من", native_columns: [] },
    ],
  });
  client.setQueryData(["entity-engine", "", "catalog", "catalog/"], {
    entities: [{ id: "work", code: "ticket", title: "کار", adapter: "ticket", is_active: true, parent: null }],
  });
  client.setQueryData(["entity-engine", "", "fields", "definitions/fields/"], []);
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <RouterProvider router={createMemoryRouter([{ path: "*", element: children }])} />
    </QueryClientProvider>
  );
  client.clear();
  return html;
}

describe("simplified forms and profile", () => {
  beforeEach(() => {
    state.avatar = "";
    state.removing = false;
  });
  it("offers entity forms and data rules while excluding fixed personal pages", () => {
    const html = renderPage(<EngineSettingsPage />);
    expect(html).toContain("کارها");
    expect(html).not.toContain("پروفایل من");
    expect(html).toContain("ورودی‌های فرم");
    expect(html).toContain("چیدمان فرم");
    expect(html).toContain("جدول و تب‌ها");
    expect(html).toContain("قواعد ثبت");
    expect(html).toContain("ارتباط‌ها");
    expect(html).toContain('type="search"');
    expect(html).toContain("جستجوی موجودیت");
    expect(html.match(/engine-workspace-tab-copy/g)).toHaveLength(7);
    for (const label of [
      "نقش‌های سازمانی",
      "لیست‌های پایه",
      "مقادیر لیست‌ها",
      "کتابخانه فیلدها",
      "قالب و انتقال تنظیمات",
      "ممیزی تعاریف",
      "مشاهده رکوردها",
      'href="/entities',
    ])
      expect(html).not.toContain(label);
  });
  it("offers avatar removal only when the current user has a picture", () => {
    expect(renderPage(<ProfileSettings />)).not.toContain("حذف تصویر پروفایل");
    state.avatar = "/avatar.png";
    expect(renderPage(<ProfileSettings />)).toContain("حذف تصویر پروفایل");
  });
  it("prevents simultaneous removal and upload", () => {
    state.avatar = "/avatar.png";
    state.removing = true;
    const html = renderPage(<ProfileSettings />);
    expect(html).toContain("در حال حذف…");
    expect(html).toMatch(/type="file"[^>]*disabled/);
  });
});
