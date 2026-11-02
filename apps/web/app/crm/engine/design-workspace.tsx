import { useState } from "react";
import { Link } from "react-router";
import { CloseOutline, SearchOutline } from "@makeplane/propel/icons";
import { Eye, GitBranch, History, LayoutTemplate, ListChecks, ShieldCheck, Table2 } from "lucide-react";
import { normalizePersianSearch } from "@plane/ui";
import { Button, Skeleton } from "../components";
import { useWorkspaceAccess } from "../api";
import { useUIStore } from "../store";
import { FormDesigner } from "./form-designer";
import { PageEditor } from "./page-studio";
import { OfficialTableDesigner } from "./official-table-designer";
import { EntityRules, GovernanceSettings } from "./governance-settings";
import { FieldLifecycleSettings } from "./field-lifecycle-settings";
import { RelationSettings } from "./relation-settings";
import { useEngineCatalog, useEngineDefinitions, useEngineForm, useEngineQuery } from "./api";
import type { FieldDefinition } from "./api";

type DesignTab = "fields" | "layout" | "preview" | "versions" | "table" | "rules" | "relations";
type Surface = { code: string; path: string; title: string; native_columns: string[] };
const tabs: { id: DesignTab; label: string; hint: string; icon: typeof ListChecks }[] = [
  { id: "fields", label: "ورودی‌های فرم", hint: "چه اطلاعاتی از کاربر گرفته شود", icon: ListChecks },
  { id: "layout", label: "چیدمان فرم", hint: "ترتیب ورودی‌ها، بخش‌ها و تب‌ها", icon: LayoutTemplate },
  { id: "preview", label: "پیش‌نمایش", hint: "امتحان فرم همان‌طور که کاربر می‌بیند", icon: Eye },
  { id: "versions", label: "نسخه‌های قبلی", hint: "بازگشت به چیدمان‌های قبلی", icon: History },
  { id: "table", label: "ستون‌های جدول", hint: "ستون‌ها و تب‌های فهرست", icon: Table2 },
  { id: "rules", label: "قواعد ثبت", hint: "جلوگیری از تکرار و شماره‌گذاری خودکار", icon: ShieldCheck },
  { id: "relations", label: "ارتباط‌ها", hint: "اتصال به بخش‌های دیگر", icon: GitBranch },
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
  const [code, setCode] = useState("ticket");
  const [tab, setTab] = useState<DesignTab>("fields");
  const [search, setSearch] = useState("");
  const [general, setGeneral] = useState(false);
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
    setTab("fields");
  };
  if (catalog.isLoading || fields.isLoading || surfaces.isLoading) return <Skeleton rows={8} />;
  if (catalog.error || fields.error || surfaces.error)
    return (
      <div className="engine-empty-selection">
        <strong>طراحی فرم‌ها بارگذاری نشد</strong>
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
  return (
    <div className="engine-workspace">
      <aside className="engine-workspace-sidebar" aria-label="فرم‌ها و جدول‌ها">
        <header>
          <strong>فرم‌ها و جدول‌ها</strong>
          <small>{entities.length.toLocaleString("fa-IR")} فرم قابل تنظیم</small>
        </header>
        <div className="engine-entity-search">
          <label htmlFor="engine-entity-search-input">جستجوی فرم</label>
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
        <nav aria-label="انتخاب فرم">
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
        {!list.length && <p>فرمی با این نام پیدا نشد.</p>}
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
                <p>فرم ثبت و ویرایش یکی است؛ ستون‌های جدول و قواعد ثبت را از تب‌های پایین تنظیم کنید.</p>
              </div>
              <Link
                className="button button-secondary"
                to={surface?.path || nativePaths[entity.code] || `/entities/${entity.code}`}
              >
                مشاهده صفحه
              </Link>
            </header>
            <nav className="engine-workspace-tabs" aria-label="بخش‌های طراحی">
              {tabs.map((item, index) => (
                <button
                  type="button"
                  key={item.id}
                  className={tab === item.id ? "active" : ""}
                  aria-current={tab === item.id ? "page" : undefined}
                  onClick={() => setTab(item.id)}
                >
                  <span className="engine-workspace-tab-symbol" aria-hidden="true">
                    <item.icon size={19} strokeWidth={1.8} />
                  </span>
                  <span className="engine-workspace-tab-copy">
                    <strong>{item.label}</strong>
                    <small>{item.hint}</small>
                  </span>
                  <span className="engine-workspace-tab-index" aria-hidden="true">
                    {(index + 1).toLocaleString("fa-IR")}
                  </span>
                </button>
              ))}
            </nav>
            <section className="engine-workspace-panel" aria-label={currentTab.label}>
              <div className="engine-workspace-panel-heading">
                <h3>{currentTab.label}</h3>
                <p>{currentTab.hint}</p>
              </div>
              <div hidden={!(["fields", "layout", "preview", "versions"] as DesignTab[]).includes(tab)}>
                {fields.data && (
                  <FormDesigner
                    key={entity.id}
                    entity={entity}
                    fields={fields.data}
                    entities={entities}
                    viewMode={tab === "table" || tab === "rules" || tab === "relations" ? "layout" : tab}
                  />
                )}
              </div>
              {tab === "table" && (
                <>
                  {surface?.native_columns.length ? (
                    <section className="engine-design-section-card">
                      <h4>ستون‌ها و تب‌های جدول</h4>
                      <p>برای همه کاربران اعمال می‌شود. هر کاربر می‌تواند از «تب‌های من» تب‌ها را برای خودش پنهان کند.</p>
                      <PageEditor key={surfaceCode} code={surfaceCode} embedded tableOnly />
                    </section>
                  ) : null}
                  {surface?.native_columns.length ? (
                    <details className="engine-design-section-card engine-optional-section">
                      <summary>
                        <strong>نماهای آماده «جدول من»</strong>
                        <small>اختیاری؛ فقط وقتی کاربران «جدول من» را باز می‌کنند استفاده می‌شود.</small>
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
            </section>
          </>
        ) : (
          <p>برای شروع، یکی از فرم‌های فهرست را انتخاب کنید.</p>
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
