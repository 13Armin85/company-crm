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
      { code: "roles", title: "نقش‌های سازمانی", native_columns: ["نام نقش"] },
      { code: "profile", title: "پروفایل من", native_columns: [] },
    ],
  });
  client.setQueryData(
    ["entity-engine", "", "entities", "definitions/entities/"],
    [{ code: "custom", title: "موجودیت آزمایشی", adapter: "" }]
  );
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
  it("shows only existing pages and removes advanced management tabs and entity links", () => {
    const html = renderPage(<EngineSettingsPage />);
    expect(html).toContain("نقش‌های سازمانی");
    expect(html).toContain("پروفایل من");
    for (const label of [
      "موجودیت آزمایشی",
      "موجودیت‌ها",
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
