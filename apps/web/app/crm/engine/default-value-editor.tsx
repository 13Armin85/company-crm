import { SchemaDrivenForm } from "@plane/ui";
import type { EntityFormSchema, FieldConfig, FieldKind, FieldValue, OptionsLoader, SchemaOption } from "@plane/ui";
import { api, useMembers, useOrganizationRoles, useOrganizationUnits } from "../api";
import { useEngineCatalog, useEngineDefinitions, useEngineSlug, enginePath } from "./api";
import type { LookupOptionDefinition, EnginePage } from "./api";
import { EngineRichText } from "./record-form";

export interface DefaultField {
  id?: string;
  code: string;
  kind: FieldKind;
  config: FieldConfig;
  lookup?: string | null;
  relation_entity?: string | null;
}

export function dynamicDefaultsFor(kind: FieldKind | undefined) {
  return [
    ...(["user", "short_text", "long_text"].includes(kind || "") ? ["current_user"] : []),
    ...(["date", "date_range", "datetime", "short_text", "long_text"].includes(kind || "") ? ["today"] : []),
    ...(["datetime", "short_text", "long_text"].includes(kind || "") ? ["now"] : []),
  ];
}

export function DefaultValueEditor({
  field,
  value,
  onChange,
  disabled = false,
}: {
  field: DefaultField;
  value?: FieldValue;
  onChange: (value: FieldValue) => void;
  disabled?: boolean;
}) {
  const slug = useEngineSlug(),
    { data: catalog } = useEngineCatalog();
  const { data: lookupValues = [] } = useEngineDefinitions<LookupOptionDefinition>("values", Boolean(field.lookup));
  const { data: members = [] } = useMembers(undefined, undefined, field.kind === "user");
  const { data: roles = [] } = useOrganizationRoles(undefined, field.kind === "role");
  const { data: units = [] } = useOrganizationUnits(undefined, field.kind === "unit");
  const code = field.code || "default_value";
  const schema: EntityFormSchema = {
    entity: "default",
    title: "مقدار پیش‌فرض",
    schema_version: 1,
    fields: [
      {
        id: field.id || code,
        code,
        title: "مقدار پیش‌فرض ثابت",
        kind: field.kind,
        config: {
          ...field.config,
          required: false,
          hidden: false,
          readonly: false,
          required_if: null,
          visible_if: null,
          effective_visible: true,
          depends_on: undefined,
          editable_after_create: true,
        },
        binding: { field: code },
        is_active: true,
      },
    ],
    layout: { tabs: [], sections: [{ id: "default", columns: 1, bindings: [{ field: code }] }] },
  };
  const loadOptions: OptionsLoader = async (_field, search, page, _parent, selected, resolve) => {
    if (field.kind === "relation") {
      const target = catalog?.entities.find((item) => item.id === field.relation_entity);
      if (!target) return { results: [], count: 0 };
      if (resolve && selected?.length) {
        const results = await Promise.all(
          selected.map(async (id) => {
            const response = await api.get(`${enginePath(slug)}/entities/${target.code}/records/${id}/`);
            return { id, title: response.data.title };
          })
        );
        return { results, count: results.length };
      }
      const response = await api.get<EnginePage>(`${enginePath(slug)}/entities/${target.code}/records/`, {
        params: { search, page },
      });
      return {
        results: response.data.results.map((item) => ({ id: item.id, title: item.title })),
        count: response.data.count,
      };
    }
    const options: SchemaOption[] =
      field.kind === "user"
        ? members.map((item) => ({ id: item.id, title: item.displayName }))
        : field.kind === "role"
          ? roles.map((item) => ({ id: item.id, title: item.name }))
          : field.kind === "unit"
            ? units.map((item) => ({ id: item.id, title: item.title }))
            : lookupValues
                .filter((item) => item.category === field.lookup && item.is_active)
                .map((item) => ({
                  id: field.config.lookup_codes ? item.code : item.id,
                  title: item.title,
                  color: item.color,
                }));
    const filtered = options.filter((item) => item.title.includes(search) && (!resolve || selected?.includes(item.id)));
    return { results: filtered.slice((page - 1) * 30, page * 30), count: filtered.length };
  };
  return (
    <div className="engine-default-editor">
      {field.kind === "file" && !field.id && (
        <p>برای افزودن فایل پیش‌فرض، ابتدا تعریف فیلد را ذخیره و سپس آن را ویرایش کنید.</p>
      )}
      <SchemaDrivenForm
        schema={schema}
        values={{ [code]: value ?? null }}
        onChange={(values) => onChange(values[code])}
        disabled={disabled || (field.kind === "file" && !field.id)}
        loadOptions={loadOptions}
        renderRichText={(item, text, change, readonly) => (
          <EngineRichText field={item} value={text} onChange={change} disabled={readonly} />
        )}
        uploadFile={async (_item, file) => {
          const data = new FormData();
          data.append("file", file);
          return (await api.post(`${enginePath(slug)}/definitions/fields/${field.id}/default-file/`, data)).data;
        }}
        fileHref={(_item, id) => `${enginePath(slug)}/definitions/fields/${field.id}/default-file/${id}/`}
      />
      <button type="button" className="button button-ghost" disabled={disabled} onClick={() => onChange(null)}>
        پاک کردن پیش‌فرض ثابت
      </button>
    </div>
  );
}
