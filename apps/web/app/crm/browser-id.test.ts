import { describe, expect, it, vi } from "vitest";
import { browserId } from "./browser-id";

describe("browser IDs on HTTP deployments", () => {
  it("creates a UUID using getRandomValues without randomUUID", () => {
    const original = globalThis.crypto;
    const getRandomValues = vi.fn((bytes: Uint8Array) => original.getRandomValues(bytes));
    vi.stubGlobal("crypto", { getRandomValues });
    try {
      expect(browserId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(getRandomValues).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
