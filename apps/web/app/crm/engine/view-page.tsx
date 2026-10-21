import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { Plus, SlidersHorizontal, Filter, Download, Palette, X } from "lucide-react";
import { SchemaDrivenForm, SearchableSelect, zonedDateTime, parseDateOnly } from "@plane/ui";
import type { Condition, EntityFormSchema, FieldValue, FormValues } from "@plane/ui";
import { jalaaliMonthLength, toGregorian } from "jalaali-js";
import { api, errorMessage, useWorkspaceAccess } from "../api";
import { Button, EmptyState, PageHeader, SearchBox, Skeleton } from "../components";
import { useUIStore } from "../store";
import { useEngineCatalog, useEngineQuery, useEngineMutation, useEngineSlug, enginePath } from "./api";
import { ViewFilterEditor, ColumnEditor, ViewValueInput } from "./view-controls";
import { ViewRenderer, ViewValue, numberText } from "./view-renderers";
import { viewKinds } from "./view-types";
import { entityDisplayTitle } from "./presentation";
import type {
  ViewDefinition,
  ViewField,
  ViewSchema,
  ViewResult,
  SavedView,
  SavedViewList,
  ViewRow,
  Presentation,
  FormatRule,
  SummarySetting,
} from "./view-types";

function ViewDrawer({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} className="engine-view-dialog">
      <div className="engine-view-backdrop" />
      <DialogPanel className="engine-view-drawer">
        <div className="engine-actions">
          <DialogTitle>{title}</DialogTitle>
          <button type="button" aria-label="بستن تنظیمات" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </DialogPanel>
    </Dialog>
  );
}

function RecipientInput({
  code,
  kind,
  value,
  onChange,
  title,
}: {
  code: string;
  kind: "roles" | "units" | "users";
  value: string[];
  onChange: (ids: string[]) => void;
  title: string;
}) {
  const slug = useEngineSlug();
  const schema: EntityFormSchema = {
    entity: code,
    title,
    schema_version: 1,
    fields: [
      { id: kind, code: kind, title, kind: "multi_select", config: {}, binding: { field: kind }, is_active: true },
    ],
    layout: { tabs: [], sections: [{ id: "recipients", columns: 1, bindings: [{ field: kind }] }] },
  };
  return (
    <SchemaDrivenForm
      schema={schema}
      values={{ [kind]: value }}
      onChange={(values) => onChange(values[kind] as string[])}
      loadOptions={async (_field, search, page, _parent, selected, resolve) =>
        (
          await api.get(`${enginePath(slug)}/entities/${code}/view-schema/`, {
            params: { recipients: kind, search, page, ...(resolve ? { selected: selected?.join(",") } : {}) },
          })
        ).data
      }
    />
  );
}

function SaveViewEditor({
  code,
  definition,
  original,
  copy,
  onSaved,
}: {
  code: string;
  definition: ViewDefinition;
  original?: SavedView;
  copy: boolean;
  onSaved: (id: string) => void;
}) {
  const { data: access } = useWorkspaceAccess(),
    mutation = useEngineMutation();
  const [name, setName] = useState(original ? original.name + (copy ? " (کپی)" : "") : "نمای جدید");
  const [visibility, setVisibility] = useState<SavedView["visibility"]>(
    copy ? "personal" : original?.visibility || "personal"
  );
  const [recipients, setRecipients] = useState(
    original && !copy ? original.recipients : ({} as SavedView["recipients"])
  );
  const [defaults, setDefaults] = useState(original && !copy ? original.default_roles : []);
  return (
    <form
      className="engine-view-settings"
      onSubmit={(e) => {
        e.preventDefault();
        void mutation
          .mutateAsync({
            path: `entities/${code}/views/${original && !copy ? `${original.id}/` : ""}`,
            method: original && !copy ? "patch" : "post",
            data: {
              name,
              visibility,
              definition,
              recipients: visibility === "shared" ? recipients : {},
              default_roles: visibility === "official" ? defaults : [],
              revision: original?.revision,
            },
          })
          .then((result) => onSaved((result as SavedView).id))
          .catch(() => {});
      }}
    >
      <label>
        نام نما
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={255} />
      </label>
      <SearchableSelect
        label="نوع دسترسی"
        value={visibility}
        disabled={Boolean(original && !copy)}
        options={[
          ...(access?.can("View.Create.Personal") ? [{ id: "personal", title: "شخصی؛ فقط خودم" }] : []),
          ...(access?.can("View.Create.Shared") ? [{ id: "shared", title: "اشتراکی؛ گیرندگان مشخص" }] : []),
          ...(access?.can("View.Manage.All") ? [{ id: "official", title: "رسمی" }] : []),
        ]}
        onChange={(v) => setVisibility(v as SavedView["visibility"])}
      />
      {visibility === "shared" && (
        <>
          {(["roles", "units", "users"] as const).map((kind) => (
            <RecipientInput
              key={kind}
              code={code}
              kind={kind}
              value={recipients[kind] || []}
              title={{ roles: "نقش‌های گیرنده", units: "واحدهای گیرنده", users: "کاربران گیرنده" }[kind]}
              onChange={(ids) => setRecipients({ ...recipients, [kind]: ids })}
            />
          ))}
          <p>اشتراک نما، مجوز مشاهده رکورد یا فیلد به گیرندگان اضافه نمی‌کند.</p>
        </>
      )}
      {visibility === "official" && (
        <RecipientInput code={code} kind="roles" title="نمای پیش‌فرض نقش‌ها" value={defaults} onChange={setDefaults} />
      )}
      {mutation.error && <p role="alert">{errorMessage(mutation.error, "ذخیره نما انجام نشد.")}</p>}
      <Button type="submit" disabled={mutation.isPending}>
        ذخیره نما
      </Button>
    </form>
  );
}

