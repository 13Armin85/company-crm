/** Pure functions that translate raw API payloads into the CRM domain models. */
import { presentNotification } from "../notification-presentation";
import { issueStatusFromState, stateNameFa } from "../issue-status";
import type {
  Issue,
  Member,
  OrganizationPermission,
  OrganizationRole,
  OrganizationUnit,
  Project,
  ProjectState,
  Status,
  TicketRoleQueueEntry,
  TicketRoutingRule,
} from "../types";

export const mapOrganizationPermission = (item: Record<string, unknown>): OrganizationPermission => ({
  id: String(item.id),
  code: String(item.code),
  name: String(item.name),
  description: String(item.description ?? ""),
  category: String(item.category ?? ""),
  isDelegatable: Boolean(item.is_delegatable),
  isActive: Boolean(item.is_active),
});

export const mapOrganizationRole = (item: Record<string, unknown>): OrganizationRole => ({
  id: String(item.id),
  name: String(item.name),
  description: String(item.description ?? ""),
  systemKey: item.system_key ? String(item.system_key) : undefined,
  isActive: Boolean(item.is_active),
  permissionIds: Array.isArray(item.permission_ids) ? item.permission_ids.map(String) : [],
  userCount: Number(item.user_count ?? 0),
  createdAt: item.created_at ? String(item.created_at) : undefined,
  updatedAt: item.updated_at ? String(item.updated_at) : undefined,
});

export const mapOrganizationUnit = (item: Record<string, unknown>): OrganizationUnit => ({
  id: String(item.id),
  title: String(item.title),
  parentId: item.parent_id ? String(item.parent_id) : undefined,
  managerId: item.manager_id ? String(item.manager_id) : undefined,
  managerName: item.manager_name ? String(item.manager_name) : undefined,
  memberIds: Array.isArray(item.member_ids) ? item.member_ids.map(String) : [],
  isActive: Boolean(item.is_active),
  createdAt: item.created_at ? String(item.created_at) : undefined,
  updatedAt: item.updated_at ? String(item.updated_at) : undefined,
});

export const mapTicketRoutingRule = (item: Record<string, unknown>): TicketRoutingRule => ({
  id: String(item.id),
  name: String(item.name),
  unitId: String(item.unit_id),
  unitTitle: String(item.unit_title ?? ""),
  requiredRoleId: String(item.required_role_id),
  roleName: String(item.role_name ?? ""),
  isActive: Boolean(item.is_active),
});

