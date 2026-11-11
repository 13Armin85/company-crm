import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  DndContext,
  useDraggable,
  useDroppable,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  GripVertical,
  LockKeyhole,
  Plus,
  RotateCcw,
  Save,
  Send,
  Settings2,
  Trash2,
} from "lucide-react";
import {
  CompactMultiSelector,
  SchemaDrivenForm,
  SearchableSelect,
  normalizePersianSearch,
  validateSchemaValues,
} from "@plane/ui";
import type { EntityFormSchema, FieldBinding, FormLayoutSchema, FormValues, SchemaField } from "@plane/ui";
import { Button, Skeleton } from "../components";
import { browserId } from "../browser-id";
import { useOrganizationRoles, useWorkspaceAccess } from "../api";
import { useUIStore } from "../store";
import { persianDate } from "../utils";
import { useEngineForm, useEngineMutation, useEngineDefinitions } from "./api";
import type { EntityDefinition, FieldDefinition, LookupDefinition, LookupOptionDefinition } from "./api";
import { DefinitionEditor } from "./definition-editor";
import { DefaultValueEditor, automaticDefaultMode, dynamicDefaultsFor } from "./default-value-editor";
import { ConditionEditor, conditionProblems } from "./rule-editors";
import { useSchemaTransport } from "./record-form";

export function moveBinding(
  layout: FormLayoutSchema,
  fromSection: string,
  field: string,
  toSection: string,
  before?: string
): FormLayoutSchema {
  const next = structuredClone(layout),
    source = next.sections.find((s) => s.id === fromSection),
    target = next.sections.find((s) => s.id === toSection);
  const binding = source?.bindings.find((b) => b.field === field);
  if (!binding || !source || !target || (before === field && fromSection === toSection)) return layout;
  source.bindings = source.bindings.filter((b) => b.field !== field);
  const index = before ? target.bindings.findIndex((b) => b.field === before) : -1;
  target.bindings.splice(index < 0 ? target.bindings.length : index, 0, binding);
  return next;
}

export function moveBindingStep(layout: FormLayoutSchema, sectionId: string, field: string, direction: -1 | 1) {
  const bindings = layout.sections.find((section) => section.id === sectionId)?.bindings || [];
  const index = bindings.findIndex((binding) => binding.field === field);
  if (index < 0 || index + direction < 0 || index + direction >= bindings.length) return layout;
  return moveBinding(layout, sectionId, field, sectionId, bindings[direction === -1 ? index - 1 : index + 2]?.field);
}

const formCodes = (layout: FormLayoutSchema | null) =>
  layout?.sections.flatMap((section) => section.bindings.map((binding) => binding.field)) || [];

export function formChangeSummary(
  next: FormLayoutSchema,
  previous: FormLayoutSchema | null,
  fields: Pick<FieldDefinition, "code" | "title">[]
) {
  const before = formCodes(previous),
    after = formCodes(next);
  const title = (code: string) => fields.find((field) => field.code === code)?.title || code;
  const added = after.filter((code) => !before.includes(code)).map(title);
  const removed = before.filter((code) => !after.includes(code)).map(title);
  const lines = [
    added.length ? `افزوده: ${added.join("، ")}` : "",
    removed.length ? `برداشته: ${removed.join("، ")}` : "",
    JSON.stringify(before) !== JSON.stringify(after) ? "ترتیب ورودی‌ها به شکل پیش‌نمایش تغییر می‌کند." : "",
  ].filter(Boolean);
  return lines.length ? lines.join("\n") : "تنظیمات یا بخش‌های فرم تغییر می‌کند.";
}

export function formDesignState(draft: FormLayoutSchema, saved: FormLayoutSchema, applied: FormLayoutSchema | null) {
  if (JSON.stringify(draft) !== JSON.stringify(saved)) return "ذخیره‌نشده";
  if (!saved.sections.length && !applied) return "ذخیره‌نشده";
  if (JSON.stringify(saved) !== JSON.stringify(applied)) return "پیش‌نویس ذخیره شد";
  return "روی فرم اعمال شد";
}

function DragItem({ id, children, label }: { id: string; children: ReactNode; label: string }) {
  const drag = useDraggable({ id }),
    drop = useDroppable({ id });
  return (
    <div
      ref={(element) => {
        drag.setNodeRef(element);
        drop.setNodeRef(element);
      }}
      className={`engine-drag-item${drop.isOver ? " is-over" : ""}`}
      style={{ opacity: drag.isDragging ? 0.5 : 1 }}
    >
      <button type="button" className="engine-drag-handle" aria-label={label} {...drag.attributes} {...drag.listeners}>
        <GripVertical size={17} aria-hidden="true" />
      </button>
      {children}
    </div>
  );
}

