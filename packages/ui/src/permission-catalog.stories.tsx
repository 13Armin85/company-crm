import type { Meta, StoryObj } from "@storybook/react";
import "@plane/tailwind-config/crm-theme.css";
import { PermissionCatalog } from "./permission-catalog";

const meta: Meta<typeof PermissionCatalog> = {
  title: "Access/PermissionCatalog",
  component: PermissionCatalog,
  args: {
    items: [
      {
        id: "view-users",
        name: "مشاهده کاربران",
        description: "مشاهده فهرست اعضای شرکت و اطلاعات کاربری آن‌ها.",
        category: "کاربران",
        isActive: true,
        isDelegatable: true,
      },
      {
        id: "edit-users",
        name: "ویرایش کاربران",
        description: "ویرایش مشخصات کاربر با رعایت دسترسی‌های نقش.",
        category: "کاربران",
        isActive: true,
        isDelegatable: false,
      },
      {
        id: "view-projects",
        name: "مشاهده پروژه‌ها",
        description: "مشاهده پروژه‌های مرتبط با نقش و اعضای آن‌ها.",
        category: "پروژه‌ها",
        isActive: true,
        isDelegatable: true,
      },
      {
        id: "old-permission",
        name: "مجوز اختصاصی",
        description: "مجوزی که دیگر فعال نیست و دسترسی ایجاد نمی‌کند.",
        category: "سایر مجوزها",
        isActive: false,
        isDelegatable: false,
      },
    ],
  },
  decorators: [
    (Story) => (
      <div
        dir="rtl"
        style={{ maxWidth: 1000, padding: 24, color: "var(--text-primary)", background: "var(--surface)" }}
      >
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof PermissionCatalog>;
export const Default: Story = {};
export const Empty: Story = { args: { items: [] } };
export const Loading: Story = { args: { items: [], isLoading: true } };
export const Error: Story = { args: { items: [], hasError: true } };
