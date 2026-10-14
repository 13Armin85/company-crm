import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import "@plane/tailwind-config/crm-theme.css";
import { SearchableSelect } from "./searchable-select";
const meta: Meta<typeof SearchableSelect> = {
  title: "Forms/SearchableSelect",
  component: SearchableSelect,
  args: {
    label: "کاربر",
    value: "",
    onChange: () => undefined,
    options: Array.from({ length: 80 }, (_, index) => ({
      id: String(index),
      title: `کاربر ${index + 1}`,
      description: `member-${index + 1}@example.com`,
      disabled: index === 2,
    })),
  },
  render: function Example(args) {
    const [value, setValue] = useState(args.value);
    return (
      <div dir="rtl" style={{ maxWidth: 360 }}>
        <SearchableSelect {...args} value={value} onChange={setValue} />
      </div>
    );
  },
};
export default meta;
type Story = StoryObj<typeof SearchableSelect>;
export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true, value: "0" } };
export const Loading: Story = { args: { loading: true } };
export const Error: Story = { args: { error: "دریافت کاربران انجام نشد." } };
export const Empty: Story = { args: { options: [] } };
export const SingleLineStatus: Story = {
  args: {
    label: "وضعیت کار",
    value: "started",
    wrapOptions: false,
    options: [
      { id: "todo", title: "برای انجام" },
      { id: "started", title: "در حال انجام" },
      { id: "review", title: "بازبینی" },
      { id: "done", title: "انجام‌شده" },
      { id: "blocked", title: "مسدود" },
    ],
  },
};
