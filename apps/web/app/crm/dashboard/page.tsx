import { ErrorState } from "../error-state";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  BarChart3,
  CalendarDays,
  Check,
  Copy,
  Expand,
  GripVertical,
  LayoutDashboard,
  ListTodo,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  Share2,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import { api, errorMessage, useCurrentUser, useOrganizationRoles, useWorkspaceAccess } from "../api";
import { SearchableSelect } from "@plane/ui";
import { Button, Skeleton } from "../components";
import { useEngineCatalog } from "../engine/api";
import { useUIStore } from "../store";
import { dashboardUrl, useAddDashboardWidget, useDashboard, useSaveDashboard } from "./api";
import type { DashboardTab, DashboardWidget, WidgetType } from "./types";
import { WidgetContent } from "./widget";
import { DashboardWidgetSettings } from "./settings";
import { dashboardPreviewRoles } from "./preview-roles";
import "../../../styles/dashboard.css";
import { browserId } from "../browser-id";

const identifier = browserId;
const duplicate = <T,>(value: T): T => structuredClone(value);
const galleryGroup: Record<WidgetType, string> = {
  counter: "شاخص و نمودار",
  chart: "شاخص و نمودار",
  progress: "شاخص و نمودار",
  workload: "شاخص و نمودار",
  age: "شاخص و نمودار",
  table: "فهرست و جدول",
  "my-work": "فهرست و جدول",
  approvals: "فهرست و جدول",
  unassigned: "فهرست و جدول",
  activity: "فهرست و جدول",
  calendar: "زمان و تیم",
  absences: "زمان و تیم",
  "team-cards": "زمان و تیم",
  links: "شخصی",
  note: "شخصی",
};
const galleryPreview: Partial<Record<WidgetType, string>> = {
  counter: "۲۴",
  chart: "▂▆█▄",
  progress: "۷۵٪",
  table: "☷ ☷ ☷",
  "team-cards": "● ● ●",
  workload: "▃▅▇",
  age: "۱ / ۳ / ۵",
  calendar: "۱ ۲ ۳",
};
const widgetIcons: Record<WidgetType, typeof LayoutDashboard> = {
  counter: BarChart3,
  chart: BarChart3,
  progress: BarChart3,
  workload: BarChart3,
  age: BarChart3,
  table: ListTodo,
  "my-work": ListTodo,
  approvals: ListTodo,
  unassigned: ListTodo,
  calendar: CalendarDays,
  absences: CalendarDays,
  "team-cards": UsersRound,
  activity: Activity,
  links: LayoutDashboard,
  note: LayoutDashboard,
};

