import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { filterRoleQueue, isLongWaiting, queueWaitLabel } from "./role-queue-model";
import type { QueueFilters } from "./role-queue-model";
import type { TicketRoleQueueEntry } from "./types";

const state = vi.hoisted(() => ({
  entries: [] as TicketRoleQueueEntry[],
  loading: false,
  error: false,
  pending: false,
  claimError: false,
  claimId: undefined as string | undefined,
}));
vi.mock("./api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api")>();
  return {
    ...original,
    useTicketRoleQueue: () => ({
      data: state.entries,
      isLoading: state.loading,
      isError: state.error,
      isFetching: state.loading,
      refetch: vi.fn(),
    }),
    useClaimTicketRoleQueue: () => ({
      isPending: state.pending,
      isError: state.claimError,
      variables: state.claimId,
      mutate: vi.fn(),
    }),
  };
});
import { RoleQueue } from "./role-queue";

const entry: TicketRoleQueueEntry = {
  id: "entry-1",
  issueId: "issue-1",
  issueName: "پيگيري درخواست کاربر ۱۲",
  projectId: "project-1",
  projectName: "پروژه پشتیبانی",
  ruleId: "rule-1",
  ruleName: "مسیر خدمات",
  requiredRoleId: "role-1",
  roleName: "کارشناس پشتیبانی",
  status: "open",
  createdAt: "2026-10-13T09:00:00Z",
};
const entries: TicketRoleQueueEntry[] = [
  entry,
  {
    ...entry,
    id: "entry-2",
    issueName: "فاکتور فروش",
    projectId: "project-2",
    projectName: "پروژه فروش",
    createdAt: "2026-10-14T09:00:00Z",
  },
  {
    ...entry,
    id: "entry-3",
    issueName: "تنظیم حساب",
    requiredRoleId: "role-2",
    roleName: "حسابدار",
    createdAt: "2026-10-12T09:00:00Z",
  },
  { ...entry, id: "entry-4", status: "claimed" },
  { ...entry, id: "entry-5", status: "closed" },
];
const filters: QueueFilters = { search: "", roleId: "", projectId: "", sort: "oldest" };
const render = (canClaim = true, canViewProject = true) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <RoleQueue canClaim={canClaim} canViewAll={false} canViewProject={canViewProject} />
    </MemoryRouter>
  );
beforeEach(() => {
  state.entries = [...entries];
  state.loading = false;
  state.error = false;
  state.pending = false;
  state.claimError = false;
  state.claimId = undefined;
});

describe("role queue filtering and wait times", () => {
  it("only lists open entries, prioritizes the oldest, and preserves the source order", () => {
    expect(filterRoleQueue(entries, filters).map((row) => row.id)).toEqual(["entry-3", "entry-1", "entry-2"]);
    expect(entries[0].id).toBe("entry-1");
  });
  it("searches names using Persian letter and digit normalization", () => {
    expect(filterRoleQueue(entries, { ...filters, search: "پیگیری درخواست کاربر 12" }).map((row) => row.id)).toEqual([
      "entry-1",
    ]);
    expect(filterRoleQueue(entries, { ...filters, search: "حسابدار" }).map((row) => row.id)).toEqual(["entry-3"]);
    expect(filterRoleQueue(entries, { ...filters, search: "مسیر خدمات" })).toHaveLength(3);
  });
  it("combines role, project and text constraints", () => {
    expect(
      filterRoleQueue(entries, { ...filters, roleId: "role-1", projectId: "project-2", search: "فاکتور" }).map(
        (row) => row.id
      )
    ).toEqual(["entry-2"]);
    expect(filterRoleQueue(entries, { ...filters, roleId: "role-2", projectId: "project-2" })).toEqual([]);
  });
  it.each(["oldest", "newest"] as const)("keeps missing and invalid dates at the end when sorted by %s", (sort) => {
    const source = [
      ...entries,
      { ...entry, id: "no-date", createdAt: undefined },
      { ...entry, id: "bad-date", createdAt: "invalid" },
    ];
    expect(
      filterRoleQueue(source, { ...filters, sort })
        .slice(-2)
        .map((row) => row.id)
    ).toEqual(["no-date", "bad-date"]);
    expect(filterRoleQueue(entries, { ...filters, sort })[0].id).toBe(sort === "oldest" ? "entry-3" : "entry-2");
  });
  it("reports Persian waiting durations and never reports a negative duration", () => {
    const time = Date.parse(entry.createdAt!);
    expect(queueWaitLabel(entry, time - 60_000)).toBe("کمتر از یک دقیقه");
    expect(queueWaitLabel(entry, time + 12 * 60_000)).toBe("۱۲ دقیقه");
    expect(queueWaitLabel(entry, time + 3 * 3_600_000)).toBe("۳ ساعت");
    expect(queueWaitLabel(entry, time + 2 * 86_400_000)).toBe("۲ روز");
    expect(queueWaitLabel({ ...entry, createdAt: "invalid" }, time)).toBe("زمان ثبت نامشخص");
    expect(isLongWaiting(entry, time + 86_400_000)).toBe(true);
    expect(isLongWaiting({ ...entry, createdAt: undefined }, time)).toBe(false);
  });
});

describe("role queue presentation and permissions", () => {
  it("labels each card's role, project, routing rule and date in Persian", () => {
    const html = render();
    expect(html).toContain("صف کارهای نقش‌ها");
    expect(html).toContain("مسیر ارجاع");
    expect(html).toMatch(/dateTime="2026-10-13T09:00:00Z"/i);
    expect(html).toContain('href="/projects/project-1"');
    expect(html).not.toContain("Role Queue");
    expect(html.match(/<article/g)).toHaveLength(3);
  });
  it("hides claim actions for viewers and project links without project access", () => {
    const html = render(false, false);
    expect(html).not.toContain('aria-label="پذیرش کار');
    expect(html).not.toContain('href="/projects/');
    expect(html).toContain("دسترسی دریافت از صف");
  });
  it("marks only the requested card as busy while blocking repeat submissions", () => {
    state.pending = true;
    state.claimId = "entry-2";
    const html = render();
    expect(html.match(/aria-busy="true"/g)).toHaveLength(1);
    expect(html.match(/<button[^>]*disabled=""[^>]*aria-label="پذیرش کار/g)).toHaveLength(3);
    expect(html).toContain("در حال دریافت…");
  });
  it("shows a retryable fetch failure instead of a misleading empty queue", () => {
    state.entries = [];
    state.error = true;
    const html = render();
    expect(html).toContain('role="alert"');
    expect(html).toContain("تلاش دوباره");
    expect(html).not.toContain("کاری در انتظار پذیرش نیست");
    expect(html).not.toContain("role-queue-summary");
  });
  it("keeps previously loaded cards visible during refresh failures", () => {
    state.error = true;
    expect(render()).toContain("نتایج قبلی نمایش داده می‌شود.");
    expect(render().match(/<article/g)).toHaveLength(3);
  });
  it("retains the failed claim and explains that the user can retry", () => {
    state.claimError = true;
    state.claimId = "entry-2";
    const html = render();
    expect(html).toContain("دریافت کار انجام نشد؛ دوباره تلاش کنید.");
    expect(html.match(/<article/g)).toHaveLength(3);
    expect(html).not.toContain('aria-busy="true"');
  });
  it("distinguishes a genuinely empty queue from loading", () => {
    state.entries = [];
    expect(render()).toContain("کاری در انتظار پذیرش نیست");
    state.loading = true;
    expect(render()).not.toContain("کاری در انتظار پذیرش نیست");
  });
});
