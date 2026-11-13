/** Ticket core panel (ticket 5): target-time card, overdue banner, extension / delay / contact dialogs,
 * referral card and the unified history. Every action is re-checked by the server. */
import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { DialogTitle } from "@headlessui/react";
import { ModalCore, PersianDateTimePicker, SearchableSelect } from "@plane/ui";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  Clock,
  Flag,
  FolderKanban,
  Gauge,
  GitMerge,
  Minus,
  PauseCircle,
  PenLine,
  Phone,
  RefreshCw,
  Shapes,
  Share2,
  Tags,
  UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  useContactResolve,
  useDecideTicketExtension,
  useDelayReport,
  useExtensionPreview,
  useReferTicket,
  useRequestExtension,
  useRespondReferral,
  useSetTicketParent,
  useSetTicketTarget,
  useTicketCard,
  useTicketHistory,
} from "../api/ticket";
import type { TicketCard, TicketDeadline } from "../api/ticket";
import { useMembers } from "../api/workspace";
import { errorMessage } from "../api";
import { Button, Skeleton } from "../components";
import { RelatedRecords } from "../engine/related-records";
import { TicketHeader, TicketTabs } from "./ticket-header";
import { PortalTab } from "./portal-tab";
import type { TicketTab } from "./ticket-header";
import { api, useSlug } from "../api/client";
import { Link } from "react-router";
import { formatWorkingMinutes } from "../workflow/model";
import {
  DEADLINE_STATES,
  HIDDEN_EVENTS,
  HISTORY_KINDS,
  eventTitle,
  PRIORITY_LABELS,
  contactErrors,
  deadlineSummary,
  delayErrors,
  extensionErrors,
  faDigits,
  historyValue,
  minutesFrom,
  originLabel,
  persianMoment,
  progressPercent,
  targetErrors,
} from "./model";

const ZONE = "Asia/Tehran";
const ICONS = { clock: Clock, alert: AlertTriangle, check: CheckCircle2, pause: PauseCircle, dash: Minus };

