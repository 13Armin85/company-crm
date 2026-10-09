import type { Meta, StoryObj } from "@storybook/react";
import { BrandLogo } from "./brand-logo";

const meta: Meta<typeof BrandLogo> = {
  title: "Brand/AmardLogo",
  component: BrandLogo,
  args: { style: { objectFit: "contain" } },
};
export default meta;
type Story = StoryObj<typeof BrandLogo>;
export const Symbol: Story = {};
export const Full: Story = { args: { variant: "full" } };
export const Dark: Story = { parameters: { backgrounds: { default: "dark" } }, args: { variant: "full" } };
export const Decorative: Story = { args: { decorative: true } };
