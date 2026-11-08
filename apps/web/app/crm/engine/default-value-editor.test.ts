import { describe, expect, it } from "vitest";
import { automaticDefaultMode } from "./default-value-editor";

describe("automatic defaults in form bindings", () => {
  it("shows the inherited dynamic default until this form overrides it", () => {
    const config = { default_dynamic: "today" as const };
    expect(automaticDefaultMode({ field: "due" }, config)).toBe("today");
    expect(automaticDefaultMode({ field: "due", default: null }, config)).toBe("");
    expect(automaticDefaultMode({ field: "due", default: { dynamic: "now" } }, config)).toBe("now");
  });

  it("uses the field's dynamic object when no form override exists", () => {
    expect(automaticDefaultMode({ field: "owner" }, { default: { dynamic: "current_user" } })).toBe("current_user");
  });
});
