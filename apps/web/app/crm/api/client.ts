/** Shared HTTP client: CSRF handling, session-scoped request cancellation and helpers used by every API module. */
import { CanceledError, create } from "axios";
import type { AxiosError, InternalAxiosRequestConfig } from "axios";
import type { QueryClient } from "@tanstack/react-query";
import { useUIStore } from "../store";
import { combineRequestSignals } from "../access/request-signals";
import { describeError } from "../error-messages";

const origin = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/api\/v1\/?$/, "").replace(/\/$/, "");
export const api = create({ baseURL: origin, timeout: 20000, withCredentials: true });
let csrfToken: string | undefined;
let sessionGeneration = 0;
let sessionRequests = new AbortController();
const requestGenerations = new WeakMap<object, number>();
const requestSignalCleanups = new WeakMap<object, () => void>();

const disposeRequestSignal = (config: object | undefined) => {
  if (!config) return;
  requestSignalCleanups.get(config)?.();
  requestSignalCleanups.delete(config);
};

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const generation = sessionGeneration;
  requestGenerations.set(config, generation);
  const signal = sessionRequests.signal;
  if (config.signal) {
    const combined = combineRequestSignals([config.signal as AbortSignal, signal]);
    config.signal = combined.signal;
    requestSignalCleanups.set(config, combined.dispose);
  } else config.signal = signal;
  try {
    if (config.method && !["get", "head", "options"].includes(config.method)) {
      if (!csrfToken) csrfToken = (await api.get<{ csrf_token: string }>("/auth/get-csrf-token/")).data.csrf_token;
      config.headers["X-CSRFTOKEN"] = csrfToken;
    }
    if (generation !== sessionGeneration) throw new CanceledError("Session changed");
    return config;
  } catch (error) {
    disposeRequestSignal(config);
    throw error;
  }
});
api.interceptors.response.use(
  (response) => {
    disposeRequestSignal(response.config);
    if (requestGenerations.get(response.config) !== sessionGeneration) throw new CanceledError("Session changed");
    return response;
  },
  (error: unknown) => {
    disposeRequestSignal((error as AxiosError)?.config);
    return Promise.reject(error);
  }
);

export const unwrap = <T>(payload: T | { results?: T; data?: T }): T => {
  if (payload && typeof payload === "object" && "results" in payload && payload.results) return payload.results;
  if (payload && typeof payload === "object" && "data" in payload && payload.data) return payload.data;
  return payload as T;
};

export const errorMessage = (error: unknown, fallback: string) => describeError(error, fallback);
/** Resolves the workspace slug, preferring an explicit one over the active workspace. */
export const useSlug = (provided?: string) => useUIStore((state) => provided || state.workspaceSlug);

/** Request options telling the API which workspace a user-level change belongs to. */
export const workspaceHeaders = () => ({ headers: { "X-CRM-Workspace": useUIStore.getState().workspaceSlug } });

export const toastSuccess = (message: string) => useUIStore.getState().toast(message);
export const toastError = (error: unknown, fallback: string) =>
  useUIStore.getState().toast(errorMessage(error, fallback), "error");

export async function clearClientSession(client: QueryClient) {
  sessionGeneration++;
  sessionRequests.abort();
  sessionRequests = new AbortController();
  await client.cancelQueries();
  client.clear();
  csrfToken = undefined;
  if (typeof localStorage !== "undefined") {
    for (const key of ["api_key", "access_token", "accessToken", "hamkar-workspace"]) localStorage.removeItem(key);
  }
  useUIStore.getState().resetSession();
}
