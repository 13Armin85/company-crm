export type NavigationPage = { code: string; title: string; category: string; path: string; to: string; kind: string };
export type NavigationItem = { code: string; path: string; to: string; label: string; icon: string; end: boolean };
export type NavigationCategory = {
  id: string;
  label: string;
  title: string;
  icon: string;
  to: string;
  items: NavigationItem[];
};
export type NavigationDocument = {
  categories: NavigationCategory[];
  routes: (NavigationItem & { category: string })[];
  entities: NavigationPage[];
  design_pages: NavigationPage[];
  design_tabs: { id: string; label: string; hint: string }[];
  all_design_title: string;
  preferences: { design_sidebar: string[] | null };
};

/** Entries authorized by the server, including categories with custom pages only. */
export function categoryEntries(document: NavigationDocument | undefined, code: string) {
  if (!document) return [];
  const category = document.categories.find((item) => item.id === code);
  if (!category) return [];
  const entries = [
    ...category.items.map((item) => ({ code: item.code, label: item.label, to: item.to })),
    ...document.entities
      .filter((page) => page.category === code)
      .map((page) => ({ code: page.code, label: page.title, to: page.to })),
  ];
  const unique = new Map<string, (typeof entries)[number]>();
  for (const entry of entries) if (!unique.has(entry.to)) unique.set(entry.to, entry);
  return Array.from(unique.values());
}

/** Only the explicit CRM namespace is removed; portal and API URLs are untouched. */
export function logicalPath(pathname: string): string {
  return pathname.replace(/^\/sections\/[a-z][a-z0-9-]{0,39}(?=\/|$)/, "") || "/";
}

export function categoryForRoute(document: NavigationDocument, pathname: string): string | undefined {
  const path = logicalPath(pathname);
  if (path.startsWith("/edit/task/")) return categoryForRoute(document, "/my-work");
  const entity = document.entities.find(
    (item) =>
      path === `/entities/${item.code}` ||
      path.startsWith(`/entities/${item.code}/`) ||
      path.startsWith(`/edit/${item.code}/`)
  );
  if (entity) return entity.category;
  const edit = /^\/edit\/([^/]+)\//.exec(path);
  if (edit) return document.design_pages?.find((page) => page.code === edit[1])?.category;
  const candidates = document.routes.filter(
    (item) => item.path === path || (item.path !== "/" && path.startsWith(`${item.path}/`))
  );
  // eslint-disable-next-line unicorn/no-array-sort -- Sort a new array without requiring ES2023.
  return candidates.sort((left, right) => right.path.length - left.path.length)[0]?.category;
}

export function categoryUrl(document: NavigationDocument | undefined, target: string): string {
  if (!document || !target.startsWith("/") || target.startsWith("//")) return target;
  const [, path, suffix] = /^([^?#]*)(.*)$/s.exec(target)!;
  const normalized = logicalPath(path);
  const category = categoryForRoute(document, normalized);
  return category ? `/sections/${category}${normalized === "/" ? "" : normalized}${suffix}` : target;
}
