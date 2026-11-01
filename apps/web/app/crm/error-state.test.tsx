import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ERROR_NOTICE_EVENT, notifyError } from "@plane/ui";
import { ErrorNotice, ErrorState } from "./error-state";
import { useUIStore } from "./store";

describe("toast-only errors", () => {
  afterEach(() => useUIStore.setState({ toasts: [] }));

  it("never renders error text inside the page", () => {
    expect(renderToStaticMarkup(<ErrorNotice message="ذخیره انجام نشد." />)).toBe("");
    const html = renderToStaticMarkup(<ErrorState message="دریافت کارها انجام نشد." />);
    expect(html).not.toContain("دریافت کارها انجام نشد.");
    expect(html).not.toContain('role="alert"');
    expect(html).toContain("تلاش دوباره");
  });

  it("broadcasts errors for the toast region", () => {
    vi.stubGlobal("window", new EventTarget());
    const listener = vi.fn();
    window.addEventListener(ERROR_NOTICE_EVENT, listener);
    notifyError("خطای آزمایشی");
    expect((listener.mock.calls[0][0] as CustomEvent<string>).detail).toBe("خطای آزمایشی");
    vi.unstubAllGlobals();
  });

  it("does not stack the same error twice", () => {
    vi.stubGlobal("window", { setTimeout: () => 0 });
    const { toast } = useUIStore.getState();
    toast("ذخیره انجام نشد.", "error");
    toast("ذخیره انجام نشد.", "error");
    expect(useUIStore.getState().toasts).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});
