/** Navigation map shared by the shell and page headers. Kept free of component imports. */
import {
  Building2,
  CalendarDays,
  CalendarOff,
  CheckSquare2,
  CircleHelp,
  ClipboardList,
  FileBarChart,
  Database,
  FileText,
  FolderKanban,
  GitBranch,
  Globe,
  Home,
  Inbox,
  LayoutGrid,
  PenLine,
  ListTodo,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  UserX,
  Users,
  Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type ShellItem = { to: string; label: string; icon: LucideIcon; end?: boolean };
export type ShellGroup = { id: string; label: string; title: string; icon: LucideIcon; items: ShellItem[] };

/** Navigation is grouped by job: the rail picks a group, the panel lists its pages. */
export const shellGroups: ShellGroup[] = [
  {
    id: "home",
    label: "میز کار",
    title: "میز کار من",
    icon: Home,
    items: [
      { to: "/", label: "داشبورد", icon: Home, end: true },
      { to: "/inbox", label: "صندوق ورودی", icon: Inbox },
      { to: "/my-work", label: "کارهای من", icon: ListTodo },
      { to: "/daily-report", label: "گزارش روزانه", icon: ClipboardList, end: true },
      { to: "/workflow-inbox", label: "منتظر اقدام من", icon: Workflow },
      { to: "/leave-requests", label: "درخواست مرخصی", icon: CalendarOff },
      { to: "/calendar", label: "تقویم", icon: CalendarDays },
    ],
  },
  {
    id: "work",
    label: "کارها",
    title: "کارها و پروژه‌ها",
    icon: CheckSquare2,
    items: [
      { to: "/issues", label: "همه کارها", icon: CheckSquare2 },
      { to: "/projects", label: "پروژه‌ها", icon: FolderKanban },
    ],
  },
  {
    id: "reports",
    label: "گزارش‌ها",
    title: "گزارش‌ها",
    icon: FileBarChart,
    items: [
      { to: "/reports", label: "گزارش‌ها", icon: FileBarChart },
      { to: "/daily-report/team", label: "گزارش روزانهٔ تیم", icon: Users },
    ],
  },
  {
    id: "data",
    label: "داده‌ها",
    title: "داده‌ها و فرم‌ها",
    icon: Database,
    items: [{ to: "/entities", label: "همه صفحه‌ها", icon: LayoutGrid, end: true }],
  },
  {
    id: "org",
    label: "سازمان",
    title: "سازمان و تیم",
    icon: Building2,
    items: [
      { to: "/team", label: "اعضای تیم", icon: Users },
      { to: "/organization", label: "ساختار سازمانی", icon: Building2 },
      { to: "/roles", label: "نقش‌های سازمانی", icon: ShieldCheck },
      { to: "/routing", label: "ارجاع هوشمند", icon: GitBranch },
      { to: "/absences", label: "عدم حضور", icon: UserX },
      { to: "/leave-templates", label: "قالب فرم مرخصی", icon: FileText },
      { to: "/signatures", label: "تصویر امضای کاربران", icon: PenLine },
    ],
  },
  {
    id: "settings",
    label: "تنظیمات",
    title: "تنظیمات",
    icon: Settings,
    items: [
      { to: "/settings", label: "تنظیمات حساب و شرکت", icon: Settings, end: true },
      { to: "/settings/engine", label: "طراحی فرم‌ها و جدول‌ها", icon: SlidersHorizontal },
      { to: "/portal-settings", label: "درگاه مشتری", icon: Globe },
      { to: "/help", label: "راهنما و پشتیبانی", icon: CircleHelp },
    ],
  },
];

const matches = (item: ShellItem, pathname: string) =>
  item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);

/** Picks the group that owns a path; project pages belong to "work", record pages to "data". */
export function groupForPath(pathname: string): string {
  if (pathname.startsWith("/entities")) return "data";
  // The most specific item wins (e.g. "/daily-report/team" belongs to reports, "/daily-report" to home).
  const owner = shellGroups
    .flatMap((group) =>
      group.items.filter((item) => item.to !== "/" && matches(item, pathname)).map((item) => ({ group, item }))
    )
    // eslint-disable-next-line unicorn/no-array-sort -- ES2022 has no toSorted; flatMap produces a new array.
    .sort((a, b) => b.item.to.length - a.item.to.length)[0]?.group;
  if (owner) return owner.id;
  if (pathname.startsWith("/daily-report")) return "home";
  if (pathname.startsWith("/edit") || pathname.startsWith("/projects")) return "work";
  return "home";
}

/** The most specific page icon for a path, falling back to its section's icon. */
export function iconForPath(pathname: string): LucideIcon {
  const items = shellGroups.flatMap((group) => group.items);
  const best = items
    .filter((item) => item.to !== "/" && matches(item, pathname))
    // eslint-disable-next-line unicorn/no-array-sort -- ES2022 has no toSorted; filter produces a new array.
    .sort((a, b) => b.to.length - a.to.length)[0];
  if (best) return best.icon;
  if (pathname === "/") return Home;
  return shellGroups.find((group) => group.id === groupForPath(pathname))?.icon ?? Home;
}

/** Section name shown above page titles. */
export function sectionTitleForPath(pathname: string): string {
  return shellGroups.find((group) => group.id === groupForPath(pathname))?.title ?? "";
}
