/** Workflow panel of a record: current step, deadline, allowed actions and history. */
import { useState } from "react";
import type { ReactNode } from "react";
import { CompactMultiSelector, PersianDateTimePicker, SearchableSelect } from "@plane/ui";
import { AlertTriangle, Clock, GitBranch } from "lucide-react";
import {
  useDecideExtension,
  useMigrationPreview,
  useRecordWorkflow,
  useStartWorkflow,
  useWorkflowAction,
  useWorkflowMeta,
} from "../api/workflow";
import type { InstanceAction, MigrationPreview, Person, TimelineEntry, WorkflowInstanceView } from "../api/workflow";
import { Button } from "../components";
import {
  TIMELINE_LABELS,
  contactErrors,
  deadlineBadges,
  delayReportErrors,
  extensionErrors,
  formatWorkingMinutes,
  joinMinutes,
  reasonError,
  versionLabel,
  visibleActions,
} from "./model";

const ZONE = "Asia/Tehran";

function Errors({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="workflow-errors" role="alert">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="workflow-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function DeadlineBadges({ run }: { run: WorkflowInstanceView["run"] }) {
  const badges = deadlineBadges(run);
  if (!badges.length) return null;
  return (
    <span className="workflow-badges">
      {badges.map((badge) => (
        <span key={badge.id} className={`workflow-badge workflow-badge-${badge.tone}`}>
          {badge.label}
        </span>
      ))}
    </span>
  );
}

/** Reason form for reject / return / refer / pause / resume; the server rejects an empty required reason too. */
export function ReasonForm({
  title,
  required = true,
  submitLabel,
  extra,
  pending,
  onSubmit,
  onCancel,
}: {
  title: string;
  required?: boolean;
  submitLabel: string;
  extra?: ReactNode;
  pending?: boolean;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const error = reasonError(reason, required);
  return (
    <form
      className="workflow-form"
      aria-label={title}
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (!error) onSubmit(reason.trim());
      }}
    >
      <strong>{title}</strong>
      {extra}
      <Field label={required ? "دلیل (الزامی)" : "توضیح (اختیاری)"}>
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} required={required} />
      </Field>
      <Errors items={submitted && error ? [error] : []} />
      <div className="workflow-form-actions">
        <Button type="submit" disabled={pending}>
          {submitLabel}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          انصراف
        </Button>
      </div>
    </form>
  );
}

export function DelayReportForm({
  pending,
  onSubmit,
  onCancel,
}: {
  pending?: boolean;
  onSubmit: (payload: { reason: string; progress: string; expected_at: string }) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState({ reason: "", progress: "", expected_at: "" });
  const [submitted, setSubmitted] = useState(false);
  const errors = delayReportErrors(value);
  return (
    <form
      className="workflow-form"
      aria-label="گزارش دیرکرد"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (!errors.length) onSubmit({ ...value, reason: value.reason.trim(), progress: value.progress.trim() });
      }}
    >
      <strong>گزارش دیرکرد</strong>
      <p className="workflow-muted">تا گزارش ثبت نشود، ادامهٔ این مرحله ممکن نیست. گزارش‌ها بعداً ویرایش نمی‌شوند.</p>
      <Field label="دلیل دیرکرد">
        <textarea value={value.reason} onChange={(event) => setValue({ ...value, reason: event.target.value })} />
      </Field>
      <Field label="وضعیت پیشرفت">
        <textarea value={value.progress} onChange={(event) => setValue({ ...value, progress: event.target.value })} />
      </Field>
      <PersianDateTimePicker
        label="زمان جدید مورد انتظار"
        value={value.expected_at}
        timeZone={ZONE}
        onChange={(expected_at) => setValue({ ...value, expected_at })}
      />
      <Errors items={submitted ? errors : []} />
      <div className="workflow-form-actions">
        <Button type="submit" disabled={pending}>
          ثبت گزارش دیرکرد
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          انصراف
        </Button>
      </div>
    </form>
  );
}

