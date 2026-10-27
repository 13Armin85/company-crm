import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { SchemaDrivenForm, validateSchemaValues, fieldVisible } from "@plane/ui";
import type { FormValues, OptionsLoader, SchemaField, SchemaOption } from "@plane/ui";
import type { TFileHandler } from "@plane/editor";
import { api, errorMessage } from "../api";
import { useUIStore } from "../store";
import { Button, Skeleton } from "../components";
import { useEngineSchema, useEngineRecord, useEngineSlug, enginePath, useEngineMutation, fieldErrors } from "./api";
import type { EngineRecord } from "./api";
import { entityDisplaySchema } from "./presentation";
import { DuplicateFeedback, duplicateDetails } from "./duplicate-feedback";

const noEmbeddedUpload = async (): Promise<string> => {
  throw new Error("برای فایل از فیلد آپلود فرم استفاده کنید.");
};
const RichTextEditorWithRef = lazy(async () => ({ default: (await import("@plane/editor")).RichTextEditorWithRef }));
const fileHandler: TFileHandler = {
  assetsUploadStatus: {},
  cancel: () => {},
  checkIfAssetExists: async () => false,
  delete: async () => {},
  getAssetDownloadSrc: async () => "",
  getAssetSrc: async () => "",
  restore: async () => {},
  upload: noEmbeddedUpload,
  duplicate: noEmbeddedUpload,
  validation: { maxFileSize: 5242880 },
};

export function EngineRichText({
  field,
  value,
  onChange,
  disabled,
}: {
  field: SchemaField;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="engine-rich-text">
      <Suspense fallback={<span>در حال آماده‌سازی ویرایشگر…</span>}>
        <RichTextEditorWithRef
          id={`engine-rich-${field.code}`}
          initialValue={value || "<p></p>"}
          value={value || "<p></p>"}
          editable={!disabled}
          disabledExtensions={["image", "issue-embed", "slash-commands"]}
          flaggedExtensions={[]}
          fileHandler={fileHandler}
          mentionHandler={{ renderComponent: () => null }}
          extendedEditorProps={{}}
          getEditorMetaData={() => ({ file_assets: [], user_mentions: [] })}
          onChange={(_json, html) => onChange(html)}
          placeholder={field.placeholder || "متن را بنویسید…"}
        />
      </Suspense>
    </div>
  );
}

export function RelationPreview({ code, id }: { code: string; id: string }) {
  const { data, error, isLoading } = useEngineRecord(code, id);
  if (isLoading) return <span>در حال دریافت…</span>;
  if (error) return <span>اطلاعات مرتبط در دسترس نیست.</span>;
  return (
    <div className="engine-preview">
      <strong>{data?.title}</strong>
      <small>{data?.number}</small>
      {["task", "ticket", "project", "leave"].includes(code) && <Link to={`/edit/${code}/${id}`}>باز کردن جزئیات</Link>}
    </div>
  );
}

export function useSchemaTransport(code: string, subtype = "", library = false, record = "") {
  const slug = useEngineSlug();
  const loadOptions = useCallback<OptionsLoader>(
    async (field, search, page, parent, selected, resolve) => {
      const params = new URLSearchParams({
        search,
        page: String(page),
        page_size: "30",
        ...(parent ? { parent } : {}),
        ...(subtype ? { subtype } : {}),
        ...(selected?.length ? { selected: selected.join(",") } : {}),
        ...(resolve ? { resolve: "true" } : {}),
        ...(library ? { library: "true" } : {}),
      });
      return (await api.get(`${enginePath(slug)}/entities/${code}/options/${field.code}/?${params}`)).data;
    },
    [code, slug, subtype, library]
  );
  const uploadFile = useCallback(
    async (field: SchemaField, file: File): Promise<SchemaOption> => {
      const data = new FormData();
      data.append("file", file);
      if (subtype) data.append("subtype", subtype);
      return (await api.post(`${enginePath(slug)}/entities/${code}/files/${field.code}/`, data)).data;
    },
    [code, slug, subtype]
  );
  const fileHref = useCallback(
    (field: SchemaField, id: string) =>
      `${enginePath(slug)}/entities/${code}/files/${field.code}/${id}/?${new URLSearchParams({ ...(record ? { record } : {}), ...(subtype ? { subtype } : {}) })}`,
    [code, slug, record, subtype]
  );
  return {
    loadOptions,
    uploadFile,
    fileHref,
    relationHref: (field: SchemaField, id: string) =>
      ["task", "ticket", "project", "leave"].includes(field.relation_entity || "")
        ? `/edit/${field.relation_entity}/${id}`
        : "#",
    renderRelationPreview: (field: SchemaField, id: string) => (
      <RelationPreview code={field.relation_entity || ""} id={id} />
    ),
    renderRichText: (field: SchemaField, value: string, onChange: (value: string) => void, disabled: boolean) => (
      <EngineRichText field={field} value={value} onChange={onChange} disabled={disabled} />
    ),
  };
}

