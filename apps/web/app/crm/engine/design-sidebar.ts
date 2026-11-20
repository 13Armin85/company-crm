export function visibleDesignPages<T extends { code: string }>(pages: T[], selected: string[] | null): T[] {
  if (selected === null) return pages;
  const byCode = new Map(pages.map((page) => [page.code, page]));
  return [...new Set(selected)].flatMap((code) => {
    const page = byCode.get(code);
    return page ? [page] : [];
  });
}
