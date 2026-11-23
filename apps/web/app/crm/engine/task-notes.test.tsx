import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TaskNotes } from "./task-notes";

vi.mock("../store", () => ({
  useUIStore: (selector: (state: { workspaceSlug: string }) => unknown) => selector({ workspaceSlug: "team" }),
}));
vi.mock("../api", () => ({ api: { get: vi.fn(), post: vi.fn() }, errorMessage: () => "خطا" }));

describe("task notes", () => {
  it("shows the shared author, timestamp, message and reply", () => {
    const client = new QueryClient();
    client.setQueryData(
      ["task-notes", "team", "work-1"],
      [
        {
          id: "n1",
          body: "متن فرستنده",
          parent_id: null,
          author: { id: "a", name: "فرستنده" },
          created_at: "2026-11-23T09:00:00Z",
        },
        {
          id: "n2",
          body: "پاسخ گیرنده",
          parent_id: "n1",
          author: { id: "b", name: "گیرنده" },
          created_at: "2026-11-23T10:00:00Z",
        },
      ]
    );
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <TaskNotes id="work-1" />
      </QueryClientProvider>
    );
    expect(html).toContain("متن فرستنده");
    expect(html).toContain("پاسخ گیرنده");
    expect(html).toContain("فرستنده");
    expect(html).toContain("گیرنده");
    expect(html).toContain("task-note-reply");
    expect(html).toContain('dateTime="2026-11-23T09:00:00Z"');
  });
});
