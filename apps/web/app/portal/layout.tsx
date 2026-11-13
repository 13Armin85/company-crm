/** Customer portal shell: separate from the CRM shell (no app-shell, no shell-nav, no internal API). */
import { useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, ListChecks, LogOut, Settings } from "lucide-react";
import { onSessionExpired } from "./api/client";
import { usePortalLogout, usePortalSession } from "./api/portal";

export const EXPIRED_FLAG = "portal-session-expired";

export default function PortalLayout() {
  const client = useMemo(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true } } }),
    []
  );
  return (
    <QueryClientProvider client={client}>
      <PortalShell />
    </QueryClientProvider>
  );
}

function PortalShell() {
  const session = usePortalSession();
  const logout = usePortalLogout();
  const client = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [expired, setExpired] = useState(false);
  useEffect(
    () =>
      onSessionExpired(() => {
        client.clear();
        setExpired(true);
      }),
    [client]
  );
  useEffect(() => {
    if (expired) {
      try {
        sessionStorage.setItem(EXPIRED_FLAG, "1");
      } catch {
        // storage may be blocked; the login page then simply shows no notice
      }
      navigate("/portal/login", { replace: true, state: { from: location.pathname } });
    }
  }, [expired, navigate, location.pathname]);
  if (session.isLoading)
    return (
      <div className="portal-page portal-center" dir="rtl" aria-busy="true">
        <p className="portal-muted">در حال بارگذاری درگاه…</p>
      </div>
    );
  if (session.error || !session.data)
    return <Navigate to="/portal/login" replace state={{ from: location.pathname }} />;
  const account = session.data;
  return (
    <div className="portal-page" dir="rtl">
      <header className="portal-header">
        <div className="portal-brand">
          <strong>درگاه مشتریان</strong>
          <span>{account.customer}</span>
        </div>
        <nav aria-label="بخش‌های درگاه">
          <NavLink to="/portal" end className="portal-nav">
            <ListChecks size={16} aria-hidden /> درخواست‌های من
          </NavLink>
          <NavLink to="/portal/new" className="portal-nav">
            <FilePlus2 size={16} aria-hidden /> ثبت درخواست
          </NavLink>
          <NavLink to="/portal/settings" className="portal-nav">
            <Settings size={16} aria-hidden /> تنظیمات
          </NavLink>
        </nav>
        <div className="portal-user">
          <span>{account.display_name}</span>
          <button
            type="button"
            className="portal-button"
            disabled={logout.isPending}
            onClick={() => logout.mutate(undefined, { onSettled: () => navigate("/portal/login", { replace: true }) })}
          >
            <LogOut size={16} aria-hidden /> خروج
          </button>
        </div>
      </header>
      <main className="portal-main">
        <Outlet />
      </main>
    </div>
  );
}
