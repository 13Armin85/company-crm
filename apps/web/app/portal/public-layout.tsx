/** Layout of the portal pages that need no session (login, password set-up). */
import { useMemo } from "react";
import { Outlet } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PageHelp } from "../crm/components/page-help";

export default function PortalPublicLayout() {
  const client = useMemo(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }), []);
  return (
    <QueryClientProvider client={client}>
      <div className="portal-page portal-center" dir="rtl">
        <div className="portal-help-corner">
          <PageHelp />
        </div>
        <Outlet />
      </div>
    </QueryClientProvider>
  );
}