export function FormDesigner({
  entity,
  fields,
  entities,
  onFieldCreated,
  viewMode = "layout",
}: {
  entity: EntityDefinition;
  fields: FieldDefinition[];
  entities: EntityDefinition[];
  onFieldCreated?: () => void;
  viewMode?: "fields" | "layout" | "preview" | "versions";
}) {
  const form = useEngineForm(entity.code),
    parent = entities.find((e) => e.id === entity.parent),
    parentForm = useEngineForm(parent?.code || "", Boolean(parent));
  const { data: roles = [] } = useOrganizationRoles(),
    { data: access } = useWorkspaceAccess();
  const { data: lookupValues = [] } = useEngineDefinitions<LookupOptionDefinition>("values"),
    { data: lookups = [] } = useEngineDefinitions<LookupDefinition>("lookups");
  const mutation = useEngineMutation(),
    [draft, setDraft] = useState<FormLayoutSchema>({ tabs: [], sections: [] }),
    [revision, setRevision] = useState<number | null>(null);
  const [selected, setSelected] = useState<{ section: string; field: string }>(),
    [query, setQuery] = useState(""),
    [preview, setPreview] = useState<FormValues>({});
  const [creatingField, setCreatingField] = useState(false),
    [editingField, setEditingField] = useState<FieldDefinition | null>(null),
    [note, setNote] = useState(""),
    [newTab, setNewTab] = useState(""),
    [previewMode, setPreviewMode] = useState<"create" | "edit">("create"),
    [previewErrors, setPreviewErrors] = useState<Record<string, string>>({}),
    [savedDraft, setSavedDraft] = useState<FormLayoutSchema>({ tabs: [], sections: [] }),
    [appliedDraft, setAppliedDraft] = useState<FormLayoutSchema | null>(null);
  const setDirty = useUIStore((s) => s.setFormDirty),
    sensors = useSensors(
      useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
      useSensor(KeyboardSensor)
    );
  const inherited = parentForm.data?.published;
  const canPublish = Boolean(access?.can("FormDesigner.Publish"));
  const inheritedCodes = new Set(inherited?.sections.flatMap((s) => s.bindings.map((b) => b.field)) || []);
  const attached = new Set(draft.sections.flatMap((s) => s.bindings.map((b) => b.field)));
  const dirty = revision !== null && JSON.stringify(draft) !== JSON.stringify(savedDraft);
  useEffect(() => {
    if (form.data && revision === null) {
      setDraft(form.data.draft);
      setSavedDraft(form.data.draft);
      setAppliedDraft(form.data.published);
      setRevision(form.data.revision);
    }
  }, [form.data, revision]);
  useEffect(() => {
    setDirty(`designer:${entity.code}`, dirty);
    return () => setDirty(`designer:${entity.code}`, false);
  }, [dirty, entity.code, setDirty]);
  const transport = useSchemaTransport(parent?.code || entity.code, parent ? entity.code : "", true);
  const selectedBinding = draft.sections
    .find((s) => s.id === selected?.section)
    ?.bindings.find((b) => b.field === selected?.field);
  const selectedField = fields.find((f) => f.code === selected?.field);
  // Conditions may only compare inputs that are on this form, never the input they belong to.
  const formFieldCodes = new Set(
    [...(inherited?.sections || []), ...draft.sections].flatMap((s) => s.bindings.map((b) => b.field))
  );
  const conditionFieldsFor = (code: string) =>
    fields.filter((f) => f.is_active && f.code !== code && formFieldCodes.has(f.code));
  const updateBinding = (patch: Partial<FieldBinding>) =>
    setDraft((old) => ({
      ...old,
      sections: old.sections.map((s) =>
        s.id === selected?.section
          ? { ...s, bindings: s.bindings.map((b) => (b.field === selected?.field ? { ...b, ...patch } : b)) }
          : s
      ),
    }));
  const liveSchema = useMemo<EntityFormSchema>(() => {
    const layout = {
      tabs: [...(inherited?.tabs || []), ...draft.tabs.filter((t) => !inherited?.tabs.some((i) => i.id === t.id))],
      sections: [...(inherited?.sections || []), ...draft.sections],
    };
    const map = new Map(fields.map((f) => [f.code, f]));
    const schemaFields = layout.sections
      .flatMap((s) => s.bindings)
      .flatMap((binding) => {
        const field = map.get(binding.field);
        if (!field) return [];
        return [
          {
            ...field,
            binding,
            used: Boolean(field.used_at),
            lookup: lookups.find((l) => l.id === field.lookup)?.code || null,
            relation_entity: entities.find((e) => e.id === field.relation_entity)?.code || null,
          } as SchemaField,
        ];
      });
    return {
      entity: parent?.code || entity.code,
      title: entity.title,
      layout,
      fields: schemaFields,
      schema_version: 1,
    };
  }, [draft, entity.code, entity.title, entities, fields, inherited, lookups, parent?.code]);
  const previewSchema = useMemo<EntityFormSchema>(
    () => ({
      ...liveSchema,
      fields: liveSchema.fields.map((field) => ({
        ...field,
        config: {
          ...field.config,
          ...(field.binding.required !== undefined ? { required: field.binding.required } : {}),
          ...(field.binding.hidden !== undefined ? { hidden: field.binding.hidden } : {}),
          ...(field.binding.required_if !== undefined ? { required_if: field.binding.required_if } : {}),
          ...(field.binding.visible_if !== undefined ? { visible_if: field.binding.visible_if } : {}),
          readonly: Boolean(
            field.binding.readonly ||
            field.config.readonly ||
            (previewMode === "edit" && field.config.editable_after_create === false)
          ),
        },
      })),
    }),
    [liveSchema, previewMode]
  );
  const addSection = () =>
    setDraft((old) => ({
      ...old,
      sections: [...old.sections, { id: `section-${browserId()}`, title: "بخش جدید", columns: 2, bindings: [] }],
    }));
  const addField = (code: string) => {
    if (!draft.sections.length) {
      const sectionId = `section-${browserId()}`;
      const titleField = parent?.title_field || entity.title_field;
      const bindings =
        titleField !== code && !inheritedCodes.has(titleField) && fields.some((field) => field.code === titleField)
          ? [{ field: titleField }, { field: code }]
          : [{ field: code }];
      setDraft({
        ...draft,
        sections: [{ id: sectionId, title: "اطلاعات", columns: 2, bindings }],
      });
      setSelected({ section: sectionId, field: code });
      return;
    }
    const target = selected?.section || draft.sections[0].id;
    setDraft((old) => ({
      ...old,
      sections: old.sections.map((s) => (s.id === target ? { ...s, bindings: [...s.bindings, { field: code }] } : s)),
    }));
    setSelected({ section: target, field: code });
  };
  const drop = (event: DragEndEvent) => {
    if (!event.over || !canPublish) return;
    const from = String(event.active.id).split(":"),
      to = String(event.over.id).split(":");
    if (from[0] === "field")
      setDraft((old) => moveBinding(old, from[1], from[2], to[1], to[0] === "field" ? to[2] : undefined));
    else if (from[0] === "section" && to[0] === "section") {
      const next = [...draft.sections],
        start = next.findIndex((s) => s.id === from[1]),
        end = next.findIndex((s) => s.id === to[1]);
      if (start >= 0 && end >= 0) {
        const [section] = next.splice(start, 1);
        next.splice(end, 0, section);
        setDraft({ ...draft, sections: next });
      }
    }
  };
  const saveDraft = async () => {
    const incomplete = draft.sections
      .flatMap((section) => section.bindings)
      .find(
        (binding) =>
          conditionProblems(binding.required_if, conditionFieldsFor(binding.field)).length ||
          conditionProblems(binding.visible_if, conditionFieldsFor(binding.field)).length
      );
    if (incomplete) {
      const title = fields.find((f) => f.code === incomplete.field)?.title || incomplete.field;
      useUIStore.getState().toast(`شرط‌های ورودی «${title}» کامل نیست؛ آن را کامل یا حذف کنید.`, "error");
      throw new Error("Incomplete form conditions");
    }
    const result = (await mutation.mutateAsync({
      path: `forms/${entity.code}/`,
      method: "put",
      data: { draft, revision },
    })) as { revision: number };
    setSavedDraft(draft);
    setRevision(result.revision);
    setDirty(`designer:${entity.code}`, false);
    return result.revision;
  };
  const publish = async (rollback?: number) => {
    if (rollback && !window.confirm(`فرم به نسخه ${rollback.toLocaleString("fa-IR")} برگردد؟`)) return;
    if (!rollback) {
      if (
        !window.confirm(
          `فرم «${entity.title}» برای ثبت و ویرایش همهٔ کاربران تغییر می‌کند.\n${formChangeSummary(draft, appliedDraft, fields)}\nتغییرات اعمال شود؟`
        )
      )
        return;
    }
    try {
      const current = dirty && !rollback ? await saveDraft() : revision;
      const result = (await mutation.mutateAsync({
        path: `forms/${entity.code}/`,
        data: { revision: current, change_note: note, ...(rollback ? { rollback_version: rollback } : {}) },
      })) as { revision: number };
      setRevision(result.revision);
      if (!rollback) {
        setAppliedDraft(draft);
        setSavedDraft(draft);
      }
      setDirty(`designer:${entity.code}`, false);
      const fresh = await form.refetch();
      if (fresh.data && rollback) {
        setDraft(fresh.data.draft);
        setSavedDraft(fresh.data.draft);
        setAppliedDraft(fresh.data.published);
      }
    } catch {
      /* Surface server validation or conflict; keep local changes. */
    }
  };
  const unpublished =
    !dirty && savedDraft.sections.length > 0 && JSON.stringify(savedDraft) !== JSON.stringify(appliedDraft);
  if (form.isLoading || (revision === null && !form.error)) return <Skeleton rows={5} />;
  if (form.error)
    return (
      <div className="engine-empty-selection">
        <strong>فرم بارگذاری نشد</strong>
        <Button variant="secondary" onClick={() => void form.refetch()}>
          تلاش دوباره
        </Button>
      </div>
    );
  return (
    <div className="engine-designer">
      <div className="engine-designer-toolbar">
        <div className="engine-designer-heading">
          <span className="engine-eyebrow">فرم فعال</span>
          <div className="engine-designer-title-row">
            <strong>{entity.title}</strong>
            <span
              role="status"
              aria-live="polite"
              className={`engine-status${dirty || unpublished ? " is-dirty" : ""}`}
            >
              {formDesignState(draft, savedDraft, appliedDraft)}
            </span>
          </div>
          <small>
            {canPublish
              ? "پیش‌نویس فقط برای طراحان ذخیره می‌شود؛ «اعمال روی فرم» آن را برای کاربران نمایش می‌دهد."
              : "برای ذخیرهٔ پیش‌نویس یا اعمال روی فرم، دسترسی طراحی فرم لازم است."}
          </small>
        </div>
        <div className="engine-actions">
          {canPublish && (
            <Button disabled={mutation.isPending || (!dirty && !unpublished)} onClick={() => void publish()}>
              <Send size={16} aria-hidden="true" />
              اعمال روی فرم
            </Button>
          )}
          {canPublish && (
            <Button
              variant="secondary"
              disabled={mutation.isPending || !dirty}
              onClick={() => void saveDraft().catch(() => {})}
            >
              <Save size={16} aria-hidden="true" />
              ذخیرهٔ پیش‌نویس
            </Button>
          )}
          {mutation.error && (
            <p role="alert">ذخیره یا اعمال فرم انجام نشد. تغییرات شما در این صفحه حفظ شده‌اند؛ دوباره تلاش کنید.</p>
          )}
          <Button
            variant="ghost"
            onClick={async () => {
              if (dirty && !window.confirm("تغییرات ذخیره‌نشده کنار گذاشته شود؟")) return;
              const fresh = await form.refetch();
              if (fresh.data) {
                setDraft(fresh.data.draft);
                setSavedDraft(fresh.data.draft);
                setAppliedDraft(fresh.data.published);
                setRevision(fresh.data.revision);
              }
            }}
          >
            <RotateCcw size={16} aria-hidden="true" />
            لغو تغییرات
          </Button>
        </div>
      </div>
      {(creatingField || editingField) && (
        <div
          className="engine-field-drawer-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setCreatingField(false);
              setEditingField(null);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setCreatingField(false);
              setEditingField(null);
            }
          }}
        >
          <div
            className="engine-field-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={editingField ? "ویرایش ورودی فرم" : "ساخت ورودی فرم"}
          >
            <DefinitionEditor
              kind="fields"
              row={editingField || undefined}
              onClose={() => {
                setCreatingField(false);
                setEditingField(null);
              }}
              onSaved={(created) => {
                if (creatingField && created?.code) addField(created.code);
                onFieldCreated?.();
              }}
            />
          </div>
        </div>
      )}
      {viewMode === "fields" && (
        <section className="engine-input-directory" aria-label="ورودی‌های فرم">
          <div className="engine-panel-heading">
            <div>
              <span className="engine-step-badge">مرحله ۱</span>
              <h3>ورودی‌های فرم {entity.title}</h3>
              <p>هر ورودی یک خانه از فرم است. برای تغییر نام، نوع یا قواعد آن «ویرایش» را بزنید.</p>
            </div>
            {canPublish && access?.can("Field.Create") && (
              <Button onClick={() => setCreatingField(true)}>
                <Plus size={16} aria-hidden="true" />
                ورودی جدید
              </Button>
            )}
          </div>
          <label className="engine-search-field">
            <span>جستجوی ورودی</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="نام یا کد ورودی…" />
          </label>
          <div className="engine-input-grid">
            {fields
              .filter(
                (field) =>
                  field.is_active &&
                  normalizePersianSearch(field.title + field.code).includes(normalizePersianSearch(query))
              )
              .map((field) => (
                <article key={field.id} className="engine-input-card">
                  <div>
                    <strong>{field.title}</strong>
                    <small dir="ltr">{field.code}</small>
                  </div>
                  <span>
                    {inheritedCodes.has(field.code)
                      ? "از فرم اصلی"
                      : attached.has(field.code)
                        ? "در فرم"
                        : "آماده افزودن"}
                  </span>
                  {access?.can("Field.Edit") && (
                    <Button variant="secondary" onClick={() => setEditingField(field)}>
                      ویرایش
                    </Button>
                  )}
                  {!attached.has(field.code) && !inheritedCodes.has(field.code) && (
                    <Button variant="ghost" disabled={!canPublish} onClick={() => addField(field.code)}>
                      افزودن به فرم
                    </Button>
                  )}
                </article>
              ))}
          </div>
          {!fields.some((field) => field.is_active) && <p>هنوز ورودی‌ای تعریف نشده است. از «ورودی جدید» شروع کنید.</p>}
        </section>
      )}
      <div hidden={viewMode !== "layout"}>
        <fieldset disabled={!canPublish} className="engine-layout-controls">
          <DndContext sensors={sensors} onDragEnd={drop}>
            <div className="engine-designer-columns">
              <aside className="engine-library">
                <div className="engine-side-panel-heading">
                  <span className="engine-step-badge">۱</span>
                  <div>
                    <h3>ورودی‌های آماده</h3>
                    <p>روی هر ورودی بزنید تا به فرم اضافه شود.</p>
                  </div>
                </div>
                <label className="engine-search-field">
                  <span>جستجوی ورودی</span>
                  <input placeholder="نام یا کد ورودی…" value={query} onChange={(e) => setQuery(e.target.value)} />
                </label>
                {canPublish && access?.can("Field.Create") && (
                  <Button variant="secondary" onClick={() => setCreatingField(true)}>
                    <Plus size={15} aria-hidden="true" />
                    ساخت ورودی جدید
                  </Button>
                )}
                <div className="engine-library-list">
                  {fields
                    .filter(
                      (f) =>
                        f.is_active &&
                        !attached.has(f.code) &&
                        !inheritedCodes.has(f.code) &&
                        normalizePersianSearch(f.title + f.code).includes(normalizePersianSearch(query))
                    )
                    .map((field) => (
                      <button
                        className="engine-library-field"
                        key={field.id}
                        type="button"
                        onClick={() => addField(field.code)}
                      >
                        <span>{field.title}</span>
                        <small>افزودن به فرم</small>
                        <b>＋</b>
                      </button>
                    ))}
                </div>
                {inheritedCodes.size > 0 && (
                  <p className="engine-notice">
                    ورودی‌های مشترک از فرم {parent?.title} به ارث می‌رسند و در فرم اصلی ویرایش می‌شوند.
                  </p>
                )}
              </aside>
              <main className="engine-design-canvas">
                <div className="engine-canvas-heading">
                  <div className="engine-side-panel-heading">
                    <span className="engine-step-badge">۲</span>
                    <div>
                      <h3>چیدمان فرم</h3>
                      <p>ورودی‌ها را با دکمه‌های بالا و پایین جابه‌جا کنید. کشیدن هم ممکن است.</p>
                    </div>
                  </div>
                  <Button variant="secondary" onClick={addSection}>
                    <Plus size={15} aria-hidden="true" />
                    افزودن بخش
                  </Button>
                </div>
                <details className="engine-advanced-setting">
                  <summary>بخش‌ها و تب‌های پیشرفته</summary>
                  <div className="engine-tab-creator">
                    <label>
                      <span>
                        نام تب جدید <small>(اختیاری؛ برای فرم‌های طولانی)</small>
                      </span>
                      <input
                        placeholder="مثلاً اطلاعات تکمیلی"
                        value={newTab}
                        onChange={(e) => setNewTab(e.target.value)}
                      />
                    </label>
                    <Button
                      variant="ghost"
                      disabled={!newTab.trim()}
                      onClick={() => {
                        if (newTab.trim()) {
                          setDraft({
                            ...draft,
                            tabs: [...draft.tabs, { id: `tab-${browserId()}`, title: newTab.trim() }],
                          });
                          setNewTab("");
                        }
                      }}
                    >
                      افزودن تب
                    </Button>
                  </div>
                  {draft.tabs.map((tab) => (
                    <div className="engine-tab-editor" key={tab.id}>
                      <label>
                        <span>عنوان تب</span>
                        <input
                          value={tab.title}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              tabs: draft.tabs.map((t) => (t.id === tab.id ? { ...t, title: e.target.value } : t)),
                            })
                          }
                        />
                      </label>
                      <button
                        type="button"
                        aria-label={`حذف تب ${tab.title}`}
                        onClick={() =>
                          setDraft({
                            tabs: draft.tabs.filter((t) => t.id !== tab.id),
                            sections: draft.sections.map((s) => (s.tab === tab.id ? { ...s, tab: undefined } : s)),
                          })
                        }
                      >
                        <Trash2 size={16} aria-hidden="true" />
                        حذف تب
                      </button>
                    </div>
                  ))}
                </details>
                {draft.sections.map((section, sectionIndex) => (
                  <DragItem key={section.id} id={`section:${section.id}`} label="جابه‌جایی بخش">
                    <div className="engine-design-section">
                      <header className="engine-section-head">
                        <span className="engine-section-index" aria-hidden="true">
                          {(sectionIndex + 1).toLocaleString("fa-IR")}
                        </span>
                        <label className="engine-section-title-field">
                          <span>عنوان بخش</span>
                          <input
                            value={section.title || ""}
                            placeholder="مثلاً اطلاعات اصلی"
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                sections: draft.sections.map((s) =>
                                  s.id === section.id ? { ...s, title: e.target.value } : s
                                ),
                              })
                            }
                          />
                        </label>
                        <div className="engine-section-meta">
                          <span className="engine-field-count">
                            {section.bindings.length.toLocaleString("fa-IR")} ورودی
                          </span>
                          <span className="engine-field-count">{section.columns.toLocaleString("fa-IR")} ستونه</span>
                          {section.tab && (
                            <span className="engine-field-count">
                              {draft.tabs.find((t) => t.id === section.tab)?.title || "تب"}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          aria-label="حذف بخش"
                          disabled={section.bindings.some((binding) =>
                            form.data?.locked_fields?.includes(binding.field)
                          )}
                          onClick={() => {
                            if (window.confirm("این بخش از چیدمان حذف شود؟ داده رکوردهای قدیمی حفظ می‌شود."))
                              setDraft({ ...draft, sections: draft.sections.filter((s) => s.id !== section.id) });
                          }}
                        >
                          <Trash2 size={17} aria-hidden="true" />
                        </button>
                      </header>
                      <details className="engine-advanced-setting engine-section-settings">
                        <summary>
                          <Settings2 size={15} aria-hidden="true" />
                          <span>چیدمان بخش {section.title || "بدون عنوان"}</span>
                          <ChevronDown className="engine-section-settings-chevron" size={15} aria-hidden="true" />
                        </summary>
                        <div className="engine-section-options">
                          <div className="engine-section-columns" role="radiogroup" aria-label="چند ورودی در یک ردیف">
                            <span>چند ورودی در یک ردیف</span>
                            <div>
                              {([1, 2, 3] as const).map((count) => (
                                <button
                                  key={count}
                                  type="button"
                                  role="radio"
                                  aria-checked={section.columns === count}
                                  onClick={() =>
                                    setDraft({
                                      ...draft,
                                      sections: draft.sections.map((s) =>
                                        s.id === section.id ? { ...s, columns: count } : s
                                      ),
                                    })
                                  }
                                >
                                  <span className="engine-column-glyph" data-count={count} aria-hidden="true">
                                    {Array.from({ length: count }, (_, i) => (
                                      <i key={i} />
                                    ))}
                                  </span>
                                  {count.toLocaleString("fa-IR")} ورودی
                                </button>
                              ))}
                            </div>
                          </div>
                          <SearchableSelect
                            showLabel
                            label="نمایش در تب"
                            value={section.tab || ""}
                            options={[{ id: "", title: "همه تب‌ها / بدون تب" }, ...draft.tabs]}
                            onChange={(v) =>
                              setDraft({
                                ...draft,
                                sections: draft.sections.map((s) =>
                                  s.id === section.id ? { ...s, tab: v || undefined } : s
                                ),
                              })
                            }
                          />
                          <Button
                            variant="ghost"
                            disabled={sectionIndex === 0}
                            onClick={() => {
                              const next = [...draft.sections];
                              [next[sectionIndex - 1], next[sectionIndex]] = [
                                next[sectionIndex],
                                next[sectionIndex - 1],
                              ];
                              setDraft({ ...draft, sections: next });
                            }}
                          >
                            <ArrowUp size={15} aria-hidden="true" />
                            بخش به بالا
                          </Button>
                        </div>
                      </details>
                      {section.bindings.map((binding, index) => (
                        <DragItem
                          key={binding.field}
                          id={`field:${section.id}:${binding.field}`}
                          label={`جابه‌جایی ${fields.find((f) => f.code === binding.field)?.title || binding.field}`}
                        >
                          <button
                            type="button"
                            className={`engine-binding${selected?.section === section.id && selected.field === binding.field ? " selected" : ""}`}
                            onClick={() => setSelected({ section: section.id, field: binding.field })}
                          >
                            {binding.title || fields.find((f) => f.code === binding.field)?.title || binding.field}
                            {form.data?.locked_fields?.includes(binding.field) && (
                              <span aria-label="فیلد هسته‌ای قفل است">
                                <LockKeyhole size={14} aria-hidden="true" />
                              </span>
                            )}
                          </button>
                          <button
                            type="button"
                            aria-label={`انتقال ${binding.title || fields.find((f) => f.code === binding.field)?.title || binding.field} به بالا`}
                            disabled={index === 0}
                            onClick={() => setDraft(moveBindingStep(draft, section.id, binding.field, -1))}
                          >
                            <ArrowUp size={15} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            aria-label={`انتقال ${binding.title || fields.find((f) => f.code === binding.field)?.title || binding.field} به پایین`}
                            disabled={index === section.bindings.length - 1}
                            onClick={() => setDraft(moveBindingStep(draft, section.id, binding.field, 1))}
                          >
                            <ArrowDown size={15} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            aria-label="حذف از فرم"
                            title="حذف از فرم"
                            disabled={form.data?.locked_fields?.includes(binding.field)}
                            onClick={() =>
                              setDraft({
                                ...draft,
                                // eslint-disable-next-line oxc/no-map-spread -- React state must be copied, not mutated.
                                sections: draft.sections.map((s) =>
                                  s.id === section.id
                                    ? { ...s, bindings: s.bindings.filter((b) => b.field !== binding.field) }
                                    : s
                                ),
                              })
                            }
                          >
                            <Trash2 size={15} aria-hidden="true" />
                          </button>
                        </DragItem>
                      ))}
                      {!section.bindings.length && (
                        <p className="engine-drop-hint">
                          از «ورودی‌های آماده» یک ورودی اضافه کنید یا آن را به اینجا بکشید.
                        </p>
                      )}
                    </div>
                  </DragItem>
                ))}
              </main>
              <aside className="engine-binding-settings">
                <div className="engine-side-panel-heading">
                  <span className="engine-step-badge">۳</span>
                  <div>
                    <h3>تنظیمات ورودی</h3>
                    <p>رفتار ورودی انتخاب‌شده را فقط در همین فرم تغییر دهید.</p>
                  </div>
                </div>
                {selectedBinding && selectedField ? (
                  <>
                    <div className="engine-selected-field">
                      <span>ورودی انتخاب‌شده</span>
                      <strong>{selectedField.title}</strong>
                      <small dir="ltr">{selectedField.code}</small>
                    </div>
                    {draft.sections.length > 1 && (
                      <SearchableSelect
                        showLabel
                        label="انتقال ورودی به بخش"
                        value={selected!.section}
                        options={draft.sections.map((section) => ({
                          id: section.id,
                          title: section.title || "بخش بدون عنوان",
                        }))}
                        onChange={(sectionId) => {
                          setDraft(moveBinding(draft, selected!.section, selected!.field, sectionId));
                          setSelected({ section: sectionId, field: selected!.field });
                        }}
                      />
                    )}
                    <label>
                      عنوان در این فرم (اختیاری)
                      <input
                        placeholder={selectedField.title}
                        value={selectedBinding.title || ""}
                        onChange={(e) => updateBinding({ title: e.target.value })}
                      />
                    </label>
                    {[
                      ["required", "پر کردن آن اجباری است"],
                      ["hidden", "در این فرم نمایش داده نشود"],
                      ["readonly", "فقط نمایشی (قابل تغییر نیست)"],
                    ].map(([key, title]) => (
                      <label className="engine-checkbox" key={key}>
                        <input
                          type="checkbox"
                          disabled={Boolean(
                            form.data?.locked_fields?.includes(selectedBinding.field) &&
                            ["hidden", "required"].includes(key)
                          )}
                          checked={Boolean(
                            selectedBinding[key as keyof FieldBinding] ??
                            selectedField.config[key as keyof typeof selectedField.config]
                          )}
                          onChange={(e) => updateBinding({ [key]: e.target.checked })}
                        />
                        {title}
                      </label>
                    ))}
                    <details className="engine-advanced-setting engine-binding-advanced">
                      <summary>تنظیمات پیشرفتهٔ این ورودی</summary>
                      <div className="engine-advanced-content">
                        <section className="engine-advanced-group" aria-label="مقدار اولیه">
                          <h4>مقدار اولیه</h4>
                          <DefaultValueEditor
                            field={selectedField}
                            value={
                              selectedBinding.default &&
                              typeof selectedBinding.default === "object" &&
                              "dynamic" in selectedBinding.default
                                ? null
                                : selectedBinding.default
                            }
                            onChange={(value) => updateBinding({ default: value })}
                          />
                          <button
                            type="button"
                            className="button button-ghost"
                            onClick={() => updateBinding({ default: undefined })}
                          >
                            استفاده از پیش‌فرض اصلی ورودی
                          </button>
                          <SearchableSelect
                            showLabel
                            label="پر شدن خودکار هنگام ثبت رکورد جدید"
                            value={automaticDefaultMode(selectedBinding, selectedField.config)}
                            options={[
                              { id: "", title: "بدون مقدار اولیهٔ خودکار" },
                              { id: "current_user", title: "کاربر جاری" },
                              { id: "today", title: "امروز" },
                              { id: "now", title: "زمان جاری" },
                            ].filter(
                              (option) => !option.id || dynamicDefaultsFor(selectedField.kind).includes(option.id)
                            )}
                            onChange={(v) =>
                              updateBinding({ default: v ? { dynamic: v as "today" | "now" | "current_user" } : null })
                            }
                          />
                          <p className="engine-advanced-note">
                            پر شدن خودکار فقط هنگام ثبت رکورد جدید انجام می‌شود؛ رکوردهای قبلی و ویرایش‌های بعدی تغییر
                            نمی‌کنند. «بدون مقدار اولیهٔ خودکار» پیش‌فرض همین فرم را پاک می‌کند. دکمهٔ بالا، پیش‌فرض اصلی ورودی
                            را دوباره اعمال می‌کند.
                          </p>
                        </section>
                        <section className="engine-advanced-group" aria-label="دسترسی به ورودی">
                          <h4>دسترسی به ورودی</h4>
                          {(["view_roles", "edit_roles"] as const).map((key) => (
                            <fieldset key={key}>
                              <legend>
                                {key === "view_roles"
                                  ? "چه کسانی این ورودی را ببینند؟"
                                  : "چه کسانی بتوانند آن را تغییر دهند؟"}
                              </legend>
                              <label className="engine-checkbox">
                                <input
                                  type="checkbox"
                                  checked={selectedBinding[key] == null}
                                  onChange={(e) => updateBinding({ [key]: e.target.checked ? null : [] })}
                                />
                                همه کسانی که به رکورد دسترسی دارند
                              </label>
                              {selectedBinding[key] != null && (
                                <CompactMultiSelector
                                  label={key === "view_roles" ? "نقش‌های مجاز مشاهده" : "نقش‌های مجاز ویرایش"}
                                  options={roles.map((r) => ({ id: r.id, title: r.name }))}
                                  selected={selectedBinding[key] || []}
                                  onChange={(v) => updateBinding({ [key]: v })}
                                />
                              )}
                            </fieldset>
                          ))}
                        </section>
                        <section className="engine-advanced-group" aria-label="شرط‌های ورودی">
                          <h4>شرط‌های ورودی</h4>
                          <ConditionEditor
                            label="فقط در شرایط خاص اجباری شود"
                            description="بدون شرط، اجباری بودن فقط از تنظیم «اجباری» پیروی می‌کند."
                            value={selectedBinding.required_if}
                            fields={conditionFieldsFor(selectedBinding.field)}
                            lookupValues={lookupValues}
                            onChange={(required_if) => updateBinding({ required_if })}
                          />
                          <ConditionEditor
                            label="فقط در شرایط خاص نمایش داده شود"
                            description="بدون شرط، این ورودی همیشه در فرم دیده می‌شود."
                            value={selectedBinding.visible_if}
                            fields={conditionFieldsFor(selectedBinding.field)}
                            lookupValues={lookupValues}
                            onChange={(visible_if) => updateBinding({ visible_if })}
                          />
                        </section>
                      </div>
                    </details>
                  </>
                ) : (
                  <div className="engine-empty-selection">
                    <strong>ورودی‌ای انتخاب نشده</strong>
                    <p>روی یکی از ورودی‌های چیدمان بزنید تا تنظیماتش اینجا نمایش داده شود.</p>
                  </div>
                )}
              </aside>
            </div>
          </DndContext>
        </fieldset>
      </div>
      <section className="engine-live-preview" hidden={viewMode !== "preview"}>
        <h3>پیش‌نمایش فرم</h3>
        <p>ورودی‌ها و پیام خطا را امتحان کنید. دادهٔ این پیش‌نمایش ثبت نمی‌شود.</p>
        <div className="engine-workspace-subnav" role="group" aria-label="حالت پیش‌نمایش">
          <button
            type="button"
            aria-pressed={previewMode === "create"}
            onClick={() => {
              setPreviewMode("create");
              setPreview({});
              setPreviewErrors({});
            }}
          >
            حالت ثبت
          </button>
          <button
            type="button"
            aria-pressed={previewMode === "edit"}
            onClick={() => {
              setPreviewMode("edit");
              setPreviewErrors({});
            }}
          >
            حالت ویرایش
          </button>
        </div>
        <p>
          {previewMode === "edit"
            ? "نمای ویرایش با دادهٔ آزمایشی همین صفحه نشان داده می‌شود؛ دسترسی واقعی هر رکورد در زمان ویرایش بررسی می‌شود."
            : "نمای ثبت رکورد جدید"}
        </p>
        <SchemaDrivenForm
          schema={previewSchema}
          values={preview}
          errors={previewErrors}
          onChange={(values) => {
            setPreview(values);
            setPreviewErrors({});
          }}
          {...transport}
        />
        <Button variant="secondary" onClick={() => setPreviewErrors(validateSchemaValues(previewSchema, preview))}>
          بررسی خطاهای فرم
        </Button>
      </section>
      <section className="engine-version-history" hidden={viewMode !== "versions"}>
        <h3>نسخه‌های قبلی فرم</h3>
        <label>
          توضیح تغییر بعدی (اختیاری)
          <input placeholder="مثلاً افزودن شماره تماس" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {form.data?.versions.map((version) => (
          <div key={version.id}>
            <strong>نسخه {version.number.toLocaleString("fa-IR")}</strong>
            <span>{persianDate(version.created_at)}</span>
            <span>{version.change_note || "بدون توضیح"}</span>
            {canPublish && version.number !== form.data?.versions[0]?.number && (
              <Button variant="secondary" disabled={mutation.isPending} onClick={() => void publish(version.number)}>
                بازگشت به این نسخه
              </Button>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
