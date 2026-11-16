import type { Meta, StoryObj } from "@storybook/react";
import { ScrollableTable } from "./table-scroll";

const meta: Meta<typeof ScrollableTable> = { title: "Tables/Horizontal scroll", component: ScrollableTable };
export default meta;
type Story = StoryObj<typeof ScrollableTable>;
export const PersianWideTable: Story = {
  render: () => (
    <div dir="rtl" style={{ maxWidth: 480 }}>
      <ScrollableTable style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["شماره", "شرح گزارش", "درخواست‌دهنده", "وضعیت", "تاریخ", "پروژه"].map((label) => (
              <th key={label} style={{ padding: 16, minWidth: 160 }}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[1, 2, 3].map((number) => (
            <tr key={number}>
              {[
                String(number),
                "بررسی درخواست پشتیبانی مشتری",
                "علی رضایی",
                "در حال بررسی",
                "۱۴۰۵/۰۸/۲۴",
                "سامانهٔ مشتریان",
              ].map((value) => (
                <td key={value} style={{ padding: 16, borderBottom: "1px solid #ddd" }}>
                  {value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </ScrollableTable>
    </div>
  ),
};
