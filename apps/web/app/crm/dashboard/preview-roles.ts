import { normalizePersianSearch } from "@plane/ui";
import type { OrganizationRole } from "../types";

const hiddenPreviewRoleNames = new Set(["حسابدار", "accountant"]);

export function dashboardPreviewRoles(roles: OrganizationRole[]): OrganizationRole[] {
  return roles.filter((role) => !hiddenPreviewRoleNames.has(normalizePersianSearch(role.name)));
}
