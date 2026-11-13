/** One leave request: edit (unsigned version only), preview, explicit signing, versions, route and history. */
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { errorMessage } from "../api";
import { useSlug } from "../api/client";
import {
  attachmentUrl,
  documentUrl,
  useLeaveAction,
  useLeaveHistory,
  useLeaveMeta,
  useLeavePreview,
  useLeaveRequest,
  useUpdateLeave,
} from "../api/leave";
import { AttachmentList, useAttachmentUploads } from "./attachments";
import type { LeaveAttachment, LeaveFormValues, LeaveRequestDetail } from "../api/leave";
import { Button, PageHeader, Skeleton } from "../components";
import { ErrorNotice } from "../error-state";
import { WorkflowPanel } from "../workflow/panel";
import { LeaveForm, LeaveStatusBadge, PreviewFrame, SignPanel, VersionList } from "./components";
import { EVENT_LABELS, formErrors, formFromVersion, formPayload, hasErrors, holderText } from "./model";
import { MySignatureSection, useDurationText } from "./requests-page";

export function LeaveSummary({ detail }: { detail: LeaveRequestDetail }) {
  const current = detail.current;
  const slug = useSlug();
  return (
    <section className="leave-card" aria-label="خلاصهٔ درخواست">
      <div className="leave-template-head">
        <LeaveStatusBadge status={detail.status} label={detail.status_label} />
        <strong>{holderText(detail)}</strong>
      </div>
      {current && (
        <dl className="leave-summary">
          <dt>درخواست‌دهنده</dt>
          <dd>{detail.requester.name}</dd>
          <dt>شیوهٔ مدت</dt>
          <dd>{current.mode_label}</dd>
          <dt>بازه</dt>
          <dd>{current.period_text}</dd>
          <dt>مدت محاسبه‌شده</dt>
          <dd>{current.duration_text}</dd>
          <dt>دلیل</dt>
          <dd>{current.reason || "—"}</dd>
          <dt>جانشین</dt>
          <dd>{current.substitute?.name ?? "—"}</dd>
          <dt>پیوست‌ها</dt>
          <dd>
            <AttachmentList items={current.attachments} hrefFor={(id) => attachmentUrl(slug, detail.id, id)} />
          </dd>
          {detail.absence && (
            <>
              <dt>عدم حضور ثبت‌شده</dt>
              <dd>{detail.absence.status === "scheduled" ? "ثبت شد" : "لغو شد"}</dd>
            </>
          )}
          {detail.cancel_reason && (
            <>
              <dt>دلیل لغو</dt>
              <dd>{detail.cancel_reason}</dd>
            </>
          )}
        </dl>
      )}
    </section>
  );
}

function Editor({ detail }: { detail: LeaveRequestDetail }) {
  const meta = useLeaveMeta();
  const update = useUpdateLeave(detail.id);
  const slug = useSlug();
  const [values, setValues] = useState<LeaveFormValues>(formFromVersion(detail.current!));
  const [files, setFiles] = useState<LeaveAttachment[]>(detail.current!.attachments);
  const uploads = useAttachmentUploads((item) => {
    setFiles((rows) => [...rows, item]);
    setValues((current) => ({ ...current, attachments: [...current.attachments, item.id] }));
  });
  // Only files already saved on the request can be downloaded (the server serves files of its versions).
  const saved = new Set(detail.versions.flatMap((version) => version.attachments.map((item) => item.id)));
  const [touched, setTouched] = useState(false);
  const duration = useDurationText(values, true);
  const shownVersion = detail.current;
  useEffect(() => {
    if (!shownVersion) return;
    setValues(formFromVersion(shownVersion));
    setFiles(shownVersion.attachments);
  }, [shownVersion]);
  const errors = touched ? formErrors(values) : {};
  return (
    <section className="leave-card" aria-label="ویرایش درخواست">
      <h2>ویرایش نسخهٔ {detail.current!.number.toLocaleString("fa-IR")}</h2>
      <LeaveForm
        values={values}
        errors={errors}
        members={meta.data?.members ?? []}
        durationText={duration.text || detail.current!.duration_text}
        durationError={duration.error}
        attachments={files}
        pending={uploads.pending}
        attachmentConfig={meta.data?.attachment}
        attachmentHref={(id) => (saved.has(id) ? attachmentUrl(slug, detail.id, id) : undefined)}
        onChange={setValues}
        onAddFiles={uploads.add}
      />
      <Button
        disabled={update.isPending || uploads.pending.length > 0}
        onClick={() => {
          setTouched(true);
          if (hasErrors(formErrors(values))) return;
          update.mutate({ ...(formPayload(values) as LeaveFormValues), revision: detail.revision });
        }}
      >
        ذخیره و ساخت دوبارهٔ پیش‌نمایش
      </Button>
    </section>
  );
}

