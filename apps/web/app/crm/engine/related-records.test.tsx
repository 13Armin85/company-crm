import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { useUIStore } from "../store";
import { RelatedRecords } from "./related-records";

const state = vi.hoisted(() => ({ fields: [] as (typeof project)[] }));

vi.mock("../api", async () => ({
  ...(await vi.importActual<typeof import("../api")>("../api")),
  useWorkspaceAccess: () => ({ data: { can: () => true } }),
}));
vi.mock("./api", async () => ({
  ...(await vi.importActual<typeof import("./api")>("./api")),
  useEngineSchema: () => ({ data: { fields: state.fields } }),
}));

const project = { code: "project", title: "پروژه", kind: "relation", config: {}, relation_entity: "project" };
const customer = { code: "customer", title: "مشتری", kind: "relation", config: {}, relation_entity: "customer" };

function renderRelatedRecords(code: string, fields: (typeof project)[]) {
  const client = new QueryClient();
  state.fields = fields;
  useUIStore.setState({ workspaceSlug: "workspace" });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <RelatedRecords code={code} id="record" />
    </QueryClientProvider>
  );
  client.clear();
  return html;
}

describe("related records in work forms", () => {
  it.each(["ticket", "task"])("hides the project button for %s", (code) => {
    const html = renderRelatedRecords(code, [project, customer]);
    expect(html).toContain("مشتری");
    expect(html).not.toContain("پروژه");
    expect(renderRelatedRecords(code, [project])).toBe("");
  });

  it("keeps project relations on other entity forms", () => {
    expect(renderRelatedRecords("customer", [project])).toContain("پروژه");
  });
});
