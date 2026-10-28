import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { RelationSettings } from "./relation-settings";
import { useUIStore } from "../store";

vi.mock("../api", async () => ({
  ...(await vi.importActual<typeof import("../api")>("../api")),
  useWorkspaceAccess: () => ({ data: { can: () => true } }),
}));

function renderRelations(rows: unknown[]) {
  const client = new QueryClient();
  const slug = "";
  useUIStore.setState({ workspaceSlug: slug });
  const key = (name: string, path: string) => ["entity-engine", slug, name, path];
  client.setQueryData(key("catalog", "catalog/"), {
    entities: [
      { id: "customer-id", code: "customer", title: "مشتری" },
      { id: "contract-id", code: "contract", title: "قرارداد" },
    ],
  });
  client.setQueryData(key("relations", "relations/"), { results: rows });
  client.setQueryData(key("lookup-path", "entities/customer/view-schema/?path="), { fields: [] });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <RelationSettings entityCode="customer" />
    </QueryClientProvider>
  );
  client.clear();
  return html;
}

describe("relation designer", () => {
  it("shows both sides, cardinality, link count and actions for an existing relation", () => {
    const html = renderRelations([
      {
        id: "relation-1",
        left_entity: "customer",
        right_entity: "contract",
        left_title: "قراردادها",
        right_title: "مشتری",
        kind: "one_to_many",
        left_required: false,
        right_required: true,
        on_delete: "detach",
        link_count: 3,
      },
    ]);
    expect(html).toContain("ارتباط‌های موجود");
    expect(html).toContain("قراردادها");
    expect(html).toContain("یک به چند");
    expect(html).toContain("۳ پیوند");
    expect(html).toContain("هنگام حذف: جدا کردن پیوند");
    expect(html).toContain("پیوند اجباری");
    expect(html).toContain("حذف ارتباط");
  });

  it("keeps creation and lookup guidance visible when there are no relations", () => {
    const html = renderRelations([]);
    expect(html).toContain("هنوز ارتباطی برای این موجودیت تعریف نشده است.");
    expect(html).toContain("۱. طرفین ارتباط");
    expect(html).toContain("۲. قوانین پیوند");
    expect(html).toContain("فیلد خواندنی از ارتباط");
    expect(html).toContain("افزودن فیلد فقط‌خواندنی");
  });
});
