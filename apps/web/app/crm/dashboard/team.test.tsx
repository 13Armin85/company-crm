import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TeamWidget } from "./team";

vi.mock("./api", () => ({
  useTeamData: () => ({
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
    data: {
      cards: [
        { id: "admin", name: "مدیر سامانه", position: "مدیر", unit: "", unit_id: "", avatar: "" },
        { id: "member", name: "عضو بدون واحد", position: "", unit: "", unit_id: "", avatar: "" },
      ],
    },
  }),
}));

describe("team directory", () => {
  it("shows active members as people without task controls", () => {
    const html = renderToStaticMarkup(<TeamWidget />);
    expect(html).toContain("مدیر سامانه");
    expect(html).toContain("عضو بدون واحد");
    expect(html).not.toContain("ارجاع");
    expect(html).not.toContain("یادآوری");
  });
});
