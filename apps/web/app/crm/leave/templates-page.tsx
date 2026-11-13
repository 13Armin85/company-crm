/** Admin page: versioned Word templates of the leave form (LeaveTemplate.Manage). */
import { useState } from "react";
import { Navigate } from "react-router";
import { useWorkspaceAccess } from "../api";
import { useSlug } from "../api/client";
import {
  templateFileUrl,
  templateSampleUrl,
  useLeaveTemplates,
  useTemplateAction,
  useUploadTemplate,
} from "../api/leave";
import { Button, PageHeader, PersianDateInput, Skeleton } from "../components";
import { PlaceholderTable, TemplateVersionRow } from "./components";

export default function LeaveTemplatesPage() {
  const slug = useSlug();
  const { data: access, isLoading } = useWorkspaceAccess();
  const allowed = access?.can("LeaveTemplate.Manage") ?? false;
  const overview = useLeaveTemplates(allowed);
  const upload = useUploadTemplate();
  const change = useTemplateAction();
  const [file, setFile] = useState<File>();
  const [title, setTitle] = useState("");
  const [expires, setExpires] = useState("");
  const [note, setNote] = useState("");
  if (isLoading) return <Skeleton rows={5} />;
  if (!allowed) return <Navigate to="/leave-requests" replace />;
  const data = overview.data;
  return (
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
      <section className="leave-card" aria-label="بارگذاری نسخهٔ تازه">
        <h2>بارگذاری نسخهٔ تازه</h2>
        <div className="leave-grid">
          <label>
            فایل .docx
            <input
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(event) => setFile(event.target.files?.[0])}
            />
          </label>
          <label>
            عنوان
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <div className="leave-field">
            <label htmlFor="leave-template-new-expiry">تاریخ انقضا (اختیاری)</label>
            <PersianDateInput id="leave-template-new-expiry" value={expires} onChange={setExpires} />
          </div>
          <label>
            یادداشت
            <input value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
        </div>
        <div className="leave-actions">
          <Button
            disabled={!file || upload.isPending}
            onClick={() => file && upload.mutate({ file, title, expires_at: expires, note })}
          >
            بارگذاری و بررسی
          </Button>
          <a href={templateSampleUrl(slug)}>دریافت قالب نمونه</a>
        </div>
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
  );
}
