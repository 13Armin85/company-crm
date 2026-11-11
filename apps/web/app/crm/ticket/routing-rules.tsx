/** Routing rules page (ticket 5, section 6.8): ordered rules, criteria, method, test panel, type targets. */
import { useEffect, useMemo, useState } from "react";
import { DialogTitle } from "@headlessui/react";
import { CompactMultiSelector, ModalCore, SearchableSelect } from "@plane/ui";
import { AlertTriangle, ArrowDown, ArrowUp, Edit3, FlaskConical, GripVertical, Plus, XCircle } from "lucide-react";
import {
  usePreviewRouting,
  useReorderRoutingRules,
  useRoutingRules,
  useSaveRoutingRule,
  useSetTypeTarget,
  useTicketTypes,
} from "../api/ticket";
import type { RoutingConditions, RoutingMethod, RoutingRule } from "../api/ticket";
import { errorMessage, useOrganizationRoles, useOrganizationUnits } from "../api";
import { useMembers } from "../api/workspace";
import { useProjects } from "../api/projects";
import { api, useSlug } from "../api/client";
import { useWorkflowMeta } from "../api/workflow";
import { useEngineCatalog, useEngineDefinitions } from "../engine/api";
import type { FieldDefinition, LookupOptionDefinition } from "../engine/api";
import { ConditionEditor } from "../engine/rule-editors";
import { Button, EmptyState, Skeleton } from "../components";
import { formatWorkingMinutes } from "../workflow/model";
import { METHOD_LABELS, PRIORITY_LABELS, faDigits, minutesFrom, moveRule, ruleProblems, ruleSentence } from "./model";

const EMPTY: Partial<RoutingRule> = {
  name: "",
  method: "round_robin",
  is_active: true,
  conditions: {},
  member_ids: [],
  unit_id: null,
  required_role_id: null,
  target_user_id: null,
};

function RecordPicker({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const slug = useSlug() ?? "";
  const catalog = useEngineCatalog();
  const entities = (catalog.data?.entities ?? []).filter((e) => !e.parent && e.is_active && !e.adapter);
  const [code, setCode] = useState("");
  const [options, setOptions] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    const chosen = entities.find((e) => e.code === code);
    if (!chosen) return;
    const titleField = (chosen as { title_field?: string }).title_field || "title";
    const controller = new AbortController();
    void api
      .post(
        `/api/workspaces/${slug}/engine/entities/${code}/query/`,
        { definition: { version: 1, type: "table", columns: [{ field: titleField, width: 180 }], sort: [] }, page_size: 200 },
        { signal: controller.signal }
      )
      .then((response) =>
        setOptions((response.data.results as { id: string; title: string }[]).map((row) => ({ id: row.id, title: row.title })))
      )
      .catch(() => setOptions([]));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, slug]);
  return (
    <div className="routing-rule-form">
      <SearchableSelect
        showLabel
        label="جدول مشتری/رکورد مرتبط"
        value={code}
        onChange={setCode}
        options={[{ id: "", title: "انتخاب جدول" }, ...entities.map((e) => ({ id: e.code, title: e.title }))]}
      />
      <CompactMultiSelector
        label="رکوردهای مرتبط (از ارتباط بین جداول)"
        options={[
          ...options,
          ...selected.filter((id) => !options.some((o) => o.id === id)).map((id) => ({ id, title: "رکورد انتخاب‌شده" })),
        ]}
        selected={selected}
        onChange={onChange}
      />
    </div>
  );
}

