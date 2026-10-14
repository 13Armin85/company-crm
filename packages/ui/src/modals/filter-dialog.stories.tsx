import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import "@plane/tailwind-config/crm-theme.css";
import { CompactMultiSelector } from "../form-fields/compact-multi-selector";
import { FilterDialog } from "./filter-dialog";

const meta: Meta<typeof FilterDialog> = {
  title: "Modals/FilterDialog",
  component: FilterDialog,
  args: {
    isOpen: true,
    title: "فیلتر کارها",
    description: "چند گزینه در یک بخش با هم و بخش‌های مختلف هم‌زمان در نتایج لحاظ می‌شوند.",
    resultCount: 12,
    resultLabel: "کار مطابق انتخاب‌ها",
  },
  render: function Example(args) {
    const [open, setOpen] = useState(args.isOpen);
    const [selected, setSelected] = useState<string[]>([]);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          فیلتر
        </button>
        <FilterDialog
          {...args}
          isOpen={open}
          onClose={() => setOpen(false)}
          onApply={() => setOpen(false)}
          onReset={() => setSelected([])}
        >
          <CompactMultiSelector
            label="وضعیت"
            selected={selected}
            onChange={setSelected}
            options={[
              { id: "todo", title: "برای انجام" },
              { id: "done", title: "انجام‌شده" },
            ]}
          />
        </FilterDialog>
      </>
    );
  },
};

export default meta;
type Story = StoryObj<typeof FilterDialog>;
export const Default: Story = {};
export const Loading: Story = { args: { loading: true } };
export const Empty: Story = { args: { resultCount: 0 } };
export const InvalidRange: Story = { args: { validationMessage: "تاریخ شروع باید پیش از تاریخ پایان باشد." } };
