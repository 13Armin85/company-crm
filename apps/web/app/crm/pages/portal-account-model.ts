import type { PortalAccountRow } from "../api/portal";
import { matchesRecordSearch } from "../identifiers";

export const accountStates = {
  active: "فعال",
  pending: "منتظر تعیین گذرواژه",
  locked: "قفل موقت",
  inactive: "غیرفعال",
} as const;
export type AccountState = keyof typeof accountStates;

export function accountState(account: Pick<PortalAccountRow, "is_active" | "locked" | "has_password">): AccountState {
  if (!account.is_active) return "inactive";
  if (account.locked) return "locked";
  return account.has_password ? "active" : "pending";
}

export function filterAccounts(accounts: PortalAccountRow[], query: string, status: AccountState | "all") {
  return accounts.filter(
    (account) =>
      (status === "all" || accountState(account) === status) &&
      matchesRecordSearch(query, [
        account.display_name,
        account.username,
        account.email,
        account.phone,
        account.customer.title,
        account.contact?.title,
      ])
  );
}
