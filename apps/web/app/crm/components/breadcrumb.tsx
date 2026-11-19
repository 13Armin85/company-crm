/** Route-aware breadcrumb trail. */
import { ChevronLeft, House } from "lucide-react";
import { Link, useLocation, useMatch } from "react-router";
import { useOrganizationRole, useWorkspaceAccess } from "../api";

type BreadcrumbItem = { id: string; label: string; to?: string };

function BreadcrumbTrail({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav className="breadcrumb" aria-label="مسیر صفحه" dir="rtl">
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
  const { data: access } = useWorkspaceAccess();
  const allowed = Boolean(access?.can("Role.View") || access?.can("Role.Permission.Assign"));
  const { data: role, isLoading, isError } = useOrganizationRole(roleId, allowed);
  // Disabled queries can still contain cached data after permissions change.
  const name = allowed && !isError && role?.id === roleId ? role.name : undefined;
  return (
    <BreadcrumbTrail
      items={[
        { id: "home", label: "خانه", to: "/" },
        { id: "roles", label: "نقش‌های سازمانی", to: access?.can("Role.View") ? "/roles" : undefined },
        { id: "role", label: name || (allowed && isLoading ? "در حال دریافت نقش…" : "نقش") },
        { id: "permissions", label: "مجوزها" },
      ]}
    />
  );
}

export function Breadcrumb() {
  const location = useLocation();
  const roleMatch = useMatch("/roles/:roleId/permissions");
  if (roleMatch) return <RoleBreadcrumb roleId={roleMatch.params.roleId ?? ""} />;
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
