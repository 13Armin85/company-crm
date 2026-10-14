import { useRef, useState } from "react";
import { Portal } from "@headlessui/react";
import type { Meta, StoryObj } from "@storybook/react";
import "@plane/tailwind-config/crm-theme.css";
import { PersianDatePicker, PersianDateTimePicker } from "./persian-date-picker";

const meta: Meta<typeof PersianDatePicker> = {
  title: "Forms/PersianDatePicker",
  component: PersianDatePicker,
  args: { label: "موعد", value: "", onChange: () => undefined },
  render: function Example(args) {
    const [value, setValue] = useState(args.value);
    return (
      <div dir="rtl" style={{ maxWidth: 360 }}>
        <PersianDatePicker {...args} value={value} onChange={setValue} />
      </div>
    );
  },
};
export default meta;
type Story = StoryObj<typeof PersianDatePicker>;
export const Empty: Story = {};
export const Filled: Story = { args: { value: "2024-03-20" } };
export const Disabled: Story = { args: { disabled: true, value: "2024-03-20" } };
export const Error: Story = { args: { error: "تاریخ پایان باید بعد از شروع باشد." } };
export const Range: Story = { args: { min: "2024-03-20", max: "2024-04-02", value: "2024-03-20" } };
export const Dark: Story = {
  decorators: [
    function DarkFrame(Story) {
      const target = useRef<HTMLDivElement>(null);
      return (
        <div ref={target} data-theme="dark" style={{ background: "#15181e", color: "#f3f4f6", padding: 16 }}>
          <Portal.Group target={target}>
            <Story />
          </Portal.Group>
        </div>
      );
    },
  ],
  args: { value: "2024-03-20" },
};
export const InForm: Story = {
  render: function Example() {
    const [value, setValue] = useState("2024-03-20");
    return (
      <div dir="rtl" style={{ width: 280, display: "grid", gap: 16 }}>
        <label htmlFor="story-end-date">
          <span>تاریخ پایان</span>
          <PersianDatePicker id="story-end-date" label="تاریخ پایان" value={value} onChange={setValue} />
        </label>
        <label>
          <span>عنوان کار</span>
          <input placeholder="آیتم بعد از تقویم" />
        </label>
      </div>
    );
  },
};
export const DateTime: Story = {
  render: function Example() {
    const [value, setValue] = useState("2026-10-10T20:45:00Z");
    return (
      <div dir="rtl" style={{ maxWidth: 360 }}>
        <PersianDateTimePicker value={value} onChange={setValue} timeZone="Asia/Tehran" />
      </div>
    );
  },
};
