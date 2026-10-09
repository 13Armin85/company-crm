export interface PermissionExplanation {
  id: string;
  code: string;
  name: string;
  category: string;
  granted: boolean;
  source: "user_deny" | "user_allow" | "role" | "delegation" | "no_access";
  role_ids?: string[];
  role_names?: string[];
  exception_id?: string;
  exception_effects?: ("ALLOW" | "DENY")[];
  has_conflict?: boolean;
  delegations?: {
    unit_id: string;
    unit_name: string;
    manager_id: string;
    manager_name: string;
    user_id: string;
    user_name: string;
    reason: string;
    ends_at: string;
  }[];
}

export interface EffectiveAccess {
  permissions: string[];
  explanations: PermissionExplanation[];
  can: (code: string) => boolean;
}

export interface PermissionException {
  id: string;
  permission: string;
  permission_code: string;
  effect: "ALLOW" | "DENY";
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
}

export interface Absence {
  id: string;
  user: string;
  user_name: string;
  starts_at: string;
  ends_at: string;
  reason: string;
  status: "scheduled" | "cancelled" | "ended";
  current_status: "active" | "upcoming" | "ended" | "cancelled";
  can_edit: boolean;
  can_end: boolean;
}