function Errors({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="ticket-errors" role="alert">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function Dialog({
  title,
  kicker,
  onClose,
  onSubmit,
  children,
  pending,
  submitLabel,
  bare,
}: {
  bare?: boolean;
  title: string;
  kicker: string;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  children: ReactNode;
  pending?: boolean;
  submitLabel: string;
}) {
  const form = (
    <form className="ticket-dialog" onSubmit={onSubmit} noValidate>
        <header>
          <span className="modal-kicker">{kicker}</span>
          {bare ? <h2>{title}</h2> : <DialogTitle as="h2">{title}</DialogTitle>}
        </header>
        {children}
        <footer>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            انصراف
          </Button>
          <Button type="submit" disabled={pending}>
            {submitLabel}
          </Button>
        </footer>
    </form>
  );
  if (bare) return form;
  return (
    <ModalCore isOpen className="create-modal ticket-modal" handleClose={() => !pending && onClose()}>
      {form}
    </ModalCore>
  );
}

function DurationInputs({
  hours,
  minutes,
  onHours,
  onMinutes,
  label,
}: {
  hours: string;
  minutes: string;
  onHours: (value: string) => void;
  onMinutes: (value: string) => void;
  label: string;
}) {
  return (
    <fieldset className="ticket-duration">
      <legend>{label}</legend>
      <label>
        <span>ساعت کاری</span>
        <input
          inputMode="numeric"
          type="number"
          min={0}
          value={hours}
          aria-label={`${label} — ساعت کاری`}
          onChange={(event) => onHours(event.target.value)}
        />
      </label>
      <label>
        <span>دقیقهٔ کاری</span>
        <input
          inputMode="numeric"
          type="number"
          min={0}
          max={59}
          value={minutes}
          aria-label={`${label} — دقیقهٔ کاری`}
          onChange={(event) => onMinutes(event.target.value)}
        />
      </label>
    </fieldset>
  );
}

/** A disabled action keeps its place and says why (section 6.1). */
function ActionButton({
  label,
  why,
  enabled,
  onClick,
  variant = "secondary",
}: {
  label: string;
  why?: string;
  enabled: boolean;
  onClick: () => void;
  variant?: "primary" | "secondary" | "danger";
}) {
  const id = useMemo(() => `why-${Math.random().toString(36).slice(2)}`, []);
  return (
    <span className="ticket-action">
      <button
        type="button"
        className={`button button-${variant}`}
        disabled={!enabled}
        aria-describedby={!enabled && why ? id : undefined}
        onClick={onClick}
      >
        {label}
      </button>
      {!enabled && why && (
        <small id={id} className="ticket-why">
          {why}
        </small>
      )}
    </span>
  );
}

// ---------------------------------------------------------------- target card

/** Start → now → approximate end on one line; the fill is the share of the working-time budget used. */
function DeadlineTrack({ deadline, percent }: { deadline: TicketDeadline; percent: number | null }) {
  const overdue = deadline.state === "overdue";
  return (
    <div className="ticket-track">
      <div
        className="ticket-track-bar"
        role="progressbar"
        aria-label="مصرف زمان هدف"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? 0}
        aria-valuetext={deadlineSummary(deadline)}
      >
        <span className="ticket-track-fill" style={{ inlineSize: `${percent ?? 0}%` }} />
        {percent !== null && !overdue && (
          <span className="ticket-track-now" style={{ insetInlineStart: `${percent}%` }} aria-hidden />
        )}
      </div>
      <div className="ticket-track-ends">
        <span>
          <small>شروع محاسبه</small>
          {deadline.started_text || "هنوز شروع نشده"}
        </span>
        <span>
          <small>پایان تقریبی</small>
          {deadline.target_text || "—"}
        </span>
      </div>
    </div>
  );
}

export function TargetCard({
  deadline,
  readOnly,
  onSetTarget,
  onExtension,
  onDecide,
}: {
  deadline: TicketDeadline;
  readOnly?: boolean;
  onSetTarget: () => void;
  onExtension: () => void;
  onDecide: (approve: boolean) => void;
}) {
  const presentation = DEADLINE_STATES[deadline.state];
  const Icon = ICONS[presentation.icon];
  const percent = progressPercent(deadline);
  const pending = deadline.pending_extension;
  const tracking = deadline.state !== "none" && deadline.state !== "not_started";
  return (
    <section
      className={`ticket-card ticket-target ticket-tone-${presentation.tone}`}
      aria-labelledby="ticket-target-title"
    >
      <header>
        <h3 id="ticket-target-title">زمان هدف</h3>
        <span className={`ticket-pill ticket-pill-${presentation.tone}`}>
          <Icon size={14} aria-hidden />
          {presentation.label}
        </span>
      </header>
      {deadline.state === "none" ? (
        <p className="ticket-target-empty">مدت هدف تعیین نشده</p>
      ) : (
        <>
          <p className="ticket-target-figure" aria-live="polite">
            {deadlineSummary(deadline)}
          </p>
          {tracking ? (
            <DeadlineTrack deadline={deadline} percent={percent} />
          ) : (
            <p className="ticket-muted">زمان از نخستین «در حال انجام» شمرده می‌شود.</p>
          )}
          <dl className="ticket-target-meta">
            <div>
              <dt>مدت هدف</dt>
              <dd>
                {formatWorkingMinutes(deadline.total_minutes ?? deadline.target_minutes)}
                {originLabel(deadline) && <small>{originLabel(deadline)}</small>}
              </dd>
            </div>
            {deadline.calendar.label && (
              <div>
                <dt>منبع تقویم</dt>
                <dd>
                  <span
                    className="ticket-calendar"
                    title={deadline.calendar.help}
                    tabIndex={0}
                    aria-label={`${deadline.calendar.label}: ${deadline.calendar.help}`}
                  >
                    <CalendarClock size={13} aria-hidden />
                    {deadline.calendar.label}
                  </span>
                </dd>
              </div>
            )}
          </dl>
        </>
      )}
      {deadline.state === "overdue" && deadline.last_delay_report && (
        <blockquote className="ticket-quote">
          <small>آخرین گزارش تأخیر</small>
          {deadline.last_delay_report.reason} — برآورد پایان {deadline.last_delay_report.expected_text}
        </blockquote>
      )}
      {pending && (
        <div className="ticket-pending" role="status">
          <strong>تمدید در انتظار تأیید {pending.approver}</strong>
          <span>
            موعد فعلی همچنان {pending.previous_target_text} است؛ موعد پیشنهادی {pending.requested_target_text}.
          </span>
          <span className="ticket-muted">دلیل: {pending.reason}</span>
          {deadline.can.decide_extension && (
            <div className="ticket-actions">
              <Button onClick={() => onDecide(true)}>تأیید تمدید</Button>
              <Button variant="danger" onClick={() => onDecide(false)}>
                رد تمدید
              </Button>
            </div>
          )}
        </div>
      )}
      {!readOnly && (
        <div className="ticket-actions ticket-card-footer">
          <ActionButton
            label="درخواست تمدید"
            enabled={deadline.can.request_extension}
            why={deadline.why.request_extension}
            onClick={onExtension}
          />
          {deadline.can.set_target && (
            <ActionButton
              label={deadline.state === "none" ? "تعیین مدت هدف" : "تغییر مدت هدف"}
              enabled
              onClick={onSetTarget}
            />
          )}
        </div>
      )}
    </section>
  );
}

export function OverdueBanner({ deadline, onReport }: { deadline: TicketDeadline; onReport: () => void }) {
  if (deadline.state !== "overdue") return null;
  return (
    <div className="ticket-banner" role="alert">
      <span className="ticket-banner-icon" aria-hidden>
        <AlertTriangle size={18} />
      </span>
      <span className="ticket-banner-text">
        <strong>{formatWorkingMinutes(deadline.overdue_minutes)} از موعد گذشته</strong>
        <small>
          {deadline.delay_report_needed
            ? "دلیل تأخیر، وضعیت پیشرفت و زمان پایان جدید را ثبت کنید."
            : "گزارش تأخیر برای این موعد ثبت شده است."}
        </small>
      </span>
      {deadline.can.report_delay && (
        <Button variant="danger" onClick={onReport}>
          ثبت گزارش تأخیر
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- dialogs

export function TargetDialog({
  id,
  deadline,
  onClose,
  bare,
}: {
  id: string;
  deadline: TicketDeadline;
  onClose: () => void;
  bare?: boolean;
}) {
  const current = deadline.ticket_minutes ?? deadline.target_minutes ?? 0;
  const [hours, setHours] = useState(current ? String(Math.floor(current / 60)) : "");
  const [minutes, setMinutes] = useState(current ? String(current % 60) : "");
  const [reason, setReason] = useState("");
  const [clearing, setClearing] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const mutation = useSetTicketTarget(id);
  const total = minutesFrom(hours, minutes);
  const errors = targetErrors(total, reason, clearing);
  return (
    <Dialog
      bare={bare}
      title={deadline.state === "none" ? "تعیین مدت هدف" : "تغییر مدت هدف"}
      kicker="زمان هدف تیکت"
      pending={mutation.isPending}
      submitLabel="ذخیره"
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (errors.length) return;
        mutation.mutate({ minutes: clearing ? null : total, reason }, { onSuccess: onClose });
      }}
    >
      {deadline.type_minutes ? (
        <p className="ticket-muted">پیش‌فرض نوع این تیکت: {formatWorkingMinutes(deadline.type_minutes)}</p>
      ) : null}
      {!clearing && <DurationInputs label="مدت هدف" hours={hours} minutes={minutes} onHours={setHours} onMinutes={setMinutes} />}
      {deadline.ticket_minutes ? (
        <label className="ticket-check">
          <input type="checkbox" checked={clearing} onChange={(event) => setClearing(event.target.checked)} />
          <span>حذف مقدار این تیکت و بازگشت به پیش‌فرض نوع</span>
        </label>
      ) : null}
      <label>
        <span>دلیل تغییر (اجباری)</span>
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} required />
      </label>
      <p className="ticket-hint">مقدار قبلی، مقدار جدید و موعد قبلی و جدید در سابقهٔ تیکت ثبت می‌شود.</p>
      <Errors items={submitted ? errors : []} />
      {mutation.error && <Errors items={[errorMessage(mutation.error, "ذخیره انجام نشد.")]} />}
    </Dialog>
  );
}

export function ExtensionDialog({ id, onClose, bare }: { id: string; onClose: () => void; bare?: boolean }) {
  const [hours, setHours] = useState("1");
  const [minutes, setMinutes] = useState("0");
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const total = minutesFrom(hours, minutes);
  const [debounced, setDebounced] = useState(total);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(total), 350);
    return () => window.clearTimeout(timer);
  }, [total]);
  const preview = useExtensionPreview(id, debounced, true);
  const mutation = useRequestExtension(id);
  const errors = extensionErrors(total, reason);
  return (
    <Dialog
      bare={bare}
      title="درخواست تمدید موعد"
      kicker="تمدید"
      pending={mutation.isPending}
      submitLabel="ارسال درخواست"
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (errors.length || !total) return;
        mutation.mutate({ minutes: total, reason }, { onSuccess: onClose });
      }}
    >
      <DurationInputs label="مدت اضافه" hours={hours} minutes={minutes} onHours={setHours} onMinutes={setMinutes} />
      <label>
        <span>دلیل (اجباری)</span>
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} required />
      </label>
      <div className="ticket-preview" aria-live="polite">
        {preview.isFetching ? (
          <span>در حال محاسبه از تقویم کاری…</span>
        ) : preview.error ? (
          <span className="ticket-error-text">{errorMessage(preview.error, "پیش‌نمایش محاسبه نشد.")}</span>
        ) : preview.data ? (
          <>
            <span>موعد فعلی: {preview.data.current_target_text}</span>
            <strong>پایان جدید در صورت تأیید: {preview.data.requested_target_text}</strong>
            <span>
              گیرنده: {preview.data.approver.name} ({preview.data.approver.relation})
            </span>
          </>
        ) : (
          <span>مدت اضافه را وارد کنید تا پایان جدید محاسبه شود.</span>
        )}
      </div>
      <p className="ticket-hint">تا تأیید مدیر، موعد فعلی تغییر نمی‌کند. این تمدید اضافه‌کاری یا ساعت حضور نیست.</p>
      <Errors items={submitted ? errors : []} />
      {mutation.error && <Errors items={[errorMessage(mutation.error, "ثبت درخواست انجام نشد.")]} />}
    </Dialog>
  );
}

