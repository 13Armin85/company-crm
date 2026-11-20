import { useCrmLocation as useLocation } from "./navigation";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router";
import { BrandLogo } from "@plane/ui";
import { PanelRightClose, PanelRightOpen, Plus, X } from "lucide-react";
import { canAccessPath } from "./access/permission-map";
import { groupForPath, navigationGroups } from "./shell-nav";
import { useNavigationDocument } from "./navigation";
import { categoryUrl } from "./navigation-paths";
import type { ShellGroup, ShellItem } from "./shell-nav";
import { SidebarPages } from "./engine/sidebar-pages";
import { toFa } from "./utils";

type ShellProps = {
  can: (code: string) => boolean;
  collapsed: boolean;
  mobileOpen: boolean;
  unreadCount: number;
  projects: { id: string; name: string; color?: string }[];
  canCreateProject: boolean;
  canCreatePage: boolean;
  onCreateProject: () => void;
  onToggleCollapsed: () => void;
  onOpenMobile: () => void;
  onCloseMobile: () => void;
};

// On tablets the panel floats over the workspace, so the rail opens it on demand.
const panelFloats = () => typeof window !== "undefined" && window.matchMedia("(max-width: 980px)").matches;

export function ShellNavigation({
  can,
  collapsed,
  mobileOpen,
  unreadCount,
  projects,
  canCreateProject,
  canCreatePage,
  onCreateProject,
  onToggleCollapsed,
  onOpenMobile,
  onCloseMobile,
}: ShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useNavigationDocument();
  const shellGroups = useMemo(() => navigationGroups(navigation), [navigation]);
  const routeGroup = groupForPath(location.canonicalPathname, shellGroups);
  const [selected, setSelected] = useState(routeGroup);
  useEffect(() => setSelected(routeGroup), [routeGroup]);

  const groups = useMemo(
    () =>
      shellGroups.reduce<ShellGroup[]>((visible, group) => {
        const items = group.items.filter((item) => canAccessPath(item.to, can));
        if (
          items.length ||
          navigation?.entities.some((page) => page.category === group.id && page.path.startsWith("/entities/"))
        )
          visible.push({ ...group, items });
        return visible;
      }, []),
    [can, shellGroups, navigation]
  );
  const current = groups.find((group) => group.id === selected) ?? groups[0];

  const chooseGroup = (group: ShellGroup) => {
    setSelected(group.id);
    const target = group.items[0]?.to ?? navigation?.categories.find((category) => category.id === group.id)?.to;
    if (target && group.id !== routeGroup) navigate(target);
    if (panelFloats()) {
      onOpenMobile();
      return;
    }
    if (collapsed) onToggleCollapsed();
  };
  const togglePanel = () => {
    if (panelFloats()) {
      if (mobileOpen) onCloseMobile();
      else onOpenMobile();
      return;
    }
    onToggleCollapsed();
  };

  return (
    <>
      <aside className="shell-rail" aria-label="بخش‌های اصلی">
        <NavLink to="/" className="shell-rail-brand" aria-label="هم‌کار، داشبورد" onClick={onCloseMobile}>
          <BrandLogo className="shell-rail-logo" />
        </NavLink>
        <nav className="shell-rail-groups">
          {groups.map((group) => {
            const Icon = group.icon;
            const active = group.id === routeGroup;
            return (
              <button
                key={group.id}
                type="button"
                className={`shell-rail-item ${active ? "is-active" : ""} ${group.id === current?.id ? "is-selected" : ""}`}
                aria-current={active ? "page" : undefined}
                aria-controls="primary-navigation"
                onClick={() => chooseGroup(group)}
              >
                <span className="shell-rail-icon">
                  <Icon size={20} strokeWidth={1.8} />
                  {group.items.some((item) => item.path === "/inbox") && unreadCount > 0 && (
                    <b aria-label={`${toFa(unreadCount)} اعلان خوانده‌نشده`}>
                      {unreadCount > 99 ? "۹۹+" : toFa(unreadCount)}
                    </b>
                  )}
                </span>
                <span className="shell-rail-label">{group.label}</span>
              </button>
            );
          })}
        </nav>
        <button
          type="button"
          className="shell-rail-item shell-rail-toggle"
          aria-label={collapsed ? "نمایش منوی بخش" : "پنهان‌کردن منوی بخش"}
          aria-expanded={!collapsed}
          aria-controls="primary-navigation"
          onClick={togglePanel}
        >
          <span className="shell-rail-icon">
            {collapsed ? (
              <PanelRightOpen size={19} strokeWidth={1.8} />
            ) : (
              <PanelRightClose size={19} strokeWidth={1.8} />
            )}
          </span>
        </button>
      </aside>

      <aside className="shell-panel" id="primary-navigation" aria-label={current?.title ?? "منو"}>
        <header className="shell-panel-head">
          <div>
            <small>هم‌کار</small>
            <h2>{current?.title}</h2>
          </div>
          <button type="button" className="shell-panel-close" aria-label="بستن منو" onClick={onCloseMobile}>
            <X size={18} />
          </button>
        </header>
        {mobileOpen && (
          <nav className="shell-panel-groups" aria-label="بخش‌ها">
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                className={group.id === current?.id ? "is-selected" : ""}
                aria-pressed={group.id === current?.id}
                onClick={() => chooseGroup(group)}
              >
                {group.label}
              </button>
            ))}
          </nav>
        )}
        <div className="shell-panel-body">
          {current && (
            <nav className="shell-links" aria-label={current.title}>
              {current.items.map((item) => (
                <ShellLink key={item.to} item={item} onNavigate={onCloseMobile}>
                  {item.path === "/inbox" && unreadCount > 0 && <b>{toFa(unreadCount)}</b>}
                </ShellLink>
              ))}
            </nav>
          )}
          {current?.items.some((item) => item.path === "/projects") && (
            <section className="shell-section">
              <h3>
                <span>پروژه‌های اخیر</span>
                {canCreateProject && (
                  <button type="button" aria-label="پروژهٔ جدید" title="پروژهٔ جدید" onClick={onCreateProject}>
                    <Plus size={15} />
                  </button>
                )}
              </h3>
              {projects.length ? (
                projects.slice(0, 6).map((project) => (
                  <NavLink
                    key={project.id}
                    to={categoryUrl(navigation, `/projects/${project.id}`)}
                    className="shell-link"
                    onClick={onCloseMobile}
                  >
                    <i className="shell-swatch" style={{ background: project.color }} aria-hidden="true" />
                    <span>{project.name}</span>
                  </NavLink>
                ))
              ) : (
                <p className="shell-empty">هنوز پروژه‌ای ندارید.</p>
              )}
            </section>
          )}
          <section className="shell-section shell-section-pages" aria-label="صفحه‌های ساخته‌شده">
            <SidebarPages collapsed={false} canCreate={canCreatePage} onNavigate={onCloseMobile} />
          </section>
        </div>
      </aside>
    </>
  );
}

function ShellLink({ item, onNavigate, children }: { item: ShellItem; onNavigate: () => void; children?: ReactNode }) {
  const Icon = item.icon;
  return (
    <NavLink to={item.to} end={item.end} className="shell-link" onClick={onNavigate}>
      <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
      <span>{item.label}</span>
      {children}
    </NavLink>
  );
}
