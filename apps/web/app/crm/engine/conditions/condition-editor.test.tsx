import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { Condition } from "@plane/ui";
import type { FieldDefinition, LookupOptionDefinition } from "../api";
import { ConditionEditor } from "./condition-editor";

const definition = (code: string, title: string, kind: FieldDefinition["kind"], lookup: string | null = null) =>
  ({ id: code, code, title, kind, lookup, config: {}, is_active: true }) as FieldDefinition;
const fields = [definition("status", "وضعیت", "select", "statuses"), definition("amount", "مبلغ", "money")];
const lookupValues = [
  { id: "s1", category: "statuses", code: "active", title: "فعال", is_active: true },
] as LookupOptionDefinition[];

function render(value: Condition | null, editorFields = fields) {
  const client = new QueryClient();
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ConditionEditor
        label="فقط در شرایط خاص نمایش داده شود"
        description="بدون شرط، این ورودی همیشه دیده می‌شود."
        value={value}
        onChange={() => {}}
        fields={editorFields}
        lookupValues={lookupValues}
      />
    </QueryClientProvider>
  );
  client.clear();
  return html;
}

describe("condition editor", () => {
  it("explains what happens without a condition and offers to add one", () => {
    const html = render(null);
    expect(html).toContain("بدون شرط، این ورودی همیشه دیده می‌شود.");
    expect(html).toContain("افزودن شرط");
  });

  it("says why no condition can be added when there is nothing to compare", () => {
    expect(render(null, [])).toContain("ورودی دیگری برای مقایسه وجود ندارد");
  });

  it("shows a readable summary for a complete rule", () => {
    const html = render({
      op: "or",
      rules: [
        { field: "status", op: "eq", value: "s1" },
        { field: "amount", op: "gt", value: 500 },
      ],
    });
    expect(html).toContain("«وضعیت» برابر باشد با «فعال» یا «مبلغ» بیشتر از ۵۰۰");
    expect(html).toContain("دست‌کم یکی برقرار باشد");
    expect(html).not.toContain("کامل نیست");
  });

  it("flags an incomplete condition before saving", () => {
    const html = render({ field: "amount", op: "gt", value: "" });
    expect(html).toContain("مقدار مقایسه را مشخص کنید.");
    expect(html).toContain("تا کامل نشود ذخیره انجام نمی‌شود");
  });
});
