/** Route-aware breadcrumb trail. */
import { Link, useLocation } from "react-router";

export function Breadcrumb() {
  const location = useLocation();
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
    <div className="breadcrumb">
      <Link to="/">خانه</Link>
      {chunks.map((chunk, index) => (
        <span key={chunk}>
          / <b>{index === 1 && details[chunks[0]] ? details[chunks[0]] : (names[chunk] ?? chunk)}</b>
        </span>
      ))}
    </div>
  );
}
