import { ErrorState } from "./error-state";
import { useEffect, useMemo, useRef, useState } from "react";
import { BusinessChoicesProvider } from "./engine/choice-provider";
import { ModalVisibilityContext } from "@plane/ui";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Navigate, NavLink, Outlet, useBlocker, useLocation, useNavigate } from "react-router";
import { Bell, Menu, Moon, Plus, Search, Sun } from "lucide-react";
import {
  useAppearance,
  useCurrentUser,
  useUnreadNotificationCount,
  useProjects,
  useUpdateAppearance,
  useWorkspaceAccess,
  useWorkspaces,
  api,
  clearClientSession,
} from "./api";
import {
  Breadcrumb,
  Button,
  CommandPalette,
  CreateModal,
  IconButton,
  NotificationDrawer,
  ToastRegion,
} from "./components";
import { useUIStore } from "./store";
import { toFa } from "./utils";
import { canAccessPath } from "./access/permission-map";
import {
  hidePrivateContent,
  revealPrivateContent,
  publishSessionEnd,
  subscribeToSessionEnd,
} from "./access/session-events";
import { ShellNavigation } from "./app-shell";


function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const collapsed = useUIStore((state) => state.sidebarCollapsed);
  const setCollapsed = useUIStore((state) => state.setSidebarCollapsed);
  const setNotifications = useUIStore((state) => state.setNotificationOpen);
  const setCommand = useUIStore((state) => state.setCommandOpen);
  const setCreate = useUIStore((state) => state.setCreateOpen);
  const theme = useUIStore((state) => state.theme);
  const density = useUIStore((state) => state.density);
  const dirtyForms = useUIStore((state) => state.dirtyForms);
  const clearDirtyForms = useUIStore((state) => state.clearDirtyForms);
  const setDensity = useUIStore((state) => state.setDensity);
  const setTheme = useUIStore((state) => state.setTheme);
  const workspaceSlug = useUIStore((state) => state.workspaceSlug);
  const setWorkspaceSlug = useUIStore((state) => state.setWorkspaceSlug);
  const { data: workspaces = [], error: workspaceError, isPending: workspacesPending } = useWorkspaces();
  const { data: appearance } = useAppearance();
  const updateAppearance = useUpdateAppearance();
  const { data: projects = [] } = useProjects();
  const { data: unreadCount = 0 } = useUnreadNotificationCount();
  const { data: currentUser } = useCurrentUser();
  const { data: access, error: accessError } = useWorkspaceAccess();
  const canCreate = access?.can("Issue.Create") === true && location.pathname.replace(/\/+$/, "") !== "/my-work";
  const [gPressed, setGPressed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  // A successful save may navigate before React renders the cleared dirty flag.
  const navigationBlocker = useBlocker(() => useUIStore.getState().dirtyForms.length > 0);
  const resolvedDark =
    theme === "dark" ||
    (theme === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedDark ? "dark" : "light";
    document.documentElement.dataset.density = density;
  }, [resolvedDark, density]);
  useEffect(() => {
    if (!appearance) return;
    setTheme(appearance.theme);
    setDensity(appearance.density);
    document.documentElement.style.setProperty("--accent", appearance.accent);
  }, [appearance, setDensity, setTheme]);
  useEffect(() => {
    if (!workspaces.length) return;
    const savedWorkspace = workspaces.find((item) => item.id === appearance?.lastWorkspaceId);
    const nextWorkspace = savedWorkspace ?? workspaces.find((item) => item.slug === workspaceSlug) ?? workspaces[0];
    if (nextWorkspace.slug !== workspaceSlug) setWorkspaceSlug(nextWorkspace.slug);
  }, [appearance?.lastWorkspaceId, setWorkspaceSlug, workspaceSlug, workspaces]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommand(true);
        return;
      }
      if (event.key === "Escape") {
        setCommand(false);
        setNotifications(false);
        setMobileSidebarOpen(false);
      }
      if (target.matches("input,textarea,select,[contenteditable=true]")) return;
      if (event.key.toLowerCase() === "g") {
        setGPressed(true);
        window.setTimeout(() => setGPressed(false), 900);
        return;
      }
      if (gPressed) {
        const paths: Record<string, string> = { h: "/", p: "/projects", m: "/my-work" };
        const path = paths[event.key.toLowerCase()];
        if (path) navigate(path);
        setGPressed(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [gPressed, navigate, setCommand, setCreate, setNotifications]);

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileSidebarOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileSidebarOpen]);

  useEffect(() => {
    if (!dirtyForms.length) return;
    const protectUnsavedChanges = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectUnsavedChanges);
    return () => window.removeEventListener("beforeunload", protectUnsavedChanges);
  }, [dirtyForms.length]);

  const workspace = workspaces.find((item) => item.slug === workspaceSlug) ?? workspaces[0];
  const can = useMemo(() => (code: string) => access?.can(code) === true, [access]);
  return (
    <div
      className={`app-shell ${collapsed ? "is-panel-collapsed" : ""} ${mobileSidebarOpen ? "is-mobile-nav-open" : ""}`}
    >
      <a className="skip-link" href="#main-content">
        رفتن به محتوای اصلی
      </a>
      <ShellNavigation
        can={can}
        collapsed={collapsed}
        mobileOpen={mobileSidebarOpen}
        unreadCount={unreadCount}
        projects={projects}
        canCreateProject={access?.can("Project.Create") === true}
        canCreatePage={Boolean(access?.can("EntityType.Create") && access?.can("FormDesigner.Publish"))}
        onCreateProject={() => setCreate(true, "project")}
        onToggleCollapsed={() => setCollapsed(!collapsed)}
        onOpenMobile={() => setMobileSidebarOpen(true)}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />
      <button
        type="button"
        className="shell-backdrop"
        aria-label="بستن منوی اصلی"
        tabIndex={mobileSidebarOpen ? 0 : -1}
        onClick={() => setMobileSidebarOpen(false)}
      />
      <div className="shell-main">
        <header className="shell-header">
          <div className="shell-header-start">
            <button
              type="button"
              className="icon-button shell-menu-button"
              aria-label="بازکردن منوی اصلی"
              aria-controls="primary-navigation"
              aria-expanded={mobileSidebarOpen}
              onClick={() => setMobileSidebarOpen(true)}
            >
              <Menu size={20} />
            </button>
            <span className="shell-workspace" title={workspace?.name}>
              <span aria-hidden="true">{(workspace?.name ?? "ش").trim().charAt(0)}</span>
              <b>{workspace?.name ?? "شرکت"}</b>
            </span>
            <Breadcrumb />
          </div>
          <div className="shell-header-actions">
            <button type="button" className="shell-search" onClick={() => setCommand(true)}>
              <Search size={16} aria-hidden="true" />
              <span>جستجو یا اجرای فرمان…</span>
              <kbd>Ctrl K</kbd>
            </button>
            {canCreate && (
              <button
                type="button"
                className="shell-create"
                aria-label="ایجاد کار جدید"
                onClick={() => setCreate(true, "issue")}
              >
                <Plus size={17} aria-hidden="true" />
                <span>کار جدید</span>
              </button>
            )}
            <IconButton
              label="اعلان‌ها"
              className={`notification-button ${unreadCount ? "has-notification" : ""}`}
              onClick={() => setNotifications(true)}
            >
              <Bell size={18} />
              {unreadCount > 0 && (
                <span
                  className="notification-badge"
                  role="status"
                  aria-live="polite"
                  aria-label={`${toFa(unreadCount)} اعلان خوانده‌نشده`}
                >
                  {unreadCount > 99 ? "۹۹+" : toFa(unreadCount)}
                </span>
              )}
            </IconButton>
            <IconButton
              label={resolvedDark ? "پوسته روشن" : "پوسته تیره"}
              onClick={() => {
                const next = resolvedDark ? "light" : "dark";
                setTheme(next);
                updateAppearance.mutate({ theme: next });
              }}
            >
              {resolvedDark ? <Sun size={18} /> : <Moon size={18} />}
            </IconButton>
            <NavLink to="/settings?section=profile" className="user-avatar" aria-label="حساب کاربری">
              {currentUser?.avatarUrl ? (
                <img src={currentUser.avatarUrl} alt={currentUser.displayName} />
              ) : (
                currentUser?.initials || "؟"
              )}
              <span />
            </NavLink>
          </div>
        </header>
        <main className="page-content" id="main-content" tabIndex={-1}>
          {workspaceError || accessError ? (
            <ErrorState message="اطلاعات شرکت دریافت نشد؛ اتصال را بررسی کنید." />
          ) : workspacesPending ? (
            <div className="page-status" role="status">
              در حال بارگذاری فضای کاری…
            </div>
          ) : !workspaces.length ? (
            <p className="page-status" role="status">
              عضویت فعالی در یک شرکت ندارید.
            </p>
          ) : !access ? (
            <div className="page-status" role="status">
              در حال بررسی دسترسی…
            </div>
          ) : canAccessPath(location.pathname, access.can) ? (
            <Outlet />
          ) : (
            <section role="alert" className="panel">
              <h2>دسترسی به این صفحه را ندارید</h2>
              <p>برای تغییر دسترسی با مدیر شرکت هماهنگ کنید.</p>
              <NavLink to="/settings">تنظیمات حساب</NavLink>
            </section>
          )}
        </main>
      </div>
      <NotificationDrawer />
      <CommandPalette />
      <CreateModal />
      {navigationBlocker.state === "blocked" && (
        <div className="modal-layer" role="presentation">
          <section
            className="create-modal logout-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="unsaved-title"
          >
            <header>
              <div>
                <span className="modal-kicker">تغییرات ذخیره‌نشده</span>
                <h2 id="unsaved-title">از این صفحه خارج شوید؟</h2>
              </div>
            </header>
            <p>فرم یا کار در حال ویرایش است. ماندن در صفحه، اطلاعات فعلی را حفظ می‌کند.</p>
            <footer>
              <Button variant="secondary" onClick={() => navigationBlocker.reset()}>
                ماندن و ادامه ویرایش
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  clearDirtyForms();
                  navigationBlocker.proceed();
                }}
              >
                خروج بدون ذخیره
              </Button>
            </footer>
          </section>
        </div>
      )}
      <ToastRegion />
    </div>
  );
}

