import type { Meta, StoryObj } from "@storybook/react";
import "@plane/tailwind-config/crm-theme.css";
import { IdentifierBadge } from "./identifier-badge";

const meta: Meta<typeof IdentifierBadge> = {
  title: "Data/IdentifierBadge",
  component: IdentifierBadge,
  args: { value: "PRJ000001", label: "شناسه پروژه" },
};
export default meta;
type Story = StoryObj<typeof IdentifierBadge>;
export const Project: Story = {};
export const Task: Story = { args: { value: "TEAM-12", label: "شناسه کار" } };
export const Record: Story = { args: { value: "0231611b-04f3-4d58-beb6-ffb09951d9af", label: "شناسه کاربر" } };
