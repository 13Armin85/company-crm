import { useEffect, useMemo, useState } from "react";
import { BrandLogo } from "@plane/ui";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Navigate, NavLink, Outlet, useBlocker, useLocation, useNavigate } from "react-router";
import {
  Bell,
  Building2,
  CalendarDays,
  CheckSquare2,
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
  CircleHelp,
  FolderKanban,
  GitBranch,
  Home,
  Inbox,
  Menu,
  Moon,
  Plus,
  Search,
  ShieldCheck,
  Settings,
  Sun,
  Users,
  X,
} from "lucide-react";
import {
  useAppearance,
  useCurrentUser,
  useNotifications,
  useProjects,
  useSelectWorkspace,
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
import { permissionsForPath } from "./access/permission-map";
import {
  hidePrivateContent,
  revealPrivateContent,
  publishSessionEnd,
  subscribeToSessionEnd,
} from "./access/session-events";

const navItems = [
  { to: "/", label: "خانه", icon: Home, end: true },
  { to: "/projects", label: "پروژه‌ها", icon: FolderKanban },
  { to: "/issues", label: "همه کارها", icon: CheckSquare2, adminOnly: true },
  { to: "/my-work", label: "کارهای من", icon: CheckSquare2 },
  { to: "/inbox", label: "صندوق ورودی", icon: Inbox },
  { to: "/calendar", label: "تقویم", icon: CalendarDays },
  { to: "/team", label: "اعضای تیم", icon: Users, adminOnly: true },
  { to: "/organization", label: "ساختار سازمانی", icon: Building2, adminOnly: true },
  { to: "/roles", label: "نقش‌های سازمانی", icon: ShieldCheck, adminOnly: true },
  { to: "/routing", label: "ارجاع هوشمند", icon: GitBranch },
  { to: "/absences", label: "عدم حضور", icon: CalendarDays },
];

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
  const toast = useUIStore((state) => state.toast);
  const setDensity = useUIStore((state) => state.setDensity);
  const setTheme = useUIStore((state) => state.setTheme);
  const workspaceSlug = useUIStore((state) => state.workspaceSlug);
  const setWorkspaceSlug = useUIStore((state) => state.setWorkspaceSlug);
  const { data: workspaces = [], error: workspaceError } = useWorkspaces();
  const { data: appearance } = useAppearance();
  const updateAppearance = useUpdateAppearance();
  const selectWorkspace = useSelectWorkspace();
  const { data: projects = [] } = useProjects();
  const { data: notifications = [] } = useNotifications();
  const { data: currentUser } = useCurrentUser();
  const { data: access, error: accessError } = useWorkspaceAccess();
  const canCreate = access?.can("Issue.Create") === true;
  const [gPressed, setGPressed] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const navigationBlocker = useBlocker(dirtyForms.length > 0);
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
        setCreate(false);
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
    setWorkspaceOpen(false);
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
  return (
    <div
      className={`app-shell ${collapsed ? "sidebar-collapsed" : ""} ${mobileSidebarOpen ? "mobile-sidebar-open" : ""}`}
    >
      <aside className="sidebar" id="primary-navigation">
        <div className="brand">
          <BrandLogo className="brand-mark" />
          <strong>هم‌کار</strong>
          <button
            type="button"
            className="mobile-sidebar-close"
            aria-label="بستن منوی اصلی"
            onClick={() => setMobileSidebarOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <nav className="main-nav">
          {navItems
            .filter((item) => permissionsForPath(item.to).every((code) => access?.can(code)))
            .map(({ to, label, icon: Icon, end }) => (
              <NavLink
                to={to}
                end={end}
                key={to}
                title={collapsed ? label : undefined}
                onClick={() => setMobileSidebarOpen(false)}
              >
                <Icon size={19} />
                <span>{label}</span>
                {to === "/inbox" && notifications.some((item) => !item.read) && (
                  <b>{toFa(notifications.filter((item) => !item.read).length)}</b>
                )}
              </NavLink>
            ))}
        </nav>
        <div className="recent-projects">
          <p>
            پروژه‌های اخیر{" "}
            {access?.can("Project.Create") && (
              <button onClick={() => setCreate(true, "project")}>
                <Plus size={14} />
              </button>
            )}
          </p>
          {projects.slice(0, 3).map((project) => (
            <NavLink
              key={project.id}
              to={`/projects/${project.id}`}
              title={collapsed ? project.name : undefined}
              onClick={() => setMobileSidebarOpen(false)}
            >
              <i style={{ background: project.color }} />
              <span>{project.name}</span>
            </NavLink>
          ))}
        </div>
        <div className="sidebar-bottom">
          <NavLink to="/settings" onClick={() => setMobileSidebarOpen(false)}>
            <Settings size={19} />
            <span>تنظیمات</span>
          </NavLink>
          <a href="https://docs.plane.so" target="_blank" rel="noreferrer">
            <CircleHelp size={19} />
            <span>راهنما و پشتیبانی</span>
          </a>
        </div>
        <button className="collapse-button" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? <ChevronsLeft size={17} /> : <ChevronsRight size={17} />}
          <span>جمع‌کردن منو</span>
        </button>
      </aside>
      <button
        type="button"
        className="mobile-sidebar-backdrop"
        aria-label="بستن منوی اصلی"
        tabIndex={mobileSidebarOpen ? 0 : -1}
        onClick={() => setMobileSidebarOpen(false)}
      />
      <div className="app-area">
        <header className="topbar">
          <div className="topbar-start">
            <button
              type="button"
              className="icon-button mobile-menu-button"
              aria-label="بازکردن منوی اصلی"
              aria-controls="primary-navigation"
              aria-expanded={mobileSidebarOpen}
              onClick={() => setMobileSidebarOpen(true)}
            >
              <Menu size={20} />
            </button>
            <button
              className="workspace-switcher"
              onClick={() => setWorkspaceOpen((value) => !value)}
              aria-expanded={workspaceOpen}
            >
              <span>{workspace?.name?.slice(0, 1) ?? "هـ"}</span>
              <b>{workspace?.name ?? "فضای کاری"}</b>
              <ChevronDown size={14} />
            </button>
            {workspaceOpen && (
              <div className="workspace-dropdown">
                <small>انتخاب شرکت</small>
                {workspaces.map((item) => (
                  <button
                    key={item.id}
                    className={item.slug === workspace?.slug ? "active" : ""}
                    onClick={() => {
                      if (dirtyForms.length > 0) {
                        toast("ابتدا تغییرات فرم باز را ذخیره یا لغو کنید", "info");
                        setWorkspaceOpen(false);
                        return;
                      }
                      setWorkspaceSlug(item.slug);
                      selectWorkspace.mutate(item.id);
                      setWorkspaceOpen(false);
                      navigate("/");
                    }}
                  >
                    <span>{item.name.slice(0, 1)}</span>
                    <b>{item.name}</b>
                  </button>
                ))}
                <NavLink to="/settings" onClick={() => setWorkspaceOpen(false)}>
                  <Settings size={15} /> تنظیمات شرکت
                </NavLink>
              </div>
            )}
            <Breadcrumb />
          </div>
          <div className="topbar-actions">
            <button className="global-search" onClick={() => setCommand(true)}>
              <Search size={17} />
              <span>جستجو در هم‌کار...</span>
              <kbd>Ctrl K</kbd>
            </button>
            {canCreate && (
              <button className="create-button" onClick={() => setCreate(true, "issue")}>
                <Plus size={17} />
                <span>ایجاد</span>
                <ChevronDown size={13} />
              </button>
            )}
            <IconButton label="اعلان‌ها" className="has-notification" onClick={() => setNotifications(true)}>
              <Bell size={19} />
            </IconButton>
            <IconButton
              label="تغییر پوسته"
              onClick={() => {
                const next = resolvedDark ? "light" : "dark";
                setTheme(next);
                updateAppearance.mutate({ theme: next });
              }}
            >
              {resolvedDark ? <Sun size={19} /> : <Moon size={19} />}
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
        <main className="page-content">
          {workspaceError || accessError ? (
            <p role="alert">دریافت فضای کاری یا دسترسی انجام نشد. صفحه را دوباره بارگذاری کنید.</p>
          ) : !workspaces.length ? (
            <p role="status">عضویت فعالی در یک شرکت ندارید.</p>
          ) : !access ? (
            <div role="status">در حال بررسی دسترسی…</div>
          ) : permissionsForPath(location.pathname).every((code) => access.can(code)) ? (
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
            <p>فرم یا تیکت در حال ویرایش است. ماندن در صفحه، اطلاعات فعلی را حفظ می‌کند.</p>
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
    const verify = async () => {
      if (ended) return;
      const current = ++sequence;
      hidePrivateContent();
      setVerifying(true);
      const result = await refetch();
      if (!active || ended || current !== sequence) return;
      if (result.isError) {
        publishSessionEnd();
        endSession();
        return;
      }
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
    const focus = () => void verify();
    const visibility = () => {
      if (document.visibilityState === "visible") void verify();
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
  }, [client, navigate, refetch, location.key]);
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
  if (isLoading)
    return (
      <main className="access-loading" role="status">
        در حال بررسی حساب…
      </main>
    );
  if (error || !user) return <Navigate to="/login" replace />;
  if (isLoading || verifying || verifiedLocation !== location.key)
    return (
      <main className="access-loading" role="status">
        در حال بررسی حساب…
      </main>
    );
  return <AppLayout />;
}
