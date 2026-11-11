import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { useUIStore } from "../store";

vi.mock("@plane/ui", async () => ({
  ...(await vi.importActual<typeof import("@plane/ui")>("@plane/ui")),
  SearchableSelect: ({
    label,
    options,
    value,
    disabled,
  }: {
    label: string;
    options: { id: string; title: string }[];
    value: string;
    disabled?: boolean;
  }) => (
    <label>
      {label}
      <select value={value} disabled={disabled} onChange={() => {}}>
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
import { DesignWorkspace } from "./design-workspace";

vi.mock("./form-designer", () => ({ FormDesigner: () => <div>طراح فرم</div> }));

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
  it("keeps all list and option settings in the input form even when the field is used", () => {
    const html = render(
      <DefinitionEditor
        kind="fields"
        row={{
          id: "city",
          code: "city",
          title: "شهر",
          kind: "select",
          lookup: "cities",
          config: {},
          used_at: "2026-11-01",
        }}
        onClose={() => {}}
      />
    );
    expect(html).toContain("منبع گزینه‌ها (لیست پایه)");
    expect(html).not.toContain("نام لیست جدید");
    expect(html).toContain("گزینه‌های «شهرها»");
    expect(html).toContain("افزودن سریع گزینه‌ها (هر گزینه در یک خط)");
    expect(html).toContain("ساخت گزینه با تنظیمات کامل");
    expect(html).toContain("تنظیمات لیست «شهرها»");
    expect(html).toContain("توضیح لیست (اختیاری)");
    expect(html).toContain("ویرایش گزینهٔ تهران");
    expect(html).toContain("رنگ");
    expect(html).toContain("آیکون (اختیاری)");
    expect(html).toContain("جایگاه نمایش");
    expect(html).toContain("مقدار پیش‌فرض");
    expect(html).toContain("گزینه فعال است");
    expect(html).toContain("پیش‌نمایش ورودی");
    expect(html.indexOf("engine-inline-lookup")).toBeLessThan(html.indexOf("<fieldset disabled"));
    expect(html).not.toContain("فیلد والد برای محدود کردن گزینه‌ها");
    expect(html).not.toContain("مقدار والد");
  });

  it("allows a multi-choice field to create its first list in place", () => {
    const html = render(
      <DefinitionEditor
        kind="fields"
        row={{ title: "برچسب‌ها", kind: "multi_select", config: {} }}
        onClose={() => {}}
      />,
      true
    );
    expect(html).toContain("ساخت لیست جدید");
    expect(html).toContain("کد لیست (اختیاری)");
    expect(html).not.toContain("گزینه‌های «");
  });

  it("does not show a separate choice-list tab", () => {
    const client = new QueryClient();
    useUIStore.setState({ workspaceSlug: "" });
    client.setQueryData(["entity-engine", "", "catalog", "catalog/"], {
      entities: [{ id: "ticket", code: "ticket", title: "کارها", is_active: true, parent: null }],
      field_kinds: [],
    });
    client.setQueryData(["entity-engine", "", "fields", "definitions/fields/"], []);
    client.setQueryData(["entity-engine", "", "surfaces", "surfaces/"], { results: [] });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <DesignWorkspace />
        </MemoryRouter>
      </QueryClientProvider>
    );
    client.clear();
    expect(html).toContain('aria-label="انتخاب بخش"');
    expect(html).toContain("فرم و جدول کدام بخش را تنظیم می‌کنید؟");
    expect(html).not.toContain("لیست‌های انتخابی");
  });
});
