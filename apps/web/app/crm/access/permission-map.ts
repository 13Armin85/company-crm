export const pagePermissions: Record<string, string> = {
  "/": "Issue.View",
  "/my-work": "Issue.View",
  "/calendar": "Issue.View",
  "/team": "User.View",
  "/organization": "OrganizationUnit.View",
  "/roles": "Role.View",
  "/absences": "Absence.View",
  "/issues": "Issue.ViewAll",
  "/routing": "Routing.Queue.View",
  "/projects": "Project.View",
};

export function permissionsForPath(pathname: string): string[] {
  const paths = Object.keys(pagePermissions);
  paths.sort((left, right) => right.length - left.length);
  const path = paths.find((entry) => pathname === entry || (entry !== "/" && pathname.startsWith(`${entry}/`)));
  if (!path) return [];
  return path === "/issues" ? ["Issue.View", pagePermissions[path]] : [pagePermissions[path]];
}

export function canAccessPath(pathname: string, can: (code: string) => boolean): boolean {
  if (/^\/roles\/[^/]+\/permissions\/?$/.test(pathname)) return can("Role.View") || can("Role.Permission.Assign");
  return permissionsForPath(pathname).every(can);
}
