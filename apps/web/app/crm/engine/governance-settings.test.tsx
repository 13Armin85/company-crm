import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { EntityRules } from "./governance-settings";
import { useUIStore } from "../store";

vi.mock("../api", async () => ({
  ...(await vi.importActual<typeof import("../api")>("../api")),
  useWorkspaceAccess: () => ({ data: { can: () => true } }),
}));

function renderRules(uniqueRules: unknown[], numberingRules: unknown[]) {
  const client = new QueryClient();
  const slug = "";
  useUIStore.setState({ workspaceSlug: slug });
  const key = (name: string, path: string) => ["entity-engine", slug, name, path];
  client.setQueryData(key("catalog", "catalog/"), { entities: [] });
  client.setQueryData(key("fields", "definitions/fields/"), []);
  client.setQueryData(key("view-schema", "entities/ticket/view-schema/"), {
    fields: [{ code: "national_id", title: "کد ملی" }],
  });
  client.setQueryData(key("unique-rules", "entities/ticket/unique-rules/"), { results: uniqueRules });
  client.setQueryData(key("numbering-rules", "entities/ticket/numbering-rules/"), { results: numberingRules });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <EntityRules code="ticket" />
    </QueryClientProvider>
  );
  client.clear();
  return html;
}

describe("data rules designer", () => {
  it("separates existing rules from creation and shows their current behavior", () => {
    const html = renderRules(
      [{ id: "unique-1", title: "شناسه مشتری", fields: ["national_id"], mode: "warn", is_active: false }],
      [{ id: "number-1", field: "contract_number", title: "شماره قرارداد", next: "CN-005" }]
    );
    expect(html).toContain("قواعد موجود");
    expect(html).toContain("قاعده جدید");
    expect(html).toContain("کد ملی");
    expect(html).toContain("غیرفعال");
    expect(html).toContain("فقط هشدار نمایش داده می‌شود");
    expect(html).toContain("شماره بعدی:");
    expect(html).toContain("CN-005");
  });

  it("guides users when no unique or numbering rule exists", () => {
    const html = renderRules([], []);
    expect(html).toContain("هنوز قاعده‌ای تعریف نشده است.");
    expect(html).toContain("هنوز ستون شماره‌گذاری تعریف نشده است.");
    expect(html).toContain("پیش‌نمایش شماره‌دهی");
  });
});
