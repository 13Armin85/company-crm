import { useState } from "react";
import { Link } from "react-router";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import type { FieldValue } from "@plane/ui";
import { Button, Skeleton } from "../components";
import { errorMessage } from "../api";
import { useEngineQuery } from "./api";
import type { EngineRecord } from "./api";
import { EngineRecordForm } from "./record-form";
import { ViewValue } from "./view-value";
import { RelatedRecords } from "./related-records";
import type { ViewField, ViewResult, ViewRow } from "./view-types";

export function RecordSummaryDrawer({
  code,
  id,
  viewId,
  rows,
  onSelect,
  hasPreviousPage = false,
  hasNextPage = false,
  onPage,
}: {
  code: string;
  id: string;
  viewId: string;
  rows: Pick<ViewRow, "id">[];
  onSelect: (id: string | null) => void;
  hasPreviousPage?: boolean;
  hasNextPage?: boolean;
  onPage?: (direction: -1 | 1) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const summary = useEngineQuery<{
    fields: (ViewField & { field: string; value: FieldValue })[];
    labels: ViewResult["labels"];
    record: EngineRecord;
  }>(
    "summary",
    `entities/${code}/records/${id}/summary/?${new URLSearchParams(viewId && !viewId.startsWith("system:") ? { view_id: viewId } : {})}`
  );
  const select = (next: string | null) => {
    if (dirty && !window.confirm("تغییرات ذخیره‌نشده کنار گذاشته شوند؟")) return;
    setEditing(false);
    setDirty(false);
    onSelect(next);
  };
  const index = rows.findIndex((row) => row.id === id);
  const navigate = (direction: -1 | 1) => {
    const next = rows[index + direction];
    if (next) {
      select(next.id);
      return;
    }
    if (!onPage || (dirty && !window.confirm("تغییرات ذخیره‌نشده کنار گذاشته شوند؟"))) return;
    setEditing(false);
    setDirty(false);
    onPage(direction);
  };
  return (
    <Dialog open onClose={() => select(null)} className="engine-view-dialog">
      <div className="engine-view-backdrop" />
      <DialogPanel className="engine-view-drawer engine-record-drawer" dir="rtl">
        <header className="engine-actions">
          <DialogTitle>خلاصه اطلاعات</DialogTitle>
          <Button variant="ghost" onClick={() => select(null)}>
            بستن
          </Button>
        </header>
        {summary.isLoading ? (
          <Skeleton rows={5} />
        ) : summary.error ? (
          <p role="alert">{errorMessage(summary.error, "دریافت خلاصه انجام نشد.")}</p>
        ) : (
          summary.data && (
            <>
              <h3>{summary.data.record.title}</h3>
              <small>{summary.data.record.number}</small>
              {editing ? (
                <EngineRecordForm
                  code={code}
                  id={id}
                  visibleFields={summary.data.fields.map((field) => field.field)}
                  onDirtyChange={setDirty}
                  onSaved={() => {
                    setDirty(false);
                    setEditing(false);
                  }}
                  onCancel={() => {
                    if (!dirty || window.confirm("تغییرات ذخیره‌نشده کنار گذاشته شوند؟")) {
                      setDirty(false);
                      setEditing(false);
                    }
                  }}
                />
              ) : (
                <>
                  <section className="engine-record-summary">
                    {summary.data.fields.map((field) => (
                      <div key={field.field}>
                        <small>{field.title}</small>
                        <ViewValue field={field} value={field.value} labels={summary.data.labels[field.field]} />
                        {field.config.readonly && <small>فقط‌خواندنی</small>}
                      </div>
                    ))}
                  </section>
                  {summary.data.record.can_edit &&
                    summary.data.fields.some((field) => !field.config.readonly && !field.field.includes(".")) && (
                      <Button onClick={() => setEditing(true)}>ویرایش</Button>
                    )}
                </>
              )}
              {editing && (
                <section className="engine-record-summary">
                  {summary.data.fields
                    .filter((field) => field.config.readonly || field.field.includes("."))
                    .map((field) => (
                      <div key={field.field}>
                        <small>{field.title} · فقط‌خواندنی</small>
                        <ViewValue field={field} value={field.value} labels={summary.data.labels[field.field]} />
                      </div>
                    ))}
                </section>
              )}
            </>
          )
        )}
        <footer className="engine-actions">
          <RelatedRecords code={code} id={id} />
          <Button variant="secondary" disabled={index <= 0 && !hasPreviousPage} onClick={() => navigate(-1)}>
            رکورد قبلی
          </Button>
          <Button
            variant="secondary"
            disabled={(index < 0 || index >= rows.length - 1) && !hasNextPage}
            onClick={() => navigate(1)}
          >
            رکورد بعدی
          </Button>
          <Link
            to={`/entities/${code}/${id}`}
            onClick={(event) => {
              if (dirty && !window.confirm("تغییرات ذخیره‌نشده کنار گذاشته شوند؟")) event.preventDefault();
            }}
          >
            باز کردن صفحه کامل
          </Link>
        </footer>
      </DialogPanel>
    </Dialog>
  );
}
