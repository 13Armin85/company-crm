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
    team: "اعضای تیم",
    organization: "ساختار سازمانی",
    roles: "نقش‌های سازمانی",
    routing: "ارجاع هوشمند",
    settings: "تنظیمات",
    edit: "فرم",
    task: "وظیفه",
    ticket: "کار پروژه",
    project: "پروژه",
    leave: "عدم حضور",
    engine: "طراحی فرم‌ها و جدول‌ها",
  };
  const chunks = location.pathname.startsWith("/entities")
    ? []
    : location.pathname
        .split("/")
        .filter(Boolean)
        .filter((_, index) => !location.pathname.startsWith("/edit/") || index < 2);
  return (
    <div className="breadcrumb">
      <Link to="/">خانه</Link>
      {chunks.map((chunk, index) => (
        <span key={chunk}>
          / <b>{index === 1 && chunks[0] === "projects" ? "جزئیات پروژه" : (names[chunk] ?? chunk)}</b>
        </span>
      ))}
    </div>
  );
}
