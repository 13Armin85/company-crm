import { useRef, useState } from "react";
import { Portal } from "@headlessui/react";
import type { Meta, StoryObj } from "@storybook/react";
import "@plane/tailwind-config/crm-theme.css";
import { PersianCalendarNavigation } from "./persian-calendar-navigation";

const meta: Meta<typeof PersianCalendarNavigation> = {
  title: "Forms/PersianCalendarNavigation",
  component: PersianCalendarNavigation,
  args: { value: "2026-10-14", onChange: () => undefined, description: "۳ کار در این ماه" },
  render: function Example(args) {
    const [value, setValue] = useState(args.value);
    return (
      <div style={{ maxWidth: 600 }}>
        <PersianCalendarNavigation {...args} value={value} onChange={setValue} />
      </div>
    );
  },
};
export default meta;
type Story = StoryObj<typeof PersianCalendarNavigation>;
export const Default: Story = {};
export const Mobile: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: 280 }}>
        <Story />
      </div>
    ),
  ],
};
export const Disabled: Story = { args: { disabled: true } };
export const LeapEsfand: Story = { args: { value: "2021-03-20" } };
export const Dark: Story = {
  decorators: [
    function DarkFrame(Story) {
      const target = useRef<HTMLDivElement>(null);
      return (
        <div ref={target} data-theme="dark" style={{ background: "#0f1115", color: "#f3f4f6", padding: 16 }}>
          <Portal.Group target={target}>
            <Story />
          </Portal.Group>
        </div>
      );
    },
  ],
};
