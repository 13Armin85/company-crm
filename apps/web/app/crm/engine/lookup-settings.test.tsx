import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
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
  useOrganizationPermissions: () => ({ data: [] }),
}));

import { DefinitionEditor } from "./definition-editor";
import { LookupSettings } from "./lookup-settings";

function render(element: ReactNode) {
  const client = new QueryClient();
  useUIStore.setState({ workspaceSlug: "" });
  const cache = (kind: string, rows: unknown[]) =>
    client.setQueryData(["entity-engine", "", kind, `definitions/${kind}/`], rows);
  cache("lookups", [
    { id: "countries", code: "countries", title: "کشورها", is_active: true },
    { id: "cities", code: "cities", title: "شهرها", is_active: true },
  ]);
  cache("values", [
    { id: "iran", category: "countries", code: "iran", title: "ایران", position: 0, is_active: true },
    { id: "tehran", category: "cities", code: "tehran", title: "تهران", parent: "iran", position: 0, is_active: true },
  ]);
  cache("fields", [
    { id: "country", code: "country", title: "کشور", kind: "select", lookup: "countries", is_active: true },
    { id: "description", code: "description", title: "توضیح", kind: "short_text", is_active: true },
    { id: "tags", code: "tags", title: "برچسب‌ها", kind: "multi_select", lookup: "countries", is_active: true },
  ]);
  const html = renderToStaticMarkup(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
  client.clear();
  return html;
}

describe("choice lists in form design", () => {
  it("shows where options are added and how dependent options are linked", () => {
    const html = render(<LookupSettings />);
    expect(html).toContain("ساخت لیست جدید");
    expect(html).toContain("افزودن گزینه به این لیست");
    expect(html).toContain("ایران");
    expect(html).toContain("مقدار والد");
  });

  it("only offers single-choice list fields as dependency parents", () => {
    const html = render(
      <DefinitionEditor
        kind="fields"
        row={{ id: "city", code: "city", title: "شهر", kind: "select", lookup: "cities", config: {} }}
        onClose={() => {}}
        onManageLookups={() => {}}
      />
    );
    expect(html).toContain("منبع گزینه‌ها (لیست پایه)");
    expect(html).toContain("ساخت یا ویرایش لیست و گزینه‌ها");
    expect(html).toContain('<option value="country">کشور</option>');
    expect(html).not.toContain('<option value="description">');
    expect(html).not.toContain('<option value="tags">');
  });
});
