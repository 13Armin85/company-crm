const storagePrefix = "crm-design-sidebar:";

export function readDesignSidebar(workspace: string): string[] | null {
  if (!workspace || typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(`${storagePrefix}${workspace}`);
    if (value === null) return null;
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? [...new Set(parsed)] : null;
  } catch {
    return null;
  }
}

export function saveDesignSidebar(workspace: string, codes: string[]) {
  if (!workspace || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${storagePrefix}${workspace}`, JSON.stringify([...new Set(codes)]));
  } catch {
    // The current selection remains usable if browser storage is unavailable.
  }
}

export function visibleDesignPages<T extends { code: string }>(pages: T[], selected: string[] | null): T[] {
  if (selected === null) return pages;
  const positions = new Map(selected.map((code, index) => [code, index]));
  return pages
    .filter((page) => positions.has(page.code))
    .toSorted((left, right) => positions.get(left.code)! - positions.get(right.code)!);
}
