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
import { errorMessage, useOrganizationRoles, useWorkspaceAccess } from "../api";
import { useUIStore } from "../store";
import { persianDate } from "../utils";
import { useEngineForm, useEngineMutation, useEngineDefinitions } from "./api";
import type { EntityDefinition, FieldDefinition, LookupDefinition, LookupOptionDefinition } from "./api";
import { DefinitionEditor } from "./definition-editor";
import { DefaultValueEditor, dynamicDefaultsFor } from "./default-value-editor";
import { ConditionEditor } from "./rule-editors";
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
    if (
      !window.confirm(
        rollback
          ? `فرم از نسخه ${rollback} بازیابی و به‌عنوان نسخه جدید منتشر شود؟`
          : "این فرم برای همه کاربران منتشر شود؟"
      )
    )
      return;
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
  if (form.isLoading || (revision === null && !form.error)) return <Skeleton rows={5} />;
  if (form.error) return <p role="alert">{errorMessage(form.error, "دریافت فرم انجام نشد.")}</p>;
  return (
    <div className="engine-designer">
      <div className="engine-designer-toolbar">
        <div className="engine-designer-heading">
          <span className="engine-eyebrow">فرم فعال</span>
          <div className="engine-designer-title-row">
            <strong>{entity.title}</strong>
            <span className={`engine-status${dirty ? " is-dirty" : ""}`}>
              {dirty ? "تغییر ذخیره‌نشده" : "پیش‌نویس ذخیره‌شده"}
            </span>
          </div>
          <small>نسخه منتشرشده: {form.data?.versions[0]?.number.toLocaleString("fa-IR") || "هنوز منتشر نشده"}</small>
        </div>
        <div className="engine-actions">
          <Button variant="secondary" disabled={mutation.isPending} onClick={() => void saveDraft().catch(() => {})}>
            <Save size={16} aria-hidden="true" />
            ذخیره پیش‌نویس
          </Button>
          {access?.can("FormDesigner.Publish") && (
            <Button disabled={mutation.isPending} onClick={() => void publish()}>
              <Send size={16} aria-hidden="true" />
              انتشار فرم
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={async () => {
              if (dirty && !window.confirm("تغییرات ذخیره‌نشده کنار گذاشته و فرم تازه بارگذاری شود؟")) return;
              const fresh = await form.refetch();
              if (fresh.data) {
                setDraft(fresh.data.draft);
                setRevision(fresh.data.revision);
              }
            }}
          >
            <RotateCcw size={16} aria-hidden="true" />
            بارگذاری دوباره
          </Button>
        </div>
      </div>
      {mutation.error && <p role="alert">{errorMessage(mutation.error, "ذخیره یا انتشار فرم انجام نشد.")}</p>}
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
              <p>تعریف ورودی و تنظیم جایگاه آن جدا هستند. برای نام، نوع و اعتبارسنجی «ویرایش ورودی» را بزنید.</p>
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
            <small>فهرست را بر اساس نام نمایشی یا کد فنی محدود کنید.</small>
          </label>
          <div className="engine-input-grid">
            {fields
              .filter(
                (field) =>
                  field.is_active &&
                  (attached.has(field.code) || inheritedCodes.has(field.code)) &&
                  normalizePersianSearch(field.title + field.code).includes(normalizePersianSearch(query))
              )
              .map((field) => (
                <article key={field.id} className="engine-input-card">
                  <div>
                    <strong>{field.title}</strong>
                    <small dir="ltr">{field.code}</small>
                  </div>
                  <span>{attached.has(field.code) || inheritedCodes.has(field.code) ? "در فرم" : "در کتابخانه"}</span>
                  {access?.can("Field.Edit") && (
                    <Button variant="secondary" onClick={() => setEditingField(field)}>
                      ویرایش ورودی
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
          {!fields.some((field) => field.is_active && (attached.has(field.code) || inheritedCodes.has(field.code))) && (
            <p>هنوز ورودی‌ای به این فرم وصل نشده است. از «ورودی جدید» یا کتابخانهٔ بخش چیدمان استفاده کنید.</p>
          )}
        </section>
      )}
      <div hidden={viewMode !== "layout"}>
        <DndContext sensors={sensors} onDragEnd={drop}>
          <div className="engine-designer-columns">
            <aside className="engine-library">
              <div className="engine-side-panel-heading">
                <span className="engine-step-badge">۱</span>
                <div>
                  <h3>کتابخانه فیلدها</h3>
                  <p>فیلد موردنظر را پیدا و به فرم اضافه کنید.</p>
                </div>
              </div>
              <label className="engine-search-field">
                <span>جستجوی فیلد</span>
                <input placeholder="نام یا کد فیلد…" value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
              {access?.can("Field.Create") && (
                <Button variant="secondary" onClick={() => setCreatingField(true)}>
                  <Plus size={15} aria-hidden="true" />
                  ساخت فیلد همین‌جا
                </Button>
              )}
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
                    <h3>بوم چیدمان فرم</h3>
                    <p>بخش‌ها را بسازید و ترتیب نمایش فیلدها را مشخص کنید.</p>
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
                    تب جدید <small>(اختیاری)</small>
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
                      <span className="engine-field-count">{section.bindings.length.toLocaleString("fa-IR")} فیلد</span>
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
                        label="تعداد ستون"
                        value={String(section.columns)}
                        options={[1, 2, 3].map((v) => ({ id: String(v), title: `${v.toLocaleString("fa-IR")} ستون` }))}
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
                        label="تب بخش"
                        value={section.tab || ""}
                        options={[{ id: "", title: "بدون تب" }, ...draft.tabs]}
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
                          aria-label="حذف اتصال فیلد"
                          disabled={form.data?.locked_fields?.includes(binding.field)}
                          onClick={() =>
                            setDraft({
                              ...draft,
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
                      <p className="engine-drop-hint">فیلد را از کتابخانه اضافه یا به این بخش منتقل کنید.</p>
                    )}
                  </div>
                </DragItem>
              ))}
            </main>
            <aside className="engine-binding-settings">
              <div className="engine-side-panel-heading">
                <span className="engine-step-badge">۳</span>
                <div>
                  <h3>تنظیمات فیلد</h3>
                  <p>نحوه نمایش و رفتار فیلد انتخاب‌شده را تنظیم کنید.</p>
                </div>
              </div>
              {selectedBinding && selectedField ? (
                <>
                  <div className="engine-selected-field">
                    <span>فیلد انتخاب‌شده</span>
                    <strong>{selectedField.title}</strong>
                    <small dir="ltr">{selectedField.code}</small>
                  </div>
                  <label>
                    عنوان جایگزین
                    <input
                      value={selectedBinding.title || ""}
                      onChange={(e) => updateBinding({ title: e.target.value })}
                    />
                  </label>
                  {[
                    ["required", "اجباری"],
                    ["hidden", "مخفی"],
                    ["readonly", "فقط‌خواندنی"],
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
                    بازگشت به پیش‌فرض کتابخانه
                  </button>
                  <SearchableSelect
                    showLabel
                    label="پیش‌فرض پویا در اتصال"
                    value={
                      selectedBinding.default &&
                      typeof selectedBinding.default === "object" &&
                      "dynamic" in selectedBinding.default
                        ? selectedBinding.default.dynamic
                        : ""
                    }
                    options={[
                      { id: "", title: "ثابت / ارث‌بری" },
                      { id: "current_user", title: "کاربر جاری" },
                      { id: "today", title: "امروز" },
                      { id: "now", title: "زمان جاری" },
                    ].filter((option) => !option.id || dynamicDefaultsFor(selectedField.kind).includes(option.id))}
                    onChange={(v) =>
                      updateBinding({ default: v ? { dynamic: v as "today" | "now" | "current_user" } : undefined })
                    }
                  />
                  <label>
                    مرحله مرتبط (زیرساخت گردش کار)
                    <input
                      value={selectedBinding.stage || ""}
                      onChange={(e) => updateBinding({ stage: e.target.value })}
                    />
                  </label>
                  {(["view_roles", "edit_roles"] as const).map((key) => (
                    <fieldset key={key}>
                      <legend>{key === "view_roles" ? "نقش‌های مجاز مشاهده" : "نقش‌های مجاز ویرایش"}</legend>
                      <label className="engine-checkbox">
                        <input
                          type="checkbox"
                          checked={selectedBinding[key] == null}
                          onChange={(e) => updateBinding({ [key]: e.target.checked ? null : [] })}
                        />
                        طبق مجوز عملیات رکورد
                      </label>
                      {selectedBinding[key] != null && (
                        <CompactMultiSelector
                          label={key === "view_roles" ? "مشاهده" : "ویرایش"}
                          options={roles.map((r) => ({ id: r.id, title: r.name }))}
                          selected={selectedBinding[key] || []}
                          onChange={(v) => updateBinding({ [key]: v })}
                        />
                      )}
                    </fieldset>
                  ))}
                  <ConditionEditor
                    label="اجباری شرطی در اتصال"
                    value={selectedBinding.required_if}
                    fields={fields}
                    lookupValues={lookupValues}
                    onChange={(required_if) => updateBinding({ required_if })}
                  />
                  <ConditionEditor
                    label="نمایش شرطی در اتصال"
                    value={selectedBinding.visible_if}
                    fields={fields}
                    lookupValues={lookupValues}
                    onChange={(visible_if) => updateBinding({ visible_if })}
                  />
                </>
              ) : (
                <div className="engine-empty-selection">
                  <strong>هنوز فیلدی انتخاب نشده</strong>
                  <p>یکی از فیلدهای بوم میانی را انتخاب کنید تا تنظیمات آن در این قسمت نمایش داده شود.</p>
                </div>
              )}
            </aside>
          </div>
        </DndContext>
      </div>
      <section className="engine-live-preview" hidden={viewMode !== "preview"}>
        <h3>پیش‌نمایش زنده فرم</h3>
        <p>این داده آزمایشی ذخیره نمی‌شود. کاربران تا انتشار، نسخه قبلی را می‌بینند.</p>
        <SchemaDrivenForm schema={liveSchema} values={preview} onChange={setPreview} {...transport} />
      </section>
      <section className="engine-version-history" hidden={viewMode !== "versions"}>
        <h3>نسخه‌های منتشرشده</h3>
        <label>
          توضیح تغییر
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {form.data?.versions.map((version) => (
          <div key={version.id}>
            <strong>نسخه {version.number.toLocaleString("fa-IR")}</strong>
            <span>{persianDate(version.created_at)}</span>
            <span>{version.change_note}</span>
            {access?.can("FormDesigner.Publish") && (
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
