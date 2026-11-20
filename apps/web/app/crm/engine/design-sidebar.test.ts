import { describe, expect, it } from "vitest";
import { visibleDesignPages } from "./design-sidebar";

describe("design workspace sidebar", () => {
  const pages = [{ code: "users" }, { code: "roles" }, { code: "leave-requests" }];

  it("shows every designable page until the sidebar is customized", () => {
    expect(visibleDesignPages(pages, null)).toEqual(pages);
  });

  it("keeps the selected pages in their saved order and ignores removed pages", () => {
    expect(visibleDesignPages(pages, ["roles", "users", "missing"])).toEqual([pages[1], pages[0]]);
    expect(visibleDesignPages(pages, [])).toEqual([]);
  });
});
