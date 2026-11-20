import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { CloseOutline, SearchOutline } from "@makeplane/propel/icons";
import { GitBranch, LayoutTemplate, ListChecks, Plus, SearchX, Table2 } from "lucide-react";
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
import { visibleDesignPages } from "./design-sidebar";
import { useCrmNavigation, useSaveDesignSidebar } from "../navigation";

type DesignTab = "fields" | "layout" | "preview" | "versions" | "table" | "rules" | "relations" | "workflow";
type Surface = { code: string; path: string; title: string; native_columns: string[] };

export function DesignWorkspace() {
  const [params, setParams] = useSearchParams();
  const catalog = useEngineCatalog();
  const navigation = useCrmNavigation();
  const saveSidebar = useSaveDesignSidebar();
  const tabs = (navigation.data?.design_tabs ?? []) as { id: DesignTab; label: string; hint: string }[];
  const fields = useEngineDefinitions<FieldDefinition>("fields");
  const surfaces = useEngineQuery<{ results: Surface[] }>("surfaces", "surfaces/");
  const { data: access } = useWorkspaceAccess();
  const [code, setCode] = useState(params.get("page") || "");
  const [tab, setTab] = useState<DesignTab>(
    (params.get("tab") as DesignTab) || (params.get("mode") === "columns" ? "table" : "layout")
  );
  useEffect(() => {
    setCode(params.get("page") || "");
    setTab((params.get("tab") as DesignTab) || (params.get("mode") === "columns" ? "table" : "layout"));
  }, [params]);
  const [search, setSearch] = useState("");
  const [managerSearch, setManagerSearch] = useState("");
  const sidebarCodes = navigation.data?.preferences.design_sidebar ?? null;
  const [managingPages, setManagingPages] = useState(false);
  const [general, setGeneral] = useState(false);
  const [creatingPage, setCreatingPage] = useState(false);
  const form = useEngineForm(code, Boolean(catalog.data?.entities.some((item) => item.code === code)));
  const entities = (catalog.data?.entities || []).filter((item) => item.is_active && item.code !== "task");
  const entity = entities.find((item) => item.code === code);
  const surfaceCode = code === "user" ? "users" : code === "unit" ? "units" : code;
  const surface = surfaces.data?.results.find((item) => item.code === surfaceCode);
  const allPages = navigation.data?.design_pages ?? [];
  const selectedPages = visibleDesignPages(allPages, sidebarCodes);
  useEffect(() => {
    const page = navigation.data?.design_pages.find((item) => item.code === params.get("page"));
    if (page && params.get("category") !== page.category) {
      const next = new URLSearchParams(params);
      next.set("category", page.category);
      setParams(next, { replace: true });
    }
  }, [navigation.data, params, setParams]);

  const togglePage = (pageCode: string) => {
    const current = sidebarCodes ?? allPages.map((item) => item.code);
    const next = current.includes(pageCode) ? current.filter((item) => item !== pageCode) : [...current, pageCode];
    saveSidebar.mutate(next);
  };
  const codes = form.data?.draft.sections.flatMap((section) => section.bindings.map((binding) => binding.field)) || [];
  const choose = (next: string) => {
    if (next === code) {
      setManagingPages(false);
      return;
    }
    if (
      useUIStore.getState().dirtyForms.length &&
      !window.confirm("تغییرات ذخیره‌نشده کنار گذاشته شود و به بخش دیگر برویم؟")
    )
      return;
    setCode(next);
    const nextParams = new URLSearchParams(params);
    nextParams.set("page", next);
    nextParams.set("tab", "layout");
    nextParams.delete("mode");
    const page = allPages.find((item) => item.code === next);
    if (page) nextParams.set("category", page.category);
    setParams(nextParams);
    setTab("layout");
    setManagingPages(false);
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
    const nextParams = new URLSearchParams(params);
    nextParams.set("tab", next);
    if (next === "table") nextParams.set("mode", "columns");
    else nextParams.delete("mode");
    setParams(nextParams);
  };
  if (catalog.isLoading || fields.isLoading || surfaces.isLoading || navigation.isLoading) return <Skeleton rows={8} />;
  if (catalog.error || fields.error || surfaces.error || navigation.error)
    return (
      <div className="engine-empty-selection">
        <strong>طراحی فرم‌ها بارگذاری نشد</strong>
        <p role="alert">
          {errorMessage(
            catalog.error || fields.error || surfaces.error || navigation.error,
            "دریافت اطلاعات طراحی فرم‌ها انجام نشد."
          )}
        </p>
        <Button
          variant="secondary"
          onClick={() => {
            void navigation.refetch();
            void catalog.refetch();
            void fields.refetch();
            void surfaces.refetch();
          }}
        >
          تلاش دوباره
        </Button>
      </div>
    );
  const list = selectedPages.filter(
    (item) =>
      (!params.get("category") || item.category === params.get("category")) &&
      normalizePersianSearch(item.title + item.code).includes(normalizePersianSearch(search))
  );
  const currentTab = tabs.find((item) => item.id === tab) ?? { id: tab, label: "", hint: "" };
  const selectedCategory = params.get("category") ?? allPages.find((item) => item.code === code)?.category ?? "";
  const categories = (navigation.data?.categories ?? []).filter((category) =>
    allPages.some((page) => page.category === category.id)
  );
  const formTab = (["fields", "layout", "preview", "versions"] as DesignTab[]).includes(tab);
  return (
    <div className="engine-workspace" dir="rtl">
      <aside className="engine-workspace-sidebar" aria-label="فرم‌ها و جدول‌ها">
        <header>
          <strong>فرم‌ها و جدول‌ها</strong>
          <small>{selectedPages.length.toLocaleString("fa-IR")} بخش قابل تنظیم</small>
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
        <label className="engine-entity-search">
          دسته‌بندی طراحی
          <select
            aria-label="دسته‌بندی طراحی"
            value={selectedCategory}
            onChange={(event) => {
              if (useUIStore.getState().dirtyForms.length && !window.confirm("تغییرات ذخیره‌نشده کنار گذاشته شود؟"))
                return;
              const next = new URLSearchParams(params);
              if (event.target.value) next.set("category", event.target.value);
              else next.delete("category");
              next.delete("page");
              next.delete("tab");
              next.delete("mode");
              setParams(next);
            }}
          >
            <option value="">{navigation.data?.all_design_title}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.title}
              </option>
            ))}
          </select>
        </label>
        <nav aria-label="انتخاب بخش">
          {categories
            .filter((category) => !selectedCategory || category.id === selectedCategory)
            .map((category) => {
              const children = list.filter((item) => item.category === category.id);
              if (!children.length) return null;
              return (
                <section className="engine-design-category" key={category.id} aria-label={category.title}>
                  <h3>{category.title}</h3>
                  {children.map((item) => (
                    <button
                      type="button"
                      key={item.code}
                      className={code === item.code ? "active" : ""}
                      aria-current={code === item.code ? "page" : undefined}
                      onClick={() => choose(item.code)}
                    >
                      <strong>{item.title}</strong>
                      <small>{item.kind}</small>
                    </button>
                  ))}
                </section>
              );
            })}
        </nav>
        {saveSidebar.error && <p role="alert">{errorMessage(saveSidebar.error, "ذخیرهٔ انتخاب صفحه‌ها انجام نشد.")}</p>}
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
        <Button variant="secondary" onClick={() => setManagingPages(true)}>
          <ListChecks size={16} aria-hidden="true" />
          مدیریت صفحات سایدبار
        </Button>
        {creatingPage && <NewPageDialog initialTitle={search.trim()} onClose={() => setCreatingPage(false)} />}
        {access?.can("View.Official.Manage") && (
          <Button variant="ghost" onClick={() => setGeneral(true)}>
            تنظیمات عمومی جدول‌ها
          </Button>
        )}
      </aside>
      <main className="engine-workspace-main">
        {managingPages ? (
          <section className="engine-workspace-panel engine-sidebar-manager" aria-label="مدیریت صفحات سایدبار">
            <div className="engine-workspace-panel-heading">
              <h2>مدیریت صفحات سایدبار</h2>
              <p>
                صفحه‌های موردنیاز را به فهرست سمت راست اضافه کنید یا از آن بردارید. روی نام هر صفحه بزنید تا فرم و جدول
                آن برای ویرایش باز شود.
              </p>
            </div>
            <label className="engine-entity-search" htmlFor="engine-sidebar-manager-search">
              جستجوی همهٔ صفحات قابل طراحی
              <input
                id="engine-sidebar-manager-search"
                type="search"
                value={managerSearch}
                onChange={(event) => setManagerSearch(event.target.value)}
                placeholder="نام یا کد صفحه"
              />
            </label>
            <div className="engine-sidebar-manager-list">
              {allPages
                .filter((item) =>
                  normalizePersianSearch(item.title + item.code).includes(normalizePersianSearch(managerSearch))
                )
                .map((item) => {
                  const included = selectedPages.some((page) => page.code === item.code);
                  return (
                    <div className="engine-sidebar-manager-row" key={item.code}>
                      <div>
                        <strong>{item.title}</strong>
                        <small>
                          {categories.find((category) => category.id === item.category)?.title} · {item.kind}
                        </small>
                      </div>
                      <div className="engine-sidebar-manager-actions">
                        <Button variant="ghost" onClick={() => choose(item.code)}>
                          طراحی صفحه
                        </Button>
                        <Button
                          variant={included ? "secondary" : "primary"}
                          disabled={saveSidebar.isPending}
                          onClick={() => togglePage(item.code)}
                        >
                          {included ? "حذف از سایدبار" : "افزودن به سایدبار"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
            </div>
          </section>
        ) : entity ? (
          <>
            <header className="engine-workspace-heading">
              <div>
                <small>فرم و جدول</small>
                <h2>{entity.title}</h2>
                <p>فرم ثبت و ویرایش و جدول این بخش را از مسیرهای جدا تنظیم کنید.</p>
              </div>
              <Link
                className="button button-secondary"
                to={allPages.find((item) => item.code === entity.code)?.to || `/entities/${entity.code}`}
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
        ) : surface ? (
          <>
            <header className="engine-workspace-heading">
              <div>
                <small>فرم و جدول صفحه</small>
                <h2>{surface.title}</h2>
                <p>تنظیمات ذخیره‌شده روی صفحهٔ اصلی برای کاربران اعمال می‌شود.</p>
              </div>
              <Link className="button button-secondary" to={surface.path}>
                مشاهده صفحه
              </Link>
            </header>
            <section
              className="engine-workspace-panel engine-workspace-surface-panel"
              aria-label={`طراحی فرم و جدول ${surface.title}`}
            >
              <div className="engine-workspace-panel-heading">
                <h3>طراحی فرم و جدول</h3>
                <p>ورودی‌های فرم و ستون‌های جدول این بخش را تنظیم کنید.</p>
              </div>
              <PageEditor key={surfaceCode} code={surfaceCode} embedded />
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