export const mapTicketRoleQueueEntry = (item: Record<string, unknown>): TicketRoleQueueEntry => ({
  id: String(item.id),
  issueId: String(item.issue_id),
  issueName: String(item.issue_name ?? ""),
  issueIdentifier: item.issue_identifier ? String(item.issue_identifier) : undefined,
  projectId: String(item.project_id),
  projectName: String(item.project_name ?? ""),
  ruleId: String(item.rule_id),
  ruleName: String(item.rule_name ?? ""),
  requiredRoleId: String(item.required_role_id),
  roleName: String(item.role_name ?? ""),
  status: String(item.status) as TicketRoleQueueEntry["status"],
  claimedById: item.claimed_by_id ? String(item.claimed_by_id) : undefined,
  claimedByName: item.claimed_by_name ? String(item.claimed_by_name) : undefined,
  createdAt: item.created_at ? String(item.created_at) : undefined,
});

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join(" ");
export const mapMember = (row: Record<string, unknown>, index = 0): Member => {
  const person = (row.member ?? row) as Record<string, unknown>;
  const name = String(person.display_name ?? `${person.first_name ?? ""} ${person.last_name ?? ""}`).trim() || "کاربر";
  return {
    id: String(person.id),
    membershipId: row.id ? String(row.id) : undefined,
    displayName: name,
    email: String(person.email ?? ""),
    timeZone: typeof person.user_timezone === "string" ? person.user_timezone : undefined,
    initials: initials(name),
    avatarUrl: person.avatar_url ? String(person.avatar_url) : person.avatar ? String(person.avatar) : undefined,
    role: Array.isArray(row.organization_roles)
      ? row.organization_roles.map((role) => String((role as { name: string }).name)).join("، ")
      : "",
    roles: Array.isArray(row.organization_roles) ? (row.organization_roles as Member["roles"]) : [],
    isActive: row.is_active !== false && person.is_active !== false,
    avatarColor: ["#4f46e5", "#ec4899", "#0ea5e9", "#f59e0b"][index % 4],
  };
};
export const mapState = (item: Record<string, unknown>): ProjectState => ({
  id: String(item.id),
  name: stateNameFa(item.name ?? "بدون وضعیت"),
  group: String(item.group ?? "unstarted"),
  color: String(item.color ?? "#9ca3af"),
  status: issueStatusFromState(item.group, item.name),
});
export const mapProject = (item: Record<string, unknown>): Project => {
  const lead =
    item.project_lead && typeof item.project_lead === "object"
      ? mapMember(item.project_lead as Record<string, unknown>)
      : undefined;
  const done = Number(item.completed_issue_count ?? 0),
    total = Number(item.total_issue_count ?? 0);
  return {
    id: String(item.id),
    name: String(item.name ?? "پروژه بدون نام"),
    identifier: String(item.identifier ?? "PRJ"),
    description:
      typeof item.description === "string"
        ? item.description
        : typeof item.description_text === "string"
          ? item.description_text
          : "",
    color: String(
      (item.logo_props as { icon?: { color?: string } } | undefined)?.icon?.color ?? item.color ?? "#4f46e5"
    ),
    progress: total ? Math.round((done / total) * 100) : 0,
    totalIssues: total,
    completedIssues: done,
    targetDate: item.target_date ? String(item.target_date) : undefined,
    archivedAt: item.archived_at ? String(item.archived_at) : undefined,
    createdAt: item.created_at ? String(item.created_at) : undefined,
    updatedAt: item.updated_at ? String(item.updated_at) : undefined,
    projectLead: lead,
    projectLeadId: lead?.id ?? (item.project_lead ? String(item.project_lead) : undefined),
    createdById: item.created_by ? String(item.created_by) : undefined,
    memberIds: Array.isArray(item.members) ? item.members.map(String) : [],
  };
};
export const mapIssue = (
  item: Record<string, unknown>,
  projectId: string,
  states: ProjectState[] = [],
  members: Member[] = [],
  projectIdentifier?: string,
  projectName?: string
): Issue => {
  const stateRaw = (item.state_detail ?? item.state) as Record<string, unknown> | string | undefined;
  const stateId =
    typeof stateRaw === "string"
      ? stateRaw
      : stateRaw?.id
        ? String(stateRaw.id)
        : item.state_id
          ? String(item.state_id)
          : undefined;
  const knownState = states.find((state) => state.id === stateId);
  const assigneeRaw = Array.isArray(item.assignees)
    ? item.assignees[0]
    : Array.isArray(item.assignee_details)
      ? item.assignee_details[0]
      : undefined;
  const assigneeId =
    Array.isArray(item.assignee_ids) && item.assignee_ids[0] ? String(item.assignee_ids[0]) : undefined;
  const rawPriority = String(item.priority ?? "none").toLowerCase();
  return {
    id: String(item.id),
    sequenceId: Number(item.sequence_id ?? 0),
    workNumber: item.work_number ? String(item.work_number) : undefined,
    name: String(item.name ?? "کار بدون عنوان"),
    scope: "project",
    projectId,
    projectName: String(
      item.project_name ?? (item.project_detail as { name?: string } | undefined)?.name ?? projectName ?? ""
    ),
    projectIdentifier: String(
      item.project_identifier ??
        (item.project_detail as { identifier?: string } | undefined)?.identifier ??
        projectIdentifier ??
        "PRJ"
    ),
    status:
      knownState?.status ??
      issueStatusFromState(
        typeof stateRaw === "object" ? stateRaw?.group : "",
        typeof stateRaw === "object" ? stateRaw?.name : ""
      ),
    stateId,
    statusCode: stateId,
    statusLabel:
      knownState?.name ??
      (typeof stateRaw === "object" && typeof stateRaw?.name === "string" ? stateNameFa(stateRaw.name) : undefined),
    statusColor: knownState?.color,
    statusOptions: states.map((state) => ({ id: state.id, title: state.name, status: state.status })),
    priorityCode: rawPriority,
    hiddenFields: Array.isArray(item.engine_hidden_fields) ? item.engine_hidden_fields.map(String) : [],
    readonlyFields: Array.isArray(item.engine_readonly_fields) ? item.engine_readonly_fields.map(String) : [],
    priority: (["urgent", "high", "medium", "low", "none"].includes(rawPriority)
      ? `${rawPriority[0].toUpperCase()}${rawPriority.slice(1)}`
      : "None") as Issue["priority"],
    assignee:
      assigneeRaw && typeof assigneeRaw === "object"
        ? mapMember(assigneeRaw as Record<string, unknown>)
        : members.find((member) => member.id === assigneeId),
    senderId: item.created_by
      ? String(typeof item.created_by === "object" ? (item.created_by as { id?: string }).id : item.created_by)
      : undefined,
    sender:
      item.created_by_detail && typeof item.created_by_detail === "object"
        ? mapMember(item.created_by_detail as Record<string, unknown>)
        : members.find((member) => member.id === String(item.created_by)),
    wasAssignedToMe: item.was_assigned_to_me === true,
    archived: item.archived === true,
    dueDate: item.target_date ? String(item.target_date) : undefined,
    completedAt: item.completed_at ? String(item.completed_at) : undefined,
    createdAt: item.created_at ? String(item.created_at) : undefined,
    updatedAt: item.updated_at ? String(item.updated_at) : undefined,
    labels: Array.isArray(item.label_details)
      ? item.label_details.map((label) => String((label as { name?: string }).name ?? "")).filter(Boolean)
      : [],
  };
};
const workspaceTaskStatus: Record<string, Status> = {
  todo: "Todo",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
  blocked: "Blocked",
};
export const mapWorkspaceTask = (item: Record<string, unknown>, members: Member[]): Issue => {
  const assigneeRaw = item.assignee_detail;
  const assigneeId = item.assignee_id ? String(item.assignee_id) : undefined;
  const rawPriority = String(item.priority ?? "none").toLowerCase();
  return {
    id: String(item.id),
    sequenceId: Number(item.sequence_id ?? 0),
    workNumber: item.work_number ? String(item.work_number) : undefined,
    name: String(item.name ?? "کار بدون عنوان"),
    scope: "workspace",
    projectIdentifier: "TEAM",
    status: workspaceTaskStatus[String(item.status)] ?? "Todo",
    statusCode: String(item.status ?? "todo"),
    priorityCode: rawPriority,
    hiddenFields: Array.isArray(item.engine_hidden_fields) ? item.engine_hidden_fields.map(String) : [],
    readonlyFields: Array.isArray(item.engine_readonly_fields) ? item.engine_readonly_fields.map(String) : [],
    priority: (["urgent", "high", "medium", "low", "none"].includes(rawPriority)
      ? `${rawPriority[0].toUpperCase()}${rawPriority.slice(1)}`
      : "None") as Issue["priority"],
    assignee:
      assigneeRaw && typeof assigneeRaw === "object"
        ? mapMember(assigneeRaw as Record<string, unknown>)
        : members.find((member) => member.id === assigneeId),
    senderId: item.created_by
      ? String(typeof item.created_by === "object" ? (item.created_by as { id?: string }).id : item.created_by)
      : undefined,
    sender:
      item.created_by_detail && typeof item.created_by_detail === "object"
        ? mapMember(item.created_by_detail as Record<string, unknown>)
        : members.find((member) => member.id === String(item.created_by)),
    wasAssignedToMe: item.was_assigned_to_me === true,
    archived: item.archived === true,
    dueDate: item.target_date ? String(item.target_date) : undefined,
    completedAt: item.completed_at ? String(item.completed_at) : undefined,
    createdAt: item.created_at ? String(item.created_at) : undefined,
    updatedAt: item.updated_at ? String(item.updated_at) : undefined,
    labels: [],
  };
};

export const mapNotification = presentNotification;
