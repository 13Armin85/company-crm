import { useState } from "react";
import { Link } from "react-router";
import { CloseOutline, SearchOutline } from "@makeplane/propel/icons";
import { GitBranch, LayoutTemplate, Plus, SearchX, Table2 } from "lucide-react";
import { NewPageDialog } from "./sidebar-pages";
import { normalizePersianSearch } from "@plane/ui";
import { Button, Skeleton } from "../components";
import { errorMessage, useWorkspaceAccess } from "../api";
import { useUIStore } from "../store";
import { FormDesigner } from "./form-designer";
import { PageEditor } from "./page-studio";
import { OfficialTableDesigner } from "./official-table-designer";
import { EntityRules, GovernanceSettings } from "./governance-settings";
import { FieldLifecycleSettings } from "./field-lifecycle-settings";
import { RelationSettings } from "./relation-settings";
import { WorkflowDesigner } from "../workflow/designer";
import { useEngineCatalog, useEngineDefinitions, useEngineForm, useEngineQuery } from "./api";
import type { FieldDefinition } from "./api";

type DesignTab = "fields" | "layout" | "preview" | "versions" | "table" | "rules" | "relations" | "workflow";
type Surface = { code: string; path: string; title: string; native_columns: string[] };
const tabs: { id: DesignTab; label: string; hint: string }[] = [
  { id: "fields", label: "همه ورودی‌ها", hint: "ویرایش تعریف ورودی‌های موجود" },
  { id: "layout", label: "طراحی فرم", hint: "ورودی‌ها را پیدا کنید، به فرم بیفزایید و ترتیبشان را تغییر دهید" },
  { id: "preview", label: "پیش‌نمایش فرم", hint: "فرم ثبت و ویرایش را امتحان کنید" },
  { id: "versions", label: "نسخه‌های قبلی", hint: "بازگشت به چیدمان‌های قبلی" },
  { id: "table", label: "طراحی جدول", hint: "ستون‌ها و نمای رسمی جدول" },
  { id: "rules", label: "قواعد ثبت", hint: "جلوگیری از تکرار و شماره‌گذاری خودکار" },
  { id: "relations", label: "ارتباط‌ها", hint: "اتصال به بخش‌های دیگر" },
  { id: "workflow", label: "گردش‌کار", hint: "مرحله‌ها، تأییدها و مهلت‌های فرایند" },
];
const surfaceCodes = new Set(["ticket", "project", "leave", "users", "units", "roles", "routing", "cycles"]);
const nativePaths: Record<string, string> = {
  ticket: "/issues",
  project: "/projects",
  leave: "/absences",
  user: "/team",
  unit: "/organization",
};

