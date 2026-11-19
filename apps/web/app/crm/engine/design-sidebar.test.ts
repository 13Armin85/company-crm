import { afterEach, describe, expect, it, vi } from "vitest";
import { readDesignSidebar, saveDesignSidebar, visibleDesignPages } from "./design-sidebar";

afterEach(() => vi.unstubAllGlobals());

describe("design workspace sidebar", () => {
  const pages = [{ code: "users" }, { code: "roles" }, { code: "leave-requests" }];

  it("shows every designable page until the sidebar is customized", () => {
    expect(visibleDesignPages(pages, null)).toEqual(pages);
  });

  it("keeps the selected pages in their saved order and ignores removed pages", () => {
    expect(visibleDesignPages(pages, ["roles", "users", "missing"])).toEqual([pages[1], pages[0]]);
    expect(visibleDesignPages(pages, [])).toEqual([]);
  });

  it("saves each workspace selection independently and ignores invalid storage", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    saveDesignSidebar("first", ["roles", "roles", "users"]);
    expect(readDesignSidebar("first")).toEqual(["roles", "users"]);
    expect(readDesignSidebar("second")).toBeNull();
    values.set("crm-design-sidebar:second", "invalid-json");
    expect(readDesignSidebar("second")).toBeNull();
  });
});
