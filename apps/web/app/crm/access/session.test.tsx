import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { api, clearClientSession } from "../api";
import { useUIStore } from "../store";
import { LoginForm } from "../pages/auth";
import { PasswordInput } from "@plane/ui";
import {
  hidePrivateContent,
  revealPrivateContent,
  publishSessionEnd,
  subscribeToSessionEnd,
  sessionSignalKey,
} from "./session-events";

describe("CRM authentication", () => {
  it("verifies requests without AbortSignal.any and releases listeners on completion", async () => {
    vi.stubGlobal("AbortSignal", Object.assign(Object.create(AbortSignal), { any: undefined }));
    try {
      const request = new AbortController();
      const remove = vi.spyOn(request.signal, "removeEventListener");
      const response = await api.get("/api/users/me/", {
        signal: request.signal,
        adapter: async (config) => ({
          data: { id: "current-user" },
          status: 200,
          statusText: "OK",
          headers: {},
          config,
        }),
      });
      expect(response.data).toEqual({ id: "current-user" });
      expect(remove).toHaveBeenCalledOnce();
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  it("releases fallback listeners on a failed network request", async () => {
    vi.stubGlobal("AbortSignal", Object.assign(Object.create(AbortSignal), { any: undefined }));
    try {
      const request = new AbortController();
      const remove = vi.spyOn(request.signal, "removeEventListener");
      const failed = await api
        .get("/api/users/me/", {
          signal: request.signal,
          adapter: async (config) => {
            throw Object.assign(new Error("Network unavailable"), { config });
          },
        })
        .catch((error: unknown) => error);
      expect(failed).toBeInstanceOf(Error);
      expect(remove).toHaveBeenCalledOnce();
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  it("rejects a late response from the previous session even if its adapter ignores abort", async () => {
    const client = new QueryClient();
    let resolveResponse: ((value: unknown) => void) | undefined;
    let started: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const request = api.get("/api/test-delayed/", {
      adapter: (config) => {
        started?.();
        return new Promise((resolve) => {
          resolveResponse = (data) => resolve({ data, status: 200, statusText: "OK", headers: {}, config });
        });
      },
    });
    const rejected = expect(request).rejects.toMatchObject({ code: "ERR_CANCELED" });
    await ready;
    await clearClientSession(client);
    resolveResponse?.({ id: "previous-account" });
    await rejected;
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it("renders a login form with username support and no signup action", () => {
    const html = renderToStaticMarkup(<LoginForm csrf="csrf-test" />);
    expect(html).toContain('action="/auth/sign-in/"');
    expect(html).toContain('autoComplete="username"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).not.toContain("sign-up");
    expect(html).not.toContain("ثبت نام");
  });

  it("disables submission while CSRF is unavailable and exposes login errors", () => {
    const html = renderToStaticMarkup(<LoginForm csrf="" errorKey="AUTHENTICATION_FAILED_SIGN_IN" />);
    expect(html).toContain('disabled=""');
    expect(html).toContain('role="alert"');
    expect(html).toContain("نام کاربری یا رمز عبور اشتباه است.");
  });

  it("keeps unknown login failures and connection errors in Persian", () => {
    const html = renderToStaticMarkup(<LoginForm csrf="" errorKey="UNKNOWN_SERVER_ERROR" failed />);
    expect(html).toContain("ورود انجام نشد؛ دوباره تلاش کنید.");
    expect(html).toContain("اتصال به سرور برقرار نشد");
    expect(html).not.toContain("UNKNOWN_SERVER_ERROR");
  });

  it("cancels and removes all cached permissions and user data on logout", async () => {
    const client = new QueryClient();
    const cancel = vi.spyOn(client, "cancelQueries");
    const removeItem = vi.fn();
    vi.stubGlobal("localStorage", { removeItem });
    client.setQueryData(["current-user"], { id: "previous-user" });
    client.setQueryData(["workspace-access", "company"], { permissions: ["User.Delete"] });
    useUIStore.setState({ workspaceSlug: "company", createOpen: true, dirtyForms: ["identity"] });
    await clearClientSession(client);
    expect(cancel).toHaveBeenCalledOnce();
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(useUIStore.getState()).toMatchObject({ workspaceSlug: undefined, createOpen: false, dirtyForms: [] });
    expect(removeItem).toHaveBeenCalledWith("access_token");
    vi.unstubAllGlobals();
  });

  it("notifies this tab without persisting credentials", () => {
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("document", { documentElement: { dataset: {} } });
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { setItem });
    const ended = vi.fn();
    const cleanup = subscribeToSessionEnd(ended);
    publishSessionEnd();
    expect(ended).toHaveBeenCalledOnce();
    expect(setItem).toHaveBeenCalledWith(sessionSignalKey, expect.stringMatching(/^\d+:[\d.]+$/));
    expect(document.documentElement.dataset.crmSessionHidden).toBe("true");
    cleanup();
    vi.unstubAllGlobals();
  });

  it("hides another tab immediately on logout and cleans up its listeners", () => {
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("document", { documentElement: { dataset: {} } });
    const ended = vi.fn();
    const cleanup = subscribeToSessionEnd(ended);
    const signal = () => Object.assign(new Event("storage"), { key: sessionSignalKey, newValue: "notification" });
    window.dispatchEvent(signal());
    expect(ended).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.crmSessionHidden).toBe("true");
    cleanup();
    window.dispatchEvent(signal());
    expect(ended).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("remains safe with disabled storage and restores content only after verification", () => {
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("document", { documentElement: { dataset: {} } });
    vi.stubGlobal("localStorage", {
      setItem: () => {
        throw new Error("Storage disabled");
      },
    });
    expect(() => publishSessionEnd()).not.toThrow();
    hidePrivateContent();
    expect(document.documentElement.dataset.crmSessionHidden).toBe("true");
    revealPrivateContent();
    expect(document.documentElement.dataset.crmSessionHidden).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("renders an accessible localized password toggle with validation and disabled state", () => {
    const html = renderToStaticMarkup(
      <PasswordInput
        id="new"
        value=""
        onChange={vi.fn()}
        required
        minLength={8}
        disabled
        toggleLabels={{ show: "نمایش رمز", hide: "مخفی کردن رمز" }}
      />
    );
    expect(html).toContain('type="password"');
    expect(html).toContain('aria-label="نمایش رمز"');
    expect(html).toContain('required=""');
    expect(html).toContain('minLength="8"');
    expect(html).toContain('disabled=""');
  });
});
