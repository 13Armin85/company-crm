import assert from "node:assert/strict";
import { test } from "node:test";
import { generateBreadcrumbItems, isAdminRouteActive } from "../components/common/header/core.ts";

test("active navigation accepts slash variants and nested authentication routes", () => {
  for (const path of [
    "/authentication",
    "/authentication/",
    "/authentication/google/",
    "/god-mode/authentication/google/?tab=1",
  ]) {
    assert.equal(isAdminRouteActive(path, "/authentication/"), true);
  }
});

test("similar names and other sections never select the wrong menu item", () => {
  for (const path of ["/workspace-extra", "/general", "/authentication-extra/google"]) {
    assert.equal(isAdminRouteActive(path, "/workspace/"), false);
    assert.equal(isAdminRouteActive(path, "/authentication/"), false);
  }
});

test("breadcrumbs retain the current page with and without a trailing slash", () => {
  const expected = [
    { title: "فضاهای کاری", href: "/workspace/" },
    { title: "ایجاد فضای کاری", href: "/workspace/create/" },
  ];
  assert.deepEqual(generateBreadcrumbItems("/workspace/create"), expected);
  assert.deepEqual(generateBreadcrumbItems("/god-mode/workspace/create/?from=menu#form"), expected);
  assert.deepEqual(generateBreadcrumbItems("/god-mode/"), []);
});

test("extended route labels can be supplied without losing their link", () => {
  assert.deepEqual(generateBreadcrumbItems("/custom/", { custom: "Custom settings" }), [
    { title: "Custom settings", href: "/custom/" },
  ]);
});
