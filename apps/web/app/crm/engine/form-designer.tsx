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
import { ArrowUp, GripVertical, LockKeyhole, Plus, RotateCcw, Save, Send, Trash2 } from "lucide-react";
import { CompactMultiSelector, SchemaDrivenForm, SearchableSelect, normalizePersianSearch } from "@plane/ui";
import type { EntityFormSchema, FieldBinding, FormLayoutSchema, FormValues, SchemaField } from "@plane/ui";
import { Button, Skeleton } from "../components";
import { useOrganizationRoles, useWorkspaceAccess } from "../api";
import { useUIStore } from "../store";
import { persianDate } from "../utils";
import { useEngineForm, useEngineMutation, useEngineDefinitions } from "./api";
import type { EntityDefinition, FieldDefinition, LookupDefinition, LookupOptionDefinition } from "./api";
import { DefinitionEditor } from "./definition-editor";
import { DefaultValueEditor, dynamicDefaultsFor } from "./default-value-editor";
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
    [newTab, setNewTab] = useState("");
  const setDirty = useUIStore((s) => s.setFormDirty),
    sensors = useSensors(
      useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
      useSensor(KeyboardSensor)
    );
  const inherited = parentForm.data?.published;
  const inheritedCodes = new Set(inherited?.sections.flatMap((s) => s.bindings.map((b) => b.field)) || []);
  const attached = new Set(draft.sections.flatMap((s) => s.bindings.map((b) => b.field)));
  const dirty = revision !== null && JSON.stringify(draft) !== JSON.stringify(form.data?.draft);
  useEffect(() => {
    if (form.data && revision === null) {
      setDraft(form.data.draft);
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
  const addSection = () =>
    setDraft((old) => ({
      ...old,
      sections: [
        ...old.sections,
        { id: `section-${crypto.randomUUID()}`, title: "بخش جدید", columns: 2, bindings: [] },
      ],
    }));
  const addField = (code: string) => {
    if (!draft.sections.length) {
      setDraft({
        ...draft,
        sections: [{ id: `section-${crypto.randomUUID()}`, title: "اطلاعات", columns: 2, bindings: [{ field: code }] }],
      });
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
    if (!event.over) return;
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
    setRevision(result.revision);
    setDirty(`designer:${entity.code}`, false);
    return result.revision;
  };
  const publish = async (rollback?: number) => {
    if (rollback && !window.confirm(`فرم به نسخه ${rollback.toLocaleString("fa-IR")} برگردد؟`)) return;
    try {
      const current = dirty && !rollback ? await saveDraft() : revision;
      const result = (await mutation.mutateAsync({
        path: `forms/${entity.code}/`,
        data: { revision: current, change_note: note, ...(rollback ? { rollback_version: rollback } : {}) },
      })) as { revision: number };
      setRevision(result.revision);
      setDirty(`designer:${entity.code}`, false);
      const fresh = await form.refetch();
      if (fresh.data) setDraft(fresh.data.draft);
    } catch {
      /* Surface server validation or conflict; keep local changes. */
    }
  };
  const canPublish = Boolean(access?.can("FormDesigner.Publish"));
  const unpublished =
    !dirty && Boolean(form.data) && JSON.stringify(form.data?.draft) !== JSON.stringify(form.data?.published);
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
            <span className={`engine-status${dirty || unpublished ? " is-dirty" : ""}`}>
              {dirty ? "تغییرات ذخیره نشده" : unpublished ? "هنوز روی فرم اعمال نشده" : "روی فرم اعمال شده"}
            </span>
          </div>
          <small>
            {canPublish
              ? "با «ذخیره و اعمال روی فرم» تغییرات بلافاصله در فرم اصلی دیده می‌شود."
              : "تغییرات شما ذخیره می‌شود و پس از تأیید مدیر روی فرم اعمال می‌شود."}
          </small>
        </div>
        <div className="engine-actions">
          {canPublish ? (
            <Button disabled={mutation.isPending || (!dirty && !unpublished)} onClick={() => void publish()}>
              <Send size={16} aria-hidden="true" />
              ذخیره و اعمال روی فرم
            </Button>
          ) : (
            <Button disabled={mutation.isPending || !dirty} onClick={() => void saveDraft().catch(() => {})}>
              <Save size={16} aria-hidden="true" />
              ذخیره تغییرات
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={async () => {
              if (dirty && !window.confirm("تغییرات ذخیره‌نشده کنار گذاشته شود؟")) return;
              const fresh = await form.refetch();
              if (fresh.data) {
                setDraft(fresh.data.draft);
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
            {access?.can("Field.Create") && (
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
                    <Button variant="ghost" onClick={() => addField(field.code)}>
                      افزودن به چیدمان
                    </Button>
                  )}
                </article>
              ))}
          </div>
          {!fields.some((field) => field.is_active) && <p>هنوز ورودی‌ای تعریف نشده است. از «ورودی جدید» شروع کنید.</p>}
        </section>
      )}
      <div hidden={viewMode !== "layout"}>
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
              {access?.can("Field.Create") && (
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
                  فیلدهای مشترک از فرم {parent?.title} به ارث می‌رسند و در فرم اصلی ویرایش می‌شوند.
                </p>
              )}
            </aside>
            <main className="engine-design-canvas">
              <div className="engine-canvas-heading">
                <div className="engine-side-panel-heading">
                  <span className="engine-step-badge">۲</span>
                  <div>
                    <h3>چیدمان فرم</h3>
                    <p>ورودی‌ها را بکشید تا ترتیبشان عوض شود؛ برای دسته‌بندی، بخش یا تب اضافه کنید.</p>
                  </div>
                </div>
                <Button variant="secondary" onClick={addSection}>
                  <Plus size={15} aria-hidden="true" />
                  افزودن بخش
                </Button>
              </div>
              <div className="engine-tab-creator">
                <label>
                  <span>
                    نام تب جدید <small>(اختیاری؛ برای فرم‌های طولانی)</small>
                  </span>
                  <input placeholder="مثلاً اطلاعات تکمیلی" value={newTab} onChange={(e) => setNewTab(e.target.value)} />
                </label>
                <Button
                  variant="ghost"
                  disabled={!newTab.trim()}
                  onClick={() => {
                    if (newTab.trim()) {
                      setDraft({
                        ...draft,
                        tabs: [...draft.tabs, { id: `tab-${crypto.randomUUID()}`, title: newTab.trim() }],
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
              {draft.sections.map((section, sectionIndex) => (
                <DragItem key={section.id} id={`section:${section.id}`} label="جابه‌جایی بخش">
                  <div className="engine-design-section">
                    <header>
                      <label>
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
                      <span className="engine-field-count">
                        {section.bindings.length.toLocaleString("fa-IR")} ورودی
                      </span>
                      <button
                        type="button"
                        aria-label="حذف بخش"
                        disabled={section.bindings.some((binding) => form.data?.locked_fields?.includes(binding.field))}
                        onClick={() => {
                          if (window.confirm("این بخش از چیدمان حذف شود؟ داده رکوردهای قدیمی حفظ می‌شود."))
                            setDraft({ ...draft, sections: draft.sections.filter((s) => s.id !== section.id) });
                        }}
                      >
                        <Trash2 size={17} aria-hidden="true" />
                      </button>
                    </header>
                    <div className="engine-section-options">
                      <SearchableSelect
                        showLabel
                        label="چند ورودی در یک ردیف"
                        value={String(section.columns)}
                        options={[1, 2, 3].map((v) => ({ id: String(v), title: `${v.toLocaleString("fa-IR")} ورودی` }))}
                        onChange={(v) =>
                          setDraft({
                            ...draft,
                            sections: draft.sections.map((s) =>
                              s.id === section.id ? { ...s, columns: Number(v) as 1 | 2 | 3 } : s
                            ),
                          })
                        }
                      />
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
                          [next[sectionIndex - 1], next[sectionIndex]] = [next[sectionIndex], next[sectionIndex - 1]];
                          setDraft({ ...draft, sections: next });
                        }}
                      >
                        <ArrowUp size={15} aria-hidden="true" />
                        بخش به بالا
                      </Button>
                    </div>
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
                          aria-label="انتقال فیلد به بالا"
                          disabled={index === 0}
                          onClick={() =>
                            setDraft(
                              moveBinding(
                                draft,
                                section.id,
                                binding.field,
                                section.id,
                                section.bindings[index - 1].field
                              )
                            )
                          }
                        >
                          <ArrowUp size={15} aria-hidden="true" />
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
                    حذف مقدار اولیه این فرم
                  </button>
                  <SearchableSelect
                    showLabel
                    label="پر شدن خودکار"
                    value={
                      selectedBinding.default &&
                      typeof selectedBinding.default === "object" &&
                      "dynamic" in selectedBinding.default
                        ? selectedBinding.default.dynamic
                        : ""
                    }
                    options={[
                      { id: "", title: "خودکار پر نشود" },
                      { id: "current_user", title: "کاربر جاری" },
                      { id: "today", title: "امروز" },
                      { id: "now", title: "زمان جاری" },
                    ].filter((option) => !option.id || dynamicDefaultsFor(selectedField.kind).includes(option.id))}
                    onChange={(v) =>
                      updateBinding({ default: v ? { dynamic: v as "today" | "now" | "current_user" } : undefined })
                    }
                  />
                  {(["view_roles", "edit_roles"] as const).map((key) => (
                    <fieldset key={key}>
                      <legend>
                        {key === "view_roles" ? "چه کسانی این ورودی را ببینند؟" : "چه کسانی بتوانند آن را تغییر دهند؟"}
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
      </div>
      <section className="engine-live-preview" hidden={viewMode !== "preview"}>
        <h3>پیش‌نمایش فرم</h3>
        <p>فرم را همان‌طور که کاربران می‌بینند امتحان کنید؛ چیزی ذخیره نمی‌شود.</p>
        <SchemaDrivenForm schema={liveSchema} values={preview} onChange={setPreview} {...transport} />
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
