import { Children, cloneElement, isValidElement, useEffect, useState } from "react";
import type { FormEvent, FormHTMLAttributes, ReactElement, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Settings2 } from "lucide-react";
import { SchemaDrivenForm, validateSchemaValues, fieldVisible } from "@plane/ui";
import type {
  EntityFormSchema,
  FieldBinding,
  FormValues,
  SchemaField,
  OptionsLoader,
  FormLayoutSchema,
} from "@plane/ui";
import { api, errorMessage, useWorkspaceAccess } from "../api";
import { useUIStore } from "../store";
import { useEngineQuery, useEngineSlug, enginePath } from "./api";
import { EngineRichText } from "./record-form";
import { persianDate } from "../utils";
import { Button } from "../components";
import { EntityViewsPage } from "./view-page";
import type { SavedViewList } from "./view-types";
import { RecordSummaryDrawer } from "./record-drawer";

export interface NativeField {
  code: string;
  title: string;
  kind: SchemaField["kind"];
  required: boolean;
  locked: boolean;
  lock_reason?: string;
  hidden?: boolean;
  aliases: string[];
}
export interface SurfaceDefinition {
  native: Record<string, { required?: boolean; hidden?: boolean }>;
  fields: FieldBinding[];
  columns: string[];
  table_tabs?: { id: string; title: string; columns: string[] }[];
}
export interface SurfaceSchema {
  code: string;
  title: string;
  path: string;
  engine: string | null;
  revision: number;
  definition: SurfaceDefinition;
  native_fields: NativeField[];
  native_columns: string[];
  engine_fields: (SchemaField & { options_surface?: string })[];
  form?: { revision: number; layout: FormLayoutSchema } | null;
  schema: EntityFormSchema;
  designer?: SurfaceDesigner;
}
export interface SurfaceDesigner {
  can_publish: boolean;
  can_create_field: boolean;
  publish_reason: string;
  create_field_reason: string;
  field_types: { id: SchemaField["kind"]; title: string }[];
  locked_fields: Record<string, string>;
  limits: { table_tabs: number; tab_title: number; field_title: number; options: number };
}
export const useSurface = (code: string) =>
  useEngineQuery<SurfaceSchema>("surface", `surfaces/${code}/`, Boolean(code));

