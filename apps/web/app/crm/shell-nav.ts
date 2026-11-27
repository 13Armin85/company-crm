/** Navigation map shared by the shell and page headers. Kept free of component imports. */
import {
  Building2,
  CalendarDays,
  CalendarOff,
  CheckSquare2,
  CircleHelp,
  ClipboardList,
  Clock3,
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

import type { NavigationDocument } from "./navigation-paths";
import { logicalPath } from "./navigation-paths";
export type ShellItem = { to: string; path?: string; label: string; icon: LucideIcon; end?: boolean };
export type ShellGroup = { id: string; label: string; title: string; icon: LucideIcon; items: ShellItem[] };
const icons: Record<string, LucideIcon> = {
  Building2,
  CalendarDays,
  CalendarOff,
  CheckSquare2,
  CircleHelp,
  ClipboardList,
  Clock3,
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
};
export function navigationGroups(document: NavigationDocument | undefined): ShellGroup[] {
  return (document?.categories ?? []).map((group) => ({
    id: group.id,
    label: group.label,
    title: group.title,
    icon: icons[group.icon] ?? LayoutGrid,
    items: group.items.map((item) => ({
      to: item.to,
      path: item.path,
      label: item.label,
      end: item.end,
      icon: icons[item.icon] ?? LayoutGrid,
    })),
  }));
}
const matches = (item: ShellItem, pathname: string) => {
  const path = item.path ?? logicalPath(item.to);
  return item.end ? pathname === path : pathname === path || pathname.startsWith(`${path}/`);
};
export function groupForPath(pathname: string, groups: ShellGroup[] = []): string {
  const code = /^\/sections\/([^/]+)/.exec(pathname)?.[1];
  if (code && groups.some((group) => group.id === code)) return code;
  const path = logicalPath(pathname);
  const candidates = groups.flatMap((group) =>
    group.items.filter((item) => matches(item, path)).map((item) => ({ group, item }))
  );
  const best = candidates.reduce<(typeof candidates)[number] | undefined>(
    (current, candidate) =>
      !current || (candidate.item.path ?? candidate.item.to).length > (current.item.path ?? current.item.to).length
        ? candidate
        : current,
    undefined
  );
  return best?.group.id ?? groups[0]?.id ?? "";
}
export function iconForPath(pathname: string, groups: ShellGroup[] = []): LucideIcon {
  const group = groups.find((entry) => entry.id === groupForPath(pathname, groups));
  const path = logicalPath(pathname);
  const best = group?.items.reduce<ShellItem | undefined>(
    (current, item) =>
      matches(item, path) && (!current || (item.path ?? item.to).length > (current.path ?? current.to).length)
        ? item
        : current,
    undefined
  );
  return best?.icon ?? group?.icon ?? Home;
}
export function sectionTitleForPath(pathname: string, groups: ShellGroup[] = []): string {
  return groups.find((group) => group.id === groupForPath(pathname, groups))?.title ?? "";
}
