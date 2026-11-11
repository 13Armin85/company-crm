/** Workflow designer of one record type: ordered steps and transitions, check, dry run and publish. */
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { CompactMultiSelector, SearchableSelect } from "@plane/ui";
import { CheckCircle2, FlaskConical, Plus, Send, Trash2 } from "lucide-react";
import {
  useCreateWorkflow,
  useNewWorkflowDraft,
  usePublishWorkflow,
  useSaveWorkflowDraft,
  useSimulateWorkflow,
  useUpdateWorkflow,
  useValidateWorkflow,
  useWorkflowDefinitions,
  useWorkflowMeta,
} from "../api/workflow";
import type {
  SimulatedStep,
  ValidationIssue,
  WorkflowDefinition,
  WorkflowGraph,
  WorkflowMeta,
  WorkflowStep,
  WorkflowTransition,
} from "../api/workflow";
import { Button, EmptyState, Skeleton } from "../components";
import { useWorkspaceAccess } from "../api";
import { useEngineDefinitions } from "../engine/api";
import type { FieldDefinition, LookupOptionDefinition } from "../engine/api";
import { ConditionEditor } from "../engine/rule-editors";
import {
  STEP_TYPE_LABELS,
  generalIssues,
  issuesForStep,
  issuesForTransition,
  joinMinutes,
  localIssues,
  newStep,
  newTransition,
  orderedPath,
  removeStep,
  renameStep,
  splitMinutes,
  versionLabel,
} from "./model";

function IssueList({ issues }: { issues: ValidationIssue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="workflow-errors" role="alert">
      {issues.map((issue) => (
        <li key={`${issue.step}|${issue.transition}|${issue.message}`}>{issue.message}</li>
      ))}
    </ul>
  );
}