export function EngineRecordForm({
  code,
  id = "",
  subtype = "",
  initialValues,
  onSaved,
  onCancel,
  readOnly = false,
  onDirtyChange,
  visibleFields,
}: {
  code: string;
  id?: string;
  subtype?: string;
  initialValues?: FormValues;
  onSaved?: (record: EngineRecord) => void;
  onCancel?: () => void;
  readOnly?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  visibleFields?: string[];
}) {
  const schemaQuery = useEngineSchema(code, subtype, id),
    recordQuery = useEngineRecord(code, id);
  const mutation = useEngineMutation(),
    transport = useSchemaTransport(code, recordQuery.data?.subtype || subtype, false, id);
  const [values, setValues] = useState<FormValues>({}),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [readyKey, setReadyKey] = useState("");
  const [savedWithWarning, setSavedWithWarning] = useState<EngineRecord | null>(null);
  const setDirty = useUIStore((s) => s.setFormDirty);
  const schema = schemaQuery.data,
    record = recordQuery.data;
  const key = `${code}:${subtype}:${id}`;
  useEffect(() => {
    if (!schema || (id && !record) || readyKey === key) return;
    setValues({ ...schema.defaults, ...(record?.values || initialValues) });
    setReadyKey(key);
    setErrors({});
  }, [schema, record, id, initialValues, key, readyKey]);
  const dirty =
    readyKey === key &&
    JSON.stringify(values) !== JSON.stringify({ ...schema?.defaults, ...(record?.values || initialValues) });
  useEffect(() => {
    onDirtyChange?.(dirty && !readOnly);
    setDirty(`entity:${key}`, dirty && !readOnly);
    return () => setDirty(`entity:${key}`, false);
  }, [dirty, key, readOnly, setDirty, onDirtyChange]);
  const canEdit = !readOnly && (!id || Boolean(record?.can_edit));
  const failure = schemaQuery.error || recordQuery.error || mutation.error;
  if (schemaQuery.isLoading || (id && recordQuery.isLoading) || (readyKey !== key && !failure))
    return <Skeleton rows={4} />;
  if (!schema)
    return <p role="alert">{errorMessage(failure, "فرم منتشرشده دریافت نشد. دوباره صفحه را بارگذاری کنید.")}</p>;
  return (
    <form
      className="engine-record-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!canEdit || mutation.isPending) return;
        const invalid = validateSchemaValues(schema, values);
        setErrors(invalid);
        if (Object.keys(invalid).length) return;
        const payload = Object.fromEntries(
          schema.fields
            .filter(
              (f) =>
                f.is_active &&
                fieldVisible(f, values, schema) &&
                f.kind !== "computed" &&
                !f.config.readonly &&
                !(id && f.config.editable_after_create === false) &&
                (id
                  ? JSON.stringify(values[f.code]) !== JSON.stringify(record?.values[f.code])
                  : values[f.code] !== undefined)
            )
            .map((f) => [f.code, values[f.code]])
        );
        try {
          const result = (await mutation.mutateAsync({
            path: `entities/${code}/records/${id ? `${id}/` : ""}`,
            method: id ? "patch" : "post",
            data: { values: payload, ...(id ? { revision: record?.revision } : {}), ...(subtype ? { subtype } : {}) },
          })) as EngineRecord;
          setDirty(`entity:${key}`, false);
          setReadyKey("");
          if (result.warnings?.length) setSavedWithWarning(result);
          else onSaved?.(result);
        } catch (error) {
          setErrors(fieldErrors(error));
        }
      }}
    >
      {failure && <p role="alert">{errorMessage(failure, "ذخیره انجام نشد؛ مقادیر و دسترسی خود را بررسی کنید.")}</p>}
      <DuplicateFeedback details={duplicateDetails(mutation.error)} />
      {savedWithWarning && (
        <>
          <p role="status">رکورد با هشدار ثبت شد.</p>
          <DuplicateFeedback details={savedWithWarning.warnings || []} />
          <Button
            onClick={() => {
              onSaved?.(savedWithWarning);
              setSavedWithWarning(null);
            }}
          >
            ادامه
          </Button>
        </>
      )}
      <SchemaDrivenForm
        schema={entityDisplaySchema(
          visibleFields
            ? {
                ...schema,
                layout: {
                  tabs: [],
                  sections: [
                    {
                      id: "summary",
                      columns: 1,
                      bindings: visibleFields
                        .filter((code) => schema.fields.some((field) => field.code === code))
                        .map((field) => ({ field })),
                    },
                  ],
                },
              }
            : schema
        )}
        values={values}
        onChange={setValues}
        errors={errors}
        disabled={!canEdit || mutation.isPending}
        editing={Boolean(id)}
        {...transport}
      />
      <footer className="engine-form-footer">
        {canEdit && (
          <Button type="submit" disabled={mutation.isPending || Boolean(savedWithWarning)}>
            {mutation.isPending ? "در حال ذخیره…" : id ? "ذخیره تغییرات" : "ثبت"}
          </Button>
        )}
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel} disabled={mutation.isPending}>
            بستن
          </Button>
        )}
      </footer>
    </form>
  );
}
