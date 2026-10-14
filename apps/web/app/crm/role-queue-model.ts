import type { TicketRoleQueueEntry } from "./types";
import { toFa } from "./utils";
import { matchesRecordSearch } from "./identifiers";

export type QueueSort = "oldest" | "newest";
export interface QueueFilters {
  search: string;
  roleId: string;
  projectId: string;
  sort: QueueSort;
}

const entryTime = (entry: TicketRoleQueueEntry) => {
  const time = entry.createdAt ? Date.parse(entry.createdAt) : NaN;
  return Number.isFinite(time) ? time : undefined;
};

export function filterRoleQueue(entries: TicketRoleQueueEntry[], filters: QueueFilters) {
  return (
    entries
      .filter(
        (entry) =>
          entry.status === "open" &&
          (!filters.roleId || entry.requiredRoleId === filters.roleId) &&
          (!filters.projectId || entry.projectId === filters.projectId) &&
          matchesRecordSearch(filters.search, [
            entry.id,
            entry.issueId,
            entry.issueIdentifier,
            entry.projectId,
            entry.ruleId,
            entry.requiredRoleId,
            entry.issueName,
            entry.projectName,
            entry.roleName,
            entry.ruleName,
          ])
      )
      // eslint-disable-next-line unicorn/no-array-sort -- filter created a new array; support the ES2022 browser target.
      .sort((a, b) => {
        const first = entryTime(a);
        const second = entryTime(b);
        // Undated entries stay at the end in either direction.
        if (first === undefined) return second === undefined ? 0 : 1;
        if (second === undefined) return -1;
        return filters.sort === "oldest" ? first - second : second - first;
      })
  );
}

export function queueWaitLabel(entry: TicketRoleQueueEntry, now = Date.now()) {
  const time = entryTime(entry);
  if (time === undefined) return "زمان ثبت نامشخص";
  const minutes = Math.max(0, Math.floor((now - time) / 60_000));
  if (minutes < 1) return "کمتر از یک دقیقه";
  if (minutes < 60) return `${toFa(minutes)} دقیقه`;
  if (minutes < 1440) return `${toFa(Math.floor(minutes / 60))} ساعت`;
  return `${toFa(Math.floor(minutes / 1440))} روز`;
}

export function isLongWaiting(entry: TicketRoleQueueEntry, now = Date.now()) {
  const time = entryTime(entry);
  return time !== undefined && now - time >= 86_400_000;
}