export default function DashboardPage() {
  const slug = useUIStore((state) => state.workspaceSlug) || "";
  const toast = useUIStore((state) => state.toast);
  const { data: access } = useWorkspaceAccess();
  const { data: roles = [] } = useOrganizationRoles(undefined, access?.can("Dashboard.Default.Manage") === true);
  const [roleId, setRoleId] = useState("");
  const dashboard = useDashboard(roleId || undefined);
  const save = useSaveDashboard(roleId || undefined);
  const addWidget = useAddDashboardWidget(roleId || undefined);
  const client = useQueryClient();
  const { data: catalog } = useEngineCatalog();
  const [tabs, setTabs] = useState<DashboardTab[]>([]);
  const [revision, setRevision] = useState(0);
  const [activeId, setActiveId] = useState("");
  const [editing, setEditing] = useState(false);
  const [gallery, setGallery] = useState(false);
  const [search, setSearch] = useState("");
  const [configuredId, setConfiguredId] = useState("");
  const [sharingId, setSharingId] = useState("");
  const [fullId, setFullId] = useState("");
  const [newTab, setNewTab] = useState("");
  const [addingTab, setAddingTab] = useState(false);
  const { data: user } = useCurrentUser();
  const [sharedActive, setSharedActive] = useState<(DashboardTab & { mode: "read" | "copy"; owner: string }) | null>(
    null
  );
  useEffect(() => {
    if (!dashboard.data || editing) return;
    setTabs(duplicate(dashboard.data.tabs));
    setRevision(dashboard.data.revision);
    setActiveId((id) => (dashboard.data!.tabs.some((tab) => tab.id === id) ? id : dashboard.data!.tabs[0]?.id || ""));
    if (dashboard.data.default_updated) toast("داشبورد پیش‌فرض به‌روز شد", "info");
  }, [dashboard.data, editing, toast]);
  const active = sharedActive || tabs.find((tab) => tab.id === activeId);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "صبح بخیر" : hour < 17 ? "روز بخیر" : "عصر بخیر";
  const now = new Date();
  const today = `${now.toLocaleDateString("fa-IR", { weekday: "long" })}، ${now.toLocaleDateString("fa-IR-u-ca-persian", { day: "numeric", month: "long", year: "numeric" })}`;
  const configured = tabs.flatMap((tab) => tab.widgets).find((widget) => widget.id === configuredId);
  const sharing = tabs.find((tab) => tab.id === sharingId);
  const galleryItems = (dashboard.data?.gallery || []).filter(
    (item) =>
      (item.type !== "team-cards" || dashboard.data?.can_team) &&
      `${item.title} ${item.type}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())
  );
  function modifyTab(id: string, apply: (tab: DashboardTab) => DashboardTab) {
    setTabs((current) => current.map((tab) => (tab.id === id ? apply(tab) : tab)));
  }
  function modifyWidget(id: string, apply: (widget: DashboardWidget) => DashboardWidget) {
    setTabs((current) =>
      current.map((tab) => ({
        ...tab,
        widgets: tab.widgets.map((widget) => (widget.id === id ? apply(widget) : widget)),
      }))
    );
  }
  function cancel() {
    if (dashboard.data) {
      setTabs(duplicate(dashboard.data.tabs));
      setRevision(dashboard.data.revision);
    }
    setEditing(false);
    setGallery(false);
    setConfiguredId("");
  }
  async function commit() {
    try {
      const result = await save.mutateAsync({ tabs, revision });
      setTabs(duplicate(result.tabs));
      setRevision(result.revision);
      setEditing(false);
      setConfiguredId("");
      toast("داشبورد ذخیره شد", "success");
    } catch (error) {
      toast(errorMessage(error, "ذخیره داشبورد انجام نشد"), "error");
    }
  }
  async function createTab() {
    const title = newTab.trim() || `تب ${(tabs.length + 1).toLocaleString("fa-IR")}`;
    const tab: DashboardTab = { id: identifier(), title, widgets: [] };
    const next = [...tabs, tab];
    setTabs(next);
    setSharedActive(null);
    setActiveId(tab.id);
    setNewTab("");
    setAddingTab(false);
    // A draft with other unsaved edits is saved together with the new tab.
    try {
      const result = await save.mutateAsync({ tabs: next, revision });
      setTabs(duplicate(result.tabs));
      setRevision(result.revision);
      toast(`تب «${title}» ساخته شد`, "success");
    } catch (error) {
      setEditing(true);
      toast(errorMessage(error, "ساخت تب انجام نشد"), "error");
    }
  }
  async function createWidget(type: WidgetType) {
    try {
      const result = await addWidget.mutateAsync({ type, tab_id: active?.id, tabs, revision });
      setTabs(duplicate(result.tabs));
      setRevision(result.revision);
      setActiveId(result.tab_id);
      setConfiguredId(result.widget_id);
      setGallery(false);
      toast("ویجت افزوده و ذخیره شد", "success");
    } catch (error) {
      toast(errorMessage(error, "افزودن ویجت انجام نشد"), "error");
    }
  }
  function reorder(sourceId: string, targetId: string) {
    if (!active || sourceId === targetId) return;
    modifyTab(active.id, (tab) => {
      const widgets = [...tab.widgets];
      const from = widgets.findIndex((item) => item.id === sourceId),
        to = widgets.findIndex((item) => item.id === targetId);
      if (from < 0 || to < 0) return tab;
      const [moved] = widgets.splice(from, 1);
      widgets.splice(to, 0, moved);
      // eslint-disable-next-line oxc/no-map-spread -- React state must be copied, not mutated.
      return { ...tab, widgets: widgets.map((item, index) => ({ ...item, x: 0, y: index * 3 })) };
    });
  }
  async function reset() {
    if (!confirm("داشبورد شخصی به پیش‌فرض نقش برگردد؟")) return;
    try {
      await api.delete(dashboardUrl(slug));
      setEditing(false);
      await dashboard.refetch();
      toast("داشبورد پیش‌فرض بازیابی شد", "success");
    } catch (error) {
      toast(errorMessage(error, "بازیابی انجام نشد"), "error");
    }
  }
  if (dashboard.isLoading) return <Skeleton rows={6} cards />;
  if (dashboard.isError)
    return (
      <ErrorState
        message={errorMessage(
          dashboard.error,
          roleId ? "دریافت داشبورد پیش‌فرض نقش انجام نشد" : "دریافت داشبورد شخصی انجام نشد"
        )}
        onRetry={() => void dashboard.refetch()}
      />
    );
  return (
    <div className={`custom-dashboard ${editing ? "is-editing" : ""}`} dir="rtl">
      <header className="dashboard-hero">
        <div className="dashboard-hero-text">
          <span className="dashboard-hero-date">
            <CalendarDays size={14} aria-hidden="true" />
            {today}
          </span>
          <h1>{roleId ? "داشبورد پیش‌فرض نقش" : `${greeting}${user?.displayName ? `، ${user.displayName}` : ""}`}</h1>
          <p>
            {roleId
              ? `چیدمانی که اعضای نقش «${roles.find((role) => role.id === roleId)?.name || ""}» در ابتدا می‌بینند.`
              : "کارها، تیم و اطلاعات مهم شما در یک نگاه"}
          </p>
        </div>
        <div className="dashboard-actions">
          {dashboard.data?.can_manage_defaults && (
            <div className="dashboard-view-switch">
              <span>نمای داشبورد</span>
              <SearchableSelect
                label="انتخاب نمای داشبورد"
                value={roleId}
                options={[
                  { id: "", title: "داشبورد شخصی من", description: "فقط برای خودتان" },
                  ...dashboardPreviewRoles(roles).map((role) => ({
                    id: role.id,
                    title: role.name,
                    description: "پیش‌فرض نقش",
                  })),
                ]}
                onChange={(next) => {
                  setEditing(false);
                  setSharedActive(null);
                  setConfiguredId("");
                  setGallery(false);
                  setActiveId("");
                  setRoleId(next);
                }}
              />
            </div>
          )}
          {!roleId && !editing && !sharedActive && (
            <Button variant="ghost" icon={RotateCcw} onClick={reset}>
              بازگشت به پیش‌فرض
            </Button>
          )}
          {sharedActive ? (
            <Button variant="secondary" onClick={() => setSharedActive(null)}>
              بازگشت به داشبورد من
            </Button>
          ) : editing ? (
            <>
              <Button variant="secondary" icon={X} onClick={cancel}>
                انصراف
              </Button>
              <Button icon={Check} onClick={commit} disabled={save.isPending}>
                ذخیره
              </Button>
            </>
          ) : (
            <Button icon={Pencil} onClick={() => setEditing(true)}>
              ویرایش چیدمان
            </Button>
          )}
        </div>
      </header>
      <nav className="dashboard-tabbar" role="tablist" aria-label="تب‌های داشبورد">
        {tabs.map((tab, index) => (
          <div
            key={tab.id}
            className={`dashboard-tab ${!sharedActive && tab.id === activeId ? "active" : ""}`}
            draggable={editing}
            onDragStart={(event) => event.dataTransfer.setData("dashboard-tab", tab.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              const fromId = event.dataTransfer.getData("dashboard-tab");
              if (!fromId) return;
              setTabs((current) => {
                const items = [...current],
                  from = items.findIndex((item) => item.id === fromId),
                  to = items.findIndex((item) => item.id === tab.id);
                if (from < 0 || to < 0) return current;
                const [moved] = items.splice(from, 1);
                items.splice(to, 0, moved);
                return items;
              });
            }}
          >
            <button
              role="tab"
              aria-selected={!sharedActive && tab.id === activeId}
              onClick={() => {
                setSharedActive(null);
                setActiveId(tab.id);
              }}
            >
              <span>{tab.title}</span>
              <small aria-hidden="true">{tab.widgets.length.toLocaleString("fa-IR")}</small>
            </button>
            {editing && (
              <div className="dashboard-tab-tools">
                <button
                  aria-label="تغییر نام تب"
                  onClick={() => {
                    const title = prompt("نام جدید تب", tab.title);
                    if (title?.trim()) modifyTab(tab.id, (item) => ({ ...item, title: title.trim() }));
                  }}
                >
                  <Pencil size={14} />
                </button>
                <button
                  aria-label="کپی تب"
                  onClick={() => {
                    const copy = duplicate(tab);
                    copy.id = identifier();
                    copy.title += " (کپی)";
                    copy.widgets = copy.widgets.map((item) => ({
                      ...item,
                      id: identifier(),
                      locked: false,
                      origin: undefined,
                    }));
                    setTabs((current) => [...current.slice(0, index + 1), copy, ...current.slice(index + 1)]);
                    setActiveId(copy.id);
                  }}
                >
                  <Copy size={14} />
                </button>
                <button aria-label="اشتراک‌گذاری تب" onClick={() => setSharingId(tab.id)}>
                  <Share2 size={14} />
                </button>
                <button
                  aria-label="حذف تب"
                  onClick={() => {
                    if (!confirm(`تب «${tab.title}» حذف شود؟`)) return;
                    setTabs((current) => current.filter((item) => item.id !== tab.id));
                    if (activeId === tab.id) setActiveId(tabs.find((item) => item.id !== tab.id)?.id || "");
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </div>
        ))}
        {!sharedActive &&
          (addingTab ? (
            <div className="dashboard-new-tab">
              <input
                ref={(input) => input?.focus()}
                aria-label="نام تب جدید"
                placeholder="نام تب جدید"
                value={newTab}
                onChange={(event) => setNewTab(event.target.value)}
                onBlur={() => !newTab.trim() && setAddingTab(false)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void createTab();
                  if (event.key === "Escape") setAddingTab(false);
                }}
              />
              <button
                aria-label="افزودن تب"
                title="افزودن تب"
                disabled={save.isPending}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void createTab()}
              >
                <Check size={16} />
              </button>
            </div>
          ) : (
            <button className="dashboard-add-tab" onClick={() => setAddingTab(true)}>
              <Plus size={15} aria-hidden="true" /> تب جدید
            </button>
          ))}
      </nav>
      {editing && (
        <div className="dashboard-editbar">
          <span>
            <GripVertical size={16} aria-hidden="true" />
            ویجت‌ها را بکشید تا جابه‌جا شوند و اندازه را از پایین هر ویجت تغییر دهید.
          </span>
          <Button variant="secondary" icon={Plus} onClick={() => setGallery(true)}>
            افزودن ویجت
          </Button>
        </div>
      )}
      {sharedActive && <p className="dashboard-shared-label">تب اشتراکی: {sharedActive.title} · فقط‌خواندنی</p>}
      {active && (
        <div className="dashboard-widget-grid">
          {active.widgets.map((widget) => {
            const WidgetIcon = widgetIcons[widget.type];
            return (
              <article
                key={widget.id}
                className={`dashboard-widget dashboard-widget-${widget.type} ${fullId === widget.id ? "dashboard-widget-full" : ""}`}
                style={{ gridColumn: `span ${Math.min(12, widget.w)}`, gridRow: `span ${Math.max(2, widget.h)}` }}
                draggable={editing && !sharedActive}
                onDragStart={(event) => event.dataTransfer.setData("dashboard-widget", widget.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  const source = event.dataTransfer.getData("dashboard-widget");
                  if (source && !sharedActive) reorder(source, widget.id);
                }}
              >
                <header>
                  <div>
                    {editing && !sharedActive && <GripVertical size={17} />}
                    <span className="dashboard-widget-icon" aria-hidden="true">
                      <WidgetIcon size={17} strokeWidth={1.9} />
                    </span>
                    <h2>{widget.title || widget.type}</h2>
                    {widget.locked && <small>قفل</small>}
                  </div>
                  <div>
                    {!sharedActive && (
                      <button aria-label="تنظیم ویجت" onClick={() => setConfiguredId(widget.id)}>
                        <Settings2 size={16} />
                      </button>
                    )}
                    <button
                      aria-label="تازه‌سازی ویجت"
                      onClick={() => client.invalidateQueries({ queryKey: ["dashboard-widget", slug, widget.id] })}
                    >
                      <RefreshCw size={16} />
                    </button>
                    <button aria-label="تمام‌صفحه" onClick={() => setFullId(fullId === widget.id ? "" : widget.id)}>
                      <Expand size={16} />
                    </button>
                    {editing && !sharedActive && roleId && (
                      <button
                        aria-label={widget.locked ? "باز کردن قفل ویجت" : "قفل کردن ویجت"}
                        onClick={() => modifyWidget(widget.id, (item) => ({ ...item, locked: !item.locked }))}
                      >
                        {widget.locked ? "🔒" : "🔓"}
                      </button>
                    )}
                    {editing && !sharedActive && (
                      <button
                        aria-label="حذف ویجت"
                        disabled={widget.locked && !roleId}
                        onClick={() => {
                          if (confirm("این ویجت حذف شود؟"))
                            modifyTab(active.id, (tab) => ({
                              ...tab,
                              widgets: tab.widgets.filter((item) => item.id !== widget.id),
                            }));
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </header>
                <WidgetContent widget={widget} />
                {editing && !sharedActive && (
                  <footer className="dashboard-resize">
                    <button
                      onClick={() => modifyWidget(widget.id, (item) => ({ ...item, w: Math.max(3, item.w - 3) }))}
                    >
                      باریک‌تر
                    </button>
                    <button
                      onClick={() =>
                        modifyWidget(widget.id, (item) => ({ ...item, w: Math.min(12, item.w + 3), x: 0 }))
                      }
                    >
                      عریض‌تر
                    </button>
                    <button
                      onClick={() => modifyWidget(widget.id, (item) => ({ ...item, h: Math.min(8, item.h + 1) }))}
                    >
                      بلندتر
                    </button>
                    <button
                      disabled={widget.h <= 2}
                      onClick={() => modifyWidget(widget.id, (item) => ({ ...item, h: Math.max(2, item.h - 1) }))}
                    >
                      کوتاه‌تر
                    </button>
                  </footer>
                )}
              </article>
            );
          })}
        </div>
      )}
      {(!active || !active.widgets.length) && (
        <div className="dashboard-empty">
          <span className="dashboard-empty-icon" aria-hidden="true">
            <LayoutDashboard size={25} strokeWidth={1.7} />
          </span>
          <strong>{active ? "این بخش هنوز ویجتی ندارد" : "داشبورد خود را بسازید"}</strong>
          <p>
            {active ? "ویجت‌های موردنیازتان را از گالری انتخاب کنید." : "با ساختن یک تب، اطلاعات مهم را کنار هم ببینید."}
          </p>
          {!sharedActive && active && (
            <Button
              icon={Plus}
              onClick={() => {
                setEditing(true);
                setGallery(true);
              }}
            >
              افزودن ویجت
            </Button>
          )}
        </div>
      )}
      {!!dashboard.data?.shared_tabs?.length && (
        <section className="dashboard-shared">
          <h2>تب‌های اشتراکی</h2>
          {dashboard.data.shared_tabs.map((tab) => (
            <div key={`${tab.owner}-${tab.id}`}>
              <button
                onClick={() => {
                  if (editing) cancel();
                  setSharedActive(tab);
                }}
              >
                {tab.title} · مشاهده
              </button>
              {tab.mode === "copy" && (
                <button
                  onClick={() => {
                    const copy = duplicate(tab);
                    copy.id = identifier();
                    copy.widgets = copy.widgets.map((item) => ({
                      ...item,
                      id: identifier(),
                      locked: false,
                      origin: undefined,
                    }));
                    setTabs((current) => [...current, copy]);
                    setSharedActive(null);
                    setActiveId(copy.id);
                    setEditing(true);
                  }}
                >
                  کپی در داشبورد من
                </button>
              )}
            </div>
          ))}
        </section>
      )}
      {gallery && (
        <div
          className="dashboard-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setGallery(false);
          }}
        >
          <aside className="dashboard-drawer" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <h2>گالری ویجت‌ها</h2>
              <button onClick={() => setGallery(false)} aria-label="بستن">
                <X />
              </button>
            </header>
            <label className="dashboard-search">
              <Search size={17} />
              <input placeholder="جستجوی ویجت" value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            <div className="dashboard-gallery">
              {["شاخص و نمودار", "فهرست و جدول", "زمان و تیم", "شخصی"].map((group) => (
                <section key={group}>
                  <h3>{group}</h3>
                  <div>
                    {galleryItems
                      .filter((item) => galleryGroup[item.type] === group)
                      .map((item) => (
                        <button
                          key={item.type}
                          disabled={addWidget.isPending}
                          onClick={() => void createWidget(item.type)}
                        >
                          <strong>{item.title}</strong>
                          <span className="dashboard-gallery-preview" aria-hidden="true">
                            {galleryPreview[item.type] || "◧"}
                          </span>
                          <small>پیش‌نمایش {item.title}</small>
                        </button>
                      ))}
                  </div>
                </section>
              ))}
            </div>
          </aside>
        </div>
      )}
      {configured && (
        <div
          className="dashboard-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setConfiguredId("");
          }}
        >
          <aside className="dashboard-drawer" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <h2>تنظیم ویجت</h2>
              <button onClick={() => setConfiguredId("")} aria-label="بستن">
                <X />
              </button>
            </header>
            <DashboardWidgetSettings
              widget={configured}
              entities={catalog?.entities || []}
              update={(next) => {
                modifyWidget(configured.id, () => next);
                setEditing(true);
              }}
            />
          </aside>
        </div>
      )}
      {sharing && (
        <div
          className="dashboard-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSharingId("");
          }}
        >
          <aside className="dashboard-drawer" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <h2>اشتراک‌گذاری تب</h2>
              <button onClick={() => setSharingId("")} aria-label="بستن">
                <X />
              </button>
            </header>
            <p>شناسه کاربران را با ویرگول جدا کنید. هر گیرنده فقط داده‌های مجاز خودش را می‌بیند.</p>
            <label>
              کاربران
              <input
                value={sharing.share?.users?.join(",") || ""}
                onChange={(event) =>
                  modifyTab(sharing.id, (tab) => ({
                    ...tab,
                    share: {
                      ...tab.share,
                      users: event.target.value
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    },
                  }))
                }
              />
            </label>
            <label>
              نقش‌ها
              <select
                multiple
                value={sharing.share?.roles || []}
                onChange={(event) =>
                  modifyTab(sharing.id, (tab) => ({
                    ...tab,
                    share: { ...tab.share, roles: Array.from(event.target.selectedOptions, (item) => item.value) },
                  }))
                }
              >
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              سطح دسترسی
              <select
                value={sharing.share?.mode || "read"}
                onChange={(event) =>
                  modifyTab(sharing.id, (tab) => ({
                    ...tab,
                    share: { ...tab.share, mode: event.target.value as "read" | "copy" },
                  }))
                }
              >
                <option value="read">فقط‌خواندنی</option>
                <option value="copy">قابل‌کپی</option>
              </select>
            </label>
            <Button
              onClick={() => {
                setEditing(true);
                setSharingId("");
              }}
            >
              ثبت در پیش‌نویس
            </Button>
          </aside>
        </div>
      )}
      {fullId && (
        <button className="dashboard-full-close" onClick={() => setFullId("")}>
          خروج از تمام‌صفحه
        </button>
      )}
    </div>
  );
}