function RuleEditor({ initial, onClose }: { initial: Partial<RoutingRule>; onClose: () => void }) {
  const [rule, setRule] = useState<Partial<RoutingRule>>(initial);
  const [submitted, setSubmitted] = useState(false);
  const save = useSaveRoutingRule();
  const members = useMembers();
  const units = useOrganizationUnits();
  const roles = useOrganizationRoles();
  const projects = useProjects();
  const types = useTicketTypes();
  const meta = useWorkflowMeta("ticket");
  const { data: allFields = [] } = useEngineDefinitions<FieldDefinition>("fields");
  const { data: lookupValues = [] } = useEngineDefinitions<LookupOptionDefinition>("values");
  const conditionFields = useMemo(
    () => allFields.filter((field) => (meta.data?.fields || []).some((row) => row.code === field.code)),
    [allFields, meta.data?.fields]
  );
  const conditions: RoutingConditions = rule.conditions ?? {};
  const setConditions = (next: RoutingConditions) => setRule({ ...rule, conditions: next });
  const problems = ruleProblems(rule);
  const memberOptions = (members.data ?? []).map((m) => ({ id: m.id, title: m.displayName, description: m.email }));
  const pool = rule.method === "round_robin" || rule.method === "least_loaded";
  return (
    <ModalCore isOpen className="create-modal organization-modal" handleClose={() => !save.isPending && onClose()}>
      <form
        className="ticket-dialog"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
          if (problems.length) return;
          save.mutate(rule, { onSuccess: onClose });
        }}
      >
        <header>
          <span className="modal-kicker">قاعدهٔ ارجاع</span>
          <DialogTitle as="h2">{rule.id ? "ویرایش قاعده" : "قاعدهٔ جدید"}</DialogTitle>
        </header>
        <label>
          <span>نام قاعده</span>
          <input value={rule.name ?? ""} onChange={(event) => setRule({ ...rule, name: event.target.value })} />
        </label>
        <fieldset className="routing-rule-form">
          <legend>اگر…</legend>
          <CompactMultiSelector
            label="نوع تیکت"
            options={(types.data ?? []).map((t) => ({ id: t.id, title: t.name }))}
            selected={conditions.type_ids ?? []}
            onChange={(type_ids) => setConditions({ ...conditions, type_ids })}
          />
          <CompactMultiSelector
            label="اولویت"
            options={Object.entries(PRIORITY_LABELS).map(([id, title]) => ({ id, title }))}
            selected={conditions.priorities ?? []}
            onChange={(priorities) => setConditions({ ...conditions, priorities })}
          />
          <CompactMultiSelector
            label="پروژه"
            options={(projects.data ?? []).map((p) => ({ id: p.id, title: p.name }))}
            selected={conditions.project_ids ?? []}
            onChange={(project_ids) => setConditions({ ...conditions, project_ids })}
          />
          <CompactMultiSelector
            label="واحد درخواست‌کننده (با زیرواحدها)"
            options={(units.data ?? []).map((u) => ({ id: u.id, title: u.title }))}
            selected={conditions.unit_ids ?? []}
            onChange={(unit_ids) => setConditions({ ...conditions, unit_ids })}
          />
          <RecordPicker
            selected={conditions.customer_ids ?? []}
            onChange={(customer_ids) => setConditions({ ...conditions, customer_ids })}
          />
          <ConditionEditor
            label="شرط پیشرفته (همان زبان شرط فرم و گردش‌کار)"
            description="بدون شرط پیشرفته، فقط معیارهای بالا بررسی می‌شوند."
            value={conditions.expression ?? null}
            onChange={(expression) => setConditions({ ...conditions, expression })}
            fields={conditionFields}
            lookupValues={lookupValues}
          />
        </fieldset>
        <fieldset className="routing-rule-form">
          <legend>آنگاه به…</legend>
          <SearchableSelect
            showLabel
            label="روش انتخاب مقصد"
            value={rule.method ?? "round_robin"}
            onChange={(method) => setRule({ ...rule, method: method as RoutingMethod })}
            options={Object.entries(METHOD_LABELS).map(([id, title]) => ({ id, title }))}
          />
          {rule.method === "user" && (
            <SearchableSelect
              showLabel
              label="فرد ثابت"
              value={rule.target_user_id ?? ""}
              onChange={(target_user_id) => setRule({ ...rule, target_user_id })}
              options={memberOptions}
            />
          )}
          {pool && (
            <CompactMultiSelector
              label="اعضای نوبت (خالی = دارندگان نقش/اعضای واحد)"
              options={memberOptions}
              selected={rule.member_ids ?? []}
              onChange={(member_ids) => setRule({ ...rule, member_ids })}
            />
          )}
          {(rule.method === "manager" || rule.method === "group" || pool) && (
            <SearchableSelect
              showLabel
              label={rule.method === "group" ? "نقش گروه" : "نقش لازم"}
              value={rule.required_role_id ?? ""}
              onChange={(required_role_id) => setRule({ ...rule, required_role_id: required_role_id || null })}
              options={[{ id: "", title: "بدون نقش" }, ...(roles.data ?? []).map((r) => ({ id: r.id, title: r.name }))]}
            />
          )}
          {(rule.method === "manager" || pool) && (
            <SearchableSelect
              showLabel
              label={rule.method === "manager" ? "واحد شروع" : "واحد اعضا"}
              value={rule.unit_id ?? ""}
              onChange={(unit_id) => setRule({ ...rule, unit_id: unit_id || null })}
              options={[{ id: "", title: "بدون واحد" }, ...(units.data ?? []).map((u) => ({ id: u.id, title: u.title }))]}
            />
          )}
          <p className="ticket-hint">
            غایب‌ها (غیبت ثبت‌شده در تقویم) کنار گذاشته می‌شوند و جانشین فعالشان جایگزین می‌شود؛ اگر کسی در دسترس نباشد،
            تیکت در صف «بدون مسئول» می‌ماند و به مدیر اعلان می‌رود.
          </p>
        </fieldset>
        <label className="ticket-check">
          <input
            type="checkbox"
            checked={rule.is_active ?? true}
            onChange={(event) => setRule({ ...rule, is_active: event.target.checked })}
          />
          <span>قاعده فعال باشد</span>
        </label>
        {submitted && problems.length > 0 && (
          <ul className="ticket-errors" role="alert">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        {save.error && <p className="ticket-error-text">{errorMessage(save.error, "ذخیره انجام نشد.")}</p>}
        <footer>
          <Button variant="secondary" disabled={save.isPending} onClick={onClose}>
            انصراف
          </Button>
          <Button type="submit" disabled={save.isPending}>
            ذخیره قاعده
          </Button>
        </footer>
      </form>
    </ModalCore>
  );
}