function PresentationEditor({
  code,
  fields,
  value,
  onSaved,
}: {
  code: string;
  fields: ViewField[];
  value: Presentation;
  onSaved: () => void;
}) {
  const { data: access } = useWorkspaceAccess(),
    mutation = useEngineMutation();
  const [rules, setRules] = useState<FormatRule[]>(value.rules || []),
    [summary, setSummary] = useState<SummarySetting[]>(
      value.summary || fields.filter((f) => f.show_in_summary).map((f) => ({ field: f.code }))
    );
  const { data: catalog } = useEngineCatalog(),
    entity = catalog?.entities.find((e) => e.code === code);
  const updateRule = (index: number, patch: Partial<FormatRule>) =>
    setRules(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  return (
    <div className="engine-view-settings">
      {access?.can("ConditionalFormat.Edit") && (
        <>
          <h3>قواعد رنگ‌بندی رسمی</h3>
          <p>اولویت بزرگ‌تر در تعارض مقدم است. شرط مبتنی بر فیلد بدون دسترسی برای آن کاربر اعمال نمی‌شود.</p>
          {rules.map((rule, index) => (
            <section className="engine-view-rule" key={index}>
              <ViewFilterEditor
                value={rule.when}
                fields={fields}
                onChange={(when) =>
                  when ? updateRule(index, { when }) : setRules(rules.filter((_, i) => i !== index))
                }
              />
              <SearchableSelect
                label="هدف قاعده"
                value={rule.target}
                options={[
                  { id: "row", title: "ردیف / کارت" },
                  { id: "cell", title: "سلول" },
                  { id: "badge", title: "برچسب" },
                ]}
                onChange={(target) =>
                  updateRule(index, { target: target as FormatRule["target"], field: fields[0]?.code })
                }
              />
              {rule.target !== "row" && (
                <SearchableSelect
                  label="فیلد هدف"
                  value={rule.field || ""}
                  options={fields.map((f) => ({ id: f.code, title: f.title }))}
                  onChange={(field) => updateRule(index, { field })}
                />
              )}
              <label>
                اولویت
                <input
                  type="number"
                  value={rule.priority}
                  onChange={(e) => updateRule(index, { priority: Number(e.target.value) })}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(rule.style.background)}
                  onChange={(e) =>
                    updateRule(index, {
                      style: { ...rule.style, background: e.target.checked ? "#fee2e2" : undefined },
                    })
                  }
                />
                رنگ پس‌زمینه
                <input
                  aria-label="رنگ پس‌زمینه"
                  type="color"
                  value={rule.style.background || "#ffffff"}
                  onChange={(e) => updateRule(index, { style: { ...rule.style, background: e.target.value } })}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(rule.style.color)}
                  onChange={(e) =>
                    updateRule(index, { style: { ...rule.style, color: e.target.checked ? "#b91c1c" : undefined } })
                  }
                />
                رنگ متن
                <input
                  aria-label="رنگ متن"
                  type="color"
                  value={rule.style.color || "#111827"}
                  onChange={(e) => updateRule(index, { style: { ...rule.style, color: e.target.value } })}
                />
              </label>
              <SearchableSelect
                label="آیکون"
                value={rule.style.icon || ""}
                options={[
                  { id: "", title: "بدون آیکون" },
                  { id: "warning", title: "هشدار" },
                  { id: "clock", title: "ساعت" },
                  { id: "check", title: "تأیید" },
                  { id: "flag", title: "پرچم" },
                  { id: "info", title: "اطلاعات" },
                ]}
                onChange={(icon) =>
                  updateRule(index, {
                    style: { ...rule.style, icon: (icon as FormatRule["style"]["icon"]) || undefined },
                  })
                }
              />
              <button type="button" onClick={() => setRules(rules.filter((_, i) => i !== index))}>
                حذف قاعده
              </button>
            </section>
          ))}
          <Button
            variant="secondary"
            onClick={() =>
              setRules([
                ...rules,
                {
                  when: { field: fields[0]?.code || "", op: "not_empty" },
                  priority: rules.length,
                  target: "row",
                  style: { background: "#fee2e2" },
                },
              ])
            }
          >
            افزودن قاعده
          </Button>
        </>
      )}
      {access?.can("View.Manage.All") && (
        <>
          <h3>خلاصه بالای جزئیات رکورد</h3>
          <SearchableSelect
            label="افزودن فیلد خلاصه"
            value=""
            options={fields.map((f) => ({ id: f.code, title: f.title }))}
            onChange={(field) => setSummary([...summary, { field }])}
          />
          {summary.map((item, index) => (
            <section className="engine-view-rule" key={index}>
              <strong>{fields.find((f) => f.code === item.field)?.title || item.field}</strong>
              <SearchableSelect
                label="زیرنوع خلاصه"
                value={item.subtype || ""}
                options={[
                  { id: "", title: "همه زیرنوع‌ها" },
                  ...(catalog?.entities
                    .filter((e) => e.parent === entity?.id)
                    .map((e) => ({ id: e.code, title: e.title })) || []),
                ]}
                onChange={(subtype) => setSummary(summary.map((s, i) => (i === index ? { ...s, subtype } : s)))}
              />
              <RecipientInput
                code={code}
                kind="roles"
                title="نقش‌های مشاهده خلاصه؛ خالی یعنی همه نقش‌های مجاز فیلد"
                value={item.roles || []}
                onChange={(roles) => setSummary(summary.map((s, i) => (i === index ? { ...s, roles } : s)))}
              />
              <button
                type="button"
                disabled={!index}
                onClick={() => {
                  const next = [...summary];
                  [next[index - 1], next[index]] = [next[index], next[index - 1]];
                  setSummary(next);
                }}
              >
                ↑
              </button>
              <button type="button" onClick={() => setSummary(summary.filter((_, i) => i !== index))}>
                حذف از خلاصه
              </button>
            </section>
          ))}
        </>
      )}
      <Button
        disabled={mutation.isPending}
        onClick={() =>
          void mutation
            .mutateAsync({
              path: `entities/${code}/presentation/`,
              method: "put",
              data: {
                ...(access?.can("ConditionalFormat.Edit") ? { rules } : {}),
                ...(access?.can("View.Manage.All") ? { summary } : {}),
              },
            })
            .then(onSaved)
            .catch(() => {})
        }
      >
        ذخیره تنظیمات رسمی
      </Button>
      {mutation.error && <p role="alert">{errorMessage(mutation.error, "ذخیره تنظیمات انجام نشد.")}</p>}
    </div>
  );
}

