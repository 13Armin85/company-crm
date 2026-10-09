import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MemberSelect, PermissionCatalog, filterPermissionCatalog } from "@plane/ui";
import type { OrganizationPermission } from "../types";
import { permissionPresentation } from "./permission-labels";

const permission = (values: Partial<OrganizationPermission> = {}): OrganizationPermission => ({
  id: "view",
  code: "User.View",
  name: "مشاهده کاربران",
  description: "نمایش فهرست اعضای شرکت",
  category: "User",
  isActive: true,
  isDelegatable: true,
  ...values,
});

describe("Persian permission presentation", () => {
  it("keeps identifiers and grants intact while translating catalog categories", () => {
    const source = permission();
    const item = permissionPresentation(source);
    expect(item.category).toBe("کاربران");
    expect(item.id).toBe(source.id);
    expect(item.code).toBe("User.View");
    expect(item.isDelegatable).toBe(true);
    const html = renderToStaticMarkup(<PermissionCatalog items={[item]} />);
    expect(html).toContain("مشاهده کاربران");
    expect(html).toContain("قابل واگذاری به جانشین");
    expect(html).not.toContain("User.View");
    expect(html).not.toContain(">User<");
  });

  it("localizes old English labels and keeps retired permissions visible without exposing raw codes", () => {
    const item = permissionPresentation(
      permission({ code: "Routing.Queue.View", category: "Routing", name: "View queue", description: "View the queue" })
    );
    expect(item.name).toBe("مشاهده صف مسیریابی");
    expect(item.description).toBe("امکان مشاهده صف در بخش مسیریابی");
    const retired = permissionPresentation(
      permission({
        id: "retired",
        code: "Old.Custom",
        category: "Old",
        name: "Custom permission",
        description: "",
        isActive: false,
      })
    );
    const html = renderToStaticMarkup(<PermissionCatalog items={[retired]} />);
    expect(html).toContain("سایر مجوزها");
    expect(html).toContain("غیرفعال");
    expect(html).not.toContain("Old.Custom");
    expect(html).not.toContain("Custom permission");
  });

  it("combines category and text filters and supports Arabic keyboard variants", () => {
    const items = [
      permissionPresentation(permission({ name: "ویرایش کاربران", code: "User.Edit" })),
      permissionPresentation(permission({ id: "role", name: "ویرایش نقش", category: "Role", code: "Role.Edit" })),
    ];
    expect(filterPermissionCatalog(items, "ويرايش", "کاربران").map((item) => item.id)).toEqual(["view"]);
    expect(filterPermissionCatalog(items, "کاربران", "نقش‌ها")).toEqual([]);
    expect(filterPermissionCatalog(items, "مجوز ناموجود")).toEqual([]);
  });

  it("announces loading and errors separately from an empty catalog", () => {
    expect(renderToStaticMarkup(<PermissionCatalog items={[]} isLoading />)).toContain("در حال دریافت مجوزها");
    expect(renderToStaticMarkup(<PermissionCatalog items={[]} hasError />)).toContain('role="alert"');
    expect(renderToStaticMarkup(<PermissionCatalog items={[]} />)).toContain("مجوزی برای نمایش وجود ندارد");
  });

  it("provides a labelled searchable member control instead of a native select", () => {
    const html = renderToStaticMarkup(
      <MemberSelect
        label="افزودن جانشین"
        value=""
        options={[{ id: "ali", title: "علی احمدی" }]}
        onChange={() => undefined}
      />
    );
    expect(html).toContain("افزودن جانشین");
    expect(html).toContain('role="combobox"');
    expect(html).toContain("جستجو و انتخاب کاربر");
    expect(html).not.toContain("<select");
  });
});
