import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import "@plane/tailwind-config/crm-theme.css";
import { MemberSelect } from "./member-select";

const meta: Meta<typeof MemberSelect> = {
  title: "Forms/MemberSelect",
  component: MemberSelect,
  args: {
    label: "افزودن جانشین",
    value: "",
    onChange: () => undefined,
    options: [
      { id: "sara", title: "سارا رضایی", initials: "س ر" },
      { id: "ali", title: "علی احمدی", initials: "ع ا" },
      { id: "nazanin", title: "نازنین محمدی", initials: "ن م" },
    ],
  },
  render: function Example(args) {
    const [value, setValue] = useState(args.value);
    return (
      <div dir="rtl" style={{ maxWidth: 420, padding: 24, color: "var(--text-primary)" }}>
        <MemberSelect {...args} value={value} onChange={setValue} />
      </div>
    );
  },
};
export default meta;
type Story = StoryObj<typeof MemberSelect>;
export const Default: Story = {};
export const Selected: Story = { args: { value: "sara" } };
export const Empty: Story = { args: { options: [] } };
export const Disabled: Story = { args: { disabled: true } };
export const LongList: Story = {
  args: {
    options: Array.from({ length: 80 }, (_, index) => ({
      id: "member-" + index,
      title: "کاربر " + (index + 1).toLocaleString("fa-IR"),
    })),
  },
};