export function EntityViewsPage() {
  const { code = "" } = useParams(),
    slug = useEngineSlug(),
    { data: access } = useWorkspaceAccess();
  const { data: catalog } = useEngineCatalog(),
    entity = catalog?.entities.find((e) => e.code === code);
  const [subtype, setSubtype] = useState("");
  const schema = useEngineQuery<ViewSchema>(
    "view-schema",
    `entities/${code}/view-schema/?${new URLSearchParams({ subtype })}`
  );
  const saved = useEngineQuery<SavedViewList>("views", `entities/${code}/views/`);
  const [definition, setDefinition] = useState<ViewDefinition | null>(null),
    [selectedView, setSelectedView] = useState("");
  const [extraFields, setExtraFields] = useState<ViewField[]>([]),
    [search, setSearch] = useState(""),
    [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1),
    [selected, setSelected] = useState<string[]>([]),
    [drawer, setDrawer] = useState<"columns" | "filter" | "save" | "copy" | "presentation" | "exports" | "bulk" | null>(
      null
    );
  const [calendarDate, setCalendarDate] = useState(zonedDateTime(new Date(), "Asia/Tehran")!.date),
    [bulkField, setBulkField] = useState(""),
    [bulkValue, setBulkValue] = useState<FieldValue>(null),
    [bulkResult, setBulkResult] = useState<{ id: string; ok: boolean; error?: unknown }[]>([]);
  const [quickField, setQuickField] = useState(""),
    [quickValue, setQuickValue] = useState<FieldValue>(null);
  const mutation = useEngineMutation();
  useEffect(() => {
    setDefinition(null);
    setSubtype("");
    setSelectedView("");
    setExtraFields([]);
    setPage(1);
    setSelected([]);
  }, [code]);
  useEffect(() => {
    if (!definition && schema.data && saved.data) {
      const view = saved.data.results.find((v) => v.id === saved.data.default_id);
      setDefinition(view?.definition || schema.data.definition);
      setSubtype(view?.definition.subtype || "");
      setSelectedView(view?.id || "");
    }
  }, [definition, schema.data, saved.data]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const fields = [
    ...(schema.data?.fields || []),
    ...extraFields.filter((f) => !schema.data?.fields.some((old) => old.code === f.code)),
  ].map((field) => ({ ...field, title: entityDisplayTitle(field.title) }));
  const effective = useMemo(() => {
    if (!definition) return null;
    if (definition.type !== "calendar" || !definition.settings?.calendar_field) return definition;
    const date = parseDateOnly(calendarDate)!,
      a = toGregorian(date.jy, date.jm, 1),
      b = toGregorian(date.jy, date.jm, jalaaliMonthLength(date.jy, date.jm));
    const iso = (v: typeof a) => `${v.gy}-${String(v.gm).padStart(2, "0")}-${String(v.gd).padStart(2, "0")}`;
    return { ...definition, settings: { ...definition.settings, calendar_start: iso(a), calendar_end: iso(b) } };
  }, [definition, calendarDate]);
  const records = useQuery({
    queryKey: [
      "entity-engine",
      slug,
      "view-query",
      code,
      effective,
      debouncedSearch,
      page,
      selectedView.startsWith("system:") ? selectedView : "",
    ],
    enabled: Boolean(slug && effective),
    queryFn: async ({ signal }): Promise<ViewResult> =>
      (
        await api.post(
          `${enginePath(slug)}/entities/${code}/query/`,
          {
            definition: effective,
            search: debouncedSearch,
            page,
            page_size: 100,
            ...(selectedView ? { view_id: selectedView } : {}),
          },
          { signal }
        )
      ).data,
  });
  const exports = useQuery({
    queryKey: ["entity-engine", slug, "exports", code],
    enabled: Boolean(slug && drawer === "exports" && access?.can("Export.Data")),
    refetchInterval: drawer === "exports" ? 3000 : false,
    queryFn: async (): Promise<{
      results: { id: string; status: string; error: string; row_count: number; format: string }[];
    }> => (await api.get(`${enginePath(slug)}/entities/${code}/exports/`)).data,
  });
  const update = (next: ViewDefinition) => {
    setSubtype(next.subtype || "");
    setDefinition(next);
    setPage(1);
    setSelected([]);
  };
  const loadPath = async (path: string) => {
    try {
      const result = await api.get<ViewSchema>(`${enginePath(slug)}/entities/${code}/view-schema/`, {
        params: { path, subtype: definition?.subtype },
      });
      setExtraFields((old) => [
        ...old.filter((f) => !result.data.fields.some((next) => next.code === f.code)),
        ...result.data.fields.map((f) => ({
          ...f,
          title: `${fields.find((parent) => parent.code === path)?.title || path} ← ${f.title}`,
        })),
      ]);
    } catch (error) {
      useUIStore.getState().toast(errorMessage(error, "دسترسی به مسیر ارتباط ندارید."), "error");
    }
  };
  useEffect(() => {
    if (!definition) return;
    const filterPaths = (node?: Condition | null): string[] =>
      node ? ("rules" in node ? node.rules.flatMap(filterPaths) : [node.field]) : [];
    const paths = new Set(
      [
        ...definition.columns.map((c) => c.field),
        ...definition.sort.map((s) => s.field),
        definition.group || "",
        ...filterPaths(definition.filter),
      ]
        .filter((path) => path.includes("."))
        .map((path) => path.split(".").slice(0, -1).join("."))
    );
    for (const path of paths) if (!extraFields.some((f) => f.code.startsWith(path + "."))) void loadPath(path);
  }, [
    JSON.stringify([definition?.columns, definition?.sort, definition?.group, definition?.filter, definition?.subtype]),
  ]);
  const activeView = saved.data?.results.find((v) => v.id === selectedView);
  const chooseView = (id: string) => {
    const view = saved.data?.results.find((v) => v.id === id);
    setSelectedView(id);
    update(view?.definition || schema.data!.definition);
  };
  const move = async (row: ViewRow, field: string, value: FieldValue) => {
    if (field.includes(".")) return;
    try {
      await mutation.mutateAsync({
        path: `entities/${code}/records/${row.id}/`,
        method: "patch",
        data: { values: { [field]: value }, revision: row.revision },
      });
    } catch {
      /* Mutation presents the server error; query data remains unchanged. */
    }
  };
  const runBulk = async (operation: "update" | "assign" | "delete") => {
    if (!selected.length || !records.data) return;
    if (
      operation === "delete" &&
      !window.confirm(`حذف ${selected.length} رکورد انتخاب‌شده؟ نتیجه هر رکورد جداگانه گزارش می‌شود.`)
    )
      return;
    try {
      const result = (await mutation.mutateAsync({
        path: `entities/${code}/bulk/`,
        data: {
          ids: selected,
          operation,
          values: operation === "delete" ? {} : { [bulkField]: bulkValue },
          revisions: Object.fromEntries(
            records.data.results.filter((r) => selected.includes(r.id)).map((r) => [r.id, r.revision])
          ),
        },
      })) as { results: typeof bulkResult };
      setBulkResult(result.results);
      setSelected(result.results.filter((r) => !r.ok).map((r) => r.id));
    } catch {
      /* Shared mutation shows failure. */
    }
  };
  if (schema.error || saved.error)
    return <p role="alert">{errorMessage(schema.error || saved.error, "دریافت تنظیمات نما انجام نشد.")}</p>;
  if (schema.isLoading || saved.isLoading || !definition) return <Skeleton rows={6} />;
  const currentData = records.data;
  return (
    <div className="engine-views-page">
      <PageHeader
        eyebrow="موجودیت‌ها و فرم‌ها"
        title={entityDisplayTitle(entity?.title || "رکوردها")}
        description="رکوردهای این فرم را جستجو کنید و با نمای دلخواه ببینید."
        actions={
          <div className="engine-actions">
            <Link className="button button-secondary" to="/entities">
              همه فرم‌ها
            </Link>
            {entity?.can_create && (
              <Link className="button button-primary" to={`/entities/${code}/new`}>
                <Plus size={16} aria-hidden="true" />
                ثبت جدید
              </Link>
            )}
          </div>
        }
      />
      <section className="engine-view-controls" aria-label="تنظیمات و جستجوی رکوردها">
        <div className="engine-view-toolbar engine-view-toolbar-main">
          <div className="engine-view-selectors">
            {catalog?.entities.some((e) => e.parent === entity?.id) && (
              <SearchableSelect
                showLabel
                label="زیرنوع نما"
                value={subtype}
                options={[
                  { id: "", title: "همه زیرنوع‌ها؛ فیلدهای مشترک" },
                  ...(catalog?.entities
                    .filter((e) => e.parent === entity?.id)
                    .map((e) => ({ id: e.code, title: entityDisplayTitle(e.title) })) || []),
                ]}
                onChange={(value) => {
                  setExtraFields([]);
                  update({ ...definition, subtype: value || undefined });
                }}
              />
            )}
            <SearchableSelect
              showLabel
              label="نمای ذخیره‌شده"
              value={selectedView}
              options={[
                { id: "", title: "نمای پایه" },
                ...(saved.data?.system.map((v) => ({ id: v.id, title: entityDisplayTitle(v.name) })) || []),
                ...(saved.data?.results.map((v) => ({
                  id: v.id,
                  title:
                    entityDisplayTitle(v.name) +
                    (v.visibility === "personal" ? " · شخصی" : v.visibility === "shared" ? " · اشتراکی" : " · رسمی"),
                })) || []),
              ]}
              onChange={chooseView}
            />
            <SearchableSelect
              showLabel
              label="نوع نما"
              value={definition.type}
              options={viewKinds}
              onChange={(type) => update({ ...definition, type: type as ViewDefinition["type"] })}
            />
          </div>
          <div className="engine-view-tools">
            <Button variant="secondary" onClick={() => setDrawer("columns")}>
              <SlidersHorizontal size={16} />
              ستون‌ها و ترتیب
            </Button>
            <Button variant="secondary" onClick={() => setDrawer("filter")}>
              <Filter size={16} />
              فیلتر پیشرفته
            </Button>
            {(access?.can("ConditionalFormat.Edit") || access?.can("View.Manage.All")) && (
              <Button variant="secondary" onClick={() => setDrawer("presentation")}>
                <Palette size={16} />
                ظاهر و خلاصه رسمی
              </Button>
            )}
            {access?.can("Export.Data") && (
              <Button variant="secondary" onClick={() => setDrawer("exports")}>
                <Download size={16} />
                خروجی
              </Button>
            )}
          </div>
        </div>
        <div className="engine-view-toolbar engine-view-toolbar-search">
          <SearchBox value={search} onChange={setSearch} placeholder="جستجو در فیلدهای مجاز…" />
          <SearchableSelect
            showLabel
            label="فیلتر سریع"
            value={quickField}
            options={[
              { id: "", title: "انتخاب فیلد" },
              ...fields.filter((f) => f.filterable).map((f) => ({ id: f.code, title: f.title })),
            ]}
            onChange={(field) => {
              setQuickField(field);
              setQuickValue(null);
            }}
          />
          {fields.find((f) => f.code === quickField) && (
            <ViewValueInput
              field={fields.find((f) => f.code === quickField)!}
              value={quickValue}
              onChange={setQuickValue}
            />
          )}
          {quickField && (
            <Button
              variant="secondary"
              onClick={() => {
                const rule: Condition = { field: quickField, op: "eq", value: quickValue };
                update({
                  ...definition,
                  filter: definition.filter ? { op: "and", rules: [definition.filter, rule] } : rule,
                });
              }}
            >
              اعمال فیلتر سریع
            </Button>
          )}
        </div>
        <div className="engine-view-toolbar engine-view-toolbar-actions">
          {definition.filter && (
            <button
              type="button"
              className="engine-filter-chip"
              onClick={() => update({ ...definition, filter: null })}
            >
              فیلترهای فعال ×
            </button>
          )}
          {(access?.can("View.Create.Personal") ||
            access?.can("View.Create.Shared") ||
            access?.can("View.Manage.All")) && (
            <Button variant="secondary" onClick={() => setDrawer("save")}>
              {activeView?.can_edit ? "ذخیره / تغییر نام نما" : "ذخیره نمای جدید"}
            </Button>
          )}
          {activeView && (
            <Button variant="secondary" onClick={() => setDrawer("copy")}>
              کپی نما
            </Button>
          )}
          {activeView?.can_edit && (
            <Button
              variant="danger"
              onClick={() => {
                if (window.confirm("نمای انتخاب‌شده حذف شود؟"))
                  void mutation
                    .mutateAsync({ path: `entities/${code}/views/${activeView.id}/`, method: "delete" })
                    .then(() =>
                      chooseView(saved.data?.default_id === activeView.id ? "" : saved.data?.default_id || "")
                    )
                    .catch(() => {});
              }}
            >
              حذف نما
            </Button>
          )}
          <Button variant="ghost" onClick={() => chooseView(saved.data?.default_id || "")}>
            بازگشت به پیش‌فرض
          </Button>
          {selected.length > 0 && (
            <Button
              onClick={() => {
                setBulkResult([]);
                setDrawer("bulk");
              }}
            >
              عملیات روی {selected.length.toLocaleString("fa-IR")} رکورد این صفحه
            </Button>
          )}
        </div>
      </section>
      {definition.type === "kanban" && (
        <div className="engine-view-axis">
          <SearchableSelect
            label="محور کانبان"
            value={definition.settings?.kanban_field || ""}
            options={fields
              .filter((f) => f.kind === "select" && !f.code.includes("."))
              .map((f) => ({ id: f.code, title: f.title }))}
            onChange={(kanban_field) =>
              update({ ...definition, settings: { ...definition.settings, kanban_field, kanban_columns: [] } })
            }
          />
          {fields.find((f) => f.code === definition.settings?.kanban_field) && (
            <ViewValueInput
              field={{
                ...fields.find((f) => f.code === definition.settings?.kanban_field)!,
                title: "ستون‌های منتخب کانبان",
              }}
              multiple
              value={definition.settings?.kanban_columns || []}
              onChange={(value) =>
                update({
                  ...definition,
                  settings: { ...definition.settings, kanban_columns: Array.isArray(value) ? value.map(String) : [] },
                })
              }
            />
          )}
        </div>
      )}
      {definition.type === "calendar" && (
        <SearchableSelect
          label="محور تاریخ تقویم"
          value={definition.settings?.calendar_field || ""}
          options={fields
            .filter((f) => ["date", "datetime", "date_range"].includes(f.kind) && !f.code.includes("."))
            .map((f) => ({ id: f.code, title: f.title }))}
          onChange={(calendar_field) => update({ ...definition, settings: { ...definition.settings, calendar_field } })}
        />
      )}
      {records.error && (
        <p className="engine-view-warning" role="alert">
          {errorMessage(
            records.error,
            "اعمال نما انجام نشد. ممکن است فیلد فیلتر غیرفعال یا دسترسی آن تغییر کرده باشد؛ فیلتر را بررسی کنید."
          )}
        </p>
      )}
      {currentData?.warnings.map((warning, index) => (
        <p key={index} role="alert" className="engine-view-warning">
          {warning}
        </p>
      ))}
      <div className="engine-results-meta">
        <strong>{currentData?.count.toLocaleString("fa-IR") || "۰"} رکورد</strong>
        <span>
          {records.isFetching ? (
            <span role="status">دریافت نمای فعلی…</span>
          ) : (
            `${viewKinds.find((view) => view.id === definition.type)?.title || "نمای فعلی"} · مطابق فیلترهای شما`
          )}
        </span>
      </div>
      {!records.error &&
        (records.isLoading ? (
          <Skeleton rows={6} />
        ) : currentData && !currentData.results.length ? (
          <EmptyState title="رکوردی یافت نشد" description="فیلتر و محدوده مشاهده را بررسی کنید." />
        ) : (
          currentData && (
            <ViewRenderer
              code={code}
              definition={{ ...definition, columns: currentData.definition.columns }}
              data={currentData}
              fields={fields}
              onChange={update}
              selected={selected}
              onSelect={setSelected}
              onMove={move}
              calendarDate={calendarDate}
              onCalendarDate={(date) => {
                setCalendarDate(date);
                setPage(1);
              }}
            />
          )
        ))}
      {currentData?.groups.length ? (
        <section className="engine-group-summary">
          <h3>آمار کل نتایج به تفکیک گروه</h3>
          {currentData.groups.map((group, index) => (
            <div key={index}>
              <ViewValue
                value={group.value}
                field={fields.find((f) => f.code === definition.group)}
                labels={currentData.labels[definition.group || ""]}
              />{" "}
              · {group.count.toLocaleString("fa-IR")} رکورد{" "}
              {Object.entries(group.totals).map(([field, totals]) => (
                <span key={field}>
                  {fields.find((f) => f.code === field)?.title}: جمع {numberText(totals.sum)} · میانگین{" "}
                  {numberText(totals.avg)}
                </span>
              ))}
            </div>
          ))}
        </section>
      ) : null}
      <div className="engine-pagination">
        <Button
          variant="secondary"
          disabled={page <= 1 || records.isFetching}
          onClick={() => {
            setPage(page - 1);
            setSelected([]);
          }}
        >
          قبلی
        </Button>
        <span>
          صفحه {page.toLocaleString("fa-IR")} · {currentData?.count.toLocaleString("fa-IR") || "۰"} رکورد مجاز
        </span>
        <Button
          variant="secondary"
          disabled={!currentData || page * 100 >= currentData.count || records.isFetching}
          onClick={() => {
            setPage(page + 1);
            setSelected([]);
          }}
        >
          بعدی
        </Button>
      </div>
      {drawer && (
        <ViewDrawer
          title={
            {
              columns: "ستون، مرتب‌سازی و گروه‌بندی",
              filter: "فیلتر پیشرفته",
              save: "ذخیره نما",
              copy: "کپی نما",
              presentation: "تنظیمات رسمی",
              exports: "خروجی نمای فعلی",
              bulk: "عملیات گروهی",
            }[drawer]
          }
          onClose={() => setDrawer(null)}
        >
          {drawer === "columns" && (
            <ColumnEditor value={definition} fields={fields} onChange={update} onLoadPath={loadPath} />
          )}
          {drawer === "filter" && (
            <>
              <ViewFilterEditor
                value={definition.filter}
                onChange={(filter) => update({ ...definition, filter })}
                fields={fields}
              />
              <Button onClick={() => setDrawer(null)}>نمایش نتیجه</Button>
            </>
          )}
          {(drawer === "save" || drawer === "copy") && (
            <SaveViewEditor
              code={code}
              definition={definition}
              original={drawer === "copy" || activeView?.can_edit ? activeView : undefined}
              copy={drawer === "copy"}
              onSaved={(id) => {
                setSelectedView(id);
                setDrawer(null);
              }}
            />
          )}
          {drawer === "presentation" && (
            <PresentationEditor
              code={code}
              fields={fields}
              value={schema.data!.presentation}
              onSaved={() => setDrawer(null)}
            />
          )}
          {drawer === "exports" && (
            <div className="engine-view-settings">
              <p>
                تمام رکوردهای مجاز مطابق ستون‌ها، ترتیب، جستجو و فیلتر فعلی در پس‌زمینه ساخته می‌شوند. مهلت دریافت فایل ۲۴
                ساعت است.
              </p>
              <div className="engine-actions">
                {["xlsx", "csv"].map((format) => (
                  <Button
                    key={format}
                    disabled={mutation.isPending}
                    onClick={() =>
                      void mutation
                        .mutateAsync({
                          path: `entities/${code}/exports/`,
                          data: {
                            definition: effective,
                            view_id: selectedView || undefined,
                            search: debouncedSearch,
                            format,
                          },
                        })
                        .catch(() => {})
                    }
                  >
                    {format === "xlsx" ? "درخواست اکسل" : "درخواست سی‌اس‌وی"}
                  </Button>
                ))}
              </div>
              {exports.data?.results.map((job) => (
                <div key={job.id}>
                  <strong>{job.format === "xlsx" ? "اکسل" : "سی‌اس‌وی"}</strong> ·{" "}
                  {{ pending: "در صف", running: "در حال ساخت", ready: "آماده دریافت", failed: "ناموفق" }[job.status] ||
                    "در حال بررسی"}{" "}
                  · {job.row_count.toLocaleString("fa-IR")} رکورد{" "}
                  {job.status === "ready" && (
                    <a
                      className="button button-secondary"
                      href={`${enginePath(slug)}/entities/${code}/exports/${job.id}/download/`}
                    >
                      دانلود
                    </a>
                  )}
                  {job.error && <p role="alert">{job.error}</p>}
                </div>
              ))}
              {exports.error && <p role="alert">دریافت وضعیت خروجی انجام نشد.</p>}
            </div>
          )}
          {drawer === "bulk" && (
            <div className="engine-view-settings">
              <p>
                انتخاب فقط مربوط به رکوردهای همین صفحه است. هر رکورد در تراکنش جداگانه با کنترل کامل مجوز و قواعد ثبت
                می‌شود.
              </p>
              <SearchableSelect
                label="فیلد تغییر گروهی"
                value={bulkField}
                options={fields
                  .filter((f) => !f.code.includes(".") && f.kind !== "computed" && !f.config.readonly)
                  .map((f) => ({ id: f.code, title: f.title }))}
                onChange={(field) => {
                  setBulkField(field);
                  setBulkValue(null);
                }}
              />
              {fields.find((f) => f.code === bulkField) && (
                <ViewValueInput
                  mode="edit"
                  field={fields.find((f) => f.code === bulkField)!}
                  value={bulkValue}
                  onChange={setBulkValue}
                />
              )}
              <Button disabled={!bulkField || mutation.isPending} onClick={() => void runBulk("update")}>
                تغییر فیلد
              </Button>
              {access?.can("Issue.Assign") && (
                <Button
                  variant="secondary"
                  disabled={
                    !bulkField || fields.find((f) => f.code === bulkField)?.kind !== "user" || mutation.isPending
                  }
                  onClick={() => void runBulk("assign")}
                >
                  واگذاری به مقدار انتخاب‌شده
                </Button>
              )}
              {access?.can(entity?.record_permissions.delete || "Issue.Delete") && (
                <Button variant="danger" disabled={mutation.isPending} onClick={() => void runBulk("delete")}>
                  حذف انتخاب‌شده‌ها
                </Button>
              )}
              {bulkResult.map((result) => (
                <p key={result.id} role={result.ok ? "status" : "alert"}>
                  {result.id}:{" "}
                  {result.ok ? "موفق" : typeof result.error === "string" ? result.error : JSON.stringify(result.error)}
                </p>
              ))}
            </div>
          )}
        </ViewDrawer>
      )}
    </div>
  );
}