export default function CrmRootLayout() {
  const client = useMemo(
    () =>
      new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } } }),
    []
  );
  return (
    <QueryClientProvider client={client}>
      <AuthenticationBoundary />
    </QueryClientProvider>
  );
}

export function AuthenticationBoundary() {
  const client = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const { data: user, isLoading, error, refetch } = useCurrentUser();
  const [verifying, setVerifying] = useState(false);
  const [verifiedLocation, setVerifiedLocation] = useState<string>();
  const [retryVerification, setRetryVerification] = useState(0);
  const verifiedUserId = useRef<string | undefined>(undefined);
  useEffect(() => {
    let active = true;
    let ended = false;
    let sequence = 0;
    const endSession = () => {
      if (ended) return;
      ended = true;
      hidePrivateContent();
      setVerifying(true);
      void clearClientSession(client).then(() => {
        if (active) navigate("/login", { replace: true });
        return undefined;
      });
    };
    const verify = async (background = false) => {
      if (ended) return;
      const current = ++sequence;
      if (!background) {
        hidePrivateContent();
        setVerifying(true);
      }
      const result = await refetch();
      if (!active || ended || current !== sequence) return;
      if (result.isError) {
        if ((result.error as { response?: { status?: number } })?.response?.status === 401) {
          publishSessionEnd();
          endSession();
        }
        return;
      }
      if (verifiedUserId.current && verifiedUserId.current !== result.data?.id) {
        publishSessionEnd();
        endSession();
        return;
      }
      verifiedUserId.current = result.data?.id;
      setVerifiedLocation(location.key);
      revealPrivateContent();
      setVerifying(false);
    };
    const pagehide = () => {
      // Hide synchronously before the browser captures a history/bfcache snapshot.
      hidePrivateContent();
      setVerifying(true);
    };
    const pageshow = (event: PageTransitionEvent) => {
      if (event.persisted) void verify();
    };
    const focus = () => void verify(true);
    const visibility = () => {
      if (document.visibilityState === "visible") void verify(true);
    };
    const unsubscribe = subscribeToSessionEnd(endSession);
    void verify();
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("pageshow", pageshow);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("pageshow", pageshow);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [client, navigate, refetch, location.key, retryVerification]);
  useEffect(() => {
    const interceptor = api.interceptors.response.use(
      (response) => response,
      async (requestError: unknown) => {
        const status = (requestError as { response?: { status?: number } }).response?.status;
        if (status === 401) {
          publishSessionEnd();
          await clearClientSession(client);
          navigate("/login", { replace: true });
        }
        return Promise.reject(requestError);
      }
    );
    return () => api.interceptors.response.eject(interceptor);
  }, [client, navigate]);
  if ((error as { response?: { status?: number } } | null)?.response?.status === 401)
    return <Navigate to="/login" replace />;
  if (!user && !isLoading && !error) return <Navigate to="/login" replace />;
  const pending = (!user && isLoading) || verifying || verifiedLocation !== location.key || (Boolean(error) && !user);
  return (
    <>
      {pending &&
        (error ? (
          <main className="access-loading">
            <ErrorState
              message="اتصال به سرور برقرار نشد."
              onRetry={() => setRetryVerification((value) => value + 1)}
            />
          </main>
        ) : (
          <main className="access-loading" role="status">
            در حال بررسی حساب…
          </main>
        ))}
      <div hidden={pending} aria-hidden={pending} inert={pending}>
        {user && verifiedLocation !== undefined && (
          <ModalVisibilityContext.Provider value={!pending}>
            <BusinessChoicesProvider>
              <AppLayout />
            </BusinessChoicesProvider>
          </ModalVisibilityContext.Provider>
        )}
      </div>
    </>
  );
}
