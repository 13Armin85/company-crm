import { logicalPath } from "../navigation-paths";

export const pagePermissions: Record<string, string> = {
  "/": "Dashboard.Personal.Manage",
  "/my-work": "Issue.View",
  "/calendar": "Issue.View",
  "/team": "User.View",
  "/organization": "OrganizationUnit.View",
  "/roles": "Role.View",
  "/absences": "Absence.View",
  "/issues": "Issue.View",
  "/routing": "Routing.Queue.View",
  "/projects": "Project.View",
  "/workflow-inbox": "Workflow.View",
  "/leave-requests": "Workflow.View",
  "/leave-templates": "LeaveTemplate.Manage",
  "/signatures": "Signature.Manage",
};

export function permissionsForPath(pathname: string): string[] {
  pathname = logicalPath(pathname);
  const paths = Object.keys(pagePermissions);
  paths.sort((left, right) => right.length - left.length);
  const path = paths.find((entry) => pathname === entry || (entry !== "/" && pathname.startsWith(`${entry}/`)));
  if (!path) return [];
  return path === "/issues" ? ["Issue.View", pagePermissions[path]] : [pagePermissions[path]];
}

export function canAccessPath(pathname: string, can: (code: string) => boolean): boolean {
  pathname = logicalPath(pathname);
  if (pathname.startsWith("/sections/")) return false;
  if (pathname.replace(/\/+$/, "") === "/entities") return can("EntityType.View") || can("FormDesigner.View");
  if (pathname.startsWith("/settings/engine"))
    return [
      "FormDesigner.View",
      "UniqueRule.Manage",
      "NumberingRule.Manage",
      "Relation.View",
      "Field.View",
      "View.Official.Manage",
      "Workflow.Design",
    ].some(can);
  if (pathname.startsWith("/daily-report/team"))
    return can(reportPermissions.teamDaily) || can(reportPermissions.viewAll);
  if (pathname.startsWith("/daily-report/settings"))
    return can(reportPermissions.submit) || can(reportPermissions.manageReminders);
  if (pathname.startsWith("/daily-report")) return can(reportPermissions.submit) || can(reportPermissions.teamDaily);
  if (pathname.startsWith("/reports")) return can(reportPermissions.view) || can(reportPermissions.viewAll);
  if (pathname.startsWith("/portal-settings")) return Object.values(portalPermissions).some(can);
  if (/^\/roles\/[^/]+\/permissions\/?$/.test(pathname)) return can("Role.View") || can("Role.Permission.Assign");
  return permissionsForPath(pathname).every(can);
}

/** Ticket 6: leave requests. Seeing a request is decided per row on the server (own, approver,
 * manager or ViewAll); these codes only show or hide pages and buttons. */
export const leavePermissions = {
  create: "LeaveRequest.Create",
  viewAll: "LeaveRequest.ViewAll",
  manageTemplates: "LeaveTemplate.Manage",
  manageSignatures: "Signature.Manage",
} as const;

/** Ticket 5 action permissions (the server enforces the same codes). Extension approval has no code:
 * it follows the "direct manager / active delegate" relation only. */
export const ticketActionPermissions = {
  setTarget: "Ticket.TargetSet",
  manageRules: "Routing.Manage",
  viewRules: "Routing.View",
  manageQueue: "Routing.Queue.ViewAll",
  route: "Routing.Route",
} as const;

/** Ticket 7: customer portal. The server enforces the same codes on every internal portal endpoint. */
export const portalPermissions = {
  manageAccounts: "Portal.Account.Manage",
  manageSettings: "Portal.Settings.Manage",
  triage: "Portal.Request.Triage",
  reply: "Portal.Reply",
  manageQuotes: "Quote.Manage",
  viewFeedback: "Portal.Feedback.View",
} as const;

/** Ticket 8: daily reports and reports. A "team" code never widens data by itself: the server
 * computes each viewer's scope (self + organization + active delegation) on every run. */
export const reportPermissions = {
  submit: "DailyReport.Submit",
  teamDaily: "DailyReport.Team.View",
  manageReminders: "DailyReport.Reminder.Manage",
  view: "Report.View",
  team: "Report.Team.View",
  viewAll: "Report.ViewAll",
  build: "Report.Build",
  share: "Report.Share",
  export: "Report.Export",
} as const;
