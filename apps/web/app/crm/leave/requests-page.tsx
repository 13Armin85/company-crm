import { SurfaceTable } from "../engine/surface";
/** «درخواست‌های مرخصی»: my requests, requests waiting for me and (when allowed) everyone's. */
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { errorMessage, useCurrentUser, useWorkspaceAccess } from "../api";
import { useSlug } from "../api/client";
import {
  signatureImageUrl,
  useCreateLeave,
  useLeaveDuration,
  useLeaveMeta,
  useLeaveRequests,
  useMySignature,
  useSignatureConsent,
} from "../api/leave";
import { useAttachmentUploads } from "./attachments";
import type { LeaveAttachment, LeaveFormValues, LeaveRequestSummary } from "../api/leave";
import { Button, EmptyState, PageHeader, Skeleton, TabBar } from "../components";
import { ErrorNotice } from "../error-state";
import { LeaveForm, LeaveStatusBadge, MySignatureCard } from "./components";
import { durationPayload, emptyForm, formErrors, formPayload, hasErrors, holderText } from "./model";

export function LeaveRequestList({ rows }: { rows: LeaveRequestSummary[] }) {
  if (!rows.length) return <EmptyState title="درخواستی نیست" description="در این فهرست درخواست مرخصی‌ای وجود ندارد." />;
  return (
    <div className="leave-table-scroll" role="region" aria-label="فهرست درخواست‌ها" tabIndex={0}>
      <SurfaceTable code="leave-requests" className="leave-table">
        <thead>
          <tr>
            <th>شماره</th>
            <th>درخواست‌دهنده</th>
            <th>شیوه</th>
            <th>بازه</th>
            <th>مدت</th>
            <th>وضعیت</th>
            <th>اکنون نزد</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <Link to={`/leave-requests/${row.id}`}>{row.number}</Link>
              </td>
              <td>{row.requester.name}</td>
              <td>{row.current?.mode_label}</td>
              <td>{row.current?.period_text}</td>
              <td>{row.current?.duration_text}</td>
              <td>
                <LeaveStatusBadge status={row.status} label={row.status_label} />
              </td>
              <td>{holderText(row)}</td>
            </tr>
          ))}
        </tbody>
      </SurfaceTable>
    </div>
  );
}

/** Live, read-only duration from the server's calendar calculation. */
export function useDurationText(values: LeaveFormValues, enabled: boolean) {
  const period = durationPayload(values);
  const key = JSON.stringify(period);
  const [settledKey, setSettledKey] = useState("");
  const valid = !hasErrors(formErrors({ ...values, reason: "" }));
  useEffect(() => {
    const timer = setTimeout(() => setSettledKey(key), 350);
    return () => clearTimeout(timer);
  }, [key]);
  const ready = enabled && valid && key === settledKey;
  const duration = useLeaveDuration(period, ready);
  return {
    text: ready ? (duration.data?.duration_text ?? "") : "",
    error: ready && duration.error ? errorMessage(duration.error, "محاسبهٔ مدت ممکن نشد") : "",
    pending: enabled && valid && (!ready || duration.isFetching),
  };
}

