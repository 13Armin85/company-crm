import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { SchemaDrivenForm } from "@plane/ui";
import type { EntityFormSchema, SchemaField } from "@plane/ui";
import { useUIStore } from "../store";
import { DeletePreviewContent } from "./delete-preview";
import type { DeletePreview } from "./delete-preview";
import { RelatedRecords, RelatedSection } from "./related-records";
import { RelationSettings } from "./relation-settings";
import { RelationFieldExtras, alignEntries, missingLinkData } from "./relation-link-data";
import type { LinkField } from "./relation-link-data";
import { ColumnEditor, sortable } from "./view-controls";
import type { ViewDefinition, ViewField } from "./view-types";

const state = vi.hoisted(() => ({ fields: [] as unknown[] }));

vi.mock("../api", async () => ({
  ...(await vi.importActual<typeof import("../api")>("../api")),
  useWorkspaceAccess: () => ({ data: { can: () => true } }),
}));
vi.mock("./api", async () => ({
  ...(await vi.importActual<typeof import("./api")>("./api")),
  useEngineSchema: () => ({ data: { fields: state.fields } }),
}));

const slug = "";
const key = (name: string, path: string) => ["entity-engine", slug, name, path];

function render(element: ReactElement, seed: (client: QueryClient) => void = () => {}) {
  const client = new QueryClient();
  useUIStore.setState({ workspaceSlug: slug });
  seed(client);
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>{element}</MemoryRouter>
    </QueryClientProvider>
  );
  client.clear();
  return html;
}

const quantity: LinkField = { code: "quantity", title: "تعداد", kind: "integer", config: { required: true, min: 1 } };
const role: LinkField = { code: "role", title: "نقش", kind: "select", lookup: "contact-role", config: {} };

function relationField(multiple: boolean, link_fields: LinkField[] = []): SchemaField {
  return {
    id: multiple ? "products" : "customer",
    code: multiple ? "products" : "customer",
    title: multiple ? "محصولات" : "مشتری",
    kind: "relation",
    relation_entity: multiple ? "product" : "customer",
    config: { multiple, relation_id: "relation-1", link_fields },
    binding: { field: multiple ? "products" : "customer" },
    is_active: true,
  } as SchemaField;
}

describe("relation settings", () => {
  const base = {
    left_entity: "customer",
    right_entity: "contract",
    left_title: "قراردادها",
    right_title: "مشتری",
    left_required: false,
    right_required: false,
    link_count: 0,
  };
  function renderSettings(rows: unknown[]) {
    return render(<RelationSettings entityCode="customer" />, (client) => {
      client.setQueryData(key("catalog", "catalog/"), {
        entities: [
          { id: "customer-id", code: "customer", title: "مشتری" },
          { id: "contract-id", code: "contract", title: "قرارداد" },
          { id: "ticket-id", code: "ticket", title: "تیکت" },
        ],
      });
      client.setQueryData(key("relations", "relations/"), { results: rows });
      client.setQueryData(key("lookup-path", "entities/customer/view-schema/?path="), { fields: [] });
      client.setQueryData(key("lookups", "definitions/lookups/"), []);
    });
  }

  it.each([
    ["one_to_one", "یک به یک"],
    ["one_to_many", "یک به چند"],
    ["many_to_one", "چند به یک"],
    ["many_to_many", "چند به چند"],
  ])("lists a %s relation with its cardinality", (kind, title) => {
    const html = renderSettings([{ ...base, id: kind, kind, on_delete: "block" }]);
    expect(html).toContain(title);
    expect(html).toContain("هنگام حذف: مسدودسازی");
  });

  it("shows soft deactivation, duplicates and link fields of a relation", () => {
    const html = renderSettings([
      {
        ...base,
        id: "r",
        kind: "many_to_many",
        on_delete: "soft_deactivate",
        allow_duplicates: true,
        link_fields: [quantity, role],
      },
    ]);
    expect(html).toContain("هنگام حذف: غیرفعال‌سازی نرم");
    expect(html).toContain("اتصال تکراری مجاز");
    expect(html).toContain("فیلدهای ارتباط: تعداد، نقش");
  });

  it("offers duplicates and relation fields in the creation form, never a cascade", () => {
    const html = renderSettings([]);
    expect(html).toContain("امکان تکرار");
    expect(html).toContain("فیلدهای روی خود ارتباط");
    expect(html).toContain("افزودن فیلد ارتباط");
    expect(html).not.toContain("cascade");
    expect(html).not.toContain("حذف آبشاری");
  });
});