export function useSurfaceValues(code: string, ids: string[]) {
  const slug = useEngineSlug();
  // eslint-disable-next-line unicorn/no-array-sort -- Sort a private copy for browsers without toSorted.
  const key = [...new Set(ids)].sort().join(",");
  return useQuery({
    queryKey: ["entity-engine", slug, "surface-values", code, key],
    enabled: Boolean(slug && key && code),
    queryFn: async ({ signal }): Promise<Record<string, FormValues>> => {
      const identifiers = key.split(","),
        batches: string[][] = [];
      for (let i = 0; i < identifiers.length; i += 100) batches.push(identifiers.slice(i, i + 100));
      const responses = await Promise.all(
        batches.map(
          async (batch) =>
            (
              await api.get(`${enginePath(slug)}/surfaces/${code}/values/`, {
                params: { ids: batch.join(",") },
                signal,
              })
            ).data.values as Record<string, FormValues>
        )
      );
      return Object.assign({}, ...responses);
    },
  });
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/** Apply native field settings without replacing the page's business controls. */
export function configureNativeFields(children: ReactNode, fields: NativeField[]): ReactNode {
  const controls = (node: ReactNode, required: boolean): ReactNode =>
    Children.map(node, (child) => {
      if (!isValidElement<Record<string, unknown>>(child)) return child;
      const props = child.props;
      if (typeof child.type === "string" && ["input", "textarea", "select"].includes(child.type))
        return cloneElement(child, { required: props.type === "checkbox" ? undefined : required });
      return props.children
        ? cloneElement(child, { children: controls(props.children as ReactNode, required) })
        : child;
    });
  return Children.map(children, (child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return child;
    const props = child.props;
    const label =
      typeof props.label === "string"
        ? props.label
        : child.type === "label"
          ? textOf(Children.toArray(props.children as ReactNode).find((c) => isValidElement(c) && c.type === "span"))
          : "";
    const field = fields.find((f) => f.title === label || f.aliases.includes(label));
    if (field) {
      if (field.hidden) return null;
      return cloneElement(child, { children: controls(props.children as ReactNode, field.required) });
    }
    return props.children
      ? cloneElement(child, { children: configureNativeFields(props.children as ReactNode, fields) })
      : child;
  });
}

export function useSurfaceTransport(code: string, record = "", engine = false) {
  const slug = useEngineSlug();
  const base = `${enginePath(slug)}/surfaces/${code}`;
  const loadOptions: OptionsLoader = async (field, search, page, parent, selected, resolve) =>
    (
      await api.get(`${base}/options/${field.code}/`, {
        params: {
          search,
          page,
          parent,
          selected: selected?.join(","),
          resolve,
          subtype: (field as SchemaField & { options_subtype?: string }).options_subtype,
        },
      })
    ).data;
  return {
    loadOptions,
    uploadFile: async (field: SchemaField, file: File) => {
      const data = new FormData();
      data.append("file", file);
      return (await api.post(`${base}/files/${field.code}/`, data)).data;
    },
    fileHref: (field: SchemaField, id: string) =>
      `${engine ? `${enginePath(slug)}/entities/${code}` : base}/files/${field.code}/${id}/?${new URLSearchParams({ record, subtype: (field as SchemaField & { options_subtype?: string }).options_subtype || "" })}`,
    relationHref: (field: SchemaField, id: string) =>
      ["task", "ticket", "project", "leave"].includes(field.relation_entity || "")
        ? `/edit/${field.relation_entity}/${id}`
        : "#",
    renderRichText: (field: SchemaField, value: string, onChange: (value: string) => void, disabled: boolean) => (
      <EngineRichText field={field} value={value} onChange={onChange} disabled={disabled} />
    ),
  };
}

export function SurfaceForm({
  code,
  recordId = "",
  children,
  onSubmit,
  ...props
}: Omit<FormHTMLAttributes<HTMLFormElement>, "onSubmit"> & {
  code: string;
  recordId?: string;
  onSubmit: (event: FormEvent<HTMLFormElement>, values: FormValues) => void;
}) {
  const config = useSurface(code),
    stored = useSurfaceValues(code, recordId ? [recordId] : []);
  const transport = useSurfaceTransport(code, recordId);
  const [values, setValues] = useState<FormValues>({}),
    [ready, setReady] = useState(""),
    [errors, setErrors] = useState<Record<string, string>>({});
  const formKey = `${code}:${recordId || "new"}`;
  const setDirty = useUIStore((s) => s.setFormDirty);
  useEffect(() => {
    if (config.data && (!recordId || stored.data) && ready !== formKey) {
      setValues({ ...config.data.schema.defaults, ...stored.data?.[recordId] });
      setReady(formKey);
    }
  }, [config.data, stored.data, recordId, formKey, ready]);
  const baseline = { ...config.data?.schema.defaults, ...stored.data?.[recordId] };
  const dirty = ready === formKey && JSON.stringify(values) !== JSON.stringify(baseline);
  useEffect(() => {
    setDirty(`surface:${formKey}`, dirty);
    return () => setDirty(`surface:${formKey}`, false);
  }, [dirty, formKey, setDirty]);
  const failure = config.error || stored.error;
  const content = Children.toArray(children);
  const isAction = (node: ReactNode) =>
    isValidElement<{ type?: string }>(node) && (node.type === "footer" || node.props.type === "submit");
  // Render existing fields while loading; submitting waits for the server schema.
  return (
    <form
      {...props}
      onSubmit={(event) => {
        event.preventDefault();
        if (!config.data || ready !== formKey || failure) return;
        const validation = validateSchemaValues(config.data.schema, values);
        setErrors(validation);
        if (Object.keys(validation).length) return;
        const submitted = Object.fromEntries(
          config.data.schema.fields
            .filter((f) => f.kind !== "computed" && !f.config.readonly && f.is_active && fieldVisible(f, values))
            .map((f) => [f.code, values[f.code] ?? null])
        );
        onSubmit(event, submitted);
      }}
    >
      {configureNativeFields(
        content.filter((node) => !isAction(node)),
        config.data?.native_fields || []
      )}
      {failure && <p role="alert">{errorMessage(failure, "تنظیمات فرم دریافت نشد. دوباره تلاش کنید.")}</p>}
      {!!config.data?.schema.fields.length && (
        <div className="surface-extra-fields">
          <SchemaDrivenForm
            schema={config.data.schema}
            values={values}
            onChange={setValues}
            errors={errors}
            disabled={ready !== formKey || Boolean(failure)}
            editing={Boolean(recordId)}
            {...transport}
          />
        </div>
      )}
      {ready !== formKey && !failure && <p role="status">در حال دریافت تنظیمات فرم…</p>}
      {content.filter(isAction)}
    </form>
  );
}

export function SurfaceFields({
  code,
  recordId,
  children,
  onChange,
  disabled = false,
}: {
  code: string;
  recordId: string;
  children?: ReactNode;
  onChange: (values: FormValues) => void;
  disabled?: boolean;
}) {
  const config = useSurface(code),
    stored = useSurfaceValues(code, recordId ? [recordId] : []),
    transport = useSurfaceTransport(code, recordId);
  const [values, setValues] = useState<FormValues>({}),
    [ready, setReady] = useState("");
  const formKey = `${code}:${recordId}`;
  useEffect(() => {
    if (config.data && stored.data && ready !== formKey) {
      setValues({ ...config.data.schema.defaults, ...stored.data[recordId] });
      setReady(formKey);
    }
  }, [config.data, stored.data, recordId, ready, formKey]);
  const setDirty = useUIStore((state) => state.setFormDirty);
  const dirty =
    ready === formKey &&
    JSON.stringify(values) !== JSON.stringify({ ...config.data?.schema.defaults, ...stored.data?.[recordId] });
  useEffect(() => {
    setDirty(`surface-fields:${formKey}`, dirty);
    return () => setDirty(`surface-fields:${formKey}`, false);
  }, [dirty, formKey, setDirty]);
  return (
    <>
      {configureNativeFields(children, config.data?.native_fields || [])}
      {(config.error || stored.error) && <p role="alert">دریافت اطلاعات تکمیلی انجام نشد.</p>}
      {!!config.data?.schema.fields.length && (
        <div className="surface-extra-fields">
          <SchemaDrivenForm
            schema={config.data.schema}
            values={values}
            disabled={disabled || ready !== formKey}
            editing
            onChange={(next) => {
              setValues(next);
              if (config.data)
                onChange(
                  Object.fromEntries(
                    config.data.schema.fields
                      .filter(
                        (f) => f.kind !== "computed" && !f.config.readonly && f.is_active && fieldVisible(f, next)
                      )
                      .map((f) => [f.code, next[f.code] ?? null])
                  )
                );
            }}
            {...transport}
          />
        </div>
      )}
    </>
  );
}

export function SurfaceFieldValue({
  field,
  value,
  code,
  recordId,
  recordValues,
}: {
  field: SchemaField & { options_surface?: string; options_subtype?: string };
  value: FormValues[string] | undefined;
  code: string;
  recordId: string;
  recordValues?: FormValues;
}) {
  const transport = useSurfaceTransport(field.options_surface || code, recordId, Boolean(field.options_surface));
  const slug = useEngineSlug();
  const reference = Boolean(
    field.lookup || ["select", "multi_select", "user", "unit", "role", "relation"].includes(field.kind)
  );
  const ids = Array.isArray(value) ? value : value == null ? [] : [String(value)];
  const key = ids.join(",");
  const parent = field.config.depends_on ? String(recordValues?.[field.config.depends_on] || "") : undefined;
  const labelQuery = useQuery({
    queryKey: [
      "entity-engine",
      slug,
      "surface-labels",
      field.options_surface || code,
      field.options_subtype || "",
      field.code,
      parent,
      key,
    ],
    enabled: Boolean(slug && reference && key),
    queryFn: async () => {
      const response = await transport.loadOptions(field, "", 1, parent, key.split(","), true);
      return Object.fromEntries(response.results.map((r) => [r.id, r.title]));
    },
  });
  const labels = labelQuery.data || {};
  if (value == null || value === "" || (Array.isArray(value) && !value.length)) return <>—</>;
  if (field.kind === "file")
    return (
      <>
        {ids.map((id, i) => (
          <a key={id} href={transport.fileHref(field, id)} target="_blank" rel="noreferrer">
            پیوست {(i + 1).toLocaleString("fa-IR")}{" "}
          </a>
        ))}
      </>
    );
  if (reference) return <>{ids.map((id) => labels[id] || "انتخاب ثبت‌شده").join("، ")}</>;
  if (field.kind === "date" || field.kind === "datetime")
    return (
      <>{persianDate(String(value), field.kind === "datetime" ? { hour: "2-digit", minute: "2-digit" } : undefined)}</>
    );
  if (typeof value === "boolean") return <>{value ? "بله" : "خیر"}</>;
  if (typeof value === "object" && !Array.isArray(value))
    return (
      <>
        {persianDate(value.start)} تا {persianDate(value.end)}
      </>
    );
  if (field.kind === "rich_text") return <>{String(value).replace(/<[^>]*>/g, " ")}</>;
  return <>{Array.isArray(value) ? value.join("، ") : String(value)}</>;
}

const surfaceRowId = (row: ReactElement) =>
  String(row.key || "")
    .split("$")
    .at(-1) || "";

export function SurfaceTable({
  code,
  children,
  ...props
}: { code: string; children: ReactNode } & React.TableHTMLAttributes<HTMLTableElement>) {
  const config = useSurface(code),
    { data: access } = useWorkspaceAccess();
  const engineCode = config.data?.engine || ({ users: "user", units: "unit" } as Record<string, string>)[code];
  const saved = useEngineQuery<SavedViewList>(
    "views",
    `entities/${engineCode}/views/`,
    Boolean(engineCode && access?.can("View.Personal.Create"))
  );
  const [personalMode, setPersonalMode] = useState<boolean | null>(null);
  const [summaryId, setSummaryId] = useState<string | null>(null);
  const elements = Children.toArray(children).filter(isValidElement) as ReactElement<{ children?: ReactNode }>[];
  const head = elements.find((element) => element.type === "thead"),
    body = elements.find((element) => element.type === "tbody");
  const headerRow = Children.toArray(head?.props.children).find(isValidElement) as
    | ReactElement<{ children?: ReactNode }>
    | undefined;
  const headings = Children.toArray(headerRow?.props.children);
  const rows = Children.toArray(body?.props.children).filter(isValidElement) as ReactElement<{
    children?: ReactNode;
  }>[];
  const [activeTab, setActiveTab] = useState("");
  const tabs = config.data?.definition.table_tabs || [];
  const selectedTab = tabs.find((tab) => tab.id === activeTab);
  const columns =
    selectedTab?.columns || config.data?.definition.columns || headings.map((h) => `native:${textOf(h) || "عملیات"}`);
  const values = useSurfaceValues(code, columns.some((c) => !c.startsWith("native:")) ? rows.map(surfaceRowId) : []);
  const fields = [...(config.data?.schema.fields || []), ...(config.data?.engine_fields || [])];
  const showPersonal =
    personalMode ?? Boolean(saved.data?.default_id && saved.data.default_id !== saved.data.official_id);
  if (showPersonal && engineCode)
    return (
      <div className="surface-table-wrap">
        <Button variant="ghost" onClick={() => setPersonalMode(false)}>
          بازگشت به جدول رسمی
        </Button>
        <EntityViewsPage entityCode={engineCode} />
      </div>
    );
  return (
    <div className="surface-table-wrap">
      {engineCode && summaryId && (
        <RecordSummaryDrawer
          code={engineCode}
          id={summaryId}
          viewId=""
          rows={rows.map((row) => ({ id: surfaceRowId(row) }))}
          onSelect={setSummaryId}
        />
      )}
      {engineCode && access?.can("View.Personal.Create") && (
        <Button variant="secondary" onClick={() => setPersonalMode(true)}>
          جدول من
        </Button>
      )}
      {access?.can("FormDesigner.Publish") && (
        <Link className="surface-config-link" to={`/settings/engine?page=${code}&mode=columns`}>
          <Settings2 size={14} /> تنظیم جدول و تب‌ها
        </Link>
      )}
      {(config.error || values.error) && <p role="alert">دریافت تنظیمات یا اطلاعات ستون‌ها انجام نشد.</p>}
      {!!tabs.length && (
        <div className="surface-table-tabs" role="tablist" aria-label="تب‌های جدول">
          <button type="button" role="tab" aria-selected={!selectedTab} onClick={() => setActiveTab("")}>
            جدول اصلی
          </button>
          {tabs.map((tab) => (
            <button
              type="button"
              key={tab.id}
              role="tab"
              aria-selected={selectedTab?.id === tab.id}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.title}
            </button>
          ))}
        </div>
      )}
      <table {...props}>
        <thead>
          <tr>
            {columns.map((column) => {
              const native = column.startsWith("native:"),
                title = column.slice(column.indexOf(":") + 1);
              return (
                <th key={column}>{native ? title : fields.find((f) => f.code === title)?.title || "فیلد غیرفعال"}</th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const cells = Children.toArray(row.props.children),
              id = surfaceRowId(row);
            return cloneElement(row, {
              ...(engineCode
                ? {
                    onClick: (event: React.MouseEvent<HTMLElement>) => {
                      if (
                        !(event.target as HTMLElement).closest(
                          "a,button,input,select,textarea,[role='button'],[role='menuitem']"
                        )
                      )
                        setSummaryId(id);
                    },
                  }
                : {}),
              children: columns.map((column) => {
                const name = column.slice(column.indexOf(":") + 1);
                if (column.startsWith("native:")) {
                  const index = headings.findIndex((heading) => (textOf(heading) || "عملیات") === name);
                  return index >= 0 && isValidElement(cells[index]) ? (
                    cloneElement(cells[index], { key: column })
                  ) : (
                    <td key={column}>—</td>
                  );
                }
                const field = fields.find((f) => f.code === name);
                return (
                  <td key={column}>
                    {field ? (
                      <SurfaceFieldValue
                        code={code}
                        recordId={id}
                        field={field}
                        value={values.data?.[id]?.[name]}
                        recordValues={values.data?.[id]}
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                );
              }),
            });
          })}
        </tbody>
      </table>
    </div>
  );
}
