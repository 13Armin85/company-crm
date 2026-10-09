import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({ api: { get: vi.fn() }, errorMessage: vi.fn() }));
import { useAccess } from "./api";

function Probe({ slug }: { slug: string }) {
  const { data } = useAccess(slug);
  return <span>{data?.can("User.Delete") ? "privileged-action" : "denied"}</span>;
}

const render = (client: QueryClient, slug: string) =>
  renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <Probe slug={slug} />
    </QueryClientProvider>
  );

describe("workspace permission cache", () => {
  it("hides previously granted actions when refresh is rejected", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["workspace-access", "company"];
    client.setQueryData(key, { permissions: ["User.Delete"], can: (code: string) => code === "User.Delete" });
    expect(render(client, "company")).toContain("privileged-action");
    await expect(
      client.fetchQuery({ queryKey: key, queryFn: () => Promise.reject(new Error("Membership removed")) })
    ).rejects.toThrow();
    expect(render(client, "company")).toContain("denied");
    client.clear();
  });

  it("never uses another workspace's cached permissions", () => {
    const client = new QueryClient();
    client.setQueryData(["workspace-access", "company"], { permissions: ["User.Delete"], can: () => true });
    expect(render(client, "other")).toContain("denied");
    client.clear();
  });
});