export function DecideDialog({
  id,
  card,
  approve,
  onClose,
}: {
  id: string;
  card: TicketCard;
  approve: boolean;
  onClose: () => void;
}) {
  const pending = card.deadline.pending_extension;
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const mutation = useDecideTicketExtension(id);
  const errors = !approve && !reason.trim() ? ["دلیل رد درخواست الزامی است."] : [];
  if (!pending) return null;
  const previous = card.deadline.extensions.filter((row) => row.id !== pending.id);
  return (
    <Dialog
      title={approve ? "تأیید تمدید" : "رد تمدید"}
      kicker="تصمیم تمدید"
      pending={mutation.isPending}
      submitLabel={approve ? "تأیید" : "رد"}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (errors.length) return;
        mutation.mutate({ extensionId: pending.id, approve, reason }, { onSuccess: onClose });
      }}
    >
      <dl className="ticket-facts">
        <div>
          <dt>موعد فعلی</dt>
          <dd>{pending.previous_target_text}</dd>
        </div>
        <div>
          <dt>موعد پیشنهادی</dt>
          <dd>{pending.requested_target_text}</dd>
        </div>
        <div>
          <dt>دلیل</dt>
          <dd>{pending.reason}</dd>
        </div>
      </dl>
      {previous.length > 0 && (
        <details>
          <summary>تمدیدهای قبلی ({faDigits(previous.length)})</summary>
          <ul className="ticket-list">
            {previous.map((row) => (
              <li key={row.id}>
                {row.status_title} — {row.previous_target_text} ← {row.requested_target_text}
              </li>
            ))}
          </ul>
        </details>
      )}
      <label>
        <span>{approve ? "توضیح (اختیاری)" : "دلیل رد (اجباری)"}</span>
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      <Errors items={submitted ? errors : []} />
      {mutation.error && <Errors items={[errorMessage(mutation.error, "ثبت تصمیم انجام نشد.")]} />}
    </Dialog>
  );
}

