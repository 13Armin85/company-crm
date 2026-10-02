import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
  const { data: access } = useWorkspaceAccess();
  const isAdmin = access?.isAdmin === true;
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
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
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
            .filter((item) => !item.adminOnly || isAdmin)
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
            {isAdmin && (
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
            {isAdmin && (
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
          {workspaceError ? <Navigate to={`/login${location.search}`} replace /> : <Outlet />}
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
      <AppLayout />
    </QueryClientProvider>
  );
}
