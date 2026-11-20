import { useCrmLocation as useLocation } from "../navigation";
/** Route-aware breadcrumb trail. */
import { ChevronLeft, House } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link, matchPath } from "react-router";
import { useNavigationDocument } from "../navigation";
import { categoryForRoute, categoryUrl } from "../navigation-paths";
import { useOrganizationRole, useWorkspaceAccess } from "../api";

type BreadcrumbItem = { id: string; label: string; to?: string };

function BreadcrumbTrail({ items }: { items: BreadcrumbItem[] }) {
  const trailRef = useRef<HTMLElement>(null);
  const trailKey = JSON.stringify(items);
  useEffect(() => {
    const trail = trailRef.current;
    if (!trail) return;
    // RTL scroll offsets are negative: keep the current page visible after
    // navigation, a database title update, or a change in available width.
    const revealCurrent = () => {
      trail.scrollLeft = -trail.scrollWidth;
    };
    revealCurrent();
    const observer = new ResizeObserver(revealCurrent);
    observer.observe(trail);
    return () => observer.disconnect();
  }, [trailKey]);
  return (
    <nav ref={trailRef} className="breadcrumb" aria-label="مسیر صفحه" dir="rtl" tabIndex={0}>
      <ol>
        {items.map((item, index) => (
          <li key={item.id}>
            {index > 0 && <ChevronLeft className="breadcrumb-separator" size={14} aria-hidden="true" />}
            {item.to && index < items.length - 1 ? (
              <Link to={item.to} title={item.label}>
                {index === 0 && <House size={15} aria-hidden="true" />}
                <span>{item.label}</span>
              </Link>
            ) : (
              <span
                className="breadcrumb-label"
                aria-current={index === items.length - 1 ? "page" : undefined}
                title={item.label}
              >
                {index === 0 && <House size={15} aria-hidden="true" />}
                <span>{item.label}</span>
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function RoleBreadcrumb({ roleId }: { roleId: string }) {
  const navigation = useNavigationDocument();
  const category = navigation?.categories.find((item) => item.id === categoryForRoute(navigation, "/roles"));
  const { data: access } = useWorkspaceAccess();
  const allowed = Boolean(access?.can("Role.View") || access?.can("Role.Permission.Assign"));
  const { data: role, isLoading, isError } = useOrganizationRole(roleId, allowed);
  // Disabled queries can still contain cached data after permissions change.
  const name = allowed && !isError && role?.id === roleId ? role.name : undefined;
  return (
    <BreadcrumbTrail
      items={[
        { id: "home", label: "خانه", to: categoryUrl(navigation, "/") },
        ...(category ? [{ id: "category", label: category.title, to: category.to }] : []),
        {
          id: "roles",
          label: navigation?.routes.find((item) => item.path === "/roles")?.label ?? "نقش‌های سازمانی",
          to: access?.can("Role.View") ? categoryUrl(navigation, "/roles") : undefined,
        },
        { id: "role", label: name || (allowed && isLoading ? "در حال دریافت نقش…" : "نقش") },
        { id: "permissions", label: "مجوزها" },
      ]}
    />
  );
}

export function Breadcrumb() {
  const location = useLocation();
  const navigation = useNavigationDocument();
  const roleMatch = matchPath("/roles/:roleId/permissions", location.pathname);
  if (roleMatch) return <RoleBreadcrumb roleId={roleMatch.params.roleId ?? ""} />;
  if (navigation) {
    const params = new URLSearchParams(location.search);
    const landing = /^\/sections\/([^/]+)\/?$/.exec(location.canonicalPathname);
    const category = navigation.categories.find(
      (item) => item.id === (landing?.[1] ?? categoryForRoute(navigation, location.pathname))
    );
    const items: BreadcrumbItem[] = [{ id: "home", label: "خانه", to: categoryUrl(navigation, "/") }];
    if (category) items.push({ id: "category", label: category.title, to: category.to });
    if (landing) return <BreadcrumbTrail items={items} />;
    const edit = matchPath("/edit/:code/:recordId", location.pathname);
    if (edit) {
      const code = edit.params.code === "task" ? "ticket" : edit.params.code;
      const page = [...navigation.entities, ...navigation.design_pages].find((item) => item.code === code);
      if (page) items.push({ id: "edit-page", label: page.title, to: page.to });
      items.push({ id: "edit", label: "ویرایش" });
      return <BreadcrumbTrail items={items} />;
    }
    if (location.pathname === "/settings/engine") {
      items.push({
        id: "designer",
        label: navigation.routes.find((item) => item.path === "/settings/engine")?.label ?? "طراحی",
        to: categoryUrl(navigation, "/settings/engine"),
      });
      const page = navigation.design_pages.find((item) => item.code === params.get("page"));
      const designCategory = navigation.categories.find(
        (item) => item.id === (page?.category ?? params.get("category"))
      );
      if (designCategory)
        items.push({
          id: "design-category",
          label: designCategory.title,
          to: `${categoryUrl(navigation, "/settings/engine")}?category=${encodeURIComponent(designCategory.id)}`,
        });
      if (page) {
        items.push({ id: "design-page", label: page.title });
        const tab = navigation.design_tabs.find(
          (item) => item.id === (params.get("tab") ?? (params.get("mode") === "columns" ? "table" : "layout"))
        );
        if (tab) items.push({ id: "design-tab", label: tab.label });
      }
      return <BreadcrumbTrail items={items} />;
    }
    const entityMatch = matchPath("/entities/:code/*", location.pathname);
    if (entityMatch) {
      const entity = navigation.entities.find((item) => item.code === entityMatch.params.code);
      if (entity) items.push({ id: "entity", label: entity.title, to: entity.to });
      if (entityMatch.params["*"]) items.push({ id: "record", label: "جزئیات" });
      return <BreadcrumbTrail items={items} />;
    }
    const page = [...navigation.routes]
      .filter(
        (item) =>
          item.path !== "/" && (location.pathname === item.path || location.pathname.startsWith(`${item.path}/`))
      )
      // eslint-disable-next-line unicorn/no-array-sort -- Sorting a private array supports ES2022.
      .sort((left, right) => right.path.length - left.path.length)[0];
    if (page) {
      items.push({ id: "page", label: page.label, to: page.to });
      if (location.pathname !== page.path) items.push({ id: "detail", label: "جزئیات" });
      return <BreadcrumbTrail items={items} />;
    }
  }
  const names: Record<string, string> = {
    projects: "پروژه‌ها",
    issues: "همه کارها",
    "my-work": "کارهای من",
    inbox: "صندوق ورودی",
    calendar: "تقویم",
    team: location.pathname.startsWith("/daily-report") ? "تیم" : "اعضای تیم",
    organization: "ساختار سازمانی",
    roles: "نقش‌های سازمانی",
    routing: "ارجاع هوشمند",
    settings: "تنظیمات",
    edit: "فرم",
    task: "وظیفه",
    ticket: "کار پروژه",
    project: "پروژه",
    leave: "عدم حضور",
    "leave-requests": "درخواست‌های مرخصی",
    "leave-templates": "قالب Word مرخصی",
    signatures: "تصویر امضا",
    absences: "عدم حضور",
    "workflow-inbox": "منتظر اقدام من",
    "portal-settings": "درگاه مشتری",
    requests: "درخواست‌های مشتریان",
    help: "راهنما",
    permissions: "مجوزها",
    engine: "طراحی فرم‌ها و جدول‌ها",
    "daily-report": "گزارش روزانه",
    reports: "گزارش‌ها",
    source: "گزارش پایه",
    saved: "گزارش ذخیره‌شده",
  };
  const details: Record<string, string> = {
    projects: "جزئیات پروژه",
    "leave-requests": "جزئیات درخواست",
    team: "پروفایل کاربر",
    roles: "مجوزهای نقش",
  };
  const chunks = location.pathname.startsWith("/entities")
    ? []
    : location.pathname
        .split("/")
        .filter(Boolean)
        .filter((_, index) => !location.pathname.startsWith("/edit/") || index < 2)
        // Report pages end in an id or a source code; the section names are enough.
        .filter((_, index) => !location.pathname.startsWith("/reports/") || index < 2)
        .filter((_, index) => !location.pathname.startsWith("/portal-settings/requests/") || index < 2);
  return (
    <BreadcrumbTrail
      items={[
        { id: "home", label: "خانه", to: "/" },
        ...chunks.map((chunk, index) => ({
          id: chunks.slice(0, index + 1).join("/"),
          label: index === 1 && details[chunks[0]] ? details[chunks[0]] : (names[chunk] ?? "جزئیات"),
        })),
      ]}
    />
  );
}
