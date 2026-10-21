import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { Breadcrumb } from "../components";
import type { EntityFormSchema } from "@plane/ui";
import { SchemaDrivenForm } from "@plane/ui";
import { entityDisplaySchema, entityDisplayTitle } from "./presentation";

describe("Persian entity presentation", () => {
  it("displays historical browser fixture names without their generated suffix", () => {
    expect(entityDisplayTitle("آزمایش مرورگر mvf74zdd")).toBe("آزمایش مرورگر");
    expect(entityDisplayTitle("نماهای مرورگر mvfntauv")).toBe("نماهای مرورگر");
    expect(entityDisplayTitle("مبلغ مرورگر mvfntauv")).toBe("مبلغ مرورگر");
  });
  it("preserves real business titles, including mixed language and numbers", () => {
    for (const title of ["قرارداد ERP", "آزمایش ۱۴۰۵", "Customer records", "نماهای مرورگر", "فروش mvfntauv"])
      expect(entityDisplayTitle(title)).toBe(title);
  });
  it("uses Persian titles for layout overrides as well as field definitions without changing stored identifiers", () => {
    const title = "مرحله مرورگر mvfntauv";
    const schema: EntityFormSchema = {
      entity: "view-browser-mvfntauv",
      title: "نماهای مرورگر mvfntauv",
      schema_version: 1,
      fields: [
        {
          id: "phase",
          code: "phase",
          title,
          kind: "short_text",
          config: {},
          binding: { field: "phase" },
          is_active: true,
        },
      ],
      layout: {
        tabs: [{ id: "main", title: "نماهای مرورگر mvfntauv" }],
        sections: [{ id: "main", title: "آزمایش مرورگر mvfntauv", columns: 2, bindings: [{ field: "phase", title }] }],
      },
    };
    const displayed = entityDisplaySchema(schema);
    const markup = renderToStaticMarkup(
      <SchemaDrivenForm schema={displayed} values={{ phase: "مقدار ثبت‌شده" }} onChange={() => {}} />
    );
    expect(markup).toContain("مقدار ثبت‌شده");
    expect(markup).toContain("مرحله مرورگر");
    expect(markup).not.toContain("mvfntauv");
    expect(displayed.entity).toBe(schema.entity);
    expect(displayed.layout.sections[0].bindings[0].field).toBe("phase");
    expect(schema.fields[0].title).toBe(title);
    expect(schema.layout.sections[0].bindings[0].title).toBe(title);
  });
  it.each(["/edit/task/record-id", "/edit/ticket/record-id", "/edit/project/record-id", "/edit/leave/record-id"])(
    "keeps native form navigation readable at %s",
    (path) => {
      const markup = renderToStaticMarkup(
        <MemoryRouter initialEntries={[path]}>
          <Breadcrumb />
        </MemoryRouter>
      );
      expect(markup).toContain("فرم");
      expect(markup).not.toContain("موجودیت");
      expect(markup).not.toContain("record-id");
    }
  );
});
