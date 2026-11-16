import { ConfiguredFields } from "../engine/surface";
/** Admin page: versioned Word templates of the leave form (LeaveTemplate.Manage). */
import { useState } from "react";
import { Navigate } from "react-router";
import { useWorkspaceAccess } from "../api";
import { useSlug } from "../api/client";
import {
  templateFileUrl,
  templateSampleUrl,
  useCreateSampleTemplate,
  useLeaveTemplates,
  useTemplateAction,
  useUploadTemplate,
} from "../api/leave";
import { Button, EmptyState, PageHeader, PersianDateInput, Skeleton } from "../components";
import { errorMessage } from "../api/client";
import { ErrorNotice } from "../error-state";
import { PlaceholderTable, ReadyTemplateCard, TemplateVersionRow } from "./components";

export default function LeaveTemplatesPage() {
  const slug = useSlug();
  const { data: access, isLoading } = useWorkspaceAccess();
  const allowed = access?.can("LeaveTemplate.Manage") ?? false;
  const overview = useLeaveTemplates(allowed);
  const upload = useUploadTemplate();
  const sample = useCreateSampleTemplate();
  const change = useTemplateAction();
  const [file, setFile] = useState<File>();
  const [title, setTitle] = useState("");
  const [expires, setExpires] = useState("");
  const [note, setNote] = useState("");
  if (isLoading) return <Skeleton rows={5} />;
  if (!allowed) return <Navigate to="/leave-requests" replace />;
  if (overview.isError)
    return (
      <EmptyState
        title="قالب‌های مرخصی در دسترس نیست"
        description={errorMessage(overview.error, "دریافت قالب‌ها ممکن نشد.")}
        action={<Button onClick={() => overview.refetch()}>تلاش دوباره</Button>}
      />
    );
  const data = overview.data;
  return (
    <ConfiguredFields code="leave-templates">
      <div className="leave-page" dir="rtl">
        <PageHeader
          eyebrow="مرخصی"
          title="قالب Word فرم مرخصی"
          description="هر بارگذاری یک نسخهٔ تازه است و نسخه‌های قبلی پاک نمی‌شوند. فقط نسخهٔ معتبر، منقضی‌نشده و منسوخ‌نشده فعال می‌شود."
        />
        {data?.active_problem && (
          <p className="leave-blockers" role="alert">
            {data.active_problem}
          </p>
        )}
        <ReadyTemplateCard
          pending={sample.isPending}
          disabled={upload.isPending}
          sampleHref={templateSampleUrl(slug)}
          onCreate={() => sample.mutate()}
          error={sample.isError ? errorMessage(sample.error, "افزودن قالب آماده ممکن نشد.") : undefined}
        />
        <section className="leave-card" aria-label="بارگذاری نسخهٔ تازه">
          <h2>بارگذاری نسخهٔ تازه</h2>
          <div className="leave-grid">
            <div className="leave-field">
              <span>فایل Word (.docx)</span>
              <label className="button button-secondary leave-upload-control">
                انتخاب فایل Word
                <input
                  className="leave-file-input"
                  type="file"
                  aria-label="انتخاب فایل Word قالب مرخصی"
                  accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  disabled={upload.isPending || sample.isPending}
                  onChange={(event) => setFile(event.target.files?.[0])}
                />
              </label>
              <small className="leave-hint">{file?.name || "فایل .docx تا حجم ۵ مگابایت"}</small>
            </div>
            <label>
              عنوان
              <input
                value={title}
                maxLength={200}
                placeholder="مثلاً: فرم درخواست مرخصی شرکت ـ نسخهٔ جدید"
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <div className="leave-field" data-surface-field="expires">
              <label htmlFor="leave-template-new-expiry">تاریخ انقضا (اختیاری)</label>
              <PersianDateInput id="leave-template-new-expiry" value={expires} onChange={setExpires} />
            </div>
            <label>
              یادداشت
              <input
                value={note}
                placeholder="مثلاً: اصلاح سربرگ و اضافه شدن محل امضا"
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
          </div>
          <div className="leave-actions">
            <Button
              disabled={!file || upload.isPending || sample.isPending}
              onClick={() => file && upload.mutate({ file, title, expires_at: expires, note })}
            >
              بارگذاری و بررسی
            </Button>
          </div>
          {upload.isError && <ErrorNotice message={errorMessage(upload.error, "بارگذاری قالب ممکن نشد.")} />}
        </section>
        <section className="leave-card" aria-label="جایگاه‌های داده">
          <h2>جایگاه‌های داده</h2>
          <p className="workflow-muted">
            جایگاه‌ها را دقیقاً به همین شکل در فایل Word بنویسید. جایگاه ناشناخته یا نبودِ جایگاه الزامی، قالب را نامعتبر
            می‌کند.
          </p>
          {data && <PlaceholderTable placeholders={data.placeholders} />}
        </section>
        <section className="leave-card" aria-label="نسخه‌ها">
          <h2>نسخه‌ها</h2>
          {!data ? (
            <Skeleton rows={3} />
          ) : (
            <ul className="leave-templates">
              {data.versions.map((row) => (
                <TemplateVersionRow
                  key={row.id}
                  row={row}
                  fileHref={templateFileUrl(slug, row.id)}
                  pending={change.isPending}
                  onActivate={() => change.mutate({ id: row.id, action: "activate" })}
                  onDeprecate={() => change.mutate({ id: row.id, action: "update", body: { deprecate: true } })}
                  onExpiry={(value) =>
                    change.mutate({ id: row.id, action: "update", body: { expires_at: value || null } })
                  }
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </ConfiguredFields>
  );
}
