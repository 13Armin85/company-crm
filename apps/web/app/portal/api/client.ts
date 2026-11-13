/** Customer-portal HTTP client. It talks only to `/api/portal/v1/` — never to internal endpoints.
 * The session lives in an HttpOnly cookie; the CSRF token is kept in memory and sent on unsafe calls. */
import { create } from "axios";
import type { AxiosError } from "axios";
import { describeError } from "../../crm/error-messages";

const origin = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/api\/v1\/?$/, "").replace(/\/$/, "");
export const PORTAL_PREFIX = "/api/portal/v1/";

export const portalApi = create({ baseURL: `${origin}${PORTAL_PREFIX}`, timeout: 30000, withCredentials: true });

let csrfToken: string | undefined;
const expiredListeners = new Set<() => void>();

export const setPortalCsrf = (token: string | undefined) => {
  csrfToken = token;
};

/** Called when the server reports the session ended (idle, absolute, logout elsewhere, deactivated). */
export const onSessionExpired = (listener: () => void) => {
  expiredListeners.add(listener);
  return () => {
    expiredListeners.delete(listener);
  };
};

portalApi.interceptors.request.use((config) => {
  if (config.method && !["get", "head", "options"].includes(config.method) && csrfToken)
    config.headers["X-Portal-CSRF"] = csrfToken;
  return config;
});

portalApi.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ code?: string }>) => {
    const code = error.response?.data?.code;
    if (error.response?.status === 401 && (code === "session_expired" || code === "not_authenticated")) {
      csrfToken = undefined;
      for (const listener of expiredListeners) listener();
    }
    return Promise.reject(error);
  }
);

export const portalError = (error: unknown, fallback: string) => describeError(error, fallback);

/** A server file URL is relative to the API origin and always goes through an ownership check. */
export const fileHref = (url: string | null | undefined) => (url ? `${origin}${url}` : undefined);
