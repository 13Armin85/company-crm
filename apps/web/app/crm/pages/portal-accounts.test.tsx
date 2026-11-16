import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PortalAccountRow } from "../api/portal";
import { accountState, filterAccounts } from "./portal-account-model";

const state = vi.hoisted(() => ({ rows: [] as PortalAccountRow[], loading: false, error: null as Error | null }));
vi.mock("../api/portal", async (original) => ({
  ...(await original<typeof import("../api/portal")>()),
  usePortalAccounts: () => ({ data: state.rows, isLoading: state.loading, error: state.error, refetch: vi.fn() }),
  usePortalAccountOptions: () => ({ data: { customer: [], contact: [] }, isLoading: false }),
  useCreatePortalAccount: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdatePortalAccount: () => ({ mutate: vi.fn(), isPending: false }),
  useIssuePortalLink: () => ({ mutate: vi.fn(), isPending: false }),
}));
import { Accounts } from "./portal-settings";

const account = (values: Partial<PortalAccountRow> = {}): PortalAccountRow => ({
  id: "account-1",
  username: "sara.customer",
  display_name: "سارا کیانی",
  email: "sara@example.com",
  phone: "09121234567",
  is_active: true,
  has_password: true,
  locked: false,
  last_login_at: null,
  customer: { id: "customer-1", title: "شرکت کیان" },
  contact: { id: "contact-1", title: "علی رضایی" },
  ...values,
});
beforeEach(() => {
  state.rows = [account()];
  state.loading = false;
  state.error = null;
});

describe("customer account list", () => {
  it("keeps both actions inside one table cell and preserves long customer and account text", () => {
    state.rows = [account({ display_name: "نام نمایشی طولانی مشتری برای بررسی چیدمان جدول" })];
    const html = renderToStaticMarkup(<Accounts />);
    expect(html).toContain('<td><div class="portal-account-actions">');
    expect(html).not.toContain('<td class="leave-actions"');
    expect(html.match(/<td>/g)).toHaveLength(6);
    expect(html).toContain('scope="col"');
    expect(html).toContain("نام نمایشی طولانی مشتری برای بررسی چیدمان جدول");
    expect(html).toContain("شرکت کیان");
    expect(html).toContain("مخاطب: علی رضایی");
    expect(html).toContain('<bdi class="portal-account-username" dir="ltr">sara.customer</bdi>');
    expect(html).toContain("بازنشانی گذرواژه");
  });
  it("offers activation, with no password link, for inactive accounts", () => {
    state.rows = [account({ is_active: false, locked: true })];
    const html = renderToStaticMarkup(<Accounts />);
    expect(html).toContain("فعال‌سازی");
    expect(html).not.toContain("بازنشانی گذرواژه");
    expect(html).toContain("portal-account-status is-inactive");
  });
  it("explains a first login and an account awaiting its password", () => {
    state.rows = [account({ has_password: false })];
    const html = renderToStaticMarkup(<Accounts />);
    expect(html).toContain("هنوز وارد نشده");
    expect(html).toContain("پیوند تعیین گذرواژه");
    expect(html).toContain("portal-account-status is-pending");
  });
  it("shows an actionable empty state and avoids a perpetual skeleton after a fetch error", () => {
    state.rows = [];
    expect(renderToStaticMarkup(<Accounts />)).toContain("هنوز حساب مشتری ساخته نشده است");
    state.error = new Error("Unavailable");
    const html = renderToStaticMarkup(<Accounts />);
    expect(html).toContain("تلاش دوباره");
    expect(html).not.toContain("skeleton-row");
    expect(html).not.toContain("هنوز حساب مشتری ساخته نشده است");
  });
  it("normalizes Persian/Arabic search and searches the customer, contact, phone and email", () => {
    for (const query of ["كياني", "كيان", "علي", "۰۹۱۲۱۲۳۴۵۶۷", "SARA@EXAMPLE.COM", "SARA.CUSTOMER"])
      expect(filterAccounts([account()], query, "all")).toHaveLength(1);
    expect(filterAccounts([account()], "ناشناخته", "all")).toHaveLength(0);
    expect(filterAccounts([account()], "سارا", "inactive")).toHaveLength(0);
  });
  it("keeps locked and pending users separate from usable active accounts", () => {
    const rows = [
      account(),
      account({ id: "locked", locked: true }),
      account({ id: "pending", has_password: false }),
      account({ id: "inactive", is_active: false, locked: true }),
    ];
    expect(filterAccounts(rows, "", "active").map((row) => row.id)).toEqual(["account-1"]);
    expect(filterAccounts(rows, "", "locked").map((row) => row.id)).toEqual(["locked"]);
    expect(filterAccounts(rows, "", "pending").map((row) => row.id)).toEqual(["pending"]);
    expect(accountState(rows[3])).toBe("inactive");
  });
});
