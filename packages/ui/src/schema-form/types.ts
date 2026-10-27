import type { ReactNode } from "react";

export type FieldValue = string | number | boolean | null | string[] | { start: string; end: string };
export type FormValues = Record<string, FieldValue>;
export type FieldKind =
  | "short_text"
  | "long_text"
  | "rich_text"
  | "integer"
  | "decimal"
  | "money"
  | "percent"
  | "date"
  | "datetime"
  | "date_range"
  | "checkbox"
  | "boolean"
  | "select"
  | "multi_select"
  | "tags"
  | "user"
  | "unit"
  | "role"
  | "file"
  | "url"
  | "email"
  | "phone"
  | "rating"
  | "computed"
  | "relation";
export type Condition =
  | { op: "and" | "or"; rules: Condition[] }
  | {
      field: string;
      op: "eq" | "ne" | "in" | "not_in" | "empty" | "not_empty" | "contains" | "gt" | "gte" | "lt" | "lte";
      value?: FieldValue | { dynamic: "today" };
    };
export type Formula =
  | { field: string }
  | { value: number | string }
  | { dynamic: "today" }
  | { op: "add" | "subtract" | "multiply" | "divide" | "date_diff"; args: [Formula, Formula] };
export interface FieldConfig {
  secret?: boolean;
  required?: boolean;
  hidden?: boolean;
  readonly?: boolean;
  editable_after_create?: boolean;
  default?: FieldValue | { dynamic: "today" | "now" | "current_user" };
  default_dynamic?: "today" | "now" | "current_user" | "";
  required_if?: Condition | null;
  visible_if?: Condition | null;
  effective_visible?: boolean;
  min?: number;
  max?: number;
  min_length?: number;
  max_length?: number;
  regex?: string;
  regex_message?: string;
  unique?: boolean;
  unit?: string;
  stars?: number;
  multiple?: boolean;
  depends_on?: string;
  extensions?: string[];
  max_file_size?: number;
  formula?: Formula;
  lookup_codes?: boolean;
  provider?: string;
}
export interface FieldBinding {
  field: string;
  title?: string;
  source?: string;
  required?: boolean;
  hidden?: boolean;
  readonly?: boolean;
  editable_after_create?: boolean;
  default?: FieldValue | { dynamic: "today" | "now" | "current_user" };
  required_if?: Condition | null;
  visible_if?: Condition | null;
  view_roles?: string[] | null;
  edit_roles?: string[] | null;
  stage?: string;
}
export interface SchemaField {
  id: string;
  code: string;
  title: string;
  kind: FieldKind;
  config: FieldConfig;
  help_text?: string;
  placeholder?: string;
  lookup?: string | null;
  relation_entity?: string | null;
  binding: FieldBinding;
  is_active: boolean;
  used?: boolean;
  show_in_summary?: boolean;
  searchable?: boolean;
  filterable?: boolean;
  table_visible?: boolean;
}
export interface FormSection {
  id: string;
  title?: string;
  tab?: string;
  columns: 1 | 2 | 3;
  bindings: FieldBinding[];
}
export interface FormLayoutSchema {
  tabs: { id: string; title: string }[];
  sections: FormSection[];
}
export interface EntityFormSchema {
  time_zone?: string;
  entity: string;
  title: string;
  subtype?: string | null;
  schema_version: number;
  layout: FormLayoutSchema;
  fields: SchemaField[];
  defaults?: FormValues;
}
export interface SchemaOption {
  id: string;
  title: string;
  color?: string;
  disabled?: boolean;
}
export type OptionsLoader = (
  field: SchemaField,
  search: string,
  page: number,
  parent?: string,
  selected?: string[],
  resolve?: boolean
) => Promise<{ results: SchemaOption[]; count: number }>;
export interface SchemaFormProps {
  schema: EntityFormSchema;
  values: FormValues;
  onChange: (values: FormValues) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
  editing?: boolean;
  loadOptions?: OptionsLoader;
  uploadFile?: (field: SchemaField, file: File) => Promise<SchemaOption>;
  fileHref?: (field: SchemaField, id: string) => string;
  relationHref?: (field: SchemaField, id: string) => string;
  renderRelationPreview?: (field: SchemaField, id: string) => ReactNode;
  renderRichText?: (
    field: SchemaField,
    value: string,
    onChange: (value: string) => void,
    disabled: boolean
  ) => ReactNode;
}
