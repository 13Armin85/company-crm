import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import "@plane/tailwind-config/crm-theme.css";
import { CompactMultiSelector } from "./compact-multi-selector";

const meta: Meta<typeof CompactMultiSelector> = {
  title: "Forms/CompactMultiSelector",
  component: CompactMultiSelector,
  args: {
    label: "نقش‌ها",
    selected: [],
    onChange: () => undefined,
    options: [
      { id: "member", title: "عضو", description: "مشاهده و پیگیری کارها", category: "پیش‌فرض" },
      { id: "support", title: "پشتیبانی", description: "رسیدگی به درخواست‌ها", category: "سازمانی" },
      { id: "inactive", title: "نقش غیرفعال", disabled: true, category: "سازمانی" },
    ],
  },
  render: function Example(args) {
    const [selected, setSelected] = useState(args.selected);
    return (
      <div dir="rtl" style={{ maxWidth: 480 }}>
        <CompactMultiSelector {...args} selected={selected} onChange={setSelected} />
      </div>
    );
  },
};

export default meta;
type Story = StoryObj<typeof CompactMultiSelector>;
export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true, selected: ["member"] } };
export const Members: Story = {
  args: {
    label: "اعضای واحد",
    selected: ["armin"],
    options: [
      { id: "armin", title: "آرمین احمدی", initials: "آ ا", description: "armin@example.com" },
      { id: "sara", title: "سارا رضایی", initials: "س ر", description: "sara@example.com" },
    ],
  },
};
export const Empty: Story = { args: { options: [] } };
