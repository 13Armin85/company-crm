import { useState } from "react";
import { SearchableSelect } from "@plane/ui";
import { DefaultValueEditor, dynamicDefaultsFor } from "./default-value-editor";
import type { FieldConfig, FieldKind } from "@plane/ui";
import { useOrganizationPermissions, errorMessage } from "../api";
import { Button } from "../components";
import { useEngineMutation, useEngineDefinitions, useEngineCatalog } from "./api";
import type { EntityDefinition, FieldDefinition, LookupDefinition, LookupOptionDefinition } from "./api";
import { ConditionEditor, FormulaEditor } from "./rule-editors";

export type DefinitionKind = "entities" | "fields" | "lookups" | "values";
export type EditableDefinition = Partial<
  EntityDefinition & FieldDefinition & LookupDefinition & LookupOptionDefinition
>;

export function DefinitionEditor({
  kind,
  row,
  onClose,
  onSaved,
}: {
  kind: DefinitionKind;
  row?: EditableDefinition;
  onClose: () => void;
  onSaved?: (row?: EditableDefinition) => void;
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
  const [data, setData] = useState<EditableDefinition>({
    code: "",
    title: "",
    description: "",
    is_active: true,
    kind: "short_text",
    config: {},
    color: "#64748b",
    position: 0,
    numbering: { prefix: "REC", padding: 5 },
    ...row,
  });
  const set = <K extends keyof EditableDefinition>(key: K, value: EditableDefinition[K]) =>
    setData((old) => ({ ...old, [key]: value }));
  const config = data.config || {},
    updateConfig = (patch: Partial<FieldConfig>) => set("config", { ...config, ...patch });
  const locked = Boolean(row?.used_at);
  const constant =
    config.default && typeof config.default === "object" && "dynamic" in config.default ? null : config.default;
  const defaultMode =
    config.default_dynamic ||
    (config.default && typeof config.default === "object" && "dynamic" in config.default
      ? config.default.dynamic
      : "constant");
  const names: Record<DefinitionKind, string> = {
    entities: "موجودیت",
    fields: "فیلد",
    lookups: "لیست پایه",
    values: "مقدار لیست",
  };
  return (
    <form
      className="engine-definition-editor"
      onSubmit={async (event) => {
        event.preventDefault();
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
      {mutation.error && <p role="alert">{errorMessage(mutation.error, "تعریف ذخیره نشد.")}</p>}
      <div className="engine-editor-grid">
        <label>
          عنوان فارسی
          <input required value={data.title || ""} onChange={(e) => set("title", e.target.value)} />
        </label>
        <label>
          کد یکتا
          <input
            required
            dir="ltr"
            pattern="[a-z][a-z0-9_-]*"
            disabled={Boolean(row?.id)}
            value={data.code || ""}
            onChange={(e) => set("code", e.target.value)}
          />
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
        فعال
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
            label="مقدار والد"
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
          {locked && <p className="engine-notice">این فیلد استفاده شده است؛ نوع و قواعد اصلی آن قابل تغییر نیستند.</p>}
          <SearchableSelect
            label="نوع فیلد"
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
            راهنما
            <textarea value={data.help_text || ""} onChange={(e) => set("help_text", e.target.value)} />
          </label>
          <label>
            متن جایگزین ورودی
            <input value={data.placeholder || ""} onChange={(e) => set("placeholder", e.target.value)} />
          </label>
          <fieldset disabled={locked} className="engine-config-fields">
            <legend>قواعد و رفتار</legend>
            {["select", "multi_select"].includes(data.kind || "") && (
              <SearchableSelect
                label="لیست پایه"
                disabled={locked}
                value={data.lookup || ""}
                options={lookups.map((l) => ({ id: l.id, title: l.title }))}
                onChange={(v) => set("lookup", v || null)}
              />
            )}
            {data.kind === "relation" && (
              <>
                <SearchableSelect
                  label="موجودیت مقصد"
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
                  چندرکوردی
                </label>
              </>
            )}
            <div className="engine-editor-grid">
              {[
                ["required", "اجباری"],
                ["readonly", "فقط‌خواندنی"],
                ["hidden", "مخفی"],
                ["unique", "مقدار یکتا"],
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
              قابل ویرایش پس از ثبت
            </label>
            <div className="engine-editor-grid">
              {[
                ["min", "حداقل مقدار"],
                ["max", "حداکثر مقدار"],
                ["min_length", "حداقل طول"],
                ["max_length", "حداکثر طول"],
              ].map(([key, title]) => (
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
            <label>
              الگوی اعتبارسنجی متن
              <input dir="ltr" value={config.regex || ""} onChange={(e) => updateConfig({ regex: e.target.value })} />
            </label>
            <label>
              پیام خطای الگو
              <input
                value={config.regex_message || ""}
                onChange={(e) => updateConfig({ regex_message: e.target.value })}
              />
            </label>
            {data.kind === "money" && (
              <label>
                واحد مبلغ
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
                  پسوندهای مجاز (جداشده با ویرگول)
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
                  حداکثر حجم به بایت
                  <input
                    type="number"
                    min={1}
                    value={config.max_file_size ?? 5242880}
                    onChange={(e) => updateConfig({ max_file_size: Number(e.target.value) })}
                  />
                </label>
              </>
            )}
            <SearchableSelect
              label="فیلد والد برای انتخاب وابسته"
              disabled={locked}
              value={config.depends_on || ""}
              options={[
                { id: "", title: "مستقل" },
                ...fields.filter((f) => f.code !== data.code).map((f) => ({ id: f.code, title: f.title })),
              ]}
              onChange={(v) => updateConfig({ depends_on: v || undefined })}
            />
            {data.kind === "computed" ? (
              <FormulaEditor value={config.formula} onChange={(formula) => updateConfig({ formula })} fields={fields} />
            ) : (
              <fieldset>
                <legend>مقدار پیش‌فرض</legend>
                <SearchableSelect
                  label="روش مقدار پیش‌فرض"
                  disabled={locked}
                  value={defaultMode}
                  options={[
                    { id: "constant", title: "ثابت / بدون پیش‌فرض" },
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
              label="اجباری شرطی"
              value={config.required_if}
              onChange={(required_if) => updateConfig({ required_if })}
              fields={fields}
              lookupValues={lookupValues}
            />
            <ConditionEditor
              label="نمایش شرطی"
              value={config.visible_if}
              onChange={(visible_if) => updateConfig({ visible_if })}
              fields={fields}
              lookupValues={lookupValues}
            />
          </fieldset>
          <fieldset>
            <legend>قابلیت‌های نمایش</legend>
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
              مخفی از فرم؛ حفظ داده‌های قبلی در جدول
            </label>
            {[
              ["show_in_summary", "نمایش در خلاصه اطلاعات"],
              ["searchable", "قابل جستجو"],
              ["filterable", "قابل فیلتر"],
              ["table_visible", "قابل نمایش در جدول"],
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
