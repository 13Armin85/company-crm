import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import "@plane/tailwind-config/crm-theme.css";
import { MemberDirectory } from "./member-directory";

const meta: Meta<typeof MemberDirectory> = {
  title: "Forms/MemberDirectory",
  component: MemberDirectory,
  args: {
    onAdd: () => undefined,
    options: [
      { id: "sara", title: "سارا رضایی", email: "sara@example.com", role: "کارشناس مالی", initials: "س ر" },
      { id: "ali", title: "علی احمدی", email: "ali@example.com", role: "پشتیبانی", initials: "ع ا" },
      { id: "nazanin", title: "نازنین محمدی", email: "nazanin@example.com", role: "مدیر فروش", initials: "ن م" },
    ],
  },
  render: function Example(args) {
    const [added, setAdded] = useState<string[]>([]);
    return (
      <div dir="rtl" style={{ maxWidth: 520, padding: 20, color: "var(--text-primary)", background: "var(--surface)" }}>
        <MemberDirectory
          {...args}
          options={args.options.filter((member) => !added.includes(member.id))}
          onAdd={(id) => setAdded([...added, id])}
        />
      </div>
    );
  },
};
export default meta;
type Story = StoryObj<typeof MemberDirectory>;
export const Default: Story = {};
export const Empty: Story = { args: { options: [] } };
export const Loading: Story = { args: { options: [], isLoading: true } };
export const Error: Story = { args: { hasError: true, onRetry: () => undefined } };
export const Disabled: Story = { args: { disabled: true } };
export const LongList: Story = {
  args: {
    options: Array.from({ length: 80 }, (_, index) => ({
      id: `member-${index}`,
      title: `عضو ${(index + 1).toLocaleString("fa-IR")} با نام و نام خانوادگی بسیار بلند`,
      email: `member.with.a.long.email.address.${index + 1}@example.com`,
      role: "کارشناس بررسی اسناد و تأیید امور مالی شرکت",
    })),
  },
};