function TestPanel() {
  const [issueId, setIssueId] = useState("");
  const preview = usePreviewRouting();
  const slug = useSlug() ?? "";
  const [tickets, setTickets] = useState<{ id: string; title: string }[]>([]);
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
        setTickets(
          (response.data.results as { id: string; title: string; number?: string }[]).map((row) => ({
            id: row.id,
            title: row.number ? `${row.number} · ${row.title}` : row.title,
          }))
        )
      )
      .catch(() => setTickets([]));
    return () => controller.abort();
  }, [slug]);
  return (
    <section className="routing-test" aria-labelledby="routing-test-title">
      <h3 id="routing-test-title">
        <FlaskConical size={16} aria-hidden /> آزمایش قاعده
      </h3>
      <form
        className="ticket-actions"
        onSubmit={(event) => {
          event.preventDefault();
          if (issueId.trim()) preview.mutate(issueId.trim());
        }}
      >
        <SearchableSelect
          showLabel
          label="تیکت نمونه"
          value={issueId}
          onChange={setIssueId}
          placeholder="یک تیکت را جستجو و انتخاب کنید"
          options={tickets}
        />
        <Button type="submit" disabled={!issueId.trim() || preview.isPending}>
          آزمایش
        </Button>
      </form>
      {preview.data && (
        <div className="ticket-preview" aria-live="polite">
          <strong>
            {preview.data.rule ? `قاعدهٔ «${preview.data.rule.name}» (${preview.data.rule.method_title})` : "هیچ قاعده‌ای منطبق نیست"}
          </strong>
          <span>{preview.data.user ? `مقصد: ${preview.data.user.name}` : "مقصد: صف بدون مسئول"}</span>
          <span>دلیل: {preview.data.reason}</span>
          {preview.data.skipped_rules.map((row) => (
            <small key={row.rule}>
              «{row.rule}» منطبق نبود: {row.failed.join("، ")}
            </small>
          ))}
        </div>
      )}
      {preview.error && <p className="ticket-error-text">{errorMessage(preview.error, "آزمایش انجام نشد.")}</p>}
    </section>
  );
}

