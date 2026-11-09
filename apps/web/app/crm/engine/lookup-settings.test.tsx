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

function render(element: ReactNode, empty = false) {
  const client = new QueryClient();
  useUIStore.setState({ workspaceSlug: "" });
  const cache = (kind: string, rows: unknown[]) =>
    client.setQueryData(["entity-engine", "", kind, `definitions/${kind}/`], rows);
  cache(
    "lookups",
    empty
      ? []
      : [
          { id: "cities", code: "cities", title: "شهرها", is_active: true },
          { id: "countries", code: "countries", title: "کشورها", is_active: true },
        ]
  );
  cache("values", [
    { id: "iran", category: "countries", code: "iran", title: "ایران", position: 0, is_active: true },
    {
      id: "tehran",
      category: "cities",
      code: "tehran",
      title: "تهران",
      parent: "iran",
      position: 0,
      is_active: true,
      is_default: true,
    },
    { id: "shiraz", category: "cities", code: "shiraz", title: "شیراز", position: 1, is_active: false },
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
  it("shows searchable lists, option status, parent, and edit controls", () => {
    const html = render(<LookupSettings />);
    expect(html).toContain("ساخت لیست جدید");
    expect(html).toContain("افزودن گزینه به این لیست");
    expect(html).toContain("ایران");
    expect(html).toContain("مقدار والد");
    expect(html).toContain("جست‌وجوی لیست");
    expect(html).toContain("جست‌وجوی گزینه در شهرها");
    expect(html).toContain("والد: ایران");
    expect(html).toContain("پیش‌فرض");
    expect(html).toContain("غیرفعال");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="ویرایش گزینهٔ تهران"');
  });

  it("only offers single-choice list fields as dependency parents", () => {
    const html = render(
      <DefinitionEditor
        kind="fields"
        row={{ id: "city", code: "city", title: "شهر", kind: "select", lookup: "cities", config: {} }}
        onClose={() => {}}
      />
    );
    expect(html).toContain("منبع گزینه‌ها (لیست پایه)");
    expect(html).toContain("نام لیست جدید");
    expect(html).toContain("گزینه‌های «شهرها»");
    expect(html).toContain("گزینه‌های جدید (هر گزینه در یک خط)");
    expect(html).toContain("پیش‌نمایش ورودی");
    expect(html).not.toContain("ساخت یا ویرایش لیست و گزینه‌ها");
    expect(html).toContain('<option value="country">کشور</option>');
    expect(html).not.toContain('<option value="description">');
    expect(html).not.toContain('<option value="tags">');
  });

  it("guides the user to create the first list when none exists", () => {
    const html = render(<LookupSettings />, true);
    expect(html).toContain("اولین لیست انتخابی را بسازید");
    expect(html).toContain("ساخت لیست جدید");
    expect(html).not.toContain("افزودن گزینه به این لیست");
  });
});
