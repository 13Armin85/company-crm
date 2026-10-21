import "../../styles/schema-form.css";
import { useState } from "react";
import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { SchemaDrivenForm } from "./schema-form";
import type { EntityFormSchema, FormValues } from "./types";

const schema: EntityFormSchema = {
  entity: "demo",
  title: "فرم پویا",
  schema_version: 1,
  layout: {
    tabs: [],
    sections: [
      {
        id: "main",
        title: "اطلاعات",
        columns: 2,
        bindings: [{ field: "title" }, { field: "urgent" }, { field: "due" }, { field: "reason" }],
      },
    ],
  },
  fields: [
    {
      id: "1",
      code: "title",
      title: "عنوان",
      kind: "short_text",
      config: { required: true },
      binding: { field: "title" },
      is_active: true,
    },
    {
      id: "2",
      code: "urgent",
      title: "فوری",
      kind: "boolean",
      config: {},
      binding: { field: "urgent" },
      is_active: true,
    },
    { id: "3", code: "due", title: "سررسید", kind: "date", config: {}, binding: { field: "due" }, is_active: true },
    {
      id: "4",
      code: "reason",
      title: "علت فوریت",
      kind: "long_text",
      config: {
        required_if: { field: "urgent", op: "eq", value: true },
        visible_if: { field: "urgent", op: "eq", value: true },
      },
      binding: { field: "reason" },
      is_active: true,
    },
  ],
};
const meta = { title: "CRM/Schema-driven form", component: SchemaDrivenForm } satisfies Meta<typeof SchemaDrivenForm>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {
  args: { schema, values: {}, onChange: () => {} },
  render: (args) => {
    const [values, setValues] = useState<FormValues>({});
    return <SchemaDrivenForm {...args} values={values} onChange={setValues} />;
  },
};

function ResponsiveForm({ dark = false, narrow = false }: { dark?: boolean; narrow?: boolean }) {
  const [values, setValues] = useState<FormValues>({ urgent: true });
  return (
    <div
      data-theme={dark ? "dark" : "light"}
      style={
        {
          maxWidth: narrow ? 360 : 1200,
          padding: 24,
          background: dark ? "#15181e" : "#fff",
          colorScheme: dark ? "dark" : "light",
          "--surface": dark ? "#15181e" : "#fff",
          "--surface-soft": dark ? "#1a1e25" : "#f9fafb",
          "--text-primary": dark ? "#f3f4f6" : "#111827",
          "--text-secondary": dark ? "#c3c7ce" : "#4b5563",
          "--border": dark ? "#262b35" : "#e5e7eb",
          "--accent": "#6366f1",
        } as CSSProperties
      }
    >
      <SchemaDrivenForm
        schema={{
          ...schema,
          layout: { ...schema.layout, sections: schema.layout.sections.map((section) => ({ ...section, columns: 3 })) },
        }}
        values={values}
        onChange={setValues}
      />
    </div>
  );
}
export const DesktopLight: Story = { args: Default.args, render: () => <ResponsiveForm /> };
export const DesktopDark: Story = { args: Default.args, render: () => <ResponsiveForm dark /> };
export const NarrowLight: Story = { args: Default.args, render: () => <ResponsiveForm narrow /> };
export const NarrowDark: Story = { args: Default.args, render: () => <ResponsiveForm dark narrow /> };
