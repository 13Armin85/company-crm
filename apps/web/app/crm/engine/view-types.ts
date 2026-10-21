import type { Condition, FieldConfig, FieldKind, FieldValue, FormValues } from "@plane/ui";

export interface ViewColumn {
  field: string;
  width: number;
  pin?: "right" | "left" | "";
}
export interface ViewDefinition {
  version: 1;
  type: "table" | "kanban" | "list" | "calendar" | "cards";
  subtype?: string;
  columns: ViewColumn[];
  sort: { field: string; direction: "asc" | "desc" }[];
  filter?: Condition | null;
  group?: string | null;
  settings?: { kanban_field?: string; kanban_columns?: string[]; calendar_field?: string };
}
export interface ViewField {
  time_zone?: string;
  code: string;
  field_code: string;
  options_entity: string;
  options_subtype?: string | null;
  title: string;
  kind: FieldKind;
  config: FieldConfig;
  lookup?: string | null;
  relation_entity?: string | null;
  operators: string[];
  filterable: boolean;
  table_visible: boolean;
  searchable: boolean;
  show_in_summary?: boolean;
}
export interface ViewStyle {
  color?: string;
  background?: string;
  icon?: "warning" | "clock" | "check" | "flag" | "info";
}
export interface ViewRow {
  group_key?: string | null;
  id: string;
  number: string;
  title: string;
  values: FormValues;
  revision: number;
  is_active: boolean;
  can_edit: boolean;
  editable_fields?: string[];
  styles: { row: ViewStyle; cells: Record<string, ViewStyle>; badges: Record<string, ViewStyle> };
}
export interface ViewResult {
  time_zone?: string;
  results: ViewRow[];
  count: number;
  page: number;
  page_size: number;
  definition: ViewDefinition;
  warnings: string[];
  labels: Record<string, Record<string, { title: string; color?: string; inactive?: boolean }>>;
  totals: Record<string, { sum: string | number | null; avg: string | number | null }>;
  groups: { value: FieldValue; key?: string; count: number; totals: ViewResult["totals"] }[];
}
export interface FormatRule {
  when: Condition;
  target: "row" | "cell" | "badge";
  field?: string;
  priority: number;
  style: ViewStyle;
}
export interface SummarySetting {
  field: string;
  subtype?: string;
  roles?: string[];
}
export interface Presentation {
  rules?: FormatRule[];
  summary?: SummarySetting[];
}
export interface ViewSchema {
  fields: ViewField[];
  definition: ViewDefinition;
  presentation: Presentation;
}
export interface SavedView {
  id: string;
  name: string;
  definition: ViewDefinition;
  visibility: "personal" | "shared" | "official";
  recipients: { roles?: string[]; units?: string[]; users?: string[] };
  default_roles: string[];
  revision: number;
  can_edit: boolean;
}
export interface SavedViewList {
  results: SavedView[];
  default_id: string | null;
  system: { id: string; name: string }[];
}
export const viewKinds = [
  { id: "table", title: "جدول" },
  { id: "kanban", title: "کانبان" },
  { id: "list", title: "لیست فشرده" },
  { id: "calendar", title: "تقویم" },
  { id: "cards", title: "کارت" },
];
