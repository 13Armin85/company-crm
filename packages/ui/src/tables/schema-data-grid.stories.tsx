import "../../styles/schema-data-grid.css";
import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { SchemaDataGrid } from "./schema-data-grid";
import type { SchemaGridColumn } from "./schema-data-grid";
import type { CSSProperties } from "react";

const meta = { title: "Data/SchemaDataGrid", component: SchemaDataGrid } satisfies Meta<typeof SchemaDataGrid>;
export default meta;
function ResponsiveExample({ dark = false, narrow = false }: { dark?: boolean; narrow?: boolean }) {
  const [columns, setColumns] = useState<SchemaGridColumn[]>([
    { field: "title", title: "عنوان کامل درخواست ثبت‌شده در فرم", width: 260, pin: "right" },
    { field: "amount", title: "مبلغ کل درخواست به ریال", width: 180 },
    { field: "status", title: "وضعیت بررسی درخواست", width: 180, pin: "left" },
  ]);
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <div
      dir="rtl"
      style={
        {
          maxWidth: narrow ? 360 : undefined,
          padding: 16,
          background: dark ? "#0f1115" : "#f7f8fa",
          "--surface": dark ? "#15181e" : "#fff",
          "--surface-soft": dark ? "#1a1e25" : "#f9fafb",
          "--text-primary": dark ? "#f3f4f6" : "#111827",
          "--text-secondary": dark ? "#c3c7ce" : "#4b5563",
          "--border": dark ? "#262b35" : "#e5e7eb",
          colorScheme: dark ? "dark" : "light",
        } as CSSProperties
      }
    >
      <SchemaDataGrid
        columns={columns}
        rows={Array.from({ length: 100 }, (_, i) => ({
          id: String(i),
          title: `درخواست بررسی و تأیید اطلاعات ${i + 1}`,
          amount: (i + 1) * 1000,
          status: "در حال بررسی",
        }))}
        selected={selected}
        onSelect={setSelected}
        onColumnsChange={setColumns}
        renderCell={(row, column) =>
          column.field === "amount" ? row.amount.toLocaleString("fa-IR") : row[column.field as "title" | "status"]
        }
      />
    </div>
  );
}
export const DesktopLight: StoryObj = { render: () => <ResponsiveExample /> };
export const DesktopDark: StoryObj = { render: () => <ResponsiveExample dark /> };
export const MobileDark: StoryObj = { render: () => <ResponsiveExample dark narrow /> };
export const LongContents: StoryObj = {
  render: () => (
    <div dir="rtl" style={{ maxWidth: 650 }}>
      <SchemaDataGrid
        columns={[
          { field: "title", title: "عنوان درخواست", width: 200, pin: "right" },
          { field: "description", title: "توضیحات کامل", width: 300 },
        ]}
        rows={Array.from({ length: 100 }, (_, index) => ({
          id: String(index),
          title: `درخواست ${(index + 1).toLocaleString("fa-IR")}`,
          description: "تمام اطلاعات این درخواست باید بدون برش و با ارتفاع متناسب نمایش داده شود. ".repeat(
            (index % 5) + 1
          ),
        }))}
        selected={[]}
        onSelect={() => {}}
        onColumnsChange={() => {}}
        renderCell={(row, column) => row[column.field as "title" | "description"]}
      />
    </div>
  ),
};
export const VirtualRows: StoryObj = {
  render: () => {
    const [columns, setColumns] = useState<SchemaGridColumn[]>([
      { field: "title", title: "عنوان", width: 250, pin: "right" },
      { field: "amount", title: "مبلغ", width: 180 },
    ]);
    const [selected, setSelected] = useState<string[]>([]);
    return (
      <div dir="rtl">
        <SchemaDataGrid
          columns={columns}
          rows={Array.from({ length: 200 }, (_, i) => ({
            id: String(i),
            title: `رکورد ${i + 1}`,
            amount: (i + 1) * 1000,
          }))}
          selected={selected}
          onSelect={setSelected}
          onColumnsChange={setColumns}
          renderCell={(row, column) => (column.field === "title" ? row.title : row.amount.toLocaleString("fa-IR"))}
        />
      </div>
    );
  },
};
