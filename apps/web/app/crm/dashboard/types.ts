export type WidgetType =
  | "counter" | "table" | "my-work" | "chart" | "progress" | "calendar"
  | "activity" | "links" | "note" | "absences" | "approvals" | "workload"
  | "age" | "unassigned" | "team-cards";

export interface DashboardWidget {
  id: string;
  type: WidgetType;
  title?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  locked?: boolean;
  origin?: string;
  config: Record<string, unknown>;
}

export interface DashboardTab {
  id: string;
  title: string;
  widgets: DashboardWidget[];
  share?: { users?: string[]; roles?: string[]; mode?: "read" | "copy" };
}

export interface DashboardPayload {
  tabs: DashboardTab[];
  revision: number;
  default_updated?: boolean;
  shared_tabs?: (DashboardTab & { mode: "read" | "copy"; owner: string })[];
  gallery?: { type: WidgetType; title: string }[];
  can_share?: boolean;
  can_team?: boolean;
  can_manage_defaults?: boolean;
}

export interface TeamCard {
  id: string;
  name: string;
  avatar?: string;
  position: string;
  unit_id: string;
  unit: string;
  unit_depth: number;
  unit_path: string;
  team: string;
  roles: { id: string; name: string }[];
  presence: "present" | "absent";
  presence_label: string;
  reason: string;
  return_at: string | null;
  substitute: { id: string; name: string } | null;
  active_tasks: { id: string; number: string | null; title: string; started_at: string }[];
  in_progress_count: number;
  open_count: number;
  overdue_count: number;
  capacity: number;
  workload_percent: number;
  last_activity: string | null;
  inactive_hours: number;
  color: string;
  label: string;
}

export interface TeamData {
  cards: TeamCard[];
  summary: Record<string, number>;
  settings: { refresh_seconds: number; alert_enabled?: boolean; alert_minutes?: number };
  empty: string | null;
}
