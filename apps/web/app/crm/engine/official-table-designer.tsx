import { ErrorNotice, ErrorState } from "../error-state";
import { useEffect, useMemo, useState } from "react";
import { Columns3, Filter, ListTree, Plus, Save, SlidersHorizontal } from "lucide-react";
import { SearchableSelect } from "@plane/ui";
import { Button, Skeleton } from "../components";
import { api, errorMessage, useWorkspaceAccess } from "../api";
import { useUIStore } from "../store";
import { ColumnEditor, ViewFilterEditor } from "./view-controls";
import { enginePath, useEngineMutation, useEngineQuery, useEngineSlug } from "./api";
import type { SavedView, SavedViewList, ViewDefinition, ViewField, ViewSchema } from "./view-types";

export function OfficialTableDesigner({ code }: { code: string }) {
  const slug = useEngineSlug();
  const { data: access } = useWorkspaceAccess();
  const schema = useEngineQuery<ViewSchema>("view-schema", `entities/${code}/view-schema/`);
  const saved = useEngineQuery<SavedViewList>("views", `entities/${code}/views/`);
  const mutation = useEngineMutation();
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("جدول رسمی");
  const [definition, setDefinition] = useState<ViewDefinition | null>(null);
  const [savedDefinition, setSavedDefinition] = useState<ViewDefinition | null>(null);
  const [savedName, setSavedName] = useState("");
  const [extraFields, setExtraFields] = useState<ViewField[]>([]);
  const [notice, setNotice] = useState("");
  const official = useMemo(
    () => saved.data?.results.filter((view) => view.visibility === "official") || [],
    [saved.data?.results]
  );
  const current = official.find((view) => view.id === selected);
  const dirty = Boolean(
    definition && (name !== savedName || JSON.stringify(definition) !== JSON.stringify(savedDefinition))
  );
  const setDirty = useUIStore((state) => state.setFormDirty);
  useEffect(() => {
    setDirty(`official-table:${code}`, dirty);
    return () => setDirty(`official-table:${code}`, false);
  }, [code, dirty, setDirty]);
  useEffect(() => {
    if (!schema.data || !saved.data || definition) return;
    const initial = official.find((view) => view.id === saved.data?.official_id) || official[0];
    setSelected(initial?.id || "");
    setName(initial?.name || "جدول رسمی");
    setSavedName(initial?.name || "جدول رسمی");
    setDefinition(structuredClone(initial?.definition || schema.data.definition));
    setSavedDefinition(structuredClone(initial?.definition || schema.data.definition));
  }, [schema.data, saved.data, definition, official]);
  const choose = (view?: SavedView) => {
    if (dirty && !window.confirm("تغییرات ذخیره‌نشدهٔ نمای رسمی کنار گذاشته شود؟")) return;
    setSelected(view?.id || "");
    setName(view?.name || "جدول رسمی");
    setSavedName(view?.name || "جدول رسمی");
    setDefinition(structuredClone(view?.definition || schema.data?.definition || null));
    setSavedDefinition(structuredClone(view?.definition || schema.data?.definition || null));
    setExtraFields([]);
    setNotice("");
  };
  const fields = [
    ...(schema.data?.fields || []),
    ...extraFields.filter((field) => !schema.data?.fields.some((item) => item.code === field.code)),
  ];
  const loadPath = async (path: string) => {
    try {
      const result = await api.get<ViewSchema>(`${enginePath(slug)}/entities/${code}/view-schema/`, {
        params: { path },
      });
      setExtraFields((previous) => [
        ...previous,
        ...result.data.fields.filter((field) => !previous.some((item) => item.code === field.code)),
      ]);
    } catch (error) {
      setNotice(errorMessage(error, "خواندن ستون‌های رابطه‌ای انجام نشد."));
    }
  };
  const save = async () => {
    if (!definition) return;
    const names = definition.columns.map(
      (column) => fields.find((field) => field.code === column.field)?.title || column.field
    );
    if (
      !window.confirm(
        `نمای رسمی «${name.trim()}» با ${names.length.toLocaleString("fa-IR")} ستون برای کاربران ذخیره شود؟\n${names.join("، ")}`
      )
    )
      return;
    try {
      const result = (await mutation.mutateAsync({
        path: `entities/${code}/views/${current ? `${current.id}/` : ""}`,
        method: current ? "patch" : "post",
        data: {
          name: name.trim(),
          visibility: "official",
          definition,
          default_roles: current?.default_roles || [],
          recipients: {},
          ...(current ? { revision: current.revision } : {}),
        },
      })) as SavedView;
      setSelected(result.id);
      setDefinition(structuredClone(result.definition));
      setSavedDefinition(structuredClone(result.definition));
      setSavedName(result.name);
      setNotice("تنظیمات جدول رسمی ذخیره شد.");
    } catch {
      setNotice("");
    }
  };
  if (schema.isLoading || saved.isLoading) return <Skeleton rows={5} />;
  if (schema.error || saved.error)
    return <ErrorState message={errorMessage(schema.error || saved.error, "تنظیمات جدول دریافت نشد.")} />;
  if (!access?.can("View.Official.Manage"))
    return <p role="status">برای تغییر ستون‌های رسمی جدول، دسترسی «مدیریت جدول رسمی» لازم است.</p>;
  if (!definition) return null;
  return (
    <section className="engine-official-designer">
      <div className="engine-panel-heading engine-table-designer-heading">
        <div>
          <span className="engine-step-badge">طراحی جدول</span>
          <h3>نماهای رسمی ذخیره‌شده</h3>
          <p>این نما پس از ذخیره در فهرست نماهای کاربران دیده می‌شود. نمای شخصی هر کاربر جداگانه ذخیره می‌شود.</p>
        </div>
        <Button variant="secondary" onClick={() => choose()}>
          <Plus size={16} aria-hidden="true" />
          نمای جدید
        </Button>
      </div>
      <div className="engine-table-identity">
        {!!official.length && (
          <SearchableSelect
            showLabel
            label="کدام نما را ویرایش می‌کنید؟"
            value={selected}
            options={[{ id: "", title: "نمای جدید" }, ...official.map((view) => ({ id: view.id, title: view.name }))]}
            onChange={(id) => choose(official.find((view) => view.id === id))}
          />
        )}
        <label>
          <span>نام نما</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={255}
            placeholder="مثلاً جدول اصلی مشتریان"
          />
          <small>کاربران این نام را در فهرست نماها می‌بینند.</small>
        </label>
      </div>
      <div className="engine-table-design-grid">
        <section className="engine-designer-card engine-column-design-card">
          <div className="engine-designer-card-heading">
            <span className="engine-designer-card-icon">
              <Columns3 size={19} aria-hidden="true" />
            </span>
            <div>
              <h4>ستون‌های جدول</h4>
              <p>ستون‌ها را اضافه، حذف یا مرتب کنید. نتیجه را پیش از ذخیره پایین صفحه ببینید.</p>
            </div>
          </div>
          <ColumnEditor columnsOnly value={definition} onChange={setDefinition} fields={fields} onLoadPath={loadPath} />
        </section>
        <section className="engine-designer-card engine-table-behavior-card">
          <div className="engine-designer-card-heading">
            <span className="engine-designer-card-icon">
              <SlidersHorizontal size={19} aria-hidden="true" />
            </span>
            <div>
              <h4>رفتار جدول</h4>
              <p>خلاصه ردیف، ترتیب اولیه و گروه‌بندی اطلاعات را مشخص کنید.</p>
            </div>
          </div>
          <details className="engine-table-setting-group engine-advanced-setting">
            <summary>خلاصهٔ ردیف و تنظیمات پیشرفته</summary>
            <div className="engine-subsection-heading">
              <ListTree size={17} aria-hidden="true" />
              <div>
                <h5>خلاصه ردیف</h5>
                <p>با کلیک روی ردیف، فیلدهای انتخاب‌شده در پنل جزئیات نمایش داده می‌شوند.</p>
              </div>
            </div>
            <div className="engine-summary-choices">
              {fields
                .filter((field) => field.table_visible)
                .map((field) => (
                  <label key={field.code}>
                    <input
                      type="checkbox"
                      checked={(definition.summary || []).includes(field.code)}
                      onChange={(event) =>
                        setDefinition({
                          ...definition,
                          summary: event.target.checked
                            ? [...(definition.summary || []), field.code]
                            : (definition.summary || []).filter((fieldCode) => fieldCode !== field.code),
                        })
                      }
                    />
                    {field.title}
                  </label>
                ))}
            </div>
          </details>
          <div className="engine-table-setting-group engine-sort-settings">
            <h5>مرتب‌سازی اولیه</h5>
            <SearchableSelect
              showLabel
              label="مرتب‌سازی بر اساس"
              value={definition.sort[0]?.field || ""}
              options={[
                { id: "", title: "بدون مرتب‌سازی" },
                ...fields.map((field) => ({ id: field.code, title: field.title })),
              ]}
              onChange={(field) =>
                setDefinition({
                  ...definition,
                  sort: field ? [{ field, direction: definition.sort[0]?.direction || "asc" }] : [],
                })
              }
            />
            {!!definition.sort.length && (
              <SearchableSelect
                showLabel
                label="ترتیب"
                value={definition.sort[0].direction}
                options={[
                  { id: "asc", title: "از کم به زیاد / قدیم به جدید" },
                  { id: "desc", title: "از زیاد به کم / جدید به قدیم" },
                ]}
                onChange={(direction) =>
                  setDefinition({
                    ...definition,
                    sort: [{ ...definition.sort[0], direction: direction as "asc" | "desc" }],
                  })
                }
              />
            )}
            <SearchableSelect
              showLabel
              label="دسته‌بندی ردیف‌ها بر اساس"
              value={definition.group || ""}
              options={[
                { id: "", title: "بدون دسته‌بندی" },
                ...fields.map((field) => ({ id: field.code, title: field.title })),
              ]}
              onChange={(group) => setDefinition({ ...definition, group: group || null })}
            />
          </div>
        </section>
      </div>
      <details className="engine-designer-card engine-filter-design-card engine-advanced-setting">
        <summary>فیلتر پیش‌فرض و تنظیمات پیشرفته</summary>
        <div className="engine-designer-card-heading">
          <span className="engine-designer-card-icon">
            <Filter size={19} aria-hidden="true" />
          </span>
          <div>
            <h4>فیلتر پیش‌فرض</h4>
            <p>تعیین کنید کاربران هنگام باز کردن این جدول در ابتدا چه رکوردهایی را ببینند.</p>
          </div>
        </div>
        <ViewFilterEditor
          value={definition.filter}
          onChange={(filter) => setDefinition({ ...definition, filter })}
          fields={fields}
        />
      </details>
      <section className="studio-table-preview" aria-label="پیش‌نمایش ستون‌های نمای رسمی">
        <h4>پیش‌نمایش ستون‌ها</h4>
        <p>از راست به چپ، این ستون‌ها هنگام انتخاب این نمای رسمی دیده می‌شوند.</p>
        <div className="studio-table-preview-scroll">
          <table>
            <thead>
              <tr>
                {definition.columns.map((column) => (
                  <th key={column.field}>
                    {fields.find((field) => field.code === column.field)?.title || column.field}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {definition.columns.map((column) => (
                  <td key={column.field}>—</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      {notice && <p role="status">{notice}</p>}
      <ErrorNotice message={mutation.error && errorMessage(mutation.error, "ذخیره جدول رسمی انجام نشد.")} />
      <div className="engine-designer-savebar">
        <div>
          <strong role="status" aria-live="polite">
            {dirty || !selected ? "ذخیره‌نشده" : "نمای رسمی ذخیره شد"}
          </strong>
          <small>ذخیرهٔ این نما روی فهرست نماهای کاربران اثر می‌گذارد.</small>
        </div>
        <Button
          disabled={!name.trim() || (!dirty && Boolean(selected)) || mutation.isPending}
          onClick={() => void save()}
        >
          <Save size={16} aria-hidden="true" />
          ذخیرهٔ نمای رسمی برای کاربران
        </Button>
      </div>
    </section>
  );
}
