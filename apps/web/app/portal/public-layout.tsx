/** Layout of the portal pages that need no session (login, password set-up). */
import { useMemo } from "react";
import { Outlet } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export default function PortalPublicLayout() {
  const client = useMemo(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }), []);
  return (
    <QueryClientProvider client={client}>
      <div className="portal-page portal-center" dir="rtl">
        <Outlet />
      </div>
    </QueryClientProvider>
  );
}
