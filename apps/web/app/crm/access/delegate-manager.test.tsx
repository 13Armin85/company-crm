import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { filterMemberDirectory, MemberDirectory } from "@plane/ui";

const state = vi.hoisted(() => ({
  canManage: true,
  loading: false,
  membersError: false,
  delegatesError: false,
}));

vi.mock("../api", () => ({
  useWorkspaceAccess: () => ({ data: { can: () => state.canManage } }),
  useMembers: () => ({
    data: [
      { id: "manager", displayName: "مدیر واحد", isActive: true },
      {
        id: "selected",
        displayName: "جانشین فعلی",
        email: "selected@example.com",
        role: "کارشناس مالی",
        isActive: true,
      },
      { id: "inactive", displayName: "عضو غیرفعال", isActive: false },
      {
        id: "available",
        displayName: "عضو با نام و نام خانوادگی کامل",
        email: "available@example.com",
        role: "مدیر فروش",
        isActive: true,
      },
    ],
    isLoading: state.loading,
    error: state.membersError ? new Error("Members unavailable") : undefined,
    refetch: vi.fn(),
  }),
}));
vi.mock("./api", () => ({
  useDelegates: () => ({
    data: state.delegatesError
      ? undefined
      : {
          delegates: [
            { user_id: "selected", name: "جانشین فعلی", priority: 1 },
            { user_id: "missing", name: "جانشین ثبت‌شده در سابقه", priority: 2 },
          ],
          active_delegation: null,
        },
    isLoading: false,
    error: state.delegatesError ? new Error("Delegates unavailable") : undefined,
  }),
  useAccessMutation: () => ({ isPending: false, mutate: vi.fn() }),
}));

import { DelegateManager } from "./delegate-manager";

const renderManager = () =>
  renderToStaticMarkup(<DelegateManager unitId="finance" unitTitle="صف بررسی مالی" managerId="manager" />);

describe("delegate member directory", () => {
  beforeEach(() => {
    state.canManage = true;
    state.loading = false;
    state.membersError = false;
    state.delegatesError = false;
  });

  it("shows eligible members inline with complete names, email and role", () => {
    const html = renderManager();
    expect(html).toContain("صف بررسی مالی");
    expect(html).toContain("عضو با نام و نام خانوادگی کامل");
    expect(html).toContain("available@example.com");
    expect(html).toContain("مدیر فروش");
    expect(html).not.toContain('role="combobox"');
    expect(html).toContain('aria-label="افزودن جانشین عضو با نام و نام خانوادگی کامل"');
    expect(html).not.toContain('aria-label="افزودن جانشین مدیر واحد"');
    expect(html).not.toContain('aria-label="افزودن جانشین عضو غیرفعال"');
    expect(html).not.toContain('aria-label="افزودن جانشین جانشین فعلی"');
  });

  it("keeps selected members and server names visible even without a matching membership", () => {
    const html = renderManager();
    expect(html).toContain("جانشین ثبت‌شده در سابقه");
    expect(html).toContain("selected@example.com");
    expect(html).toContain("کارشناس مالی");
    expect(html).toContain('aria-label="اولویت ۲"');
    expect(html).toContain('aria-label="حذف جانشین جانشین فعلی"');
  });

  it("keeps the ordered list read only when the delegate grant is missing", () => {
    state.canManage = false;
    const html = renderManager();
    expect(html).toContain("جانشین فعلی");
    expect(html).not.toContain("افزودن جانشین");
    expect(html).not.toContain("حذف جانشین");
    expect(html).not.toContain("ذخیره ترتیب");
  });

  it("distinguishes loading and membership errors from an empty list", () => {
    state.loading = true;
    expect(renderManager()).toContain("در حال دریافت اعضا");
    state.loading = false;
    state.membersError = true;
    const html = renderManager();
    expect(html).toContain("دریافت فهرست اعضا انجام نشد");
    expect(html).toContain("تلاش دوباره");
    expect(html).not.toContain("عضو دیگری برای افزودن وجود ندارد");
    state.delegatesError = true;
    expect(renderManager()).toContain("دریافت جانشینان انجام نشد");
  });

  it("searches complete names, email and role with Arabic letter variants and multiple terms", () => {
    const members = [
      { id: "ali", title: "علی کریمی", email: "ali@example.com", role: "کارشناس مالی" },
      { id: "sara", title: "سارا رضایی", email: "sara@example.com", role: "مدیر فروش" },
    ];
    expect(filterMemberDirectory(members, "علي كريمي").map((member) => member.id)).toEqual(["ali"]);
    expect(filterMemberDirectory(members, "ALI@EXAMPLE.COM مالی").map((member) => member.id)).toEqual(["ali"]);
    expect(filterMemberDirectory(members, "فروش").map((member) => member.id)).toEqual(["sara"]);
    expect(filterMemberDirectory(members, "نام ناموجود")).toEqual([]);
    expect(filterMemberDirectory(members, " ")).toEqual(members);
  });

  it("renders all 80 members without dropping the last entries", () => {
    const options = Array.from({ length: 80 }, (_, index) => ({ id: `member-${index}`, title: `عضو ${index + 1}` }));
    const html = renderToStaticMarkup(<MemberDirectory options={options} onAdd={() => undefined} />);
    expect(html.match(/class="crm-member-directory-add"/g)).toHaveLength(80);
    expect(html).toContain('aria-label="افزودن جانشین عضو 80"');
    expect(renderToStaticMarkup(<MemberDirectory options={[]} onAdd={() => undefined} />)).toContain(
      "عضو دیگری برای افزودن وجود ندارد"
    );
  });
});
