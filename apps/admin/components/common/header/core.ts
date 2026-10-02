/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export const CORE_HEADER_SEGMENT_LABELS: Record<string, string> = {
  general: "تنظیمات عمومی",
  ai: "هوش مصنوعی",
  email: "ایمیل",
  authentication: "ورود و امنیت",
  image: "کتابخانه تصاویر",
  google: "Google",
  github: "GitHub",
  gitlab: "GitLab",
  gitea: "Gitea",
  workspace: "فضاهای کاری",
  create: "ایجاد فضای کاری",
};

const normalizeAdminPath = (pathname: string) =>
  "/" +
  pathname
    .split(/[?#]/, 1)[0]
    .split("/")
    .filter(Boolean)
    .filter((segment, index) => index !== 0 || segment !== "god-mode")
    .join("/");

export function isAdminRouteActive(pathname: string, href: string): boolean {
  const current = normalizeAdminPath(pathname);
  const target = normalizeAdminPath(href);
  return current === target || current.startsWith(target + "/");
}

export function generateBreadcrumbItems(pathname: string, labels: Record<string, string> = CORE_HEADER_SEGMENT_LABELS) {
  const segments = normalizeAdminPath(pathname).split("/").filter(Boolean);
  return segments.map((segment, index) => ({
    title: labels[segment] ?? segment.toUpperCase(),
    href: "/" + segments.slice(0, index + 1).join("/") + "/",
  }));
}
