import { MutationCache, QueryClient } from "@tanstack/react-query";

/** Every business mutation can change a report, including writes from custom entity forms. */
export function createCrmQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
    mutationCache: new MutationCache({
      onSuccess: () =>
        client.invalidateQueries({
          predicate: (query) => ["report-run", "report-catalog"].includes(String(query.queryKey[0])),
          refetchType: "active",
        }),
    }),
  });
  return client;
}
