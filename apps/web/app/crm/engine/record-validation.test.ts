import { describe, expect, it } from "vitest";
import type { EntityFormSchema } from "@plane/ui";
import { validateRecordEdit } from "./record-validation";

const schema = {
  fields: [
    { code: "municipality", kind: "relation", is_active: true, config: { required: true } },
    { code: "status", kind: "short_text", is_active: true, config: { required: true } },
  ],
  layout: { tabs: [], sections: [] },
} as unknown as EntityFormSchema;

describe("editing an existing work record", () => {
  it("accepts a status change when a historical required relation is empty and unchanged", () => {
    expect(
      validateRecordEdit(schema, { municipality: null, status: "done" }, { municipality: null, status: "todo" })
    ).toEqual({});
  });

  it("still requires the relation when creating a work record", () => {
    expect(validateRecordEdit(schema, { municipality: null, status: "todo" })).toHaveProperty("municipality");
  });
});
