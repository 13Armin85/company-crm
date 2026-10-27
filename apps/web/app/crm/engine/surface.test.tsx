import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { configureNativeFields, SurfaceTable } from "./surface";
import type { NativeField, SurfaceSchema } from "./surface";
import { createTableTabId, reorderColumn } from "./page-studio";

const native: NativeField = {
  code: "description",
  title: "توضیح",
  kind: "long_text",
  required: false,
  locked: false,
  aliases: [],
};

describe("native form customization", () => {
  it("creates distinct valid table tab identifiers on plain HTTP without randomUUID", () => {
    vi.stubGlobal("crypto", { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    try {
      const first = createTableTabId(),
        second = createTableTabId();
      expect(first).toMatch(/^[a-zA-Z0-9_-]{1,80}$/);
      expect(second).not.toBe(first);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("removes a hidden input while preserving unrelated controls", () => {
    const html = renderToStaticMarkup(
      <>
        {configureNativeFields(
          <div>
            <label>
              <span>توضیح</span>
              <textarea defaultValue="old" />
            </label>
            <button type="submit">ذخیره</button>
          </div>,
          [{ ...native, hidden: true }]
        )}
      </>
    );
    expect(html).not.toContain("textarea");
    expect(html).toContain("ذخیره");
  });
  it("applies and clears required on the original native input", () => {
    const content = (
      <label>
        <span>توضیح</span>
        <textarea required />
      </label>
    );
    expect(renderToStaticMarkup(<>{configureNativeFields(content, [native])}</>)).not.toContain("required");
    expect(renderToStaticMarkup(<>{configureNativeFields(content, [{ ...native, required: true }])}</>)).toContain(
      'required=""'
    );
  });
  it("keeps the column order immutable when moving a column", () => {
    const columns = ["native:نام نقش", "field:score", "native:توضیح"];
    expect(reorderColumn(columns, 1, -1)).toEqual(["field:score", "native:نام نقش", "native:توضیح"]);
    expect(columns).toEqual(["native:نام نقش", "field:score", "native:توضیح"]);
    expect(reorderColumn(columns, 0, -1)).toEqual(columns);
  });
  it("uses the backend column order and extra values in an existing table", () => {
    const slug = "",
      id = "a13e6fae-6e53-4ff2-bdf4-ed2cec808bb8";
    const client = new QueryClient();
    const data: SurfaceSchema = {
      code: "roles",
      title: "نقش‌ها",
      path: "/roles",
      engine: null,
      revision: 1,
      native_fields: [],
      native_columns: ["نام نقش", "توضیح"],
      engine_fields: [],
      definition: { native: {}, fields: [{ field: "score" }], columns: ["field:score", "native:نام نقش"] },
      schema: {
        entity: "roles",
        title: "اضافی",
        schema_version: 1,
        layout: { tabs: [], sections: [] },
        fields: [
          {
            id: "score",
            code: "score",
            title: "امتیاز",
            kind: "integer",
            config: {},
            binding: { field: "score" },
            is_active: true,
          },
        ],
      },
    };
    client.setQueryData(["entity-engine", slug, "surface", "surfaces/roles/"], data);
    client.setQueryData(["entity-engine", slug, "surface-values", "roles", id], { [id]: { score: 7 } });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <SurfaceTable code="roles">
            <thead>
              <tr>
                <th>نام نقش</th>
                <th>توضیح</th>
              </tr>
            </thead>
            <tbody>
              <tr key={id}>
                <td>پشتیبانی</td>
                <td>متن مخفی جدول</td>
              </tr>
            </tbody>
          </SurfaceTable>
        </MemoryRouter>
      </QueryClientProvider>
    );
    expect(html).toContain("<td>7</td>");
    expect(html.indexOf("امتیاز")).toBeLessThan(html.indexOf("نام نقش"));
    expect(html).not.toContain("متن مخفی جدول");
    client.clear();
  });
});
