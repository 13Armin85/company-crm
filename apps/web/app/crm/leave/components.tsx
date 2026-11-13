/** Presentational parts of the leave request pages. They render server-provided flags only;
 * the server decides who may edit, sign or see anything. */
import type { ReactNode } from "react";
import { Button, PersianDateInput } from "../components";
import type {
  LeaveAttachment,
  LeaveFormValues,
  LeaveStatus,
  LeaveTemplate,
  LeaveVersion,
  Person,
  SignatureEvent,
  SignatureInfo,
  TemplateOverview,
} from "../api/leave";
import {
  EVENT_LABELS,
  MODE_LABELS,
  SIGN_BUTTON,
  SIGNATURE_NOTICE,
  STATUS_LABELS,
  STATUS_TONES,
  blockingIssues,
} from "./model";
import type { AttachmentConfig } from "./model";
import { LeaveAttachments } from "./attachments";
import type { PendingUpload } from "./attachments";

export function LeaveStatusBadge({ status, label }: { status: LeaveStatus; label?: string }) {
  return <span className={`leave-status leave-status-${STATUS_TONES[status]}`}>{label || STATUS_LABELS[status]}</span>;
}

function Field({
  label,
  error,
  children,
  htmlFor,
}: {
  label: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="leave-field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error && (
        <small className="leave-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

export function LeaveForm({
  values,
  errors,
  members,
  durationText,
  durationError,
  attachments,
  pending,
  attachmentConfig,
  attachmentHref,
  disabled,
  onChange,
  onAddFiles,
}: {
  values: LeaveFormValues;
  errors: Partial<Record<keyof LeaveFormValues, string>>;
  members: Person[];
  durationText: string;
  durationError?: string;
  /** Metadata of every file uploaded for this form; only those in ``values.attachments`` are shown. */
  attachments: LeaveAttachment[];
  pending?: PendingUpload[];
  attachmentConfig?: AttachmentConfig;
  attachmentHref?: (id: string) => string | undefined;
  disabled?: boolean;
  onChange: (values: LeaveFormValues) => void;
  onAddFiles?: (files: File[]) => void;
}) {
  const set = <K extends keyof LeaveFormValues>(key: K, value: LeaveFormValues[K]) =>
    onChange({ ...values, [key]: value });
  const hourly = values.mode === "hourly";
  return (
    <div className="leave-form" dir="rtl">
      <fieldset className="leave-mode" disabled={disabled}>
        <legend>شیوهٔ مدت</legend>
        {(Object.keys(MODE_LABELS) as LeaveFormValues["mode"][]).map((mode) => (
          <label key={mode}>
            <input
              type="radio"
              name="leave-mode"
              value={mode}
              checked={values.mode === mode}
              onChange={() => set("mode", mode)}
            />
            {MODE_LABELS[mode]}
          </label>
        ))}
        <small className="workflow-muted">این انتخاب فقط شیوهٔ ورود بازه را مشخص می‌کند.</small>
      </fieldset>
      <div className="leave-grid">
        <Field label="تاریخ شروع" error={errors.start_date} htmlFor="leave-start-date">
          <PersianDateInput
            id="leave-start-date"
            value={values.start_date}
            disabled={disabled}
            onChange={(value) =>
              onChange({ ...values, start_date: value, end_date: values.end_date < value ? value : values.end_date })
            }
          />
        </Field>
        {hourly && (
          <Field label="ساعت شروع" error={errors.start_time} htmlFor="leave-start-time">
            <input
              id="leave-start-time"
              type="time"
              value={values.start_time}
              disabled={disabled}
              onChange={(event) => set("start_time", event.target.value)}
            />
          </Field>
        )}
        <Field label="تاریخ پایان" error={errors.end_date} htmlFor="leave-end-date">
          <PersianDateInput
            id="leave-end-date"
            value={values.end_date}
            disabled={disabled}
            onChange={(value) => set("end_date", value)}
          />
        </Field>
        {hourly && (
          <Field label="ساعت پایان" error={errors.end_time} htmlFor="leave-end-time">
            <input
              id="leave-end-time"
              type="time"
              value={values.end_time}
              disabled={disabled}
              onChange={(event) => set("end_time", event.target.value)}
            />
          </Field>
        )}
      </div>
      <Field label="مدت محاسبه‌شده (طبق تقویم کاری شما)" error={durationError}>
        <output className="leave-duration" aria-live="polite">
          {durationText || "—"}
        </output>
      </Field>
      <Field label="دلیل" error={errors.reason} htmlFor="leave-reason">
        <textarea
          id="leave-reason"
          rows={3}
          value={values.reason}
          disabled={disabled}
          onChange={(event) => set("reason", event.target.value)}
        />
      </Field>
      <Field label="جانشین پیشنهادی" htmlFor="leave-substitute">
        <select
          id="leave-substitute"
          value={values.substitute}
          disabled={disabled}
          onChange={(event) => set("substitute", event.target.value)}
        >
          <option value="">بدون جانشین</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </Field>
      <LeaveAttachments
        items={attachments.filter((item) => values.attachments.includes(item.id))}
        pending={pending}
        config={attachmentConfig}
        disabled={disabled}
        hrefFor={attachmentHref}
        onAdd={onAddFiles}
        onRemove={(id) =>
          set(
            "attachments",
            values.attachments.filter((item) => item !== id)
          )
        }
      />
    </div>
  );
}

export function PreviewFrame({ html, title }: { html: string; title: string }) {
  // Static HTML from the server, shown in a sandbox without scripts or same-origin access.
  return <iframe className="leave-preview" title={title} sandbox="" srcDoc={html} />;
}

export function SignPanel({
  canSign,
  blockers,
  pending,
  hasPreview,
  onSign,
}: {
  canSign: boolean;
  blockers: string[];
  pending?: boolean;
  hasPreview: boolean;
  onSign: () => void;
}) {
  const disabled = !canSign || !hasPreview || Boolean(pending);
  return (
    <section className="leave-sign" aria-label="ثبت امضا">
      <p className="leave-notice">{SIGNATURE_NOTICE}</p>
      <p className="workflow-muted">
        با زدن دکمهٔ زیر، تصویر امضای ذخیره‌شدهٔ شما روی همین سندِ پیش‌نمایش‌شده درج می‌شود، نسخه قفل می‌شود و درخواست برای
        تأیید ارسال می‌شود. امضا هرگز خودکار درج نمی‌شود.
      </p>
      {!canSign && blockers.length > 0 && (
        <ul className="leave-blockers" role="alert">
          {blockers.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      )}
      {canSign && !hasPreview && <p className="leave-error">ابتدا پیش‌نمایش سند را ببینید.</p>}
      <Button disabled={disabled} onClick={onSign}>
        {SIGN_BUTTON}
      </Button>
    </section>
  );
}

export function VersionList({
  versions,
  documentHref,
  onShow,
}: {
  versions: LeaveVersion[];
  documentHref: (version: LeaveVersion) => string;
  onShow?: (version: LeaveVersion) => void;
}) {
  return (
    <table className="leave-table">
      <thead>
        <tr>
          <th>نسخه</th>
          <th>بازه</th>
          <th>مدت</th>
          <th>امضا</th>
          <th>قالب</th>
          <th>سند</th>
        </tr>
      </thead>
      <tbody>
        {versions.map((version) => (
          <tr key={version.id}>
            <td>
              {version.number.toLocaleString("fa-IR")} {version.is_locked ? "(قفل)" : "(در حال ویرایش)"}
            </td>
            <td>{version.period_text}</td>
            <td>{version.duration_text}</td>
            <td>
              {version.signed_at
                ? `${version.signed_by?.name ?? ""} — ${new Date(version.signed_at).toLocaleString("fa-IR")}`
                : "امضا نشده"}
            </td>
            <td>{version.template ? `نسخهٔ ${version.template.number.toLocaleString("fa-IR")}` : "—"}</td>
            <td>
              {version.has_document ? (
                <span className="leave-actions">
                  <a href={documentHref(version)}>دریافت Word</a>
                  {onShow && (
                    <Button variant="ghost" onClick={() => onShow(version)}>
                      نمایش
                    </Button>
                  )}
                </span>
              ) : (
                "—"
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function MySignatureCard({
  signature,
  imageUrl,
  pending,
  onGrant,
  onRevoke,
}: {
  signature: SignatureInfo | null;
  imageUrl: string;
  pending?: boolean;
  onGrant: (signatureId: string) => void;
  onRevoke: () => void;
}) {
  return (
    <section className="leave-card" aria-label="تصویر امضای من">
      <h2>تصویر امضای من</h2>
      <p className="leave-notice">{SIGNATURE_NOTICE}</p>
      {!signature ? (
        <p className="workflow-muted">
          هنوز تصویر امضایی برای شما بارگذاری نشده است. نقش مسئول باید آن را بارگذاری کند.
        </p>
      ) : (
        <div className="leave-signature">
          <img src={imageUrl} alt="تصویر امضای من" />
          <div>
            {signature.has_consent ? (
              <>
                <p>اجازهٔ درج این تصویر را داده‌اید.</p>
                <Button variant="secondary" disabled={pending} onClick={onRevoke}>
                  لغو اجازه
                </Button>
                <small className="workflow-muted">
                  پس از لغو، تصویر در درخواست‌های تازه درج نمی‌شود؛ اسناد امضاشدهٔ قبلی تغییر نمی‌کنند.
                </small>
              </>
            ) : (
              <>
                <p>
                  {signature.consent_revoked_at
                    ? "اجازهٔ درج امضا را لغو کرده‌اید."
                    : "پیش از نخستین استفاده، تصویر بالا را ببینید و اجازهٔ درج آن را بدهید."}
                </p>
                <Button disabled={pending} onClick={() => onGrant(signature.id)}>
                  این تصویر را دیدم و اجازهٔ درج آن را می‌دهم
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export function PlaceholderTable({ placeholders }: { placeholders: TemplateOverview["placeholders"] }) {
  return (
    <table className="leave-table">
      <thead>
        <tr>
          <th>جایگاه</th>
          <th>معنا</th>
          <th>الزامی</th>
        </tr>
      </thead>
      <tbody>
        {placeholders.map((row) => (
          <tr key={row.key}>
            <td dir="ltr">
              <code>{`{{${row.key}}}`}</code>
            </td>
            <td>{row.title}</td>
            <td>{row.required ? "بله" : "خیر"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function TemplateVersionRow({
  row,
  fileHref,
  pending,
  onActivate,
  onDeprecate,
  onExpiry,
}: {
  row: LeaveTemplate;
  fileHref: string;
  pending?: boolean;
  onActivate: () => void;
  onDeprecate: () => void;
  onExpiry: (value: string) => void;
}) {
  const errors = blockingIssues(row.issues);
  return (
    <li className={`leave-template leave-template-${row.status}`}>
      <div className="leave-template-head">
        <strong>
          نسخهٔ {row.number.toLocaleString("fa-IR")} — {row.title}
        </strong>
        <span className={`leave-status leave-status-${row.status === "active" ? "success" : "neutral"}`}>
          {row.status_label}
        </span>
        <a href={fileHref}>{row.original_name}</a>
      </div>
      {row.warnings.length > 0 ? (
        <ul className="leave-blockers" role="alert" aria-label="هشدارهای قالب">
          {row.warnings.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      ) : (
        <p className="workflow-muted">قالب معتبر است.</p>
      )}
      <div className="leave-actions">
        <div className="leave-field">
          <label htmlFor={`leave-template-expiry-${row.id}`}>تاریخ انقضا</label>
          <PersianDateInput
            id={`leave-template-expiry-${row.id}`}
            value={row.expires_at ?? ""}
            disabled={pending || row.status === "deprecated"}
            onChange={(value) => value !== (row.expires_at ?? "") && onExpiry(value)}
          />
        </div>
        {row.expires_at && row.status !== "deprecated" && (
          <Button variant="ghost" disabled={pending} onClick={() => onExpiry("")}>
            برداشتن تاریخ انقضا
          </Button>
        )}
        {row.status === "inactive" && (
          <Button disabled={pending || !row.can_activate || errors.length > 0} onClick={onActivate}>
            فعال‌سازی
          </Button>
        )}
        {row.status !== "deprecated" && (
          <Button variant="danger" disabled={pending} onClick={onDeprecate}>
            منسوخ کردن
          </Button>
        )}
      </div>
    </li>
  );
}

export function SignatureHistoryList({ events }: { events: SignatureEvent[] }) {
  if (!events.length) return <p className="workflow-muted">سابقه‌ای ثبت نشده است.</p>;
  return (
    <ol className="leave-history">
      {events.map((event) => (
        <li key={event.id}>
          <strong>{EVENT_LABELS[event.type] ?? event.type}</strong> — {event.actor?.name ?? "سامانه"} —{" "}
          {new Date(event.at).toLocaleString("fa-IR")}
        </li>
      ))}
    </ol>
  );
}
