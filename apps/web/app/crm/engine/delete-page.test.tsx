import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { EntityDefinition } from "./api";
import { DeletePageButton, DeletePageDialog } from "./delete-page";

vi.mock("../access/components", () => ({
  AccessModal: ({ children, title }: { children: ReactNode; title: string }) => (
    <section aria-label={title}>{children}</section>
  ),
}));

const entity = (controls?: EntityDefinition["page_management"]) =>
  ({ id: "page-id", title: "قراردادها", page_management: controls }) as EntityDefinition;
function dialog(controls: EntityDefinition["page_management"]) {
  const client = new QueryClient();
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <DeletePageDialog entity={entity(controls)} onClose={() => {}} />
    </QueryClientProvider>
  );
  client.clear();
  return html;
}

describe("server-controlled page deletion", () => {
  it("hides management until the backend grants it", () => {
    expect(renderToStaticMarkup(<DeletePageButton entity={entity()} />)).toBe("");
    expect(
      renderToStaticMarkup(
        <DeletePageButton
          entity={entity({ can_manage: false, can_delete: false, can_archive: false, delete_blockers: [] })}
        />
      )
    ).toBe("");
  });
  it("offers deletion for an unused custom page and explains the consequence", () => {
    const html = dialog({ can_manage: true, can_delete: true, can_archive: true, delete_blockers: [] });
    expect(html).toContain("button-danger");
    expect(html).toContain("قابل بازگشت نیست");
    expect(html).not.toContain("غیرفعال‌سازی صفحه");
  });
  it("shows server dependency reasons and offers archive without a delete action", () => {
    const html = dialog({
      can_manage: true,
      can_delete: false,
      can_archive: true,
      delete_blockers: ["گردش‌کار به این صفحه وابسته است."],
    });
    expect(html).toContain("گردش‌کار به این صفحه وابسته است.");
    expect(html).toContain("غیرفعال‌سازی صفحه");
    expect(html).not.toContain("button-danger");
  });
  it("allows restoring an archived page only when the backend grants it", () => {
    const html = dialog({
      can_manage: true,
      can_delete: false,
      can_archive: false,
      can_restore: true,
      delete_blockers: ["این صفحه رکورد دارد."],
    });
    expect(html).toContain("فعال‌سازی صفحه");
    expect(html).not.toContain("غیرفعال‌سازی صفحه");
    expect(html).not.toContain("button-danger");
  });
  it("names the available action instead of promising deletion of a protected page", () => {
    const html = renderToStaticMarkup(
      <DeletePageButton
        entity={entity({
          can_manage: true,
          can_delete: false,
          can_archive: false,
          can_restore: true,
          delete_blockers: ["این صفحه رکورد دارد."],
        })}
      />
    );
    expect(html).toContain("بازگردانی صفحهٔ قراردادها");
    expect(html).not.toContain("حذف صفحه");
  });
});
