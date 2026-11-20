import { createContext, useContext } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, useSlug } from "./api/client";
import { categoryUrl, logicalPath } from "./navigation-paths";
import type { NavigationDocument } from "./navigation-paths";

export const NavigationContext = createContext<NavigationDocument | undefined>(undefined);
export const useNavigationDocument = () => useContext(NavigationContext);
export function CategorizedOutlet() {
  const document = useNavigationDocument();
  const location = useLocation();
  if (!document) return null;
  const landing = /^\/sections\/([^/]+)\/?$/.exec(location.pathname);
  if (landing && document.categories.some((category) => category.id === landing[1])) return <Outlet />;
  const target = categoryUrl(document, location.pathname + location.search + location.hash);
  if (target !== location.pathname + location.search + location.hash) return <Navigate to={target} replace />;
  const prefix = /^\/sections\/([^/]+)/.exec(location.pathname);
  if (prefix && !document.categories.some((category) => category.id === prefix[1]))
    return <p role="alert">دسته‌بندی پیدا نشد.</p>;
  return <Outlet />;
}
export function useCrmLocation() {
  const location = useLocation();
  return { ...location, pathname: logicalPath(location.pathname), canonicalPathname: location.pathname };
}
export function useCrmNavigation() {
  const slug = useSlug();
  return useQuery({
    queryKey: ["crm-navigation", slug],
    enabled: Boolean(slug),
    queryFn: async ({ signal }): Promise<NavigationDocument> =>
      (await api.get(`/api/workspaces/${encodeURIComponent(slug ?? "")}/navigation/`, { signal })).data,
  });
}
export function useSaveDesignSidebar() {
  const slug = useSlug();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (codes: string[] | null): Promise<NavigationDocument> =>
      (await api.patch(`/api/workspaces/${encodeURIComponent(slug ?? "")}/navigation/`, { design_sidebar: codes }))
        .data,
    onSuccess: (data) => client.setQueryData(["crm-navigation", slug], data),
  });
}