export function ExtensionForm({
  current,
  currentText,
  pending,
  onSubmit,
  onCancel,
}: {
  current: string | null;
  currentText: string;
  pending?: boolean;
  onSubmit: (payload: { minutes?: number; target_at?: string; reason: string }) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState({
    mode: "minutes" as "minutes" | "moment",
    hours: 1,
    minutes: 0,
    target_at: "",
    reason: "",
  });
  const [submitted, setSubmitted] = useState(false);
  const errors = extensionErrors(value, current);
  return (
    <form
      className="workflow-form"
      aria-label="درخواست تمدید"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (errors.length) return;
        onSubmit(
          value.mode === "minutes"
            ? { minutes: joinMinutes(value.hours, value.minutes) ?? undefined, reason: value.reason.trim() }
            : { target_at: value.target_at, reason: value.reason.trim() }
        );
      }}
    >
      <strong>درخواست تمدید مهلت</strong>
      <p className="workflow-muted">مهلت فعلی: {currentText || "—"}. تا تأیید مدیر مستقیم، همین مهلت معتبر است.</p>
      <SearchableSelect
        label="نوع درخواست"
        value={value.mode}
        onChange={(mode) => setValue({ ...value, mode: mode as "minutes" | "moment" })}
        options={[
          { id: "minutes", title: "افزودن زمان کاری" },
          { id: "moment", title: "تعیین مهلت جدید" },
        ]}
      />
      {value.mode === "minutes" ? (
        <div className="workflow-row">
          <Field label="ساعت کاری">
            <input
              type="number"
              min={0}
              value={value.hours}
              onChange={(event) => setValue({ ...value, hours: Number(event.target.value) })}
            />
          </Field>
          <Field label="دقیقه">
            <input
              type="number"
              min={0}
              max={59}
              value={value.minutes}
              onChange={(event) => setValue({ ...value, minutes: Number(event.target.value) })}
            />
          </Field>
        </div>
      ) : (
        <PersianDateTimePicker
          label="مهلت جدید"
          value={value.target_at}
          timeZone={ZONE}
          onChange={(target_at) => setValue({ ...value, target_at })}
        />
      )}
      <Field label="دلیل تمدید">
        <textarea value={value.reason} onChange={(event) => setValue({ ...value, reason: event.target.value })} />
      </Field>
      <Errors items={submitted ? errors : []} />
      <div className="workflow-form-actions">
        <Button type="submit" disabled={pending}>
          ارسال درخواست تمدید
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          انصراف
        </Button>
      </div>
    </form>
  );
}