export function DelayDialog({ id, onClose, bare }: { id: string; onClose: () => void; bare?: boolean }) {
  const [reason, setReason] = useState("");
  const [progress, setProgress] = useState("");
  const [expected, setExpected] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const mutation = useDelayReport(id);
  const errors = delayErrors(reason, progress, expected);
  return (
    <Dialog
      bare={bare}
      title="گزارش تأخیر"
      kicker="دیرکرد"
      pending={mutation.isPending}
      submitLabel="ثبت گزارش"
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (errors.length || !expected) return;
        mutation.mutate({ reason, progress, expected_at: expected }, { onSuccess: onClose });
      }}
    >
      <label>
        <span>دلیل تأخیر</span>
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} required />
      </label>
      <label>
        <span>وضعیت پیشرفت</span>
        <textarea value={progress} onChange={(event) => setProgress(event.target.value)} required />
      </label>
      <PersianDateTimePicker
        label="زمان پایان جدید"
        value={expected ?? undefined}
        timeZone={ZONE}
        onChange={(value: string) => setExpected(value || null)}
      />
      <p className="ticket-hint">این برآورد موعد رسمی را تغییر نمی‌دهد؛ برای تغییر موعد درخواست تمدید بدهید.</p>
      <Errors items={submitted ? errors : []} />
      {mutation.error && <Errors items={[errorMessage(mutation.error, "ثبت گزارش انجام نشد.")]} />}
    </Dialog>
  );
}

export function ContactDialog({
  id,
  card,
  onClose,
  bare,
}: {
  id: string;
  card: TicketCard;
  onClose: () => void;
  bare?: boolean;
}) {
  const [channel, setChannel] = useState(card.contact_channels[0]?.code ?? "");
  const [contactName, setContactName] = useState("");
  const [contactAt, setContactAt] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [resolved, setResolved] = useState<boolean | null>(null);
  const [notifyCustomer, setNotifyCustomer] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const mutation = useContactResolve(id);
  const errors = contactErrors({ channel, contactName, summary, resolved });
  return (
    <Dialog
      bare={bare}
      title="حل در تماس اول"
      kicker="مسیر کوتاه"
      pending={mutation.isPending}
      submitLabel="ثبت تماس"
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (errors.length || resolved === null) return;
        mutation.mutate(
          {
            channel,
            contact_name: contactName,
            summary,
            resolved,
            ...(contactAt ? { contact_at: contactAt } : {}),
            ...(card.portal ? { notify_customer: notifyCustomer } : {}),
          },
          { onSuccess: onClose }
        );
      }}
    >
      <div className="ticket-chips" role="radiogroup" aria-label="کانال تماس">
        {card.contact_channels.map((item) => (
          <button
            key={item.code}
            type="button"
            role="radio"
            aria-checked={channel === item.code}
            className={`ticket-chip ${channel === item.code ? "is-active" : ""}`}
            onClick={() => setChannel(item.code)}
          >
            {item.title}
          </button>
        ))}
      </div>
      <label>
        <span>مخاطب</span>
        <input value={contactName} onChange={(event) => setContactName(event.target.value)} required />
      </label>
      <PersianDateTimePicker
        label="زمان تماس (پیش‌فرض: اکنون)"
        value={contactAt ?? undefined}
        timeZone={ZONE}
        onChange={(value: string) => setContactAt(value || null)}
      />
      <label>
        <span>خلاصهٔ گفتگو</span>
        <textarea value={summary} onChange={(event) => setSummary(event.target.value)} required />
      </label>
      <div className="ticket-outcomes" role="radiogroup" aria-label="نتیجهٔ تماس">
        <button
          type="button"
          role="radio"
          aria-checked={resolved === true}
          className={`ticket-outcome ${resolved === true ? "is-active" : ""}`}
          onClick={() => setResolved(true)}
        >
          <CheckCircle2 size={18} aria-hidden /> حل شد — تیکت بسته شود
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={resolved === false}
          className={`ticket-outcome ${resolved === false ? "is-active" : ""}`}
          onClick={() => setResolved(false)}
        >
          <RefreshCw size={18} aria-hidden /> حل نشد — ادامه در مسیر عادی
        </button>
      </div>
      {card.portal && (
        <label className="ticket-check">
          <input type="checkbox" checked={notifyCustomer} onChange={(event) => setNotifyCustomer(event.target.checked)} />
          <span>اطلاع به مشتری — خلاصهٔ تماس در درگاه مشتری نمایش داده شود (در غیر این صورت فقط داخلی می‌ماند)</span>
        </label>
      )}
      <Errors items={submitted ? errors : []} />
      {mutation.error && <Errors items={[errorMessage(mutation.error, "ثبت تماس انجام نشد.")]} />}
    </Dialog>
  );
}