export function TypeTargets() {
  const types = useTicketTypes();
  const save = useSetTypeTarget();
  const [editing, setEditing] = useState<{ id: string; hours: string; minutes: string; reason: string } | null>(null);
  if (types.isLoading) return <Skeleton rows={2} />;
  const rows = types.data ?? [];
  if (!rows.length || !rows[0].can_set_target) return null;
  return (
    <section className="management-section" aria-labelledby="type-target-title">
      <header className="section-heading">
        <div>
          <h2 id="type-target-title">مدت هدف پیش‌فرض انواع تیکت</h2>
          <p>به ساعت/دقیقهٔ کاری؛ مقدار هر تیکت بر این پیش‌فرض مقدم است.</p>
        </div>
      </header>
      <ul className="ticket-list">
        {rows.map((row) => (
          <li key={row.id} className="ticket-inbox-row">
            <div>
              <strong>{row.name}</strong>
              <small>{row.target_minutes ? formatWorkingMinutes(row.target_minutes) : "بدون مدت هدف"}</small>
            </div>
            {editing?.id === row.id ? (
              <form
                className="ticket-actions"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!editing.reason.trim()) return;
                  save.mutate(
                    { typeId: row.id, minutes: minutesFrom(editing.hours, editing.minutes), reason: editing.reason },
                    { onSuccess: () => setEditing(null) }
                  );
                }}
              >
                <input
                  aria-label="ساعت کاری"
                  type="number"
                  min={0}
                  value={editing.hours}
                  onChange={(e) => setEditing({ ...editing, hours: e.target.value })}
                />
                <input
                  aria-label="دقیقهٔ کاری"
                  type="number"
                  min={0}
                  max={59}
                  value={editing.minutes}
                  onChange={(e) => setEditing({ ...editing, minutes: e.target.value })}
                />
                <input
                  aria-label="دلیل تغییر"
                  placeholder="دلیل (اجباری)"
                  value={editing.reason}
                  onChange={(e) => setEditing({ ...editing, reason: e.target.value })}
                />
                <Button type="submit" disabled={!editing.reason.trim() || save.isPending}>
                  ذخیره
                </Button>
                <Button variant="secondary" onClick={() => setEditing(null)}>
                  انصراف
                </Button>
              </form>
            ) : (
              <Button
                variant="secondary"
                onClick={() =>
                  setEditing({
                    id: row.id,
                    hours: String(Math.floor((row.target_minutes ?? 0) / 60)),
                    minutes: String((row.target_minutes ?? 0) % 60),
                    reason: "",
                  })
                }
              >
                تعیین مدت هدف
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RoutingRulesManager({ canManage }: { canManage: boolean }) {
  const rules = useRoutingRules(canManage);
  const save = useSaveRoutingRule();
  const reorder = useReorderRoutingRules();
  const [editing, setEditing] = useState<Partial<RoutingRule> | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  if (!canManage) return null;
  const rows = rules.data ?? [];
  const ids = rows.map((row) => row.id);
  const shown = rows.filter((row) => !query.trim() || row.name.includes(query.trim()));
  const apply = (next: string[]) => {
    if (next.join() !== ids.join()) reorder.mutate(next);
  };
  return (
    <>
      <section className="management-section" aria-labelledby="routing-rules-title">
        <header className="section-heading">
          <div>
            <h2 id="routing-rules-title">قواعد ارجاع خودکار</h2>
            <p>به ترتیب بالا به پایین بررسی می‌شوند؛ نخستین قاعدهٔ منطبق برنده است.</p>
          </div>
          <Button icon={Plus} onClick={() => setEditing({ ...EMPTY, position: rows.length + 1 })}>
            قاعدهٔ جدید
          </Button>
        </header>
        <label>
          <span className="sr-only">جستجوی قاعده</span>
          <input
            aria-label="جستجوی نام قاعده"
            placeholder="جستجوی نام قاعده…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {rules.isLoading ? (
          <Skeleton rows={4} />
        ) : rules.error ? (
          <div className="ticket-error-text" role="alert">
            دریافت قواعد انجام نشد.{" "}
            <button type="button" className="button button-ghost" onClick={() => void rules.refetch()}>
              تلاش دوباره
            </button>
          </div>
        ) : !shown.length ? (
          <EmptyState title="قاعده‌ای نیست" description="برای ارجاع خودکار تیکت‌ها یک قاعده بسازید." />
        ) : (
          <ol className="routing-rules-list">
            {shown.map((rule) => {
              const index = ids.indexOf(rule.id);
              return (
                <li
                  key={rule.id}
                  className={`routing-rule-row ${dragging === rule.id ? "is-dragging" : ""}`}
                  draggable={!query}
                  onDragStart={() => setDragging(rule.id)}
                  onDragEnd={() => setDragging(null)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (!dragging || dragging === rule.id) return;
                    const next = ids.filter((id) => id !== dragging);
                    next.splice(next.indexOf(rule.id), 0, dragging);
                    apply(next);
                  }}
                >
                  <GripVertical size={16} aria-hidden />
                  <span className="ticket-pill ticket-pill-neutral">{faDigits(index + 1)}</span>
                  <div className="routing-rule-text">
                    <strong>{rule.name}</strong>
                    <span>{ruleSentence(rule)}</span>
                    {rule.shadowed_by && (
                      <span className="routing-rule-warning">
                        <AlertTriangle size={14} aria-hidden /> هرگز اجرا نمی‌شود: قاعدهٔ بالاتر «{rule.shadowed_by}» همهٔ
                        تیکت‌ها را می‌گیرد.
                      </span>
                    )}
                  </div>
                  <span className={`state-pill ${rule.is_active ? "is-on" : "is-off"}`}>
                    {rule.is_active ? "فعال" : "غیرفعال"}
                  </span>
                  <span className="row-actions">
                    <button
                      type="button"
                      aria-label={`انتقال «${rule.name}» به بالا`}
                      disabled={index === 0 || reorder.isPending}
                      onClick={() => apply(moveRule(ids, rule.id, -1))}
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      type="button"
                      aria-label={`انتقال «${rule.name}» به پایین`}
                      disabled={index === ids.length - 1 || reorder.isPending}
                      onClick={() => apply(moveRule(ids, rule.id, 1))}
                    >
                      <ArrowDown size={16} />
                    </button>
                    <button type="button" aria-label={`ویرایش «${rule.name}»`} onClick={() => setEditing(rule)}>
                      <Edit3 size={16} />
                    </button>
                    {rule.is_active && (
                      <button
                        type="button"
                        aria-label={`غیرفعال‌کردن «${rule.name}»`}
                        onClick={() => save.mutate({ ...rule, is_active: false })}
                      >
                        <XCircle size={16} />
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        <TestPanel />
      </section>
      {editing && <RuleEditor initial={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