/** Route map: steps in order with their outgoing transitions. Interactive when onSelect is given. */
export function PathPreview({
  graph,
  selected,
  issues = [],
  onSelect,
}: {
  graph: WorkflowGraph;
  selected?: string;
  issues?: ValidationIssue[];
  onSelect?: (code: string) => void;
}) {
  const steps = orderedPath(graph);
  return (
    <ol className={`workflow-path${onSelect ? " is-interactive" : ""}`} aria-label="نمای مسیر">
      {steps.map((step, index) => {
        const outgoing = graph.transitions
          .filter((row) => row.from === step.code)
          .map((row) => `${row.label || row.code} ← ${graph.steps.find((s) => s.code === row.to)?.title || row.to}`)
          .join(" · ");
        const problems = issuesForStep(issues, step.code).length;
        const body = (
          <>
            <span className="workflow-path-index" aria-hidden="true">
              {(index + 1).toLocaleString("fa-IR")}
            </span>
            <span className="workflow-path-text">
              <strong>{step.title || step.code}</strong>
              <small>{STEP_TYPE_LABELS[step.type]}</small>
              <span>{outgoing}</span>
            </span>
            {problems > 0 && (
              <b className="workflow-path-issues" aria-label={`${problems.toLocaleString("fa-IR")} مشکل`}>
                {problems.toLocaleString("fa-IR")}
              </b>
            )}
          </>
        );
        return (
          <li key={step.code} className={`workflow-path-${step.type}${selected === step.code ? " is-selected" : ""}`}>
            {onSelect ? (
              <button type="button" aria-pressed={selected === step.code} onClick={() => onSelect(step.code)}>
                {body}
              </button>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function SimulationResult({ path }: { path: SimulatedStep[] }) {
  return (
    <table className="workflow-simulation" aria-label="نتیجهٔ آزمایش">
      <thead>
        <tr>
          <th>مرحله</th>
          <th>مسئول</th>
          <th>مهلت</th>
          <th>انتقال</th>
        </tr>
      </thead>
      <tbody>
        {path.map((row) => (
          <tr key={`${row.step}-${row.entered_at}`}>
            <td>{row.title}</td>
            <td>
              {row.error ? (
                <span className="workflow-error-text">{row.error}</span>
              ) : (
                row.assignee?.name || (row.candidates.length ? row.candidates.map((p) => p.name).join("، ") : "—")
              )}
              {row.assignment_reason && <small> ({row.assignment_reason})</small>}
            </td>
            <td>{row.target_text || "—"}</td>
            <td>{row.transition ? `${row.transition.label}${row.transition.auto ? " (خودکار)" : ""}` : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Plain-language description of who handles a step. */
function assigneeText(step: WorkflowStep, meta: WorkflowMeta) {
  const rule = step.assignee;
  if (rule.type === "user")
    return meta.members.find((row) => row.id === rule.user_id)?.name || "یک کاربر (انتخاب نشده)";
  if (rule.type === "role") return `نقش ${meta.roles.find((row) => row.id === rule.role_id)?.name || "(انتخاب نشده)"}`;
  if (rule.type === "record_field")
    return (meta.fields || []).find((row) => row.code === rule.field)?.title || "کاربرِ ثبت‌شده در فرم";
  return meta.assignee_types[rule.type] || "—";
}

/** "۲ ساعت و ۳۰ دقیقه" or "بدون مهلت". */
function durationText(total?: number | null) {
  const { hours, minutes } = splitMinutes(total);
  if (!hours && !minutes) return "بدون مهلت";
  const parts = [
    hours ? `${hours.toLocaleString("fa-IR")} ساعت` : "",
    minutes ? `${minutes.toLocaleString("fa-IR")} دقیقه` : "",
  ];
  return `${parts.filter(Boolean).join(" و ")} کاری`;
}

function Advanced({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="workflow-more">
      <summary>{summary}</summary>
      <div className="workflow-more-body">{children}</div>
    </details>
  );
}

export function StepEditor({
  step,
  meta,
  issues,
  readOnly,
  onChange,
  onRename,
  onRemove,
}: {
  step: WorkflowStep;
  meta: WorkflowMeta;
  issues: ValidationIssue[];
  readOnly: boolean;
  onChange: (next: WorkflowStep) => void;
  onRename: (code: string) => void;
  onRemove: () => void;
}) {
  const fields = (meta.fields || []).map((field) => ({ id: field.code, title: field.title }));
  const duration = splitMinutes(step.target_minutes);
  const set = (patch: Partial<WorkflowStep>) => onChange({ ...step, ...patch });
  return (
    <fieldset className="workflow-step-editor" disabled={readOnly} aria-label={`مرحلهٔ ${step.title}`}>
      <legend className="sr-only">ویرایش مرحلهٔ {step.title || step.code}</legend>
      <IssueList issues={issues} />
      <div className="workflow-row">
        <label className="workflow-field">
          <span>نام مرحله</span>
          <input value={step.title} onChange={(event) => set({ title: event.target.value })} />
        </label>
        <SearchableSelect
          showLabel
          label="نوع مرحله"
          value={step.type}
          onChange={(type) => set({ type: type as WorkflowStep["type"] })}
          options={Object.entries(meta.step_types).map(([id, title]) => ({ id, title }))}
        />
      </div>
      {step.type !== "end" && (
        <>
          <div className="workflow-row">
            <SearchableSelect
              showLabel
              label="چه کسی این مرحله را انجام می‌دهد؟"
              value={step.assignee.type}
              onChange={(type) => set({ assignee: { type: type as WorkflowStep["assignee"]["type"] } })}
              options={Object.entries(meta.assignee_types).map(([id, title]) => ({ id, title }))}
            />
            {step.assignee.type === "user" && (
              <SearchableSelect
                showLabel
                label="کدام کاربر؟"
                value={step.assignee.user_id || ""}
                onChange={(user_id) => set({ assignee: { ...step.assignee, user_id } })}
                options={meta.members.map((row) => ({ id: row.id, title: row.name }))}
              />
            )}
            {step.assignee.type === "role" && (
              <SearchableSelect
                showLabel
                label="کدام نقش؟"
                value={step.assignee.role_id || ""}
                onChange={(role_id) => set({ assignee: { ...step.assignee, role_id } })}
                options={meta.roles.map((row) => ({ id: row.id, title: row.name }))}
              />
            )}
            {step.assignee.type === "record_field" && (
              <SearchableSelect
                showLabel
                label="کدام فیلد فرم؟"
                value={step.assignee.field || ""}
                onChange={(field) => set({ assignee: { ...step.assignee, field } })}
                options={(meta.fields || [])
                  .filter((field) => field.kind === "user")
                  .map((field) => ({ id: field.code, title: field.title }))}
              />
            )}
          </div>
          <div className="workflow-duration" role="group" aria-label="مهلت انجام">
            <span>چقدر وقت دارد؟</span>
            <label className="workflow-field">
              <input
                type="number"
                min={0}
                aria-label="ساعت کاری"
                value={duration.hours}
                onChange={(event) => set({ target_minutes: joinMinutes(Number(event.target.value), duration.minutes) })}
              />
              <small>ساعت کاری</small>
            </label>
            <label className="workflow-field">
              <input
                type="number"
                min={0}
                max={59}
                aria-label="دقیقه"
                value={duration.minutes}
                onChange={(event) => set({ target_minutes: joinMinutes(duration.hours, Number(event.target.value)) })}
              />
              <small>دقیقه</small>
            </label>
            <small className="workflow-muted">صفر یعنی بدون مهلت.</small>
          </div>
        </>
      )}
      <label className="workflow-field">
        <span>راهنما برای انجام‌دهنده (اختیاری)</span>
        <input
          value={step.help || ""}
          placeholder="مثلاً: مدارک را بررسی و نتیجه را ثبت کنید"
          onChange={(event) => set({ help: event.target.value })}
        />
      </label>
      <Advanced summary="تنظیمات بیشتر این مرحله">
        <div className="workflow-row">
          <label className="workflow-field">
            <span>کد مرحله (انگلیسی)</span>
            <input
              value={step.code}
              dir="ltr"
              onChange={(event) => onRename(event.target.value.replace(/[^\w-]/g, ""))}
            />
          </label>
          <SearchableSelect
            showLabel
            label="وضعیت رکورد در این مرحله"
            value={step.status_code}
            onChange={(status_code) => set({ status_code })}
            options={(meta.statuses || []).map((row) => ({ id: row.code, title: row.title }))}
          />
          {step.type !== "end" && (
            <SearchableSelect
              showLabel
              label="اگر انجام‌دهنده غایب بود"
              value={step.absence_policy || "delegate"}
              onChange={(absence_policy) => set({ absence_policy: absence_policy as "delegate" | "keep" })}
              options={[
                { id: "delegate", title: "جانشین فعال جایگزین شود" },
                { id: "keep", title: "همان مسئول بماند" },
              ]}
            />
          )}
        </div>
        {step.type !== "end" && (
          <>
            <div className="workflow-row">
              <SearchableSelect
                showLabel
                label="یادآوری نزدیک موعد"
                value={step.reminder?.type || ""}
                onChange={(type) =>
                  set({
                    reminder: type ? { type: type as "percent" | "minutes", value: step.reminder?.value || 80 } : null,
                  })
                }
                options={[
                  { id: "", title: "بدون یادآوری" },
                  { id: "percent", title: "پس از گذشت درصدی از مدت" },
                  { id: "minutes", title: "چند دقیقهٔ کاری مانده به موعد" },
                ]}
              />
              {step.reminder && (
                <label className="workflow-field">
                  <span>{step.reminder.type === "percent" ? "درصد" : "دقیقه"}</span>
                  <input
                    type="number"
                    min={1}
                    value={step.reminder.value}
                    onChange={(event) => set({ reminder: { ...step.reminder!, value: Number(event.target.value) } })}
                  />
                </label>
              )}
            </div>
            <div className="workflow-checks">
              {Object.entries(meta.pause_kinds).map(([kind, title]) => (
                <label key={kind} className="workflow-check">
                  <input
                    type="checkbox"
                    checked={Boolean(step.pause?.[kind as "customer" | "formal"])}
                    onChange={(event) => set({ pause: { ...step.pause, [kind]: event.target.checked } })}
                  />
                  اجازهٔ «{title}» (زمان متوقف می‌شود)
                </label>
              ))}
            </div>
            <CompactMultiSelector
              label="فیلدهایی که باید پیش از ادامه پر شوند"
              options={fields}
              selected={step.required_fields || []}
              onChange={(required_fields) => set({ required_fields })}
            />
            <label className="workflow-check">
              <input
                type="checkbox"
                checked={Boolean(step.lock_fields)}
                onChange={(event) => set({ lock_fields: event.target.checked })}
              />
              در این مرحله فقط فیلدهای انتخاب‌شده قابل ویرایش باشند
            </label>
            {step.lock_fields && (
              <CompactMultiSelector
                label="فیلدهای قابل ویرایش"
                options={fields}
                selected={step.editable_fields || []}
                onChange={(editable_fields) => set({ editable_fields })}
              />
            )}
          </>
        )}
      </Advanced>
      {!readOnly && (
        <div className="workflow-editor-foot">
          <Button variant="ghost" icon={Trash2} onClick={onRemove}>
            حذف این مرحله
          </Button>
        </div>
      )}
    </fieldset>
  );
}

export function TransitionEditor({
  row,
  graph,
  meta,
  fields,
  lookupValues,
  issues,
  readOnly,
  onChange,
  onRemove,
}: {
  row: WorkflowTransition;
  graph: WorkflowGraph;
  meta: WorkflowMeta;
  fields: FieldDefinition[];
  lookupValues: LookupOptionDefinition[];
  issues: ValidationIssue[];
  readOnly: boolean;
  onChange: (next: WorkflowTransition) => void;
  onRemove: () => void;
}) {
  const steps = graph.steps.map((step) => ({ id: step.code, title: step.title || step.code }));
  const set = (patch: Partial<WorkflowTransition>) => onChange({ ...row, ...patch });
  const reasonForced = row.kind === "reject" || row.kind === "return";
  return (
    <fieldset
      className={`workflow-transition-editor is-${row.kind}`}
      disabled={readOnly}
      aria-label={`دکمهٔ ${row.label}`}
    >
      <legend className="sr-only">دکمهٔ {row.label || row.code}</legend>
      <IssueList issues={issues} />
      <div className="workflow-button-line">
        <label className="workflow-field">
          <span>متن دکمه</span>
          <input value={row.label} placeholder="مثلاً: تأیید" onChange={(event) => set({ label: event.target.value })} />
        </label>
        <span className="workflow-button-arrow" aria-hidden="true">
          ←
        </span>
        <SearchableSelect
          showLabel
          label="کار به کدام مرحله برود؟"
          value={row.to}
          onChange={(to) => set({ to })}
          options={steps}
        />
        <SearchableSelect
          showLabel
          label="معنی این دکمه"
          value={row.kind}
          onChange={(kind) => set({ kind: kind as WorkflowTransition["kind"] })}
          options={Object.entries(meta.transition_kinds).map(([id, title]) => ({ id, title }))}
        />
        {!readOnly && (
          <button
            type="button"
            className="workflow-icon-remove"
            aria-label={`حذف دکمهٔ ${row.label}`}
            title="حذف دکمه"
            onClick={onRemove}
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      <Advanced summary="شرط و تنظیمات بیشتر این دکمه">
        <div className="workflow-row">
          <SearchableSelect
            showLabel
            label="از مرحلهٔ"
            value={row.from}
            onChange={(from) => set({ from })}
            options={steps}
          />
        </div>
        <div className="workflow-checks">
          <label className="workflow-check">
            <input
              type="checkbox"
              checked={reasonForced || Boolean(row.reason_required)}
              disabled={reasonForced}
              onChange={(event) => set({ reason_required: event.target.checked })}
            />
            نوشتن دلیل الزامی است
          </label>
          <label className="workflow-check">
            <input
              type="checkbox"
              checked={Boolean(row.auto)}
              disabled={reasonForced}
              onChange={(event) => set({ auto: event.target.checked })}
            />
            خودکار انجام شود (وقتی شرط برقرار است)
          </label>
        </div>
        <ConditionEditor
          label="فقط وقتی نمایش داده شود که…"
          description="بدون شرط، این دکمه همیشه در دسترس است."
          value={row.condition ?? null}
          fields={fields}
          lookupValues={lookupValues}
          onChange={(condition) => set({ condition })}
        />
      </Advanced>
    </fieldset>
  );
}

function CreateWorkflowForm({
  entity,
  meta,
  onCreated,
}: {
  entity: string;
  meta: WorkflowMeta;
  onCreated: (id: string) => void;
}) {
  const create = useCreateWorkflow();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("standard");
  const [subtype, setSubtype] = useState("");
  const subtypes = meta.entities.find((row) => row.code === entity)?.subtypes || [];
  const [managerClose, setManagerClose] = useState(false);
  return (
    <form
      className="workflow-form"
      aria-label="گردش‌کار جدید"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!title.trim()) return;
        const created = await create.mutateAsync({
          entity,
          title: title.trim(),
          kind,
          ...(subtype ? { subtype } : {}),
          settings: kind === "fast_path" ? { require_manager_close: managerClose } : {},
        });
        onCreated(created.id);
        setTitle("");
      }}
    >
      <div className="workflow-row">
        <label className="workflow-field">
          <span>نام گردش‌کار</span>
          <input
            value={title}
            placeholder="مثلاً: تأیید درخواست خرید"
            onChange={(event) => setTitle(event.target.value)}
            required
          />
        </label>
        <SearchableSelect
          showLabel
          label="نوع"
          value={kind}
          onChange={setKind}
          options={[
            { id: "standard", title: "مسیر عادی" },
            ...(entity === "ticket" ? [{ id: "fast_path", title: "مسیر کوتاه (ثبت ← رسیدگی ← حل)" }] : []),
          ]}
        />
        {subtypes.length > 0 && (
          <SearchableSelect
            showLabel
            label="برای کدام نوع کار؟"
            value={subtype}
            onChange={setSubtype}
            options={[{ id: "", title: "همهٔ انواع" }, ...subtypes.map((row) => ({ id: row.code, title: row.title }))]}
          />
        )}
      </div>
      {kind === "fast_path" && (
        <label className="workflow-check">
          <input type="checkbox" checked={managerClose} onChange={(event) => setManagerClose(event.target.checked)} />
          بستن تیکت با تأیید مدیر مستقیم
        </label>
      )}
      <Button type="submit" icon={Plus} disabled={create.isPending}>
        ساخت گردش‌کار
      </Button>
    </form>
  );
}

/** Definition-level settings: on/off, overall deadline and whose record this is. */
export function DefinitionSettings({
  definition,
  meta,
  readOnly,
  pending,
  onSave,
}: {
  definition: WorkflowDefinition;
  meta: WorkflowMeta;
  readOnly: boolean;
  pending?: boolean;
  onSave: (body: { is_active: boolean; settings: Record<string, unknown> }) => void;
}) {
  const [active, setActive] = useState(definition.is_active);
  const [total, setTotal] = useState(splitMinutes(definition.settings.instance_target_minutes));
  const [subjectField, setSubjectField] = useState(definition.settings.subject_field || "");
  const [managerClose, setManagerClose] = useState(Boolean(definition.settings.require_manager_close));
  const userFields = (meta.fields || []).filter((field) => field.kind === "user");
  const minutes = joinMinutes(total.hours, total.minutes);
  return (
    <form
      className="workflow-settings"
      aria-label="تنظیمات گردش‌کار"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          is_active: active,
          settings: {
            instance_target_minutes: minutes || null,
            subject_field: subjectField || null,
            ...(definition.kind === "fast_path" ? { require_manager_close: managerClose } : {}),
          },
        });
      }}
    >
      <fieldset disabled={readOnly}>
        <label className="workflow-check">
          <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
          فعال: رکوردهای جدید این بخش خودکار با این گردش‌کار شروع شوند
        </label>
        <div className="workflow-duration" role="group" aria-label="مهلت کل">
          <span>مهلت کل کار (از ثبت تا پایان)</span>
          <label className="workflow-field">
            <input
              type="number"
              min={0}
              aria-label="ساعت کاری کل"
              value={total.hours}
              onChange={(event) => setTotal({ ...total, hours: Number(event.target.value) })}
            />
            <small>ساعت کاری</small>
          </label>
          <label className="workflow-field">
            <input
              type="number"
              min={0}
              max={59}
              aria-label="دقیقهٔ کل"
              value={total.minutes}
              onChange={(event) => setTotal({ ...total, minutes: Number(event.target.value) })}
            />
            <small>دقیقه</small>
          </label>
          <small className="workflow-muted">صفر یعنی بدون مهلت کل.</small>
        </div>
        {userFields.length > 0 && (
          <SearchableSelect
            showLabel
            label="«فرد رکورد» کیست؟ (برای مدیر مستقیم و مسئول)"
            value={subjectField}
            onChange={setSubjectField}
            options={[
              { id: "", title: "ثبت‌کنندهٔ رکورد" },
              ...userFields.map((field) => ({ id: field.code, title: `فیلد «${field.title}»` })),
            ]}
          />
        )}
        {definition.kind === "fast_path" && (
          <label className="workflow-check">
            <input type="checkbox" checked={managerClose} onChange={(event) => setManagerClose(event.target.checked)} />
            بستن تیکت با تأیید مدیر مستقیم
          </label>
        )}
        {!readOnly && (
          <Button type="submit" variant="secondary" disabled={pending}>
            ذخیرهٔ تنظیمات
          </Button>
        )}
      </fieldset>
    </form>
  );
}

function DefinitionEditor({
  definition,
  meta,
  canDesign,
  canPublish,
}: {
  definition: WorkflowDefinition;
  meta: WorkflowMeta;
  canDesign: boolean;
  canPublish: boolean;
}) {
  const versions = definition.versions;
  const draft = versions.find((row) => row.status === "draft");
  const published = versions.find((row) => row.status === "published");
  const [versionId, setVersionId] = useState((draft || published || versions[0]).id);
  const version = versions.find((row) => row.id === versionId) || versions[0];
  const [graph, setGraph] = useState<WorkflowGraph>(version.graph);
  const [issues, setIssues] = useState<ValidationIssue[] | null>(null);
  const [path, setPath] = useState<SimulatedStep[] | null>(null);
  const [sampleSubject, setSampleSubject] = useState("");
  const [openCode, setOpenCode] = useState("");
  const save = useSaveWorkflowDraft();
  const validate = useValidateWorkflow();
  const simulate = useSimulateWorkflow();
  const publish = usePublishWorkflow();
  const newDraft = useNewWorkflowDraft();
  const update = useUpdateWorkflow();
  const { data: allFields = [] } = useEngineDefinitions<FieldDefinition>("fields");
  const { data: lookupValues = [] } = useEngineDefinitions<LookupOptionDefinition>("values");
  useEffect(() => {
    setGraph(version.graph);
    setIssues(null);
    setPath(null);
  }, [version.id]);
  const readOnly = !version.is_editable || !canDesign;
  const conditionFields = useMemo(
    () => allFields.filter((field) => (meta.fields || []).some((row) => row.code === field.code)),
    [allFields, meta.fields]
  );
  const shown = issues ?? localIssues(graph);
  const ordered = orderedPath(graph);
  const stepCodes = new Set(graph.steps.map((row) => row.code));
  const orphans = graph.transitions.map((row, index) => ({ row, index })).filter(({ row }) => !stepCodes.has(row.from));
  const statusLabel = { draft: "پیش‌نویس", published: "منتشرشده", retired: "بازنشسته" }[version.status];
  const titleOf = (code: string) => graph.steps.find((row) => row.code === code)?.title || code;
  const run = async (kind: "validate" | "simulate" | "publish") => {
    if (!readOnly) await save.mutateAsync({ id: version.id, graph });
    if (kind === "validate") setIssues((await validate.mutateAsync({ id: version.id, graph })).issues);
    if (kind === "simulate") {
      const result = await simulate.mutateAsync({
        id: version.id,
        graph,
        values: {},
        subject: sampleSubject || undefined,
      });
      setIssues(result.issues);
      setPath(result.path);
    }
    if (kind === "publish") {
      const report = await validate.mutateAsync({ id: version.id, graph });
      setIssues(report.issues);
      if (report.valid) await publish.mutateAsync({ id: version.id });
    }
  };
  const renderTransition = ({ row, index }: { row: WorkflowTransition; index: number }) => (
    <TransitionEditor
      key={`${row.code}-${index}`}
      row={row}
      graph={graph}
      meta={meta}
      fields={conditionFields}
      lookupValues={lookupValues}
      readOnly={readOnly}
      issues={issuesForTransition(shown, row.code)}
      onChange={(next) =>
        setGraph({ ...graph, transitions: graph.transitions.map((item, i) => (i === index ? next : item)) })
      }
      onRemove={() => setGraph({ ...graph, transitions: graph.transitions.filter((_, i) => i !== index) })}
    />
  );
  return (
    <section className="workflow-definition" aria-label={definition.title}>
      <header className="workflow-definition-header">
        <div className="workflow-definition-title">
          <strong>{definition.title}</strong>
          <span className="workflow-definition-meta">
            <span className={`workflow-version-chip is-${version.status}`}>{statusLabel}</span>
            <span>{definition.kind === "fast_path" ? "مسیر کوتاه" : "مسیر عادی"}</span>
            <span className={`workflow-version-chip is-${definition.is_active ? "published" : "retired"}`}>
              {definition.is_active ? "فعال" : "غیرفعال"}
            </span>
          </span>
        </div>
        <div className="workflow-definition-actions">
          {!readOnly && (
            <Button
              variant="secondary"
              disabled={save.isPending}
              onClick={() => void save.mutate({ id: version.id, graph })}
            >
              ذخیرهٔ پیش‌نویس
            </Button>
          )}
          {version.is_editable && canPublish && (
            <Button icon={Send} disabled={publish.isPending} onClick={() => void run("publish")}>
              انتشار برای همه
            </Button>
          )}
        </div>
      </header>
      <p className="workflow-intro">
        هر کارت یک مرحله از کار است: چه کسی آن را انجام می‌دهد، چقدر وقت دارد و با کدام دکمه کار به مرحلهٔ بعد می‌رود. برای
        تغییر هر مرحله روی «ویرایش» بزنید.
      </p>
      {!version.is_editable && (
        <p className="workflow-note" role="note">
          این نسخه {version.status === "published" ? "منتشر شده" : "بازنشسته است"} و فقط قابل مشاهده است. کارهای در
          جریان روی همین نسخه ادامه می‌دهند.
          {canDesign && !draft && (
            <Button
              variant="secondary"
              disabled={newDraft.isPending}
              onClick={async () => setVersionId((await newDraft.mutateAsync(definition.id)).id)}
            >
              ساخت نسخهٔ جدید برای ویرایش
            </Button>
          )}
        </p>
      )}
      <IssueList issues={generalIssues(shown)} />
      {issues && issues.length === 0 && (
        <p className="workflow-ok" role="status">
          همه‌چیز درست است؛ مشکلی پیدا نشد.
        </p>
      )}

      <ol className="workflow-flow" aria-label="مرحله‌های کار">
        {ordered.map((step, position) => {
          const open = openCode === step.code;
          const problems = issuesForStep(shown, step.code);
          const outgoing = graph.transitions
            .map((row, index) => ({ row, index }))
            .filter(({ row }) => row.from === step.code);
          return (
            <li
              key={`step-${graph.steps.indexOf(step)}`}
              className={`workflow-card is-${step.type}${open ? " is-open" : ""}`}
            >
              <div className="workflow-card-summary">
                <span className="workflow-card-number" aria-hidden="true">
                  {step.type === "end" ? <CheckCircle2 size={18} /> : (position + 1).toLocaleString("fa-IR")}
                </span>
                <div className="workflow-card-text">
                  <h4>
                    {step.title || step.code}
                    <span className={`workflow-type-chip is-${step.type}`}>{STEP_TYPE_LABELS[step.type]}</span>
                    {problems.length > 0 && (
                      <span className="workflow-card-problem">{problems.length.toLocaleString("fa-IR")} مشکل</span>
                    )}
                  </h4>
                  {step.type === "end" ? (
                    <p>کار در این مرحله تمام می‌شود.</p>
                  ) : (
                    <dl>
                      <div>
                        <dt>چه کسی</dt>
                        <dd>{assigneeText(step, meta)}</dd>
                      </div>
                      <div>
                        <dt>مهلت</dt>
                        <dd>{durationText(step.target_minutes)}</dd>
                      </div>
                    </dl>
                  )}
                  {outgoing.length > 0 && (
                    <ul className="workflow-card-buttons" aria-label="دکمه‌های این مرحله">
                      {outgoing.map(({ row }) => (
                        <li key={row.code} className={`is-${row.kind}`}>
                          <b>{row.label || row.code}</b>
                          <span>← {titleOf(row.to)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <button
                  type="button"
                  className="workflow-card-toggle"
                  aria-expanded={open}
                  onClick={() => setOpenCode(open ? "" : step.code)}
                >
                  {open ? "بستن" : readOnly ? "جزئیات" : "ویرایش"}
                </button>
              </div>
              {open && (
                <div className="workflow-card-body">
                  <StepEditor
                    step={step}
                    meta={meta}
                    readOnly={readOnly}
                    issues={problems}
                    onChange={(next) =>
                      setGraph({ ...graph, steps: graph.steps.map((row) => (row.code === step.code ? next : row)) })
                    }
                    onRename={(code) => {
                      if (!code) return;
                      setGraph(renameStep(graph, step.code, code));
                      setOpenCode(code);
                    }}
                    onRemove={() => {
                      setGraph(removeStep(graph, step.code));
                      setOpenCode("");
                    }}
                  />
                  {step.type !== "end" && (
                    <section className="workflow-buttons-editor" aria-label={`دکمه‌های ${step.title}`}>
                      <h5>بعد از این مرحله چه می‌شود؟</h5>
                      <p className="workflow-muted">
                        هر دکمه، کار را به یک مرحله می‌فرستد. مثلاً «تأیید» به مرحلهٔ بعد و «رد» به پایان.
                      </p>
                      {outgoing.map(renderTransition)}
                      {!readOnly && graph.steps.length > 1 && (
                        <Button
                          variant="secondary"
                          icon={Plus}
                          onClick={() => {
                            const next = ordered[position + 1] || graph.steps.find((row) => row.code !== step.code);
                            if (next)
                              setGraph({
                                ...graph,
                                transitions: [...graph.transitions, newTransition(graph, step.code, next.code)],
                              });
                          }}
                        >
                          افزودن دکمه
                        </Button>
                      )}
                    </section>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {!readOnly && (
        <div className="workflow-add-step">
          <span>افزودن مرحله:</span>
          {(["normal", "approval", "end"] as const).map((type) => (
            <Button
              key={type}
              variant="secondary"
              icon={Plus}
              onClick={() => {
                const created = newStep(graph, type, meta.statuses?.[0]?.code || "");
                setGraph({ ...graph, steps: [...graph.steps, created] });
                setOpenCode(created.code);
              }}
            >
              {type === "normal" ? "یک کار" : type === "approval" ? "یک تأیید" : "پایان کار"}
            </Button>
          ))}
        </div>
      )}
      {orphans.length > 0 && (
        <section className="workflow-buttons-editor workflow-orphans" aria-label="دکمه‌های بدون مرحله">
          <h5>دکمه‌هایی که مرحله‌شان حذف شده</h5>
          <p className="workflow-muted">برای هر کدام مرحلهٔ مبدأ تازه‌ای انتخاب کنید یا آن را حذف کنید.</p>
          {orphans.map(renderTransition)}
        </section>
      )}

      <details className="workflow-test" open={!definition.is_active || undefined}>
        <summary>تنظیمات گردش‌کار</summary>
        <div className="workflow-test-body">
          <DefinitionSettings
            key={`${definition.id}-${definition.is_active}-${JSON.stringify(definition.settings)}`}
            definition={definition}
            meta={meta}
            readOnly={!canDesign}
            pending={update.isPending}
            onSave={(body) => update.mutate({ id: definition.id, ...body })}
          />
        </div>
      </details>
      <details className="workflow-test">
        <summary>
          <FlaskConical size={16} aria-hidden="true" />
          امتحان و بررسی پیش از انتشار
        </summary>
        <div className="workflow-test-body">
          <p className="workflow-muted">
            «بررسی» مشکلات مسیر را پیدا می‌کند. «امتحان» نشان می‌دهد کار برای یک فرد نمونه از چه مرحله‌هایی و با چه مسئولی
            می‌گذرد؛ چیزی واقعاً ثبت نمی‌شود.
          </p>
          <div className="workflow-toolbar">
            <Button variant="secondary" icon={CheckCircle2} disabled={!canDesign} onClick={() => void run("validate")}>
              بررسی مشکلات
            </Button>
            <SearchableSelect
              showLabel
              label="فرد نمونه"
              value={sampleSubject}
              onChange={setSampleSubject}
              options={[{ id: "", title: "بدون فرد" }, ...meta.members.map((row) => ({ id: row.id, title: row.name }))]}
            />
            <Button variant="secondary" icon={FlaskConical} disabled={!canDesign} onClick={() => void run("simulate")}>
              امتحان مسیر
            </Button>
          </div>
          {path && <SimulationResult path={path} />}
        </div>
      </details>
      <details className="workflow-versions">
        <summary>نسخه‌ها</summary>
        <div className="workflow-test-body">
          <SearchableSelect
            showLabel
            label="نسخهٔ در حال نمایش"
            value={version.id}
            onChange={setVersionId}
            options={versions.map((row) => ({
              id: row.id,
              title: `${versionLabel(row.number)} · ${{ draft: "پیش‌نویس", published: "منتشرشده", retired: "بازنشسته" }[row.status]}`,
            }))}
          />
        </div>
      </details>
    </section>
  );
}

export function WorkflowDesigner({ entity }: { entity: string }) {
  const meta = useWorkflowMeta(entity);
  const definitions = useWorkflowDefinitions(entity);
  const { data: access } = useWorkspaceAccess();
  const [selected, setSelected] = useState("");
  if (meta.isLoading || definitions.isLoading) return <Skeleton rows={6} />;
  if (!meta.data || !access?.can("Workflow.View"))
    return <p role="status">برای مشاهدهٔ گردش‌کارها از مدیر سامانه دسترسی بگیرید.</p>;
  // Active first, then the standard path before the fast path, so the default selection is predictable.
  const rows = [...(definitions.data || [])].sort(
    (a, b) => Number(b.is_active) - Number(a.is_active) || Number(a.kind !== "standard") - Number(b.kind !== "standard")
  );
  const current = rows.find((row) => row.id === selected) || rows[0];
  const canDesign = access.can("Workflow.Design");
  return (
    <div className="workflow-designer" dir="rtl">
      {rows.length > 1 && (
        <nav className="workflow-definition-tabs" aria-label="گردش‌کارهای این بخش">
          {rows.map((row) => (
            <button
              type="button"
              key={row.id}
              aria-pressed={row.id === current?.id}
              className={row.id === current?.id ? "is-active" : ""}
              onClick={() => setSelected(row.id)}
            >
              {row.title}
            </button>
          ))}
        </nav>
      )}
      {current ? (
        <DefinitionEditor
          key={current.id}
          definition={current}
          meta={meta.data}
          canDesign={canDesign}
          canPublish={access.can("Workflow.Publish")}
        />
      ) : (
        <EmptyState title="هنوز گردش‌کاری ندارد" description="با «گردش‌کار جدید» مسیر مرحله‌به‌مرحلهٔ این بخش را بسازید." />
      )}
      {canDesign && (
        <details className="workflow-create" open={!current || undefined}>
          <summary>
            <Plus size={16} aria-hidden="true" />
            گردش‌کار جدید
          </summary>
          <CreateWorkflowForm entity={entity} meta={meta.data} onCreated={setSelected} />
        </details>
      )}
    </div>
  );
}
