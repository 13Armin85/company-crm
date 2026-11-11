import type { SchemaField } from "@plane/ui";
import { Plus } from "lucide-react";
import { useEngineDefinitions, useEngineRecord } from "./api";
import type { LookupDefinition, LookupOptionDefinition } from "./api";

export type LinkField = {
  code: string;
  title: string;
  kind: "integer" | "decimal" | "short_text" | "select";
  lookup?: string | null;
  config: { required?: boolean; min?: number; max?: number };
};
export type LinkEntry = { id: string; data: Record<string, unknown> };

export const linkFieldsOf = (field: SchemaField): LinkField[] => field.config.link_fields || [];

export const selectedIds = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];

/** Keep the data of records that stay selected; newly selected records start empty. */
export function alignEntries(ids: string[], entries: LinkEntry[] = []): LinkEntry[] {
  const kept = entries.filter((entry) => ids.includes(entry.id));
  return [...kept, ...ids.filter((id) => !kept.some((entry) => entry.id === id)).map((id) => ({ id, data: {} }))];
}

/** Persian message for the first required link value that is missing, or "". */
export function missingLinkData(fields: LinkField[], entries: LinkEntry[]): string {
  for (const entry of entries)
    for (const field of fields)
      if (field.config.required && [undefined, null, ""].includes(entry.data[field.code] as never))
        return `«${field.title}» برای هر رکورد مرتبط الزامی است.`;
  return "";
}

function RecordTitle({ entity, id }: { entity: string; id: string }) {
  const record = useEngineRecord(entity, id);
  return <strong>{record.data?.title || "رکورد مرتبط"}</strong>;
}

export function RelationLinkInputs({
  field,
  entries,
  onChange,
  disabled = false,
}: {
  field: SchemaField;
  entries: LinkEntry[];
  onChange: (entries: LinkEntry[]) => void;
  disabled?: boolean;
}) {
  const fields = linkFieldsOf(field);
  const needsLookups = fields.some((item) => item.kind === "select");
  const lookups = useEngineDefinitions<LookupDefinition>("lookups", needsLookups);
  const values = useEngineDefinitions<LookupOptionDefinition>("values", needsLookups);
  if (!fields.length || !entries.length) return null;
  const options = (code?: string | null) => {
    const category = lookups.data?.find((lookup) => lookup.code === code);
    return (values.data || []).filter(
      (value) => category && value.is_active && [category.id, category.code].includes(value.category)
    );
  };
  const set = (index: number, code: string, value: unknown) =>
    onChange(
      entries.map((entry, position) =>
        position === index ? { ...entry, data: { ...entry.data, [code]: value } } : entry
      )
    );
  return (
    <fieldset className="engine-relation-link-data" aria-label={`اطلاعات ارتباط ${field.title}`}>
      <legend>اطلاعات ارتباط «{field.title}»</legend>
      {entries.map((entry, index) => (
        <div className="engine-relation-link-row" key={`${entry.id}:${index}`}>
          <RecordTitle entity={field.relation_entity || ""} id={entry.id} />
          {fields.map((item) => {
            const current = entry.data[item.code];
            const label = `${item.title}${item.config.required ? " *" : ""}`;
            if (item.kind === "select")
              return (
                <label key={item.code}>
                  {label}
                  <select
                    disabled={disabled}
                    value={typeof current === "string" ? current : ""}
                    onChange={(event) => set(index, item.code, event.target.value || null)}
                  >
                    <option value="">انتخاب کنید</option>
                    {options(item.lookup).map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.title}
                      </option>
                    ))}
                  </select>
                </label>
              );
            const numeric = item.kind !== "short_text";
            return (
              <label key={item.code}>
                {label}
                <input
                  disabled={disabled}
                  type={numeric ? "number" : "text"}
                  inputMode={item.kind === "integer" ? "numeric" : numeric ? "decimal" : undefined}
                  min={item.config.min}
                  max={item.config.max}
                  step={item.kind === "integer" ? 1 : "any"}
                  value={current === undefined || current === null ? "" : String(current)}
                  onChange={(event) => {
                    const raw = event.target.value;
                    set(index, item.code, raw === "" ? null : item.kind === "integer" ? Number(raw) : raw);
                  }}
                />
              </label>
            );
          })}
        </div>
      ))}
    </fieldset>
  );
}

/** Link-data inputs and the quick-create button shown under one relation field of a form. */
export function RelationFieldExtras({
  field,
  entries,
  canCreate,
  disabled = false,
  onChange,
  onCreate,
}: {
  field: SchemaField;
  entries: LinkEntry[];
  canCreate: boolean;
  disabled?: boolean;
  onChange: (entries: LinkEntry[]) => void;
  onCreate: () => void;
}) {
  const hasLinkData = linkFieldsOf(field).length > 0 && entries.length > 0;
  if (!canCreate && !hasLinkData) return null;
  const label = `ساخت رکورد جدید برای «${field.title}»`;
  return (
    <div className="engine-relation-extras">
      {canCreate && (
        <button
          type="button"
          className="engine-relation-create"
          aria-label={label}
          title={label}
          disabled={disabled}
          onClick={onCreate}
        >
          <Plus size={14} strokeWidth={2.4} aria-hidden="true" />
          <span>رکورد جدید</span>
        </button>
      )}
      <RelationLinkInputs field={field} entries={entries} disabled={disabled} onChange={onChange} />
    </div>
  );
}