function MemberSelect({ value, onChange, exclude = [] }: { value: string; onChange: (id: string) => void; exclude?: string[] }) {
  const members = useMembers();
  return (
    <SearchableSelect
      showLabel
      label="گیرنده"
      value={value}
      onChange={onChange}
      options={(members.data ?? [])
        .filter((member) => !exclude.includes(member.id))
        .map((member) => ({ id: member.id, title: member.displayName, description: member.email }))}
    />
  );
}

export function ReferDialog({
  id,
  mode,
  card,
  onClose,
}: {
  id: string;
  mode: "refer" | "forward" | "reject";
  card: TicketCard;
  onClose: () => void;
}) {
  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const refer = useReferTicket(id);
  const respond = useRespondReferral(id);
  const mutation = mode === "refer" ? refer : respond;
  const errors = [
    ...(mode !== "reject" && !userId ? ["گیرنده را انتخاب کنید."] : []),
    ...(!reason.trim() ? ["دلیل الزامی است."] : []),
  ];
  const titles = { refer: "ارجاع تیکت", forward: "ارجاع به فرد دیگر", reject: "رد ارجاع" };
  return (
    <Dialog
      title={titles[mode]}
      kicker="ارجاع"
      pending={mutation.isPending}
      submitLabel={mode === "reject" ? "رد و بازگرداندن" : "ارجاع"}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (errors.length) return;
        if (mode === "refer") refer.mutate({ user_id: userId, reason }, { onSuccess: onClose });
        else respond.mutate({ action: mode, reason, ...(mode === "forward" ? { user_id: userId } : {}) }, { onSuccess: onClose });
      }}
    >
      {mode !== "reject" && (
        <MemberSelect value={userId} onChange={setUserId} exclude={card.active_referral ? [card.active_referral.to_id] : []} />
      )}
      {mode === "reject" && card.active_referral && (
        <p className="ticket-muted">تیکت به ارجاع‌دهنده ({card.active_referral.by}) برمی‌گردد.</p>
      )}
      <label>
        <span>دلیل (اجباری)</span>
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} required />
      </label>
      <Errors items={submitted ? errors : []} />
      {mutation.error && <Errors items={[errorMessage(mutation.error, "ارجاع انجام نشد.")]} />}
    </Dialog>
  );
}

