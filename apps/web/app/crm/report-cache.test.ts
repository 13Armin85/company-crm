import { QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { createCrmQueryClient } from "./report-cache";

describe("reports connected to application writes", () => {
  it("invalidates saved/base report results in every workspace after a successful mutation", async () => {
    const client = createCrmQueryClient();
    for (const slug of ["company-a", "company-b"]) {
      client.setQueryData(["report-run", slug, "leave"], { count: 1 });
      client.setQueryData(["report-catalog", slug], { sources: [] });
    }
    client.setQueryData(["unrelated", "company-a"], "kept");
    await client
      .getMutationCache()
      .build(client, { mutationFn: async () => "absence saved" })
      .execute(undefined);
    for (const slug of ["company-a", "company-b"]) {
      expect(client.getQueryState(["report-run", slug, "leave"])?.isInvalidated).toBe(true);
      expect(client.getQueryState(["report-catalog", slug])?.isInvalidated).toBe(true);
    }
    expect(client.getQueryState(["unrelated", "company-a"])?.isInvalidated).toBe(false);
    client.clear();
  });
  it("refreshes an open report after a write from any business form", async () => {
    const client = createCrmQueryClient();
    const key = ["report-run", "company", "leave"];
    let records = 1;
    const queryFn = async () => records;
    await client.fetchQuery({ queryKey: key, queryFn });
    const observer = new QueryObserver(client, { queryKey: key, queryFn, staleTime: Infinity });
    const unsubscribe = observer.subscribe(() => {});
    await client
      .getMutationCache()
      .build(client, {
        mutationFn: async () => {
          records = 2;
        },
      })
      .execute(undefined);
    expect(client.getQueryData(key)).toBe(2);
    unsubscribe();
    client.clear();
  });
  it("keeps cached reports intact when a save fails", async () => {
    const client = createCrmQueryClient();
    const key = ["report-run", "company", "projects"];
    client.setQueryData(key, { count: 3 });
    await expect(
      client
        .getMutationCache()
        .build(client, {
          mutationFn: async () => {
            throw new Error("Save rejected");
          },
        })
        .execute(undefined)
    ).rejects.toThrow("Save rejected");
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    client.clear();
  });
});
