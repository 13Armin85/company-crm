import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WorkCalendarDayDialog } from "./day-dialog";
import { ALL_LAYERS } from "./model";

vi.mock("@headlessui/react", async (importOriginal) => {
  const original = await importOriginal<typeof import("@headlessui/react")>();
  return {
    ...original,
    Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DialogPanel: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  };
});

vi.mock("../api/work-calendar", () => {
  const mutation = () => ({ mutate: vi.fn(), isPending: false });
  return {
    useWorkCalendar: () => ({
      data: {
        user: { id: "u1", name: "علی" },
        time_zone: "Asia/Tehran",
        today: "2026-11-24",
        restricted: false,
        can_edit: true,
        can_schedule: true,
        events: [],
        is_self: true,
      },
      isLoading: false,
    }),
    useWorkCalendarPeople: () => ({ data: { people: [] } }),
    usePendingActivities: () => ({ data: [] }),
    useScheduleVersions: () => ({ data: [] }),
    useCreateWorkEvent: mutation,
    useCreateScheduleException: mutation,
    useSaveScheduleVersion: mutation,
    useDeclarePresence: mutation,
    useCancelPresence: mutation,
    useConfirmActivity: mutation,
  };
});

describe("work calendar day dialog", () => {
  it("shows a clear navigation and the selected day's content", () => {
    const html = renderToStaticMarkup(
      <WorkCalendarDayDialog
        date="2026-11-24"
        personId=""
        onPersonChange={() => undefined}
        layers={ALL_LAYERS}
        onLayersChange={() => undefined}
        onClose={() => undefined}
      />
    );
    expect(html).toContain('class="work-day-layout"');
    expect(html).toContain('aria-label="بخش‌های روز"');
    expect(html).toContain("برنامهٔ روز");
    expect(html).toContain("ثبت رویداد");
    expect(html).toContain("برنامهٔ هفتگی");
    expect(html).toContain("نمایش تقویم");
    expect(html).toContain("برنامهٔ علی");
  });
});
