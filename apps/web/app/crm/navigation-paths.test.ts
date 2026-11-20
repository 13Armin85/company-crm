import { describe, expect, it } from "vitest";
import {
  categoryEntries,
  categoryForRoute,
  categoryUrl,
  logicalPath,
  type NavigationDocument,
} from "./navigation-paths";
import { canAccessPath } from "./access/permission-map";

const document = {
  categories: [],
  routes: [
    { path: "/", category: "home" },
    { path: "/roles", category: "company" },
    { path: "/settings", category: "settings" },
    { path: "/settings/engine", category: "settings" },
    { path: "/daily-report", category: "home" },
    { path: "/daily-report/team", category: "reports" },
  ],
  entities: [{ code: "contracts", category: "data" }],
} as unknown as NavigationDocument;

describe("database navigation URLs", () => {
  it("opens a member category containing authorized custom pages without designer menu items", () => {
    const memberDocument = {
      ...document,
      categories: [{ id: "data", items: [] }],
      entities: [
        { code: "contracts", title: "قراردادها", category: "data", to: "/sections/data/entities/contracts" },
        { code: "other", title: "دیگر", category: "work", to: "/sections/work/entities/other" },
      ],
    } as unknown as NavigationDocument;
    expect(categoryEntries(memberDocument, "data")).toEqual([
      { code: "contracts", label: "قراردادها", to: "/sections/data/entities/contracts" },
    ]);
    expect(categoryEntries(memberDocument, "missing")).toEqual([]);
    expect(categoryEntries(undefined, "data")).toEqual([]);
    expect(canAccessPath("/sections/data/entities", () => false)).toBe(false);
  });

  it("keeps the configured menu label when a native page points to the same URL", () => {
    const shared = { code: "projects", label: "پروژه‌های مجاز", to: "/sections/work/projects" };
    const sharedDocument = {
      categories: [{ id: "work", items: [shared] }],
      entities: [{ code: "project", title: "پروژه", category: "work", to: shared.to }],
    } as unknown as NavigationDocument;
    expect(categoryEntries(sharedDocument, "work")).toEqual([shared]);
  });
  it("uses the configured category, including descendants and custom pages", () => {
    expect(categoryUrl(document, "/roles/123/permissions")).toBe("/sections/company/roles/123/permissions");
    expect(categoryForRoute(document, "/daily-report/team")).toBe("reports");
    expect(categoryUrl(document, "/entities/contracts/123")).toBe("/sections/data/entities/contracts/123");
    expect(categoryUrl(document, "/edit/contracts/123")).toBe("/sections/data/edit/contracts/123");
    expect(categoryUrl(document, "/")).toBe("/sections/home");
  });
  it("canonicalizes old categories and preserves encoded search and hash", () => {
    expect(categoryUrl(document, "/sections/old/roles?next=%2Fa%3Fb#details")).toBe(
      "/sections/company/roles?next=%2Fa%3Fb#details"
    );
    expect(categoryUrl(document, "/settings/engine?page=roles&category=company&tab=table")).toBe(
      "/sections/settings/settings/engine?page=roles&category=company&tab=table"
    );
    expect(categoryUrl(document, "//example.com/roles")).toBe("//example.com/roles");
    expect(logicalPath("/portal/sections/org")).toBe("/portal/sections/org");
  });
  it("keeps permission checks effective for categorized URLs", () => {
    expect(canAccessPath("/sections/company/roles/123/permissions", () => false)).toBe(false);
    expect(canAccessPath("/sections/company/roles/123/permissions", (code) => code === "Role.Permission.Assign")).toBe(
      true
    );
    expect(canAccessPath("/sections/settings/settings/engine", () => false)).toBe(false);
  });
});
