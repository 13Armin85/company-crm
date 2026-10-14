import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import "@plane/tailwind-config/crm-theme.css";
import { PersianTimePicker } from "./persian-time-picker";

const meta: Meta<typeof PersianTimePicker> = {
  title: "Forms/PersianTimePicker",
  component: PersianTimePicker,
  args: { label: "شروع", value: "09:30", onChange: () => undefined },
  render: function Example(args) {
    const [value, setValue] = useState(args.value);
    return (
      <div dir="rtl" style={{ maxWidth: 320 }}>
        <PersianTimePicker {...args} value={value} onChange={setValue} />
      </div>
    );
  },
};
export default meta;
type Story = StoryObj<typeof PersianTimePicker>;
export const Default: Story = {};
export const Midnight: Story = { args: { value: "00:00" } };
export const ExactMinute: Story = { args: { label: "پایان", value: "23:59" } };
export const Disabled: Story = { args: { disabled: true } };
export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: 240 }}>
        <Story />
      </div>
    ),
  ],
};
export const Dark: Story = {
  decorators: [
    (Story) => (
      <div data-theme="dark" style={{ padding: 16, background: "#15181e" }}>
        <Story />
      </div>
    ),
  ],
};
