import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SchemaDrivenForm } from "@plane/ui";
import type { EntityFormSchema, FormLayoutSchema } from "@plane/ui";
import { formChangeSummary, formDesignState, moveBindingStep } from "./form-designer";

const layout: FormLayoutSchema = {
  tabs: [],
  sections: [
    {
      id: "main",
      title: "اطلاعات",
      columns: 1,
      bindings: [{ field: "name", required: true }, { field: "phone" }, { field: "email" }],
    },
    { id: "other", title: "بیشتر", columns: 1, bindings: [] },
  ],
};

describe("مسیر سادهٔ طراحی فرم", () => {
  it("moves a binding with buttons while preserving its settings and the source layout", () => {
    const moved = moveBindingStep(layout, "main", "name", 1);
    expect(moved.sections[0].bindings.map((binding) => binding.field)).toEqual(["phone", "name", "email"]);
    expect(moved.sections[0].bindings[1].required).toBe(true);
    expect(layout.sections[0].bindings.map((binding) => binding.field)).toEqual(["name", "phone", "email"]);
    expect(moveBindingStep(layout, "main", "name", -1)).toBe(layout);
    expect(moveBindingStep(layout, "main", "email", 1)).toBe(layout);
  });

  it("names added and removed inputs before applying to all users", () => {
    const next: FormLayoutSchema = {
      ...layout,
      sections: [{ ...layout.sections[0], bindings: [{ field: "name" }, { field: "email" }, { field: "city" }] }],
    };
    const summary = formChangeSummary(next, layout, [
      { code: "city", title: "شهر" },
      { code: "phone", title: "تلفن" },
    ]);
    expect(summary).toContain("افزوده: شهر");
    expect(summary).toContain("برداشته: تلفن");
    expect(summary).toContain("ترتیب ورودی‌ها");
  });

  it("distinguishes local edits, a saved draft, and an applied form", () => {
    expect(formDesignState({ tabs: [], sections: [] }, { tabs: [], sections: [] }, null)).toBe("ذخیره‌نشده");
    const edited = moveBindingStep(layout, "main", "name", 1);
    expect(formDesignState(edited, layout, layout)).toBe("ذخیره‌نشده");
    expect(formDesignState(edited, edited, layout)).toBe("پیش‌نویس ذخیره شد");
    expect(formDesignState(edited, edited, edited)).toBe("روی فرم اعمال شد");
  });

  it("announces a preview validation error and connects it to the input", () => {
    const schema: EntityFormSchema = {
      entity: "example",
      title: "نمونه",
      schema_version: 1,
      layout: { tabs: [], sections: [{ id: "main", columns: 1, bindings: [{ field: "name" }] }] },
      fields: [
        {
          id: "name",
          code: "name",
          title: "نام",
          kind: "short_text",
          config: { required: true },
          binding: { field: "name" },
          is_active: true,
        },
      ],
    };
    const html = renderToStaticMarkup(
      <SchemaDrivenForm schema={schema} values={{}} errors={{ name: "نام لازم است" }} onChange={() => {}} />
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("نام لازم است");
    expect(html).toMatch(/aria-describedby="[^"]+-error"/);
  });
});
