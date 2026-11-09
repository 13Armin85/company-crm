import { describe, expect, it } from "vitest";
import { dashboardPreviewRoles } from "./preview-roles";
import type { OrganizationRole } from "../types";

const role = (id: string, name: string): OrganizationRole => ({
  id,
  name,
  description: "",
  isActive: true,
  permissionIds: [],
});

describe("dashboard preview roles", () => {
  it("removes the accountant item from the dashboard view selector", () => {
    expect(
      dashboardPreviewRoles([
        role("1", "مدیر"),
        role("2", "حسابدار"),
        role("3", "حساب دار"),
        role("4", "Accountant"),
        role("5", "کارشناس"),
      ]).map((item) => item.id)
    ).toEqual(["1", "5"]);
  });
});
