import { useState } from "react";
import { Link } from "react-router";
import { SchemaDrivenForm } from "@plane/ui";
import type { SchemaField } from "@plane/ui";
import { Button } from "../components";
import { errorMessage, useWorkspaceAccess } from "../api";
import { useEngineQuery, useEngineRecord, useEngineMutation, useEngineSchema } from "./api";
import { EngineRecordForm, useSchemaTransport } from "./record-form";
import type { ViewResult } from "./view-types";

function RelatedSection({ code, id, field }: { code: string; id: string; field: SchemaField }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(1);
  const [latestRevision, setLatestRevision] = useState<number | null>(null);
  const record = useEngineRecord(code, id);
  const transport = useSchemaTransport(code, "", false, id);
  const mutation = useEngineMutation();
  const rows = useEngineQuery<ViewResult & { entity: string }>(
    "related-records",
    `entities/${code}/records/${id}/related/${field.code}/?page=${page}&page_size=10`,
    open
  );
  const write = async (targetId: string | string[], action: "attach" | "detach") => {
    const result = await mutation.mutateAsync({
      path: `entities/${code}/records/${id}/related/${field.code}/`,
      data: {
        ...(Array.isArray(targetId) ? { targets: targetId } : { target: targetId }),
        action,
        revision: Math.max(latestRevision || 0, record.data?.revision || 0),
      },
    });
    const revision = (result as { revision?: number }).revision;
    if (typeof revision === "number") setLatestRevision(revision);
    return result;
  };
  const editable = record.data?.can_edit && !field.config.readonly;
  return (
    <section className="engine-view-settings">
      <Button variant="ghost" onClick={() => setOpen(!open)}>
        {field.title} {open ? "▴" : "▾"}
      </Button>
      {open && (
        <>
          {rows.isLoading ? (
            <p>در حال دریافت…</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>عنوان</th>
                  <th>شماره</th>
                  <th>وضعیت</th>
                  <th>عملیات</th>
                </tr>
              </thead>
              <tbody>
                {rows.data?.results.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link to={`/entities/${rows.data?.entity}/${row.id}`}>{row.title}</Link>
                    </td>
                    <td>{row.number}</td>
                    <td>
                      {["task_status", "ticket_state"]
                        .map((key) =>
                          row.values[key]
                            ? rows.data?.labels[key]?.[String(row.values[key])]?.title || String(row.values[key])
                            : null
                        )
                        .find(Boolean) || "—"}
                    </td>
                    <td>
                      {editable && (
                        <Button
                          variant="danger"
                          onClick={() => {
                            if (window.confirm("این رکورد از ارتباط جدا شود؟"))
                              void write(row.id, "detach").catch(() => {});
                          }}
                        >
                          جدا کردن
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!rows.isLoading && !rows.data?.count && <p>رکورد مرتبطی وجود ندارد.</p>}
          {Boolean(rows.data?.count) && (
            <div className="engine-actions">
              <span>{rows.data?.count.toLocaleString("fa-IR")} رکورد مرتبط</span>
              <Button variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>
                قبلی
              </Button>
              <Button
                variant="secondary"
                disabled={page * 10 >= (rows.data?.count || 0)}
                onClick={() => setPage(page + 1)}
              >
                بعدی
              </Button>
            </div>
          )}
          {editable && (
            <>
              <SchemaDrivenForm
                {...transport}
                schema={{
                  entity: code,
                  title: field.title,
                  schema_version: 1,
                  fields: [{ ...field, config: { ...field.config, required: false } }],
                  layout: { tabs: [], sections: [{ id: "attach", columns: 1, bindings: [{ field: field.code }] }] },
                }}
                values={{ [field.code]: field.config.multiple ? target : target[0] || null }}
                onChange={(values) =>
                  setTarget(
                    Array.isArray(values[field.code])
                      ? (values[field.code] as string[])
                      : values[field.code]
                        ? [String(values[field.code])]
                        : []
                  )
                }
              />
              <Button
                disabled={!target.length || mutation.isPending}
                onClick={() => {
                  const selected = [...target];
                  setTarget([]);
                  void write(selected, "attach").catch(() =>
                    setTarget((current) => (current.length ? current : selected))
                  );
                }}
              >
                اتصال رکورد موجود
              </Button>
              <Button variant="secondary" onClick={() => setCreating(!creating)}>
                افزودن رکورد مرتبط
              </Button>
              {creating && field.relation_entity && (
                <EngineRecordForm
                  code={field.relation_entity}
                  onSaved={(created) =>
                    void write(created.id, "attach")
                      .then(() => setCreating(false))
                      .catch(() => {})
                  }
                  onCancel={() => setCreating(false)}
                />
              )}
            </>
          )}
          {(rows.error || mutation.error) && (
            <p role="alert">{errorMessage(rows.error || mutation.error, "عملیات رکوردهای مرتبط انجام نشد.")}</p>
          )}
        </>
      )}
    </section>
  );
}

export function RelatedRecords({ code, id }: { code: string; id: string }) {
  const { data: access } = useWorkspaceAccess();
  const schema = useEngineSchema(code, "", id);
  if (!access?.can("Relation.View")) return null;
  return (
    <section aria-label="رکوردهای مرتبط">
      <h3>رکوردهای مرتبط</h3>
      {schema.data?.fields
        .filter((field) => field.kind === "relation")
        .map((field) => (
          <RelatedSection key={`${id}:${field.code}`} code={code} id={id} field={field} />
        ))}
    </section>
  );
}

export function RelatedListPreview({
  code,
  id,
  field,
  count,
}: {
  code: string;
  id: string;
  field: string;
  count: number;
}) {
  const [open, setOpen] = useState(false);
  const rows = useEngineQuery<ViewResult & { entity: string }>(
    "related-preview",
    `entities/${code}/records/${id}/related/${field}/?page_size=5`,
    open
  );
  return (
    <span className="engine-related-list" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <Button variant="ghost" onClick={() => setOpen(!open)}>
        {count.toLocaleString("fa-IR")} رکورد مرتبط
      </Button>
      {open && (
        <span className="engine-related-preview" role="dialog" aria-label="فهرست کوتاه رکوردهای مرتبط">
          {rows.isLoading
            ? "در حال دریافت…"
            : rows.error
              ? "دریافت فهرست انجام نشد."
              : rows.data?.results.map((row) => {
                  const status = row.values.task_status || row.values.ticket_state;
                  return (
                    <span key={row.id}>
                      <Link to={`/entities/${rows.data?.entity}/${row.id}`}>{row.title}</Link>
                      <small>
                        {status
                          ? rows.data?.labels.task_status?.[String(status)]?.title ||
                            rows.data?.labels.ticket_state?.[String(status)]?.title ||
                            String(status)
                          : "—"}
                      </small>
                    </span>
                  );
                })}
        </span>
      )}
    </span>
  );
}
