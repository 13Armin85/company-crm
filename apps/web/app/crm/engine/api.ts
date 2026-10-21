import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EntityFormSchema, FieldConfig, FieldKind, FormLayoutSchema, FormValues } from "@plane/ui";
import { api, errorMessage } from "../api";
import { useUIStore } from "../store";
import type { BusinessChoices } from "../choice-label-context";

export interface EntityDefinition {
  id: string;
  code: string;
  title: string;
  icon: string;
  description: string;
  is_active: boolean;
  parent: string | null;
  adapter: string;
  title_field: string;
  numbering: { prefix?: string; padding?: number };
  record_permissions: Record<string, string>;
  can_create?: boolean;
}
export interface LookupDefinition {
  id: string;
  code: string;
  title: string;
  description: string;
  is_active: boolean;
  is_system: boolean;
}
export interface LookupOptionDefinition {
  id: string;
  category: string;
  code: string;
  title: string;
  color: string;
  icon: string;
  position: number;
  is_default: boolean;
  is_active: boolean;
  parent: string | null;
}
export interface FieldDefinition {
  id: string;
  code: string;
  title: string;
  kind: FieldKind;
  help_text: string;
  placeholder: string;
  config: FieldConfig;
  lookup: string | null;
  relation_entity: string | null;
  is_active: boolean;
  used_at: string | null;
  show_in_summary: boolean;
  searchable: boolean;
  filterable: boolean;
  table_visible: boolean;
}
export interface Catalog {
  choice_labels?: BusinessChoices;
  entities: EntityDefinition[];
  field_kinds: { code: FieldKind; title: string }[];
  templates: { code: string; title: string }[];
}
export interface FormDefinition {
  draft: FormLayoutSchema;
  revision: number;
  published: FormLayoutSchema | null;
  versions: { id: string; number: number; created_at: string; created_by_id: string | null; change_note: string }[];
}
export interface EngineRecord {
  id: string;
  entity: string;
  subtype: string | null;
  title: string;
  number: string;
  values: FormValues;
  revision: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  can_edit: boolean;
  can_deactivate?: boolean;
  can_delete: boolean;
  native_url: string | null;
}
export interface EnginePage {
  results: EngineRecord[];
  count: number;
  page: number;
  page_size: number;
}
export interface AuditEvent {
  id: string;
  type: string;
  field: string;
  before: unknown;
  after: unknown;
  actor: string;
  at: string;
  metadata: Record<string, unknown>;
}

export const enginePath = (slug: string) => `/api/workspaces/${slug}/engine`;
export const useEngineSlug = () => useUIStore((state) => state.workspaceSlug) || "";
export function useEngineQuery<T>(key: string, path: string, enabled = true) {
  const slug = useEngineSlug();
  return useQuery({
    queryKey: ["entity-engine", slug, key, path],
    enabled: Boolean(slug && enabled),
    queryFn: async ({ signal }): Promise<T> => (await api.get(`${enginePath(slug)}/${path}`, { signal })).data,
  });
}
export const useEngineCatalog = () => useEngineQuery<Catalog>("catalog", "catalog/");
export const useEngineForm = (code: string, enabled = true) =>
  useEngineQuery<FormDefinition>("form", `forms/${code}/`, Boolean(code && enabled));
export const useEngineSchema = (code: string, subtype = "", record = "") =>
  useEngineQuery<EntityFormSchema>(
    "schema",
    `entities/${code}/schema/?${new URLSearchParams({ ...(subtype ? { subtype } : {}), ...(record ? { record } : {}) })}`,
    Boolean(code)
  );
export const useEngineRecord = (code: string, id: string) =>
  useEngineQuery<EngineRecord>("record", `entities/${code}/records/${id}/`, Boolean(code && id));
export const useEngineDefinitions = <T>(kind: string, enabled = true) =>
  useEngineQuery<T[]>(kind, `definitions/${kind}/`, enabled);

export function useEngineMutation() {
  const slug = useEngineSlug(),
    client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      path,
      data,
      method = "post",
    }: {
      path: string;
      data?: unknown;
      method?: "post" | "put" | "patch" | "delete";
    }): Promise<unknown> => (await api.request({ url: `${enginePath(slug)}/${path}`, method, data })).data,
    onSuccess: async () => {
      await Promise.all(
        [
          "entity-engine",
          "issues",
          "projects",
          "project",
          "absences",
          "task-history",
          "workspace-access",
          "organization-permissions",
        ].map((key) => client.invalidateQueries({ queryKey: [key, slug] }))
      );
      useUIStore.getState().toast("تغییرات ذخیره شد");
    },
    onError: (error) =>
      useUIStore.getState().toast(errorMessage(error, "عملیات انجام نشد؛ اطلاعات را بررسی کنید."), "error"),
  });
}

export function fieldErrors(error: unknown): Record<string, string> {
  const data = (error as { response?: { data?: Record<string, unknown> } })?.response?.data;
  if (!data || typeof data !== "object") return {};
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      Array.isArray(value)
        ? value.map(String).join("، ")
        : typeof value === "string"
          ? value
          : "مقدار معتبر وارد کنید.",
    ])
  );
}
