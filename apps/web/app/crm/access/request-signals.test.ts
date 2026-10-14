import { afterEach, describe, expect, it, vi } from "vitest";
import { combineRequestSignals } from "./request-signals";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("request cancellation without AbortSignal.any", () => {
  const fallback = () => vi.stubGlobal("AbortSignal", Object.assign(Object.create(AbortSignal), { any: undefined }));

  it.each([0, 1])("cancels when signal %i aborts and releases both listeners", (index) => {
    fallback();
    const controllers = [new AbortController(), new AbortController()];
    const remove = controllers.map((controller) => vi.spyOn(controller.signal, "removeEventListener"));
    const combined = combineRequestSignals(controllers.map((controller) => controller.signal));
    expect(combined.signal.aborted).toBe(false);
    controllers[index].abort("session changed");
    expect(combined.signal.aborted).toBe(true);
    expect(combined.signal.reason).toBe("session changed");
    remove.forEach((spy) => expect(spy).toHaveBeenCalledOnce());
  });

  it("starts canceled when a supplied signal already aborted", () => {
    fallback();
    const request = new AbortController();
    const session = new AbortController();
    session.abort();
    const remove = vi.spyOn(request.signal, "removeEventListener");
    const combined = combineRequestSignals([request.signal, session.signal]);
    expect(combined.signal.aborted).toBe(true);
    expect(remove).toHaveBeenCalledOnce();
  });

  it("releases listeners when a request completes without canceling it", () => {
    fallback();
    const request = new AbortController();
    const session = new AbortController();
    const combined = combineRequestSignals([request.signal, session.signal]);
    combined.dispose();
    session.abort();
    expect(combined.signal.aborted).toBe(false);
  });
});