function NewRequest({ onDone }: { onDone: () => void }) {
  const meta = useLeaveMeta();
  const create = useCreateLeave();
  const navigate = useNavigate();
  const [values, setValues] = useState<LeaveFormValues>(emptyForm(meta.data?.today));
  const [files, setFiles] = useState<LeaveAttachment[]>([]);
  const uploads = useAttachmentUploads((item) => {
    setFiles((rows) => [...rows, item]);
    setValues((current) => ({ ...current, attachments: [...current.attachments, item.id] }));
  });
  const [touched, setTouched] = useState(false);
  const errors = touched ? formErrors(values) : {};
  const duration = useDurationText(values, true);
  const today = meta.data?.today;
  // The form can open before the meta (with the workspace's "today") has loaded; fill the dates once.
  useEffect(() => {
    if (today)
      setValues((current) => (current.start_date ? current : { ...current, start_date: today, end_date: today }));
  }, [today]);
  if (meta.isError)
    return (
      <EmptyState
        title="فرم مرخصی در دسترس نیست"
        description={errorMessage(meta.error, "خواندن اطلاعات فرم ممکن نشد.")}
      />
    );
  if (!meta.data) return <Skeleton rows={3} />;
  return (
    <form
      className="leave-card"
      aria-label="درخواست مرخصی تازه"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (
          hasErrors(formErrors(values)) ||
          create.isPending ||
          uploads.pending.length ||
          duration.pending ||
          duration.error
        )
          return;
        create.mutate(formPayload(values) as LeaveFormValues, {
          onSuccess: (row) => {
            onDone();
            navigate(`/leave-requests/${row.id}`);
          },
        });
      }}
    >
      <h2>درخواست مرخصی تازه</h2>
      <p className="leave-form-intro">۱. بازه را مشخص کنید · ۲. پیش‌نمایش را بررسی کنید · ۳. امضا و ارسال برای تأیید</p>
      {!meta.data.has_workflow && (
        <p className="leave-notice" role="status">
          مسیر تأیید مرخصی هنوز آماده نیست. می‌توانید پیش‌نویس را ذخیره کنید؛ ارسال برای تأیید پس از تنظیم مسیر توسط مدیر
          سامانه ممکن می‌شود.
        </p>
      )}
      <LeaveForm
        values={values}
        errors={errors}
        members={meta.data.members}
        durationText={duration.text}
        durationError={duration.error}
        calculating={duration.pending}
        disabled={create.isPending}
        attachments={files}
        pending={uploads.pending}
        attachmentConfig={meta.data.attachment}
        onChange={setValues}
        onAddFiles={uploads.add}
      />
      <div className="leave-actions">
        <Button
          type="submit"
          disabled={create.isPending || uploads.pending.length > 0 || duration.pending || Boolean(duration.error)}
        >
          ذخیرهٔ پیش‌نویس و رفتن به پیش‌نمایش
        </Button>
        <Button variant="ghost" onClick={onDone}>
          انصراف
        </Button>
      </div>
      {create.isError && <ErrorNotice message={errorMessage(create.error, "ذخیرهٔ درخواست ممکن نشد.")} />}
    </form>
  );
}

export function MySignatureSection() {
  const slug = useSlug();
  const mine = useMySignature();
  const consent = useSignatureConsent();
  const { data: user } = useCurrentUser();
  if (!mine.data || !user) return null;
  return (
    <MySignatureCard
      signature={mine.data.signature}
      imageUrl={signatureImageUrl(slug, user.id, mine.data.signature?.id)}
      pending={consent.isPending}
      onGrant={(id) => consent.mutate({ grant: true, confirm: true, signature_id: id })}
      onRevoke={() => consent.mutate({ grant: false })}
    />
  );
}

export default function LeaveRequestsPage() {
  const { data: access, isLoading } = useWorkspaceAccess();
  const [scope, setScope] = useState("mine");
  const [creating, setCreating] = useState(false);
  const canCreate = access?.can("LeaveRequest.Create") ?? false;
  const rows = useLeaveRequests(scope);
  if (isLoading) return <Skeleton rows={5} />;
  if (!access?.can("Workflow.View") && !canCreate) return <Navigate to="/my-work" replace />;
  const tabs = [
    { id: "mine", label: "درخواست‌های من" },
    { id: "waiting", label: "منتظر تصمیم من" },
    { id: "others", label: access?.can("LeaveRequest.ViewAll") ? "همهٔ درخواست‌های دیگران" : "درخواست‌های زیرمجموعه" },
  ];
  return (
    <div className="leave-page" dir="rtl">
      <PageHeader
        eyebrow="مرخصی"
        title="درخواست‌های مرخصی"
        description="درخواست روزانه یا ساعتی ثبت کنید؛ مدت با تقویم کاری شما محاسبه می‌شود و پس از امضا در مسیر تأیید قرار می‌گیرد."
        actions={
          <>
            {(access?.can("Report.View") || access?.can("Report.ViewAll")) && (
              <Link className="button button-secondary" to="/reports/source/leave">
                گزارش مرخصی و عدم حضور
              </Link>
            )}
            {canCreate && !creating && <Button onClick={() => setCreating(true)}>درخواست تازه</Button>}
          </>
        }
      />
      {creating && <NewRequest onDone={() => setCreating(false)} />}
      {canCreate && <MySignatureSection />}
      <TabBar items={tabs} active={scope} onChange={setScope} />
      {rows.isLoading ? (
        <Skeleton rows={5} />
      ) : rows.isError ? (
        <EmptyState
          title="دریافت درخواست‌ها ممکن نشد"
          description={errorMessage(rows.error, "دوباره تلاش کنید.")}
          action={<Button onClick={() => rows.refetch()}>تلاش دوباره</Button>}
        />
      ) : (
        <LeaveRequestList rows={rows.data ?? []} />
      )}
    </div>
  );
}
