import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { TeamCard, TeamData } from "./types";

const card: TeamCard = {
  id: "member-1",
  name: "سارا رضایی",
  position: "کارشناس پشتیبانی",
  unit_id: "unit-1",
  unit: "پشتیبانی",
  unit_depth: 0,
  unit_path: "پشتیبانی",
  team: "پشتیبانی",
  roles: [{ id: "role-1", name: "کارشناس" }],
  presence: "present",
  presence_label: "حاضر",
  reason: "",
  return_at: null,
  substitute: null,
  active_tasks: [{ id: "task-1", number: "CRM-۱۲", title: "پیگیری مشتری", started_at: "2026-11-22T08:00:00Z" }],
  in_progress_count: 1,
  open_count: 3,
  overdue_count: 1,
  capacity: 8,
  workload_percent: 38,
  last_activity: "2026-11-22T08:00:00Z",
  inactive_hours: 0,
  color: "green",
  label: "در حال کار",
};
const team: TeamData = {
  cards: [card],
  summary: { green: 1, gray: 1 },
  settings: { refresh_seconds: 45 },
  empty: null,
};

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: { rules: [], alert_enabled: false, alert_minutes: 30 }, refetch: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  useWorkspaceAccess: () => ({ data: { can: () => false } }),
}));
vi.mock("../store", () => ({
  useUIStore: (selector: (state: { workspaceSlug: string; toast: () => void }) => unknown) =>
    selector({ workspaceSlug: "test", toast: vi.fn() }),
}));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  useTeamData: () => ({ data: team, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() }),
}));

import { TeamWidget } from "./team";

describe("dashboard team overview", () => {
  it("shows team totals, status filters, workload, and current tasks", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TeamWidget />
      </MemoryRouter>
    );
    expect(html).toContain("۲ عضو در تیم");
    expect(html).toContain("همه اعضا");
    expect(html).toContain("در حال کار");
    expect(html).toContain("غایب");
    expect(html).toContain('aria-label="به‌روزرسانی وضعیت تیم"');
    expect(html).toContain("۳۸٪");
    expect(html).toContain('href="/entities/ticket/task-1"');
  });
});
