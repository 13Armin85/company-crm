import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { EntityRules } from "./governance-settings";
import { useUIStore } from "../store";

vi.mock("@plane/ui", async () => ({
  ...(await vi.importActual<typeof import("@plane/ui")>("@plane/ui")),
  SearchableSelect: ({
    label,
    options,
    value,
  }: {
    label: string;
    options: { id: string; title: string }[];
    value: string;
  }) => (
    <label>
      {label}
      <select value={value} onChange={() => {}}>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.title}
          </option>
        ))}
      </select>
    </label>
  ),
}));

vi.mock("../api", async () => ({
  ...(await vi.importActual<typeof import("../api")>("../api")),
  useWorkspaceAccess: () => ({ data: { can: () => true } }),
}));

function renderRules(
  uniqueRules: unknown[],
  numberingRules: unknown[],
  candidates: { code: string; title: string }[] = []
) {
  const client = new QueryClient();
  const slug = "";
  useUIStore.setState({ workspaceSlug: slug });
  const key = (name: string, path: string) => ["entity-engine", slug, name, path];
  client.setQueryData(key("catalog", "catalog/"), { entities: [] });
  client.setQueryData(key("view-schema", "entities/ticket/view-schema/"), {
    fields: [{ code: "national_id", title: "کد ملی" }],
  });
  client.setQueryData(key("unique-rules", "entities/ticket/unique-rules/"), { results: uniqueRules });
  client.setQueryData(key("numbering-rules", "entities/ticket/numbering-rules/"), {
    results: numberingRules,
    candidates,
  });
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
    expect(html).toContain("ستون تازه‌ای برای شماره‌گذاری ساخته می‌شود");
    expect(html).toContain("نام ستون جدید");
    expect(html).not.toContain("کدام ستون شماره خودکار بگیرد؟");
  });

  it("offers the current form's empty columns without requiring field-library access", () => {
    const html = renderRules([], [], [{ code: "contract_no", title: "شماره قرارداد" }]);
    expect(html).toContain("شماره قرارداد");
    expect(html).toContain("کدام ستون شماره خودکار بگیرد؟");
    expect(html).not.toContain("ستون متن کوتاه خالی در این فرم وجود ندارد");
  });
});