describe("relation fields in forms", () => {
  const schema = (field: SchemaField): EntityFormSchema => ({
    entity: "ticket",
    title: "تیکت",
    schema_version: 1,
    fields: [field],
    layout: { tabs: [], sections: [{ id: "main", columns: 1, bindings: [{ field: field.code }] }] },
  });
  const loadOptions = async () => ({ results: [], count: 0 });

  it("renders a single searchable select for the one side and a multi selector for the many side", () => {
    const single = renderToStaticMarkup(
      <SchemaDrivenForm
        schema={schema(relationField(false))}
        values={{}}
        onChange={() => {}}
        loadOptions={loadOptions}
      />
    );
    const multiple = renderToStaticMarkup(
      <SchemaDrivenForm
        schema={schema(relationField(true))}
        values={{ products: [] }}
        onChange={() => {}}
        loadOptions={loadOptions}
      />
    );
    expect(single).toContain("مشتری");
    expect(multiple).toContain("محصولات");
    expect(single).not.toEqual(multiple.replace("محصولات", "مشتری"));
  });

  it("shows quick create only with create permission on the target table", () => {
    const field = relationField(false);
    const props = { field, entries: [], onChange: () => {}, onCreate: () => {} };
    expect(render(<RelationFieldExtras {...props} canCreate />)).toContain("ساخت رکورد جدید برای «مشتری»");
    expect(render(<RelationFieldExtras {...props} canCreate={false} />)).not.toContain("ساخت رکورد جدید");
  });

  it("asks for link data next to every selected record", () => {
    const field = relationField(true, [quantity, role]);
    const entries = alignEntries(["p1", "p2"], [{ id: "p1", data: { quantity: 2 } }]);
    expect(entries).toEqual([
      { id: "p1", data: { quantity: 2 } },
      { id: "p2", data: {} },
    ]);
    const html = render(
      <RelationFieldExtras field={field} entries={entries} canCreate={false} onChange={() => {}} onCreate={() => {}} />,
      (client) => {
        client.setQueryData(key("record", "entities/product/records/p1/"), { title: "کالای اول" });
        client.setQueryData(key("lookups", "definitions/lookups/"), [
          { id: "cat", code: "contact-role", title: "نقش", is_active: true },
        ]);
        client.setQueryData(key("values", "definitions/values/"), [
          { id: "v1", category: "cat", code: "owner", title: "مالک", is_active: true },
        ]);
      }
    );
    expect(html).toContain("اطلاعات ارتباط «محصولات»");
    expect(html).toContain("کالای اول");
    expect(html).toContain("تعداد *");
    expect(html).toContain("مالک");
    expect(missingLinkData([quantity], entries)).toBe("«تعداد» برای هر رکورد مرتبط الزامی است.");
    expect(missingLinkData([quantity], [{ id: "p1", data: { quantity: 1 } }])).toBe("");
  });
});

describe("related records", () => {
  it("shows the reverse side of a relation on the target record", () => {
    state.fields = [
      {
        code: "tickets",
        title: "تیکت‌های مرتبط",
        kind: "relation",
        config: { multiple: true },
        relation_entity: "ticket",
      },
    ];
    expect(render(<RelatedRecords code="customer" id="c1" />)).toContain("تیکت‌های مرتبط");
  });

  it("lists link data, marks inactive records and hides creation without permission", () => {
    const field = relationField(true, [quantity, role]);
    const path = "entities/order/records/o1/related/products/?page=1&page_size=10";
    const html = render(<RelatedSection code="order" id="o1" field={field} defaultOpen />, (client) => {
      client.setQueryData(key("record", "entities/order/records/o1/"), { can_edit: true, revision: 1 });
      client.setQueryData(key("related-records", path), {
        entity: "product",
        count: 1,
        results: [{ id: "p1", title: "کالا", number: "P-1", values: {}, is_active: false }],
        labels: {},
        can_create: false,
        link_fields: [quantity, role],
        link_data: { p1: [{ quantity: 4, role: "v1" }] },
        link_labels: { v1: "مالک" },
      });
    });
    expect(html).toContain("غیرفعال");
    expect(html).toContain("۴");
    expect(html).toContain("مالک");
    expect(html).toContain("جدا کردن");
    expect(html).not.toContain("افزودن رکورد مرتبط");
  });
});

describe("delete preview dialog", () => {
  const preview = (behavior: "block" | "detach" | "soft_deactivate"): DeletePreview => ({
    impacts: [
      {
        relation_id: "r",
        relation_title: "تیکت‌ها",
        opposite_entity: "ticket",
        opposite_entity_title: "تیکت",
        link_count: 3,
        behavior,
        blocked: behavior === "block",
      },
    ],
    blocked: behavior === "block",
    result: behavior === "block" ? "blocked" : behavior === "detach" ? "delete" : "deactivate",
  });

  it.each([
    ["block", "مسدود", "این عملیات مسدود است"],
    ["detach", "پیوندها جدا می‌شوند", "رکورد حذف می‌شود"],
    ["soft_deactivate", "رکورد غیرفعال می‌شود", "به‌جای حذف غیرفعال می‌شود"],
  ] as const)("explains the %s rule with the affected link count", (behavior, rule, result) => {
    const html = renderToStaticMarkup(<DeletePreviewContent preview={preview(behavior)} />);
    expect(html).toContain("تیکت‌ها");
    expect(html).toContain("۳");
    expect(html).toContain(rule);
    expect(html).toContain(result);
  });
});

describe("view controls on relation fields", () => {
  const field = (code: string, multiple: boolean): ViewField => ({
    code,
    field_code: code,
    options_entity: "deal",
    title: code === "customer" ? "مشتری" : "محصولات",
    kind: "relation",
    config: { multiple },
    relation_entity: "customer",
    operators: ["eq", "in", "not_in", "empty", "not_empty", ...(multiple ? ["contains"] : [])],
    filterable: true,
    table_visible: true,
    searchable: true,
  });
  const definition: ViewDefinition = {
    version: 1,
    type: "table",
    columns: [{ field: "customer", width: 200 }],
    summary: [],
    sort: [],
    filter: null,
    group: null,
  };

  it("sorts only on the one side of a relation", () => {
    expect(sortable(field("customer", false))).toBe(true);
    expect(sortable(field("products", true))).toBe(false);
    const html = renderToStaticMarkup(
      <ColumnEditor
        value={definition}
        fields={[field("customer", false), field("products", true)]}
        onChange={() => {}}
        onLoadPath={async () => {}}
      />
    );
    expect(html).toContain("مرتب‌سازی جدول من بر اساس");
  });
});
