export function visibleDesignPages<T extends { code: string }>(pages: T[], selected: string[] | null): T[] {
  if (selected === null) return pages;
  const positions = new Map(selected.map((code, index) => [code, index]));
  // eslint-disable-next-line unicorn/no-array-sort -- filter creates a private array.
  return pages
    .filter((page) => positions.has(page.code))
    .sort((left, right) => positions.get(left.code)! - positions.get(right.code)!);
}