export function ReferralCard({
  card,
  onRefer,
  onRespond,
  accepting,
  onAccept,
}: {
  card: TicketCard;
  onRefer: () => void;
  onRespond: (mode: "forward" | "reject") => void;
  accepting?: boolean;
  onAccept: () => void;
}) {
  const active = card.active_referral;
  const chain = card.referrals.filter((row) => row.outcome === "referred").slice(-3);
  return (
    <section className="ticket-card" aria-labelledby="ticket-referral-title">
      <header>
        <h3 id="ticket-referral-title">ارجاع</h3>
        <Share2 size={16} aria-hidden className="ticket-card-glyph" />
      </header>
      {active ? (
        <div className="ticket-pending" role="status">
          <div className="ticket-handoff" aria-label={`ارجاع از ${active.by} به ${active.to}`}>
            <span className="ticket-person">{active.by}</span>
            <ArrowLeft size={16} aria-hidden />
            <span className="ticket-person is-current">{active.to}</span>
          </div>
          <span>دلیل: {active.reason}</span>
          {active.mine ? (
            <div className="ticket-actions">
              <Button disabled={accepting} onClick={onAccept}>
                پذیرش
              </Button>
              <Button variant="danger" onClick={() => onRespond("reject")}>
                رد با دلیل
              </Button>
              <Button variant="secondary" onClick={() => onRespond("forward")}>
                ارجاع به فرد دیگر
              </Button>
            </div>
          ) : (
            <span className="ticket-muted">در انتظار پاسخ {active.to}</span>
          )}
        </div>
      ) : (
        <p className="ticket-muted">ارجاع در انتظار پاسخی وجود ندارد.</p>
      )}
      {!active && chain.length > 0 && (
        <ol className="ticket-chain" aria-label="آخرین ارجاع‌ها">
          {chain.map((row) => (
            <li key={row.id}>
              <span>
                {row.by} ← {row.to}
              </span>
              {row.response_title && <span className={`ticket-chip-static is-${row.response}`}>{row.response_title}</span>}
            </li>
          ))}
        </ol>
      )}
      {!card.read_only && (
        <div className="ticket-actions ticket-card-footer">
          <ActionButton
            label="ارجاع"
            enabled={card.can.refer && !active}
            why={active ? "یک ارجاع در انتظار پاسخ است." : "فقط مسئول یا مدیر دارای مجوز ارجاع می‌تواند ارجاع دهد."}
            onClick={onRefer}
          />
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- core fields (ن۱)

export function TicketDetailsCard({ card, onParent }: { card: TicketCard; onParent: () => void }) {
  const d = card.details;
  const rows: [string, LucideIcon, ReactNode][] = [
    ["ثبت‌کننده", UserRound, d.creator || "—"],
    ["نوع", Shapes, d.type || "—"],
    ["پروژه", FolderKanban, d.project || "بدون پروژه"],
    ["اولویت", Flag, PRIORITY_LABELS[d.priority] || d.priority || "—"],
    ["سررسید", CalendarDays, d.due_date ? persianMoment(`${d.due_date}T12:00:00+03:30`).split("،").slice(0, 2).join("،") : "—"],
    ["تخمین", Gauge, d.estimate !== null && d.estimate !== undefined ? faDigits(String(d.estimate)) : "—"],
    ["برچسب‌ها", Tags, d.labels.length ? d.labels.join("، ") : "—"],
  ];
  return (
    <section className="ticket-card" aria-labelledby="ticket-details-title">
      <header>
        <h3 id="ticket-details-title">مشخصات تیکت</h3>
      </header>
      <dl className="ticket-details">
        {rows.map(([label, Glyph, value]) => (
          <div key={label} className={value === "—" ? "is-empty" : undefined}>
            <dt>
              <Glyph size={14} aria-hidden />
              {label}
            </dt>
            <dd>{value}</dd>
          </div>
        ))}
        <div className={`ticket-details-wide${d.parent || d.parent_hidden ? "" : " is-empty"}`}>
          <dt>
            <GitMerge size={14} aria-hidden />
            تیکت والد
          </dt>
          <dd>
            {d.parent ? (
              <Link to={`/entities/ticket/${d.parent.id}`}>{d.parent.name}</Link>
            ) : d.parent_hidden ? (
              "تیکت والد خارج از دسترسی شماست"
            ) : (
              "—"
            )}
          </dd>
        </div>
      </dl>
      {d.children.length > 0 && (
        <div className="ticket-children">
          <small className="ticket-muted">زیرتیکت‌ها</small>
          <ul>
            {d.children.map((child) => (
              <li key={child.id}>
                <Link to={`/entities/ticket/${child.id}`}>{child.name}</Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!card.read_only && (
        <div className="ticket-actions ticket-card-footer">
          <Button variant="secondary" onClick={onParent}>
            {d.parent ? "تغییر تیکت والد" : "تعیین تیکت والد"}
          </Button>
        </div>
      )}
    </section>
  );
}

export function ParentDialog({ id, card, onClose, bare }: { id: string; card: TicketCard; onClose: () => void; bare?: boolean }) {
  const slug = useSlug() ?? "";
  const [parentId, setParentId] = useState(card.details.parent?.id ?? "");
  const [options, setOptions] = useState<{ id: string; title: string }[]>([]);
  const mutation = useSetTicketParent(id);
  useEffect(() => {
    if (!slug) return;
    const controller = new AbortController();
    void api
      .post(
        `/api/workspaces/${slug}/engine/entities/ticket/query/`,
        { definition: { version: 1, type: "table", columns: [{ field: "title", width: 180 }], sort: [] }, page_size: 200 },
        { signal: controller.signal }
      )
      .then((response) =>
        setOptions(
          (response.data.results as { id: string; title: string; number?: string }[])
            .filter((row) => row.id !== id)
            .map((row) => ({ id: row.id, title: row.number ? `${row.number} · ${row.title}` : row.title }))
        )
      )
      .catch(() => setOptions([]));
    return () => controller.abort();
  }, [slug, id]);
  return (
    <Dialog
      bare={bare}
      title="تیکت والد"
      kicker="والد / فرزند"
      pending={mutation.isPending}
      submitLabel="ذخیره"
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate({ parent_id: parentId || null }, { onSuccess: onClose });
      }}
    >
      <SearchableSelect
        showLabel
        label="تیکت والد"
        value={parentId}
        onChange={setParentId}
        options={[{ id: "", title: "بدون والد" }, ...options]}
      />
      <p className="ticket-hint">والد باید در همین شرکت باشد و نمی‌تواند خود این تیکت یا یکی از زیرتیکت‌هایش باشد.</p>
      {mutation.error && <Errors items={[errorMessage(mutation.error, "ذخیره انجام نشد.")]} />}
    </Dialog>
  );
}

// ---------------------------------------------------------------- history (6.9)

const EVENT_GLYPHS: Record<string, LucideIcon> = {
  status: CircleDot,
  assignee: Share2,
  deadline: Clock,
  extension: CalendarClock,
  delay: AlertTriangle,
  contact: Phone,
  lifecycle: CheckCircle2,
  fields: PenLine,
};

export function TicketHistory({ id }: { id: string }) {
  const [kind, setKind] = useState("");
  const history = useTicketHistory(id, kind);
  return (
    <section className="ticket-history" aria-labelledby="ticket-history-title">
      <header>
        <h3 id="ticket-history-title">سابقه</h3>
        <div className="ticket-chips" role="tablist" aria-label="فیلتر نوع رویداد">
          {HISTORY_KINDS.map((item) => (
            <button
              key={item.id || "all"}
              type="button"
              role="tab"
              aria-selected={kind === item.id}
              className={`ticket-chip ${kind === item.id ? "is-active" : ""}`}
              onClick={() => setKind(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>
      {history.isLoading ? (
        <Skeleton rows={3} />
      ) : history.error ? (
        <div className="ticket-error-text" role="alert">
          دریافت سابقه انجام نشد.{" "}
          <button type="button" className="button button-ghost" onClick={() => void history.refetch()}>
            تلاش دوباره
          </button>
        </div>
      ) : !history.data?.length ? (
        <p className="ticket-muted">رویدادی برای این فیلتر ثبت نشده است.</p>
      ) : (
        <ol className="ticket-timeline">
          {history.data.filter((event) => !HIDDEN_EVENTS.has(event.type)).map((event) => {
            const Glyph = EVENT_GLYPHS[event.kind] ?? PenLine;
            const before = historyValue(event.before, event.field);
            const after = historyValue(event.after, event.field);
            const changed = before !== "—" || after !== "—";
            const initial = before === "—" && after !== "—";
            return (
              <li key={event.id} className={`ticket-event ticket-event-${event.kind}`}>
                <span className="ticket-event-icon" aria-hidden>
                  <Glyph size={14} />
                </span>
                <div className="ticket-event-body">
                  <div className="ticket-event-head">
                    <strong>{eventTitle(event.type, event.field, event.metadata)}</strong>
                    <time dateTime={event.created_at ?? undefined}>
                      {event.created_text || persianMoment(event.created_at)}
                    </time>
                  </div>
                  <small className="ticket-event-actor">{event.actor}</small>
                  {changed && (
                    <span className="ticket-event-change">
                      {initial ? (
                        <>
                          مقدار اولیه: <bdi>{after}</bdi>
                        </>
                      ) : (
                        <>
                          <bdi>{before}</bdi> ← <bdi>{after}</bdi>
                        </>
                      )}
                    </span>
                  )}
                  {event.reason && <span className="ticket-event-reason">دلیل: {event.reason}</span>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- panel

type Open =
  | { kind: "target" }
  | { kind: "extension" }
  | { kind: "decide"; approve: boolean }
  | { kind: "delay" }
  | { kind: "contact" }
  | { kind: "refer"; mode: "refer" | "forward" | "reject" }
  | { kind: "parent" }
  | null;

function ReferralList({ card }: { card: TicketCard }) {
  if (!card.referrals.length) return <p className="ticket-muted">این تیکت هنوز ارجاع نشده است.</p>;
  return (
    <ol className="ticket-timeline">
      {card.referrals.map((row) => (
        <li key={row.id} className="ticket-event ticket-event-assignee">
          <span className="ticket-event-icon" aria-hidden>
            <Share2 size={14} />
          </span>
          <div className="ticket-event-body">
            <div className="ticket-event-head">
              <strong>
                {row.outcome === "referred"
                  ? "ارجاع دستی"
                  : row.outcome === "queued"
                    ? "صف بدون مسئول"
                    : `ارجاع خودکار${row.rule ? ` — «${row.rule}»` : ""}`}
              </strong>
              <time dateTime={row.created_at ?? undefined}>{row.created_text}</time>
            </div>
            <span className="ticket-handoff">
              {row.by && <span className="ticket-person">{row.by}</span>}
              {row.by && row.to && <ArrowLeft size={14} aria-hidden />}
              {row.to && <span className="ticket-person is-current">{row.to}</span>}
              {row.response_title && <span className={`ticket-chip-static is-${row.response}`}>{row.response_title}</span>}
            </span>
            {row.reason && <span className="ticket-event-reason">دلیل: {row.reason}</span>}
            {row.response_reason && <span className="ticket-event-reason">پاسخ: {row.response_reason}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function ChildrenList({ card, onParent }: { card: TicketCard; onParent: () => void }) {
  const d = card.details;
  return (
    <div className="ticket-children-panel">
      <p>
        <span className="ticket-muted">تیکت والد: </span>
        {d.parent ? (
          <Link to={`/entities/ticket/${d.parent.id}`}>{d.parent.name}</Link>
        ) : d.parent_hidden ? (
          "تیکت والد خارج از دسترسی شماست"
        ) : (
          "ندارد"
        )}
      </p>
      {d.children.length ? (
        <ul className="ticket-list">
          {d.children.map((child) => (
            <li key={child.id}>
              <Link to={`/entities/ticket/${child.id}`}>{child.name}</Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ticket-muted">این تیکت زیرتیکتی ندارد.</p>
      )}
      {!card.read_only && (
        <Button variant="secondary" onClick={onParent}>
          {d.parent ? "تغییر تیکت والد" : "تعیین تیکت والد"}
        </Button>
      )}
    </div>
  );
}

export function TicketCorePanel({ id }: { id: string }) {
  const card = useTicketCard(id);
  const respond = useRespondReferral(id);
  const [open, setOpen] = useState<Open>(null);
  const [tab, setTab] = useState<TicketTab>("history");
  if (card.isLoading) return <Skeleton rows={4} />;
  if (card.error || !card.data)
    return (
      <div className="ticket-error-text" role="alert">
        {errorMessage(card.error, "اطلاعات زمان هدف و ارجاع دریافت نشد.")}{" "}
        <button type="button" className="button button-ghost" onClick={() => void card.refetch()}>
          تلاش دوباره
        </button>
      </div>
    );
  const data = card.data;
  const close = () => setOpen(null);
  return (
    <div className="ticket-core">
      <TicketHeader
        card={data}
        onAction={(action) =>
          setOpen(
            action === "refer"
              ? { kind: "refer", mode: "refer" }
              : action === "contact"
                ? { kind: "contact" }
                : action === "parent"
                  ? { kind: "parent" }
                  : action === "target"
                    ? { kind: "target" }
                    : action === "extension"
                      ? { kind: "extension" }
                      : { kind: "delay" }
          )
        }
      />
      {data.read_only && <p className="ticket-hint">دسترسی شما به این تیکت فقط‌خواندنی است.</p>}
      <OverdueBanner deadline={data.deadline} onReport={() => setOpen({ kind: "delay" })} />
      <div className="ticket-core-grid">
        <div className="ticket-core-main">
          {!data.read_only && (
            <div className="ticket-shortcut">
              <span className="ticket-muted">مسیر کوتاه</span>
              <ActionButton
                label="حل در تماس"
                enabled={data.can.contact}
                why="تیکت بسته است یا دسترسی ثبت تماس ندارید."
                onClick={() => setOpen({ kind: "contact" })}
              />
            </div>
          )}
          <TicketTabs
            active={tab}
            onChange={setTab}
            counts={{
              referrals: data.referrals.length,
              children: data.details.children.length,
            }}
          />
          <div role="tabpanel" id={`ticket-tabpanel-${tab}`} aria-labelledby={`ticket-tab-${tab}`}>
            {tab === "history" && <TicketHistory id={id} />}
            {tab === "portal" && <PortalTab id={id} />}
            {tab === "referrals" && (
              <section className="ticket-history" aria-label="ارجاع‌ها">
                <ReferralList card={data} />
              </section>
            )}
            {tab === "related" && <RelatedRecords code="ticket" id={id} />}
            {tab === "children" && (
              <section className="ticket-history" aria-label="زیرتیکت‌ها">
                <ChildrenList card={data} onParent={() => setOpen({ kind: "parent" })} />
              </section>
            )}
          </div>
        </div>
        <aside className="ticket-core-side">
          <TargetCard
            deadline={data.deadline}
            readOnly={data.read_only}
            onSetTarget={() => setOpen({ kind: "target" })}
            onExtension={() => setOpen({ kind: "extension" })}
            onDecide={(approve) => setOpen({ kind: "decide", approve })}
          />
          <ReferralCard
            card={data}
            accepting={respond.isPending}
            onAccept={() => respond.mutate({ action: "accept" })}
            onRefer={() => setOpen({ kind: "refer", mode: "refer" })}
            onRespond={(mode) => setOpen({ kind: "refer", mode })}
          />
          <TicketDetailsCard card={data} onParent={() => setOpen({ kind: "parent" })} />
        </aside>
      </div>
      {open?.kind === "target" && <TargetDialog id={id} deadline={data.deadline} onClose={close} />}
      {open?.kind === "extension" && <ExtensionDialog id={id} onClose={close} />}
      {open?.kind === "decide" && <DecideDialog id={id} card={data} approve={open.approve} onClose={close} />}
      {open?.kind === "delay" && <DelayDialog id={id} onClose={close} />}
      {open?.kind === "contact" && <ContactDialog id={id} card={data} onClose={close} />}
      {open?.kind === "refer" && <ReferDialog id={id} card={data} mode={open.mode} onClose={close} />}
      {open?.kind === "parent" && <ParentDialog id={id} card={data} onClose={close} />}
    </div>
  );
}
