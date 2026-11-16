import { ConfiguredFields, SurfaceTable } from "../engine/surface";
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

export function ReadyTemplateCard({
  pending,
  disabled,
  error,
  sampleHref,
  onCreate,
}: {
  pending: boolean;
  disabled?: boolean;
  error?: string;
  sampleHref: string;
  onCreate: () => void;
}) {
  return (
    <section className="leave-card" aria-label="قالب آمادهٔ مرخصی">
      <h2>شروع با قالب آماده</h2>
      <p className="workflow-muted">
        قالب فارسی آماده، همهٔ جایگاه‌های لازم و محل امضا را دارد. آن را اضافه کنید و پس از بررسی، از فهرست نسخه‌ها فعال
        کنید. برای استفاده از سربرگ شرکت، فایل دلخواه را در بخش بعد بارگذاری کنید.
      </p>
      <div className="leave-actions">
        <Button variant="secondary" disabled={pending || disabled} onClick={onCreate}>
          {pending ? "در حال افزودن قالب…" : "افزودن قالب آمادهٔ فارسی"}
        </Button>
        <a href={sampleHref}>دریافت فایل نمونه برای ویرایش</a>
      </div>
      {error && (
        <p className="leave-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function Field({
  label,
  error,
  children,
  htmlFor,
  hint,
}: {
  label: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
  hint?: string;
}) {
  return (
    <div className="leave-field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && (
        <small id={htmlFor ? `${htmlFor}-hint` : undefined} className="leave-hint">
          {hint}
        </small>
      )}
      {error && (
        <small id={htmlFor ? `${htmlFor}-error` : undefined} className="leave-error" role="alert">
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
  calculating,
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
  calculating?: boolean;
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
    <ConfiguredFields code="leave-requests">
      <div className="leave-form" dir="rtl">
        <fieldset className="leave-mode" disabled={disabled}>
          <legend>بازهٔ مرخصی را چطور وارد می‌کنید؟</legend>
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
          <small className="leave-hint">
            برای یک یا چند روز کامل «روزانه» و برای بخشی از روز «ساعتی» را انتخاب کنید.
          </small>
        </fieldset>
        <div className="leave-grid">
          <Field
            label="تاریخ شروع"
            error={errors.start_date}
            htmlFor="leave-start-date"
            hint="روز آغاز مرخصی را از تقویم انتخاب کنید."
          >
            <PersianDateInput
              id="leave-start-date"
              label="تاریخ شروع مرخصی"
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
                aria-invalid={Boolean(errors.start_time)}
                aria-describedby={errors.start_time ? "leave-start-time-error" : undefined}
                onChange={(event) => set("start_time", event.target.value)}
              />
            </Field>
          )}
          <Field
            label="تاریخ پایان"
            error={errors.end_date}
            htmlFor="leave-end-date"
            hint="برای مرخصی یک‌روزه، تاریخ شروع و پایان یکسان است."
          >
            <PersianDateInput
              id="leave-end-date"
              label="تاریخ پایان مرخصی"
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
                aria-invalid={Boolean(errors.end_time)}
                aria-describedby={errors.end_time ? "leave-end-time-error" : undefined}
                onChange={(event) => set("end_time", event.target.value)}
              />
            </Field>
          )}
        </div>
        <Field label="مدت محاسبه‌شده (طبق تقویم کاری شما)" error={durationError}>
          <output className="leave-duration" aria-live="polite">
            {calculating
              ? "در حال محاسبهٔ مدت…"
              : durationText || "پس از انتخاب بازه، مدت مرخصی اینجا نمایش داده می‌شود."}
          </output>
        </Field>
        <Field
          label="دلیل مرخصی (اختیاری)"
          error={errors.reason}
          htmlFor="leave-reason"
          hint="توضیح کوتاهی بنویسید تا مسئول تأیید درخواست را بهتر بررسی کند؛ حداکثر ۲۰۰۰ نویسه."
        >
          <textarea
            id="leave-reason"
            rows={3}
            value={values.reason}
            disabled={disabled}
            placeholder="مثلاً: مراجعه به پزشک؛ کارهای فوری را پیش از شروع مرخصی تحویل می‌دهم."
            maxLength={2000}
            aria-invalid={Boolean(errors.reason)}
            aria-describedby={`leave-reason-hint${errors.reason ? " leave-reason-error" : ""}`}
            onChange={(event) => set("reason", event.target.value)}
          />
        </Field>
        <Field
          label="جانشین پیشنهادی (اختیاری)"
          htmlFor="leave-substitute"
          hint="اگر همکاری در زمان نبودن شما کارها را پیگیری می‌کند، او را انتخاب کنید."
        >
          <select
            id="leave-substitute"
            value={values.substitute}
            disabled={disabled}
            aria-describedby="leave-substitute-hint"
            onChange={(event) => set("substitute", event.target.value)}
          >
            <option value="">انتخاب همکار جانشین؛ در صورت نیاز</option>
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
    </ConfiguredFields>
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
    <div className="leave-table-scroll" role="region" aria-label="نسخه‌ها و اسناد مرخصی" tabIndex={0}>
      <SurfaceTable code="leave-versions" className="leave-table">
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
              <td>
                {version.template ? `نسخهٔ ${version.template.number.toLocaleString("fa-IR")}` : "هنگام امضا ثبت می‌شود"}
              </td>
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
                  "فایل پس از امضا آماده می‌شود"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </SurfaceTable>
    </div>
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
    <div className="leave-table-scroll" role="region" aria-label="راهنمای جایگاه‌های Word" tabIndex={0}>
      <SurfaceTable code="leave-placeholders" className="leave-table">
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
      </SurfaceTable>
    </div>
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
