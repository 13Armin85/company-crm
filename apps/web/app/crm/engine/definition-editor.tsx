import { useState } from "react";
import { SearchableSelect } from "@plane/ui";
import { DefaultValueEditor, dynamicDefaultsFor } from "./default-value-editor";
import type { FieldConfig, FieldKind } from "@plane/ui";
import { useOrganizationPermissions } from "../api";
import { Button } from "../components";
import { useEngineMutation, useEngineDefinitions, useEngineCatalog } from "./api";
import type { EntityDefinition, FieldDefinition, LookupDefinition, LookupOptionDefinition } from "./api";
import { ConditionEditor, FormulaEditor, conditionProblems } from "./rule-editors";
import { useUIStore } from "../store";
import { browserId } from "../browser-id";

const textKinds = new Set(["short_text", "long_text", "email", "phone", "url"]);
const numberKinds = new Set(["integer", "decimal", "money", "percent"]);
const choiceKinds = new Set(["select", "multi_select"]);

export type DefinitionKind = "entities" | "fields" | "lookups" | "values";
export type EditableDefinition = Partial<
  EntityDefinition & FieldDefinition & LookupDefinition & LookupOptionDefinition
>;

export function DefinitionEditor({
  kind,
  row,
  onClose,
  onSaved,
  onManageLookups,
}: {
  kind: DefinitionKind;
  row?: EditableDefinition;
  onClose: () => void;
  onSaved?: (row?: EditableDefinition) => void;
  onManageLookups?: () => void;
}) {
  const { data: catalog } = useEngineCatalog();
  const { data: fields = [] } = useEngineDefinitions<FieldDefinition>("fields", kind === "fields");
  const { data: lookups = [] } = useEngineDefinitions<LookupDefinition>(
    "lookups",
    kind === "fields" || kind === "values"
  );
  const { data: lookupValues = [] } = useEngineDefinitions<LookupOptionDefinition>(
    "values",
    kind === "fields" || kind === "values"
  );
  const { data: permissions = [] } = useOrganizationPermissions(undefined, kind === "entities");
  const mutation = useEngineMutation();
  const [data, setData] = useState<EditableDefinition>(() => ({
    code:
      kind === "lookups" || kind === "values"
        ? `${kind === "lookups" ? "list" : "option"}_${browserId().replaceAll("-", "").slice(0, 10)}`
        : "",
    title: "",
    description: "",
    is_active: true,
    kind: "short_text",
    config: {},
    color: "#64748b",
    position: 0,
    numbering: { prefix: "REC", padding: 5 },
    ...row,
  }));
  const set = <K extends keyof EditableDefinition>(key: K, value: EditableDefinition[K]) =>
    setData((old) => ({ ...old, [key]: value }));
  const config = data.config || {},
    updateConfig = (patch: Partial<FieldConfig>) => set("config", { ...config, ...patch });
  const locked = Boolean(row?.used_at);
  // A field may not depend on itself, and retired fields no longer appear on forms.
  const conditionFields = fields.filter((f) => f.is_active && f.code !== data.code && f.code !== row?.code);
  const constant =
    config.default && typeof config.default === "object" && "dynamic" in config.default ? null : config.default;
  const defaultMode =
    config.default_dynamic ||
    (config.default && typeof config.default === "object" && "dynamic" in config.default
      ? config.default.dynamic
      : "constant");
  const names: Record<DefinitionKind, string> = {
    entities: "موجودیت",
    fields: "ورودی فرم",
    lookups: "لیست پایه",
    values: "مقدار لیست",
  };
  return (
    <form
      className="engine-definition-editor"
      onSubmit={async (event) => {
        event.preventDefault();
        if (kind === "fields") {
          const problems = [
            ...conditionProblems(config.required_if, conditionFields),
            ...conditionProblems(config.visible_if, conditionFields),
          ];
          if (problems.length) {
            useUIStore.getState().toast(`شرط‌های این ورودی کامل نیست: ${problems[0]}`, "error");
            return;
          }
        }
        const keys =
          kind === "entities"
            ? [
                "code",
                "title",
                "description",
                "icon",
                "is_active",
                "parent",
                "title_field",
                "numbering",
                "record_permissions",
              ]
            : kind === "lookups"
              ? ["code", "title", "description", "is_active"]
              : kind === "values"
                ? ["code", "title", "category", "color", "icon", "position", "is_default", "is_active", "parent"]
                : [
                    "code",
                    "title",
                    "kind",
                    "help_text",
                    "placeholder",
                    "config",
                    "lookup",
                    "relation_entity",
                    "is_active",
                    "show_in_summary",
                    "searchable",
                    "filterable",
                    "table_visible",
                    "hidden_from_form",
                  ];
        const payload = Object.fromEntries(
          keys
            .filter(
              (key) =>
                key in data &&
                !(
                  locked &&
                  ![
                    "title",
                    "help_text",
                    "placeholder",
                    "is_active",
                    "show_in_summary",
                    "searchable",
                    "filterable",
                    "table_visible",
                    "hidden_from_form",
                    "code",
                    "config",
                  ].includes(key)
                )
            )
            .map((key) => [key, data[key as keyof EditableDefinition]])
        );
        try {
          const saved = await mutation.mutateAsync({
            path: `definitions/${kind}/${row?.id ? `${row.id}/` : ""}`,
            method: row?.id ? "patch" : "post",
            data: payload,
          });
          onSaved?.(saved as EditableDefinition);
          onClose();
        } catch {
          /* Keep the form open with the server error. */
        }
      }}
    >
      <header>
        <h2>
          {row?.id ? "ویرایش" : "ایجاد"} {names[kind]}
        </h2>
        <Button variant="ghost" onClick={onClose}>
          بستن
        </Button>
      </header>
      <div className="engine-editor-grid">
        <label>
          {kind === "fields" ? "نام ورودی (همان چیزی که کاربر می‌بیند)" : "عنوان"}
          <input
            required
            value={data.title || ""}
            placeholder={kind === "fields" ? "مثلاً شماره تماس مشتری" : undefined}
            onChange={(e) => set("title", e.target.value)}
          />
        </label>
        <label>
          کد یکتا (انگلیسی)
          <input
            required
            dir="ltr"
            pattern="[a-z][a-z0-9_\-]*"
            title="با حرف کوچک انگلیسی شروع شود؛ فقط حرف، عدد، خط تیره یا زیرخط"
            placeholder="customer_phone"
            disabled={Boolean(row?.id) && (kind !== "fields" || locked)}
            value={data.code || ""}
            onChange={(e) => set("code", e.target.value.toLowerCase().replace(/\s+/g, "_"))}
          />
          <small>
            {kind === "fields" && locked
              ? "این ورودی داده ثبت‌شده دارد؛ کد آن ثابت می‌ماند."
              : "برای گزارش‌ها و اتصال‌ها استفاده می‌شود و در فرم دیده نمی‌شود."}
          </small>
        </label>
      </div>
      {(kind === "entities" || kind === "lookups") && (
        <label>
          توضیحات
          <textarea value={data.description || ""} onChange={(e) => set("description", e.target.value)} />
        </label>
      )}
      <label className="engine-checkbox">
        <input
          type="checkbox"
          checked={data.is_active ?? true}
          onChange={(e) => {
            if (window.confirm(e.target.checked ? "این تعریف فعال شود؟" : "این تعریف غیرفعال شود؟"))
              set("is_active", e.target.checked);
          }}
        />{" "}
        {kind === "fields" ? "این ورودی فعال است" : "فعال"}
      </label>
      {kind === "entities" && (
        <>
          <label>
            آیکون یا ایموجی
            <input value={data.icon || ""} onChange={(e) => set("icon", e.target.value)} />
          </label>
          <SearchableSelect
            label="موجودیت مادر (برای زیرنوع)"
            value={data.parent || ""}
            disabled={Boolean(row?.id)}
            options={[
              { id: "", title: "موجودیت اصلی" },
              ...(catalog?.entities
                .filter((v) => !v.parent && v.id !== row?.id)
                .map((v) => ({ id: v.id, title: v.title })) || []),
            ]}
            onChange={(v) => set("parent", v || null)}
          />
          <label>
            کد فیلد عنوان رکورد
            <input value={data.title_field || "title"} onChange={(e) => set("title_field", e.target.value)} />
          </label>
          <div className="engine-editor-grid">
            <label>
              پیشوند شماره
              <input
                dir="ltr"
                value={data.numbering?.prefix || ""}
                onChange={(e) => set("numbering", { ...data.numbering, prefix: e.target.value })}
              />
            </label>
            <label>
              تعداد رقم
              <input
                type="number"
                min={1}
                max={12}
                value={data.numbering?.padding ?? 5}
                onChange={(e) => set("numbering", { ...data.numbering, padding: Number(e.target.value) })}
              />
            </label>
          </div>
          {!data.adapter && (
            <details>
              <summary>مجوزهای عملیات روی رکوردها</summary>
              <p>
                مجوز مدیریت تعریف از مجوز دسترسی به رکورد مستقل است. بدون «مشاهده همه»، کاربر فقط رکوردهای خودش را
                می‌بیند.
              </p>
              {[
                ["view", "مشاهده"],
                ["view_all", "مشاهده همه"],
                ["create", "ایجاد"],
                ["edit", "ویرایش"],
                ["delete", "حذف"],
              ].map(([key, title]) => (
                <SearchableSelect
                  key={key}
                  label={title}
                  value={
                    data.record_permissions?.[key] ||
                    `Issue.${key === "view_all" ? "ViewAll" : key[0].toUpperCase() + key.slice(1)}`
                  }
                  options={permissions.map((p) => ({ id: p.code, title: p.name }))}
                  onChange={(v) =>
                    set("record_permissions", {
                      view: "Issue.View",
                      view_all: "Issue.ViewAll",
                      create: "Issue.Create",
                      edit: "Issue.Edit",
                      delete: "Issue.Delete",
                      ...data.record_permissions,
                      [key]: v,
                    })
                  }
                />
              ))}
            </details>
          )}
        </>
      )}
      {kind === "values" && (
        <>
          <SearchableSelect
            label="لیست پایه"
            disabled={Boolean(row?.id)}
            value={data.category || ""}
            options={lookups.map((l) => ({ id: l.id, title: l.title }))}
            onChange={(v) => set("category", v)}
          />
          <div className="engine-editor-grid">
            <label>
              رنگ
              <input type="color" value={data.color || "#64748b"} onChange={(e) => set("color", e.target.value)} />
            </label>
            <label>
              آیکون
              <input value={data.icon || ""} onChange={(e) => set("icon", e.target.value)} />
            </label>
          </div>
          <SearchableSelect
            label="مقدار والد (برای لیست وابسته)"
            value={data.parent || ""}
            options={[
              { id: "", title: "بدون والد" },
              ...lookupValues
                .filter((v) => v.id !== data.id)
                .map((v) => ({
                  id: v.id,
                  title: `${lookups.find((l) => l.id === v.category)?.title || ""} / ${v.title}`,
                })),
            ]}
            onChange={(v) => set("parent", v || null)}
          />
          <small>
            برای گزینهٔ مستقل «بدون والد» را نگه دارید؛ برای گزینهٔ وابسته، مقدار متناظر از لیست والد را انتخاب کنید.
          </small>
          <label className="engine-checkbox">
            <input
              type="checkbox"
              checked={data.is_default || false}
              onChange={(e) => set("is_default", e.target.checked)}
            />
            مقدار پیش‌فرض
          </label>
        </>
      )}
      {kind === "fields" && (
        <>
          {locked && (
            <p className="engine-notice">
              این فیلد استفاده شده است؛ نوع و قواعد اصلی آن ثابت می‌مانند. نام، نمایش و مقدار اولیه را می‌توانید ویرایش
              کنید.
            </p>
          )}
          <SearchableSelect
            label="نوع ورودی"
            value={data.kind || "short_text"}
            disabled={locked}
            options={catalog?.field_kinds.map((k) => ({ id: k.code, title: k.title })) || []}
            onChange={(v) => {
              set("kind", v as FieldKind);
              set("config", v === "computed" ? { formula: { value: 0 } } : {});
              set("lookup", null);
              set("relation_entity", null);
            }}
          />
          <label>
            راهنمای کوتاه زیر ورودی (اختیاری)
            <textarea
              value={data.help_text || ""}
              placeholder="مثلاً شماره را با ۰۹ شروع کنید"
              onChange={(e) => set("help_text", e.target.value)}
            />
          </label>
          {textKinds.has(data.kind || "") && (
            <label>
              متن نمونه داخل کادر (اختیاری)
              <input value={data.placeholder || ""} onChange={(e) => set("placeholder", e.target.value)} />
            </label>
          )}
          <fieldset disabled={locked} className="engine-config-fields">
            <legend>قواعد پر کردن</legend>
            {["select", "multi_select"].includes(data.kind || "") && (
              <div>
                <SearchableSelect
                  label="منبع گزینه‌ها (لیست پایه)"
                  showLabel
                  disabled={locked}
                  value={data.lookup || ""}
                  options={lookups
                    .filter((item) => item.is_active || item.id === data.lookup)
                    .map((item) => ({ id: item.id, title: item.is_active ? item.title : `${item.title} (غیرفعال)` }))}
                  onChange={(v) => set("lookup", v || null)}
                />
                <small>
                  هر گزینه یک مقدار در این لیست است. ابتدا لیست و گزینه‌ها را بسازید، سپس لیست را اینجا انتخاب کنید.
                </small>
                {onManageLookups && !locked && (
                  <Button variant="secondary" onClick={onManageLookups}>
                    ساخت یا ویرایش لیست و گزینه‌ها
                  </Button>
                )}
              </div>
            )}
            {data.kind === "relation" && (
              <>
                <SearchableSelect
                  label="به کدام بخش متصل شود؟"
                  disabled={locked}
                  value={data.relation_entity || ""}
                  options={catalog?.entities.filter((e) => !e.parent).map((e) => ({ id: e.id, title: e.title })) || []}
                  onChange={(v) => set("relation_entity", v || null)}
                />
                <label className="engine-checkbox">
                  <input
                    type="checkbox"
                    checked={config.multiple || false}
                    onChange={(e) => updateConfig({ multiple: e.target.checked })}
                  />
                  امکان انتخاب چند مورد
                </label>
              </>
            )}
            <div className="engine-editor-grid">
              {[
                ["required", "پر کردن آن اجباری است"],
                ["readonly", "فقط نمایشی (کاربر نمی‌تواند تغییر دهد)"],
                ["unique", "مقدار تکراری ثبت نشود"],
              ].map(([key, title]) => (
                <label className="engine-checkbox" key={key}>
                  <input
                    type="checkbox"
                    checked={Boolean(config[key as keyof FieldConfig])}
                    onChange={(e) => updateConfig({ [key]: e.target.checked })}
                  />
                  {title}
                </label>
              ))}
            </div>
            <label className="engine-checkbox">
              <input
                type="checkbox"
                checked={config.editable_after_create !== false}
                onChange={(e) => updateConfig({ editable_after_create: e.target.checked })}
              />
              بعد از ثبت هم قابل ویرایش باشد
            </label>
            <div className="engine-editor-grid">
              {[
                ["min", "کمترین مقدار مجاز"],
                ["max", "بیشترین مقدار مجاز"],
                ["min_length", "کمترین تعداد حرف"],
                ["max_length", "بیشترین تعداد حرف"],
              ]
                .filter(([key]) =>
                  key.endsWith("_length") ? textKinds.has(data.kind || "") : numberKinds.has(data.kind || "")
                )
                .map(([key, title]) => (
                  <label key={key}>
                    {title}
                    <input
                      type="number"
                      value={
                        typeof config[key as keyof FieldConfig] === "number"
                          ? Number(config[key as keyof FieldConfig])
                          : ""
                      }
                      onChange={(e) => {
                        const next = { ...config };
                        if (e.target.value === "") delete next[key as "min"];
                        else next[key as "min"] = Number(e.target.value);
                        set("config", next);
                      }}
                    />
                  </label>
                ))}
            </div>
            {data.kind === "money" && (
              <label>
                واحد پول (مثلاً ریال)
                <input value={config.unit || ""} onChange={(e) => updateConfig({ unit: e.target.value })} />
              </label>
            )}
            {data.kind === "rating" && (
              <label>
                تعداد ستاره
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={config.stars || 5}
                  onChange={(e) => updateConfig({ stars: Number(e.target.value) })}
                />
              </label>
            )}
            {data.kind === "file" && (
              <>
                <label>
                  نوع فایل‌های مجاز (مثلاً pdf، jpg)
                  <input
                    dir="ltr"
                    value={config.extensions?.join(", ") || ""}
                    onChange={(e) =>
                      updateConfig({
                        extensions: e.target.value
                          .split(/[,،]/)
                          .map((v) => v.trim().toLowerCase().replace(/^\./, ""))
                          .filter(Boolean),
                      })
                    }
                  />
                </label>
                <label>
                  حداکثر حجم هر فایل (مگابایت)
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={Math.round((config.max_file_size ?? 5242880) / 1048576)}
                    onChange={(e) => updateConfig({ max_file_size: Math.max(1, Number(e.target.value)) * 1048576 })}
                  />
                </label>
              </>
            )}
            {choiceKinds.has(data.kind || "") && (
              <div>
                <SearchableSelect
                  label="فیلد والد برای محدود کردن گزینه‌ها"
                  showLabel
                  disabled={locked}
                  value={config.depends_on || ""}
                  options={[
                    { id: "", title: "وابسته نیست؛ همهٔ گزینه‌های لیست نمایش داده شوند" },
                    ...fields
                      .filter((f) => f.is_active && f.kind === "select" && f.lookup && f.code !== data.code)
                      .map((f) => ({ id: f.code, title: f.title })),
                  ]}
                  onChange={(v) => updateConfig({ depends_on: v || undefined })}
                />
                <small>
                  «وابسته نیست» یعنی انتخاب این فیلد از فیلد دیگری تأثیر نمی‌گیرد. برای وابستگی، فیلد والد باید از نوع
                  انتخاب تکی و در همین فرم باشد؛ برای هر گزینهٔ فرزند هم «مقدار والد» را در تب لیست‌های انتخابی تعیین
                  کنید.
                </small>
              </div>
            )}
            {data.kind === "computed" ? (
              <FormulaEditor value={config.formula} onChange={(formula) => updateConfig({ formula })} fields={fields} />
            ) : (
              <fieldset>
                <legend>مقدار اولیه</legend>
                <SearchableSelect
                  label="ورودی با چه مقداری پر شود؟"
                  disabled={locked}
                  value={defaultMode}
                  options={[
                    { id: "constant", title: "خالی یا یک مقدار ثابت" },
                    { id: "current_user", title: "کاربر جاری" },
                    { id: "today", title: "امروز" },
                    { id: "now", title: "زمان جاری" },
                  ].filter((option) => option.id === "constant" || dynamicDefaultsFor(data.kind).includes(option.id))}
                  onChange={(mode) =>
                    updateConfig({
                      default_dynamic: mode === "constant" ? "" : (mode as "today" | "now" | "current_user"),
                      default: null,
                    })
                  }
                />
                {defaultMode === "constant" && data.kind && (
                  <DefaultValueEditor
                    field={{
                      id: row?.id,
                      code: data.code || "",
                      kind: data.kind,
                      config,
                      lookup: data.lookup,
                      relation_entity: data.relation_entity,
                    }}
                    value={constant ?? null}
                    onChange={(value) => updateConfig({ default: value })}
                    disabled={locked}
                  />
                )}
              </fieldset>
            )}
            <ConditionEditor
              label="فقط در شرایط خاص اجباری شود"
              description="بدون شرط، اجباری بودن فقط از گزینه «اجباری» بالا پیروی می‌کند."
              value={config.required_if}
              onChange={(required_if) => updateConfig({ required_if })}
              fields={conditionFields}
              lookupValues={lookupValues}
            />
            <ConditionEditor
              label="فقط در شرایط خاص نمایش داده شود"
              description="بدون شرط، این ورودی همیشه در فرم دیده می‌شود."
              value={config.visible_if}
              onChange={(visible_if) => updateConfig({ visible_if })}
              fields={conditionFields}
              lookupValues={lookupValues}
            />
          </fieldset>
          {locked && data.kind !== "computed" && (
            <fieldset>
              <legend>مقدار اولیه ورودی</legend>
              <SearchableSelect
                label="ورودی با چه مقداری پر شود؟"
                value={defaultMode}
                options={[
                  { id: "constant", title: "خالی یا یک مقدار ثابت" },
                  { id: "current_user", title: "کاربر جاری" },
                  { id: "today", title: "امروز" },
                  { id: "now", title: "زمان جاری" },
                ].filter((option) => option.id === "constant" || dynamicDefaultsFor(data.kind).includes(option.id))}
                onChange={(mode) =>
                  updateConfig({
                    default_dynamic: mode === "constant" ? "" : (mode as "today" | "now" | "current_user"),
                    default: null,
                  })
                }
              />
              {defaultMode === "constant" && (
                <DefaultValueEditor
                  field={{
                    id: row?.id,
                    code: data.code || "",
                    kind: data.kind!,
                    config,
                    lookup: data.lookup,
                    relation_entity: data.relation_entity,
                  }}
                  value={constant ?? null}
                  onChange={(value) => updateConfig({ default: value })}
                />
              )}
            </fieldset>
          )}
          <fieldset>
            <legend>نمایش در جدول و جستجو</legend>
            <label className="engine-checkbox">
              <input
                type="checkbox"
                checked={Boolean(data.hidden_from_form)}
                onChange={(e) => {
                  if (
                    window.confirm(
                      e.target.checked
                        ? "فیلد از فرم مخفی شود؟ داده‌های قبلی در جدول باقی می‌مانند و فقط‌خواندنی هستند."
                        : "فیلد دوباره در فرم فعال شود؟"
                    )
                  )
                    set("hidden_from_form", e.target.checked);
                }}
              />
              دیگر در فرم نمایش داده نشود (داده‌های قبلی حفظ می‌شود)
            </label>
            {[
              ["show_in_summary", "در خلاصه رکورد نمایش داده شود"],
              ["searchable", "در جستجو پیدا شود"],
              ["filterable", "در فیلترها قابل انتخاب باشد"],
              ["table_visible", "به‌عنوان ستون جدول قابل انتخاب باشد"],
            ].map(([key, title]) => (
              <label className="engine-checkbox" key={key}>
                <input
                  type="checkbox"
                  checked={Boolean(data[key as keyof EditableDefinition] ?? key !== "show_in_summary")}
                  onChange={(e) => setData((old) => ({ ...old, [key]: e.target.checked }))}
                />
                {title}
              </label>
            ))}
          </fieldset>
        </>
      )}
      <footer className="engine-form-footer">
        <Button type="submit" disabled={mutation.isPending}>
          ذخیره {names[kind]}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          انصراف
        </Button>
      </footer>
    </form>
  );
}
