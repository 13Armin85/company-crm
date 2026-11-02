import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { useUIStore } from "./store";

export const PAGE_SIZES = [10, 25, 50, 100] as const;

export interface PageEnvelope<T> {
  results: T[];
  count: number;
  page: number;
  page_size: number;
  pages: number;
}

/** Waits until typing pauses so every keystroke does not hit the server. */
export function useDebouncedValue<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Page and page size for one table; the size is remembered per table in this browser. */
export function useTablePaging(table: string, resetKey: unknown) {
  const storageKey = `crm-page-size:${table}`;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState<number>(() => {
    try {
      const stored = Number(localStorage.getItem(storageKey));
      return (PAGE_SIZES as readonly number[]).includes(stored) ? stored : 25;
    } catch {
      return 25;
    }
  });
  const reset = JSON.stringify(resetKey);
  // A new search or filter always starts again from the first page.
  useEffect(() => setPage(1), [reset]);
  return {
    page,
    pageSize,
    setPage,
    setPageSize: (size: number) => {
      setPageSizeState(size);
      setPage(1);
      try {
        localStorage.setItem(storageKey, String(size));
      } catch {
        /* Private mode: the size lasts for this visit only. */
      }
    },
  };
}

type Params = Record<string, string | number | boolean | string[] | undefined | null>;

const toQuery = (params: Params) =>
  Object.fromEntries(
    Object.entries(params)
      .filter(
        ([, value]) => value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && !value.length)
      )
      .map(([key, value]) => [key, Array.isArray(value) ? value.join(",") : String(value)])
  );

/** One server page of a table; the previous page stays on screen while the next one loads. */
export function usePagedTable<Row, Mapped = Row, Extra extends object = object>(options: {
  key: string;
  path: (slug: string) => string;
  params: Params;
  page: number;
  pageSize: number;
  enabled?: boolean;
  map?: (rows: Row[], envelope: PageEnvelope<Row> & Extra) => Mapped[] | Promise<Mapped[]>;
}) {
  const slug = useUIStore((state) => state.workspaceSlug) || "";
  const query = toQuery(options.params);
  return useQuery({
    queryKey: [options.key, slug, "page", query, options.page, options.pageSize],
    enabled: Boolean(slug) && options.enabled !== false,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const envelope = (
        await api.get<PageEnvelope<Row> & Extra>(options.path(slug), {
          params: { ...query, page: options.page, page_size: options.pageSize },
          signal,
        })
      ).data;
      const rows = options.map
        ? await options.map(envelope.results, envelope)
        : (envelope.results as unknown as Mapped[]);
      return { ...envelope, rows };
    },
  });
}