export default function LeaveRequestPage() {
  const { id } = useParams();
  const slug = useSlug();
  const query = useLeaveRequest(id);
  const detail = query.data;
  const [shownVersion, setShownVersion] = useState<string>();
  const preview = useLeavePreview(id, shownVersion, Boolean(detail));
  const history = useLeaveHistory(id);
  const action = useLeaveAction(id ?? "");
  const [cancelReason, setCancelReason] = useState("");
  if (query.isLoading) return <Skeleton rows={6} />;
  if (query.error || !detail)
    return <ErrorNotice message={errorMessage(query.error, "این درخواست پیدا نشد یا اجازهٔ دیدن آن را ندارید")} />;
  const actions = detail.actions;
  return (
    <div className="leave-page" dir="rtl">
      <PageHeader
        eyebrow="درخواست‌های مرخصی"
        title={`درخواست مرخصی ${detail.number}`}
        description="سند Word فقط از حساب شما و داده‌های همین درخواست ساخته می‌شود؛ برای اصلاح، خود درخواست را ویرایش کنید."
      />
      <LeaveSummary detail={detail} />
      {actions.can_edit && <Editor detail={detail} />}
      {actions.can_new_version && (
        <section className="leave-card">
          <p>
            این درخواست برای اصلاح بازگشته است. نسخهٔ امضاشدهٔ قبلی دست‌نخورده می‌ماند؛ برای اصلاح، نسخهٔ تازه بسازید و دوباره
            امضا کنید.
          </p>
          <Button
            disabled={action.isPending}
            onClick={() => action.mutate({ action: "new-version", body: { revision: detail.revision } })}
          >
            ساخت نسخهٔ تازه برای اصلاح
          </Button>
        </section>
      )}
      <section className="leave-card" aria-label="پیش‌نمایش سند">
        <h2>
          پیش‌نمایش سند {preview.data?.signed ? "(امضاشده)" : ""}
          {shownVersion && (
            <Button variant="ghost" onClick={() => setShownVersion(undefined)}>
              بازگشت به نسخهٔ جاری
            </Button>
          )}
        </h2>
        {preview.isLoading ? (
          <Skeleton rows={4} />
        ) : preview.error ? (
          <ErrorNotice message={errorMessage(preview.error, "ساخت پیش‌نمایش ممکن نشد")} />
        ) : (
          preview.data && <PreviewFrame html={preview.data.html} title={`پیش‌نمایش ${detail.number}`} />
        )}
      </section>
      {detail.is_mine && ["draft", "returned"].includes(detail.status) && !shownVersion && (
        <>
          <MySignatureSection />
          <SignPanel
            canSign={actions.can_sign}
            blockers={actions.sign_blockers}
            pending={action.isPending}
            hasPreview={Boolean(preview.data && !preview.data.signed && preview.data.fingerprint)}
            onSign={() =>
              preview.data &&
              action.mutate({
                action: "sign",
                body: { confirm: true, fingerprint: preview.data.fingerprint, revision: detail.revision },
              })
            }
          />
        </>
      )}
      <WorkflowPanel code="leave_request" id={detail.id} />
      <section className="leave-card" aria-label="نسخه‌ها">
        <h2>نسخه‌ها و اسناد</h2>
        <VersionList
          versions={detail.versions}
          documentHref={(version) => documentUrl(slug, detail.id, version.id)}
          onShow={(version) => setShownVersion(version.id)}
        />
      </section>
      {actions.can_cancel && (
        <section className="leave-card" aria-label="لغو درخواست">
          <label htmlFor="leave-cancel-reason">دلیل لغو (اختیاری)</label>
          <input id="leave-cancel-reason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          <Button
            variant="danger"
            disabled={action.isPending}
            onClick={() =>
              action.mutate({ action: "cancel", body: { revision: detail.revision, reason: cancelReason } })
            }
          >
            لغو درخواست
          </Button>
          {detail.status === "approved" && (
            <small className="workflow-muted">عدم حضور ثبت‌شده برای این مرخصی هم لغو می‌شود.</small>
          )}
        </section>
      )}
      <section className="leave-card" aria-label="سابقه">
        <h2>سابقهٔ تغییرها</h2>
        <ol className="leave-history">
          {(history.data?.events ?? []).map((event) => (
            <li key={event.id}>
              <strong>{EVENT_LABELS[event.type] ?? event.type}</strong>
              {event.version ? ` — نسخهٔ ${event.version.toLocaleString("fa-IR")}` : ""} — {event.actor?.name ?? ""} —{" "}
              {new Date(event.at).toLocaleString("fa-IR")}
              {event.reason && <p className="workflow-muted">{event.reason}</p>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
