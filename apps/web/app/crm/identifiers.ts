import { normalizePersianSearch } from "@plane/ui";
import type { Issue, OrganizationUnit } from "./types";

export const issueReference = (issue: Pick<Issue, "scope" | "projectIdentifier" | "sequenceId">) =>
  `${issue.scope === "workspace" ? "TEAM" : issue.projectIdentifier}-${issue.sequenceId}`;

export function matchesRecordSearch(query: string, values: (string | undefined)[]) {
  const search = normalizePersianSearch(query);
  return !search || values.some((value) => value && normalizePersianSearch(value).includes(search));
}

export function organizationSearchIds(units: OrganizationUnit[], query: string) {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const visible = new Set<string>();
  for (const unit of units) {
    if (!matchesRecordSearch(query, [unit.id, unit.title, unit.managerName])) continue;
    let current: OrganizationUnit | undefined = unit;
    while (current && !visible.has(current.id)) {
      visible.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }
  return visible;
}
