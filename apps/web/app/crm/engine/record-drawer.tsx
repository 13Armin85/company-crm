import { ErrorNotice } from "../error-state";
import { useState } from "react";
import { Link } from "react-router";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { ChevronLeft, ChevronRight, ExternalLink, Lock, Pencil, X } from "lucide-react";
import { IdentifierBadge } from "@plane/ui";
import type { FieldValue } from "@plane/ui";
import { Button, Skeleton } from "../components";
import { errorMessage } from "../api";
import { useEngineQuery } from "./api";
import type { EngineRecord } from "./api";
import { EngineRecordForm } from "./record-form";
import { ViewValue } from "./view-value";
import { RelatedRecords } from "./related-records";
import { WorkflowPanel } from "../workflow/panel";
import { TicketCorePanel } from "../ticket/ticket-panel";
import type { ViewField, ViewResult, ViewRow } from "./view-types";

const editable = (field: ViewField & { field: string }) => !field.config.readonly && !field.field.includes(".");

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
  const record = summary.data?.record;
  return (
    <Dialog open onClose={() => select(null)} className="engine-view-dialog">
      <div className="engine-view-backdrop" />
      <DialogPanel className="engine-view-drawer engine-record-drawer" dir="rtl">
        <header className="record-drawer-top">
          <DialogTitle className="record-drawer-kicker">خلاصه اطلاعات</DialogTitle>
          <div className="record-drawer-nav">
            <button
              type="button"
              aria-label="رکورد قبلی"
              title="رکورد قبلی"
              disabled={index <= 0 && !hasPreviousPage}
              onClick={() => navigate(-1)}
            >
              <ChevronRight size={17} />
            </button>
            <button
              type="button"
              aria-label="رکورد بعدی"
              title="رکورد بعدی"
              disabled={(index < 0 || index >= rows.length - 1) && !hasNextPage}
              onClick={() => navigate(1)}
            >
              <ChevronLeft size={17} />
            </button>
            <button type="button" aria-label="بستن" title="بستن" onClick={() => select(null)}>
              <X size={17} />
            </button>
          </div>
        </header>
        {summary.isLoading ? (
          <Skeleton rows={5} />
        ) : summary.error ? (
          <ErrorNotice message={errorMessage(summary.error, "دریافت خلاصه انجام نشد.")} />
        ) : (
          record && (
            <>
              <div className="record-drawer-title">
                {record.number && <IdentifierBadge value={record.number} label="شماره رکورد" />}
                <h3>{record.title || "بدون عنوان"}</h3>
              </div>
              {!editing && (
                <div className="record-drawer-actions">
                  {record.can_edit && summary.data!.fields.some(editable) && (
                    <Button icon={Pencil} onClick={() => setEditing(true)}>
                      ویرایش
                    </Button>
                  )}
                  <Link className="button button-secondary" to={`/entities/${code}/${id}`}>
                    <ExternalLink size={16} /> باز کردن صفحه کامل
                  </Link>
                </div>
              )}
              {editing ? (
                <div className="record-drawer-editor">
                  <EngineRecordForm
                    code={code}
                    id={id}
                    visibleFields={summary.data!.fields.map((field) => field.field)}
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
                </div>
              ) : null}
              <dl className="engine-record-summary record-drawer-fields">
                {summary
                  .data!.fields.filter((field) => !editing || !editable(field))
                  .map((field) => (
                    <div key={field.field}>
                      <dt>
                        <small>{field.title}</small>
                        {!editable(field) && <Lock size={12} aria-label="فقط‌خواندنی" />}
                      </dt>
                      <dd>
                        <ViewValue field={field} value={field.value} labels={summary.data!.labels[field.field]} />
                      </dd>
                    </div>
                  ))}
              </dl>
              <div className="record-drawer-related">
                {code === "ticket" && <TicketCorePanel id={id} />}
                <WorkflowPanel code={code} id={id} />
                {code !== "ticket" && <RelatedRecords code={code} id={id} />}
              </div>
            </>
          )
        )}
      </DialogPanel>
    </Dialog>
  );
}