export function DesignWorkspace() {
  const catalog = useEngineCatalog();
  const fields = useEngineDefinitions<FieldDefinition>("fields");
  const surfaces = useEngineQuery<{ results: Surface[] }>("surfaces", "surfaces/");
  const { data: access } = useWorkspaceAccess();
  const [code, setCode] = useState("");
  const [tab, setTab] = useState<DesignTab>("layout");
  const [search, setSearch] = useState("");
  const [general, setGeneral] = useState(false);
  const [creatingPage, setCreatingPage] = useState(false);
  const form = useEngineForm(code, Boolean(catalog.data?.entities.some((item) => item.code === code)));
  const entities = (catalog.data?.entities || []).filter((item) => item.is_active && item.code !== "task");
  const entity = entities.find((item) => item.code === code);
  const surfaceCode = code === "user" ? "users" : code === "unit" ? "units" : code;
  const surface = surfaces.data?.results.find((item) => item.code === surfaceCode && surfaceCodes.has(item.code));
  const codes = form.data?.draft.sections.flatMap((section) => section.bindings.map((binding) => binding.field)) || [];
  const choose = (next: string) => {
    if (next === code) return;
    if (
      useUIStore.getState().dirtyForms.length &&
      !window.confirm("تغییرات ذخیره‌نشده کنار گذاشته شود و به بخش دیگر برویم؟")
    )
      return;
    setCode(next);
    setTab("layout");
  };
  const selectTab = (next: DesignTab) => {
    if (tab === "table" && next !== "table") {
      const dirty = useUIStore.getState().dirtyForms;
      if (
        (dirty.includes(`page-studio:${surfaceCode}`) || dirty.includes(`official-table:${code}`)) &&
        !window.confirm("تغییرات ذخیره‌نشدهٔ جدول کنار گذاشته شود؟")
      )
        return;
    }
    setTab(next);
  };
  if (catalog.isLoading || fields.isLoading || surfaces.isLoading) return <Skeleton rows={8} />;
  if (catalog.error || fields.error || surfaces.error)
    return (
      <div className="engine-empty-selection">
        <strong>طراحی فرم‌ها بارگذاری نشد</strong>
        <p role="alert">
          {errorMessage(catalog.error || fields.error || surfaces.error, "دریافت اطلاعات طراحی فرم‌ها انجام نشد.")}
        </p>
        <Button
          variant="secondary"
          onClick={() => {
            void catalog.refetch();
            void fields.refetch();
            void surfaces.refetch();
          }}
        >
          تلاش دوباره
        </Button>
      </div>
    );
  const list = entities.filter((item) =>
    normalizePersianSearch(item.title + item.code).includes(normalizePersianSearch(search))
  );
  const currentTab = tabs.find((item) => item.id === tab)!;
  const formTab = (["fields", "layout", "preview", "versions"] as DesignTab[]).includes(tab);
  return (
    <div className="engine-workspace" dir="rtl">
      <aside className="engine-workspace-sidebar" aria-label="فرم‌ها و جدول‌ها">
        <header>
          <strong>فرم‌ها و جدول‌ها</strong>
          <small>{entities.length.toLocaleString("fa-IR")} بخش قابل تنظیم</small>
        </header>
        <div className="engine-entity-search">
          <label htmlFor="engine-entity-search-input">جستجوی بخش</label>
          <div className="engine-entity-search-control">
            <SearchOutline aria-hidden="true" />
            <input
              id="engine-entity-search-input"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="مثلاً کارها، مشتری، کاربر…"
            />
            {search && (
              <button type="button" aria-label="پاک کردن جستجو" onClick={() => setSearch("")}>
                <CloseOutline aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        <nav aria-label="انتخاب بخش">
          {list.map((item) => (
            <button
              type="button"
              key={item.id}
              className={code === item.code ? "active" : ""}
              aria-current={code === item.code ? "page" : undefined}
              onClick={() => choose(item.code)}
            >
              <strong>{item.code === "ticket" ? "کارها" : item.title}</strong>
              <small>{item.parent ? "نوع فرعی" : item.adapter ? "بخش اصلی سامانه" : "بخش سفارشی"}</small>
            </button>
          ))}
        </nav>
        {!list.length && (
          <div className="engine-search-empty" role="status">
            <span className="engine-search-empty-icon" aria-hidden="true">
              <SearchX size={22} />
            </span>
            <strong>{search.trim() ? `بخشی با «${search.trim()}» پیدا نشد` : "هنوز بخشی وجود ندارد"}</strong>
            <p>املای نام را بررسی کنید یا با کد انگلیسی بخش جستجو کنید.</p>
            <div className="engine-search-empty-actions">
              {search && (
                <Button variant="secondary" onClick={() => setSearch("")}>
                  پاک کردن جستجو
                </Button>
              )}
              {access?.can("EntityType.Create") && access?.can("FormDesigner.Publish") && (
                <Button onClick={() => setCreatingPage(true)}>
                  <Plus size={15} aria-hidden="true" />
                  {search.trim() ? `ساخت صفحهٔ «${search.trim()}»` : "ساخت صفحهٔ جدید"}
                </Button>
              )}
            </div>
          </div>
        )}
        {creatingPage && <NewPageDialog initialTitle={search.trim()} onClose={() => setCreatingPage(false)} />}
        {access?.can("View.Official.Manage") && (
          <Button variant="ghost" onClick={() => setGeneral(true)}>
            تنظیمات عمومی جدول‌ها
          </Button>
        )}
      </aside>
      <main className="engine-workspace-main">
        {entity ? (
          <>
            <header className="engine-workspace-heading">
              <div>
                <small>فرم و جدول</small>
                <h2>{entity.code === "ticket" ? "کارها" : entity.title}</h2>
                <p>فرم ثبت و ویرایش و جدول این بخش را از مسیرهای جدا تنظیم کنید.</p>
              </div>
              <Link
                className="button button-secondary"
                to={surface?.path || nativePaths[entity.code] || `/entities/${entity.code}`}
              >
                مشاهده صفحه
              </Link>
            </header>
            <nav className="engine-workspace-primary" aria-label="انتخاب فرم یا جدول">
              <button
                type="button"
                className={formTab ? "active" : ""}
                aria-current={formTab ? "page" : undefined}
                onClick={() => selectTab("layout")}
              >
                <LayoutTemplate size={20} aria-hidden="true" />
                <strong>فرم</strong>
                <small>ورودی‌ها، ترتیب و پیش‌نمایش ثبت و ویرایش</small>
              </button>
              <button
                type="button"
                className={tab === "table" ? "active" : ""}
                aria-current={tab === "table" ? "page" : undefined}
                onClick={() => selectTab("table")}
              >
                <Table2 size={20} aria-hidden="true" />
                <strong>جدول</strong>
                <small>ستون‌ها و نمایی که کاربران می‌بینند</small>
              </button>
              {entity && !["user", "unit", "project"].includes(entity.adapter) && access?.can("Workflow.View") && (
                <button
                  type="button"
                  className={tab === "workflow" ? "active" : ""}
                  aria-current={tab === "workflow" ? "page" : undefined}
                  onClick={() => selectTab("workflow")}
                >
                  <GitBranch size={20} aria-hidden="true" />
                  <strong>گردش‌کار</strong>
                  <small>مرحله‌ها، تأییدها و مهلت‌ها</small>
                </button>
              )}
            </nav>
            {formTab && (
              <nav className="engine-workspace-subnav" aria-label="کارهای فرم">
                <button
                  type="button"
                  aria-current={tab === "layout" ? "page" : undefined}
                  onClick={() => selectTab("layout")}
                >
                  طراحی فرم
                </button>
                <button
                  type="button"
                  aria-current={tab === "preview" ? "page" : undefined}
                  onClick={() => selectTab("preview")}
                >
                  پیش‌نمایش فرم
                </button>
              </nav>
            )}
            <details
              className="engine-workspace-advanced"
              open={!["layout", "preview", "table"].includes(tab) ? true : undefined}
            >
              <summary>تنظیمات پیشرفته</summary>
              <nav aria-label="تنظیمات پیشرفته طراحی">
                {tabs
                  .filter((item) => ["fields", "versions", "rules", "relations"].includes(item.id))
                  .map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      aria-current={tab === item.id ? "page" : undefined}
                      onClick={() => selectTab(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
              </nav>
            </details>
            <section className="engine-workspace-panel" aria-label={currentTab.label}>
              <div className="engine-workspace-panel-heading">
                <h3>{currentTab.label}</h3>
                <p>{currentTab.hint}</p>
              </div>
              <div hidden={!formTab}>
                {fields.data && (
                  <FormDesigner
                    key={entity.id}
                    entity={entity}
                    fields={fields.data}
                    entities={entities}
                    viewMode={tab === "fields" || tab === "preview" || tab === "versions" ? tab : "layout"}
                  />
                )}
              </div>
              {tab === "table" && (
                <>
                  {surface?.native_columns.length ? (
                    <section className="engine-design-section-card">
                      <h4>ستون‌ها و تب‌های جدول</h4>
                      <p>این ستون‌ها و تب‌ها پس از ذخیره روی جدول این صفحه برای کاربران اعمال می‌شوند.</p>
                      <PageEditor key={surfaceCode} code={surfaceCode} embedded tableOnly />
                    </section>
                  ) : null}
                  {surface?.native_columns.length ? (
                    <details className="engine-design-section-card engine-optional-section">
                      <summary>
                        <strong>نماهای رسمی ذخیره‌شده</strong>
                        <small>
                          این نماها در فهرست نماهای کاربران دیده می‌شوند. نمای شخصی هر کاربر از صفحهٔ جدول خودش ذخیره
                          می‌شود.
                        </small>
                      </summary>
                      <OfficialTableDesigner key={code} code={code} />
                    </details>
                  ) : (
                    <section className="engine-design-section-card">
                      <OfficialTableDesigner key={code} code={code} />
                    </section>
                  )}
                </>
              )}
              {tab === "rules" && (
                <div className="engine-rules-stack">
                  <EntityRules key={code} code={code} />
                  <FieldLifecycleSettings key={code} fieldCodes={codes} />
                </div>
              )}
              {tab === "relations" && <RelationSettings key={code} entityCode={code} />}
              {tab === "workflow" && <WorkflowDesigner key={code} entity={code} />}
            </section>
          </>
        ) : (
          <section className="engine-workspace-start">
            <h2>فرم و جدول کدام بخش را تنظیم می‌کنید؟</h2>
            <p>نام بخش را جستجو کنید و از فهرست انتخاب کنید. سپس «فرم» یا «جدول» را باز کنید.</p>
          </section>
        )}
      </main>
      {general && (
        <div
          className="engine-field-drawer-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setGeneral(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setGeneral(false);
          }}
        >
          <div className="engine-field-drawer" role="dialog" aria-modal="true" aria-label="تنظیمات عمومی جدول‌ها">
            <Button variant="ghost" onClick={() => setGeneral(false)}>
              بستن
            </Button>
            <GovernanceSettings generalOnly />
          </div>
        </div>
      )}
    </div>
  );
}