export function ExtensionDecisionForm({
  extension,
  pending,
  onDecide,
}: {
  extension: NonNullable<WorkflowInstanceView["pending_extension"]>;
  pending?: boolean;
  onDecide: (approve: boolean, reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  return (
    <section className="workflow-form" aria-label="بررسی درخواست تمدید">
      <strong>درخواست تمدید {extension.requested_by?.name}</strong>
      <p>
        از {extension.previous_target_text || "—"} تا <b>{extension.requested_target_text}</b>
      </p>
      <p className="workflow-muted">دلیل: {extension.reason}</p>
      <Field label="توضیح (برای رد الزامی)">
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
      <Errors items={error ? [error] : []} />
      <div className="workflow-form-actions">
        <Button disabled={pending} onClick={() => onDecide(true, reason.trim())}>
          تأیید تمدید
        </Button>
        <Button
          variant="danger"
          disabled={pending}
          onClick={() => {
            if (!reason.trim()) return setError("برای رد درخواست تمدید، دلیل را بنویسید.");
            onDecide(false, reason.trim());
          }}
        >
          رد تمدید
        </Button>
      </div>
    </section>
  );
}

export function ContactResolveForm({
  channels,
  pending,
  onSubmit,
  onCancel,
}: {
  channels: { code: string; title: string }[];
  pending?: boolean;
  onSubmit: (payload: {
    channel: string;
    contact_name: string;
    contact_at: string;
    summary: string;
    outcome: string;
  }) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState({
    channel: channels[0]?.code ?? "",
    contact_name: "",
    contact_at: "",
    summary: "",
    outcome: "",
  });
  const [submitted, setSubmitted] = useState(false);
  const errors = contactErrors(value);
  return (
    <form
      className="workflow-form"
      aria-label="ثبت تماس و حل"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (!errors.length) onSubmit(value);
      }}
    >
      <strong>ثبت تماس و حل</strong>
      <p className="workflow-muted">اطلاعات تماس در تاریخچهٔ همین تیکت ثبت می‌شود و تیکت در یک گام حل می‌شود.</p>
      <div className="workflow-row">
        <SearchableSelect
          label="کانال تماس"
          value={value.channel}
          onChange={(channel) => setValue({ ...value, channel })}
          options={channels.map((item) => ({ id: item.code, title: item.title }))}
        />
        <Field label="مخاطب">
          <input
            value={value.contact_name}
            onChange={(event) => setValue({ ...value, contact_name: event.target.value })}
          />
        </Field>
      </div>
      <PersianDateTimePicker
        label="زمان تماس"
        value={value.contact_at}
        timeZone={ZONE}
        onChange={(contact_at) => setValue({ ...value, contact_at })}
      />
      <Field label="خلاصهٔ گفتگو">
        <textarea value={value.summary} onChange={(event) => setValue({ ...value, summary: event.target.value })} />
      </Field>
      <Field label="نتیجه">
        <textarea value={value.outcome} onChange={(event) => setValue({ ...value, outcome: event.target.value })} />
      </Field>
      <Errors items={submitted ? errors : []} />
      <div className="workflow-form-actions">
        <Button type="submit" disabled={pending}>
          ثبت تماس و حل
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          انصراف
        </Button>
      </div>
    </form>
  );
}

function describeData(entry: TimelineEntry) {
  const data = entry.data as Record<string, any>;
  const parts: string[] = [];
  if (data.contact)
    parts.push(
      `تماس ${data.contact.channel_title} با ${data.contact.contact_name} (${data.contact.contact_text}): ${data.contact.summary}`
    );
  if (entry.kind === "pause" && data.kind) parts.push(data.kind === "customer" ? "در انتظار پاسخ مشتری" : "توقف رسمی");
  if (entry.kind === "extension" || entry.kind.startsWith("extension_"))
    parts.push(`مهلت قبلی: ${data.previous_target_text || "—"} · مهلت درخواستی: ${data.requested_target_text || "—"}`);
  if (entry.kind === "delay_report") parts.push(`پیشرفت: ${data.progress} · پایان مورد انتظار: ${data.expected_text}`);
  if (entry.kind === "reassign" && data.before)
    parts.push(`از ${data.before.assignee?.name || "—"} به ${data.after?.assignee?.name || "—"}`);
  if (entry.kind === "to_standard" && data.followup) parts.push(`پیگیری: ${data.followup.title}`);
  return parts.join(" — ");
}

export function WorkflowTimeline({
  entries,
  steps,
}: {
  entries: TimelineEntry[];
  steps: { code: string; title: string }[];
}) {
  const title = (code: string) => steps.find((step) => step.code === code)?.title || code;
  if (!entries.length) return <p className="workflow-muted">هنوز اقدامی ثبت نشده است.</p>;
  return (
    <ol className="workflow-timeline" aria-label="سابقهٔ گردش‌کار">
      {entries.map((entry) => (
        <li key={entry.id} className={`workflow-timeline-${entry.kind}`}>
          <div>
            <strong>{TIMELINE_LABELS[entry.kind] || entry.kind}</strong>
            {entry.from_step && entry.to_step && entry.from_step !== entry.to_step && (
              <span>
                {" "}
                {title(entry.from_step)} ← {title(entry.to_step)}
              </span>
            )}
          </div>
          <small>
            {entry.actor?.name || "سامانه"} · {entry.at_text} · {versionLabel(entry.version)}
          </small>
          {entry.reason && <p>دلیل: {entry.reason}</p>}
          {describeData(entry) && <p>{describeData(entry)}</p>}
          {Object.keys(entry.changed_values || {}).length > 0 && (
            <p className="workflow-muted">فیلدهای تغییرکرده: {Object.keys(entry.changed_values).join("، ")}</p>
          )}
        </li>
      ))}
    </ol>
  );
}

/** What moving the record to another version changes; shown before the move is confirmed. */
export function MigrationSummary({ preview }: { preview: MigrationPreview }) {
  return (
    <div className="workflow-migration" aria-label="پیش‌نمایش انتقال">
      <dl className="workflow-facts">
        <div>
          <dt>از</dt>
          <dd>
            {versionLabel(preview.before.version)} · {preview.before.assignee?.name || "بدون مسئول"}
          </dd>
        </div>
        {preview.after && (
          <div>
            <dt>به</dt>
            <dd>
              {versionLabel(preview.after.version)} · مرحلهٔ «{preview.after.step_title}» ·{" "}
              {preview.after.assignee?.name || "بدون مسئول"}
              {preview.after.target_text ? ` · مهلت ${preview.after.target_text}` : ""}
            </dd>
          </div>
        )}
      </dl>
      {preview.problems.length > 0 && (
        <ul className="workflow-errors" role={preview.can_migrate ? "note" : "alert"}>
          {preview.problems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {!preview.can_migrate && <p className="workflow-muted">با این انتخاب انتقال ممکن نیست.</p>}
    </div>
  );
}

function MigrationForm({
  instance,
  pending,
  onCancel,
  onSubmit,
}: {
  instance: WorkflowInstanceView;
  pending?: boolean;
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const target = instance.migration_target!;
  const [step, setStep] = useState("");
  const preview = useMigrationPreview(instance.id, target.id, step);
  return (
    <ReasonForm
      title={`انتقال به ${versionLabel(target.number)}`}
      submitLabel="انتقال به نسخهٔ جدید"
      pending={pending || preview.isLoading || !preview.data?.can_migrate}
      extra={
        <>
          <p className="workflow-muted">
            این رکورد روی {versionLabel(instance.version.number)} است. پیش از انتقال، اثر آن را بررسی کنید.
          </p>
          <SearchableSelect
            showLabel
            label="مرحلهٔ مقصد در نسخهٔ جدید"
            value={step}
            onChange={setStep}
            options={[
              { id: "", title: "همان مرحلهٔ فعلی (اگر در نسخهٔ جدید باشد)" },
              ...target.steps.map((row) => ({ id: row.code, title: row.title })),
            ]}
          />
          {preview.isLoading && <p className="workflow-muted">در حال بررسی…</p>}
          {preview.data && <MigrationSummary preview={preview.data} />}
        </>
      }
      onCancel={onCancel}
      onSubmit={(reason) =>
        onSubmit({ version: target.id, reason, ...(step ? { step_map: { [instance.current_step.code]: step } } : {}) })
      }
    />
  );
}

/** Refer to one person or to a group (any present member of an organisational role may act). */
export function ReferTargetPicker({
  mode,
  onModeChange,
  roles,
  roleId,
  onRoleChange,
  people,
}: {
  mode: "user" | "role";
  onModeChange: (mode: "user" | "role") => void;
  roles: Person[];
  roleId: string;
  onRoleChange: (role: string) => void;
  people: ReactNode;
}) {
  return (
    <>
      <SearchableSelect
        showLabel
        label="ارجاع به"
        value={mode}
        onChange={(value) => onModeChange(value as "user" | "role")}
        options={[
          { id: "user", title: "یک فرد" },
          ...(roles.length ? [{ id: "role", title: "یک گروه (هر عضو نقش می‌تواند انجام دهد)" }] : []),
        ]}
      />
      {mode === "role" ? (
        <SearchableSelect
          showLabel
          label="کدام گروه؟"
          value={roleId}
          onChange={onRoleChange}
          options={roles.map((row) => ({ id: row.id, title: row.name }))}
        />
      ) : (
        people
      )}
    </>
  );
}

type Dialog =
  | { kind: "transition"; code: string; label: string; required: boolean; refer: boolean }
  | { kind: "pause" | "resume" | "delay" | "extension" | "contact" | "to_standard" | "reassign" | "migrate" };

/** Presentational panel; ``onAction`` posts to the server, which re-checks every action. */
export function WorkflowPanelView({
  instance,
  members = [],
  roles = [],
  pending,
  onAction,
  onDecideExtension,
}: {
  instance: WorkflowInstanceView;
  members?: Person[];
  roles?: Person[];
  pending?: boolean;
  onAction: (action: InstanceAction, body: Record<string, unknown>) => void;
  onDecideExtension: (approve: boolean, reason: string) => void;
}) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [pauseKind, setPauseKind] = useState(instance.actions.pause_kinds[0] ?? "customer");
  const [target, setTarget] = useState<string[]>([]);
  const [referTo, setReferTo] = useState<"user" | "role">("user");
  const [role, setRole] = useState("");
  const [followupTitle, setFollowupTitle] = useState("");
  const run = instance.run;
  const groups = visibleActions(instance.actions);
  const send = (action: InstanceAction, body: Record<string, unknown>) => {
    onAction(action, { revision: instance.revision, ...body });
    setDialog(null);
  };
  const peoplePicker = (label: string) => (
    <CompactMultiSelector
      label={label}
      options={members.map((member) => ({ id: member.id, title: member.name }))}
      selected={target}
      onChange={(next) => setTarget(next.slice(-1))}
    />
  );
  return (
    <section className="workflow-panel" dir="rtl" aria-label="گردش‌کار">
      <header className="workflow-panel-header">
        <GitBranch size={18} aria-hidden />
        <div>
          <strong>{instance.definition.title}</strong>
          <small>
            {versionLabel(instance.version.number)}
            {instance.definition.kind === "fast_path" ? " · مسیر کوتاه" : ""}
          </small>
        </div>
        <span className={`workflow-status workflow-status-${instance.status}`}>
          {{ running: "در جریان", completed: "پایان‌یافته", cancelled: "لغوشده", error: "خطا" }[instance.status]}
        </span>
      </header>
      {instance.status === "error" && (
        <p className="workflow-error-banner" role="alert">
          <AlertTriangle size={16} aria-hidden /> {instance.error_message}
        </p>
      )}
      <ol className="workflow-steps" aria-label="مسیر">
        {instance.steps.map((step) => (
          <li key={step.code} aria-current={step.code === instance.current_step.code ? "step" : undefined}>
            {step.title}
          </li>
        ))}
      </ol>
      <dl className="workflow-facts">
        <div>
          <dt>مرحلهٔ جاری</dt>
          <dd>{instance.current_step.title}</dd>
        </div>
        {run && (
          <div>
            <dt>مسئول</dt>
            <dd>
              {run.assignee?.name ||
                (run.candidates.length ? `گروه: ${run.candidates.map((p) => p.name).join("، ")}` : "تعیین نشده")}
              {run.assignment_reason && <small> ({run.assignment_reason})</small>}
            </dd>
          </div>
        )}
        {run?.target_at && (
          <div>
            <dt>مهلت</dt>
            <dd>
              <Clock size={14} aria-hidden /> {run.target_text} <DeadlineBadges run={run} />
            </dd>
          </div>
        )}
        {run?.target_at && run.remaining_minutes !== null && !run.overdue && (
          <div>
            <dt>زمان کاری باقی‌مانده</dt>
            <dd>{formatWorkingMinutes(run.remaining_minutes)}</dd>
          </div>
        )}
        {instance.target_text && (
          <div>
            <dt>مهلت کل</dt>
            <dd>{instance.target_text}</dd>
          </div>
        )}
      </dl>
      {groups.length > 0 && (
        <div className="workflow-actions" role="group" aria-label="اقدام‌های مجاز">
          {instance.actions.transitions.map((row) => (
            <Button
              key={row.code}
              variant={row.kind === "reject" ? "danger" : row.kind === "return" ? "secondary" : "primary"}
              disabled={pending || row.blocked}
              onClick={() =>
                row.reason_required || row.kind === "refer"
                  ? setDialog({
                      kind: "transition",
                      code: row.code,
                      label: row.label,
                      required: row.reason_required || row.kind === "refer",
                      refer: row.kind === "refer",
                    })
                  : send("transition", { transition: row.code, reason: "" })
              }
            >
              {row.label}
            </Button>
          ))}
          {instance.actions.can_contact_resolve && (
            <Button variant="secondary" onClick={() => setDialog({ kind: "contact" })}>
              ثبت تماس و حل
            </Button>
          )}
          {instance.actions.can_to_standard && (
            <Button variant="secondary" onClick={() => setDialog({ kind: "to_standard" })}>
              انتقال به مسیر عادی
            </Button>
          )}
          {instance.actions.can_pause && (
            <Button variant="secondary" onClick={() => setDialog({ kind: "pause" })}>
              توقف
            </Button>
          )}
          {instance.actions.can_resume && (
            <Button variant="secondary" onClick={() => setDialog({ kind: "resume" })}>
              ازسرگیری
            </Button>
          )}
          {instance.actions.can_report_delay && (
            <Button variant="secondary" onClick={() => setDialog({ kind: "delay" })}>
              گزارش دیرکرد
            </Button>
          )}
          {instance.actions.can_request_extension && (
            <Button variant="ghost" onClick={() => setDialog({ kind: "extension" })}>
              درخواست تمدید
            </Button>
          )}
          {instance.actions.can_reassign && (
            <Button variant="ghost" onClick={() => setDialog({ kind: "reassign" })}>
              ارجاع مدیریتی
            </Button>
          )}
          {instance.actions.can_migrate && instance.migration_target && (
            <Button variant="ghost" onClick={() => setDialog({ kind: "migrate" })}>
              انتقال به {versionLabel(instance.migration_target.number)}
            </Button>
          )}
        </div>
      )}
      {instance.actions.transitions.some((row) => row.blocked) && (
        <p className="workflow-muted" role="note">
          این مرحله از مهلت گذشته است؛ پیش از ادامه، گزارش دیرکرد را ثبت کنید.
        </p>
      )}
      {dialog?.kind === "transition" && (
        <ReasonForm
          title={dialog.label}
          required={dialog.required}
          submitLabel={dialog.label}
          pending={pending}
          extra={
            dialog.refer ? (
              <ReferTargetPicker
                mode={referTo}
                onModeChange={setReferTo}
                roles={roles}
                roleId={role}
                onRoleChange={setRole}
                people={peoplePicker("کدام فرد؟")}
              />
            ) : undefined
          }
          onCancel={() => setDialog(null)}
          onSubmit={(reason) =>
            send("transition", {
              transition: dialog.code,
              reason,
              ...(dialog.refer ? (referTo === "role" ? { role } : { user: target[0] }) : {}),
            })
          }
        />
      )}
      {dialog?.kind === "pause" && (
        <ReasonForm
          title="توقف مرحله"
          submitLabel="ثبت توقف"
          pending={pending}
          extra={
            <SearchableSelect
              label="نوع توقف"
              value={pauseKind}
              onChange={(value) => setPauseKind(value as typeof pauseKind)}
              options={instance.actions.pause_kinds.map((kind) => ({
                id: kind,
                title: kind === "customer" ? "در انتظار پاسخ مشتری" : "توقف رسمی",
              }))}
            />
          }
          onCancel={() => setDialog(null)}
          onSubmit={(reason) => send("pause", { kind: pauseKind, reason })}
        />
      )}
      {dialog?.kind === "resume" && (
        <ReasonForm
          title="ازسرگیری مرحله"
          submitLabel="ازسرگیری"
          pending={pending}
          onCancel={() => setDialog(null)}
          onSubmit={(reason) => send("resume", { reason })}
        />
      )}
      {dialog?.kind === "reassign" && (
        <ReasonForm
          title="ارجاع مدیریتی"
          submitLabel="ثبت ارجاع"
          pending={pending}
          extra={peoplePicker("مسئول جایگزین")}
          onCancel={() => setDialog(null)}
          onSubmit={(reason) => send("reassign", { user: target[0], reason })}
        />
      )}
      {dialog?.kind === "to_standard" && (
        <ReasonForm
          title="انتقال به مسیر عادی"
          submitLabel="انتقال"
          pending={pending}
          extra={
            <>
              <Field label="عنوان کار پیگیری (اختیاری)">
                <input value={followupTitle} onChange={(event) => setFollowupTitle(event.target.value)} />
              </Field>
              {followupTitle.trim() && peoplePicker("مسئول کار پیگیری")}
            </>
          }
          onCancel={() => setDialog(null)}
          onSubmit={(reason) =>
            send("to-standard", {
              reason,
              ...(followupTitle.trim() ? { followup: { title: followupTitle.trim(), assignee: target[0] } } : {}),
            })
          }
        />
      )}
      {dialog?.kind === "migrate" && instance.migration_target && (
        <MigrationForm
          instance={instance}
          pending={pending}
          onCancel={() => setDialog(null)}
          onSubmit={(body) => send("migrate", body)}
        />
      )}
      {dialog?.kind === "delay" && (
        <DelayReportForm
          pending={pending}
          onCancel={() => setDialog(null)}
          onSubmit={(body) => send("delay-report", body)}
        />
      )}
      {dialog?.kind === "extension" && run && (
        <ExtensionForm
          current={run.target_at}
          currentText={run.target_text}
          pending={pending}
          onCancel={() => setDialog(null)}
          onSubmit={(body) => send("extension", body)}
        />
      )}
      {dialog?.kind === "contact" && (
        <ContactResolveForm
          channels={instance.contact_channels}
          pending={pending}
          onCancel={() => setDialog(null)}
          onSubmit={(body) => send("contact-resolve", body)}
        />
      )}
      {instance.pending_extension && instance.actions.can_decide_extension && (
        <ExtensionDecisionForm extension={instance.pending_extension} pending={pending} onDecide={onDecideExtension} />
      )}
      {instance.pending_extension && !instance.actions.can_decide_extension && (
        <p className="workflow-muted">
          درخواست تمدید تا {instance.pending_extension.requested_target_text} در انتظار تأیید مدیر مستقیم است.
        </p>
      )}
      <details className="workflow-history" open>
        <summary>سابقهٔ گردش‌کار</summary>
        <WorkflowTimeline entries={instance.timeline} steps={instance.steps} />
      </details>
    </section>
  );
}

export function WorkflowPanel({ code, id }: { code: string; id: string }) {
  const query = useRecordWorkflow(code, id);
  const meta = useWorkflowMeta();
  const action = useWorkflowAction();
  const decide = useDecideExtension();
  const start = useStartWorkflow();
  if (query.isLoading || query.error || !query.data) return null;
  const instance = query.data.instance;
  if (!instance) {
    if (!query.data.can_start) return null;
    return (
      <section className="workflow-panel" dir="rtl" aria-label="گردش‌کار">
        <p>برای این رکورد گردش‌کار منتشرشده‌ای وجود دارد اما هنوز شروع نشده است.</p>
        <Button disabled={start.isPending} onClick={() => start.mutate({ entity: code, recordId: id })}>
          شروع گردش‌کار
        </Button>
      </section>
    );
  }
  return (
    <WorkflowPanelView
      instance={instance}
      members={meta.data?.members}
      roles={meta.data?.roles}
      pending={action.isPending || decide.isPending}
      onAction={(name, body) => action.mutate({ instanceId: instance.id, action: name, body })}
      onDecideExtension={(approve, reason) =>
        instance.pending_extension &&
        decide.mutate({ id: instance.pending_extension.id, approve, reason, revision: instance.revision })
      }
    />
  );
}
