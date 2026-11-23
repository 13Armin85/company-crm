import { useCrmLocation as useLocation } from "../navigation";
import { ErrorNotice } from "../error-state";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, Box, CalendarDays, CheckSquare2, FolderKanban, Layers3, Settings2, Ticket } from "lucide-react";
import { normalizePersianSearch, SearchableSelect } from "@plane/ui";
import { Button, EmptyState, PageHeader, SearchBox, Skeleton } from "../components";
import { AccessModal } from "../access/components";
import { errorMessage, useWorkspaceAccess } from "../api";
import { useUIStore } from "../store";
import { persianDate, plainText } from "../utils";
import { EngineRecordForm } from "./record-form";
import { EntityRecordSummary } from "./record-summary";
import { TaskNotes } from "./task-notes";
import { auditEventTitle, auditFieldTitle, auditValue } from "./audit-presentation";
import { RelatedRecords } from "./related-records";
import { WorkflowPanel } from "../workflow/panel";
import { TicketCorePanel } from "../ticket/ticket-panel";
import { DeletePreviewDialog } from "./delete-preview";
import { useEngineCatalog, useEngineQuery, useEngineRecord, useEngineMutation } from "./api";
import type { AuditEvent, EnginePage } from "./api";
import { entityDisplayTitle } from "./presentation";
import { NewPageDialog } from "./sidebar-pages";
import { DeletePageButton } from "./delete-page";
import { useNavigationDocument } from "../navigation";
import { categoryUrl } from "../navigation-paths";

export function EntityDirectoryPage() {
  const { data, isLoading, error } = useEngineCatalog();
  const { data: access } = useWorkspaceAccess();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [creatingPage, setCreatingPage] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const navigation = useNavigationDocument();
  const pageNavigation = useMemo(() => new Map(navigation?.entities.map((page) => [page.code, page])), [navigation]);
  const entities = useMemo(
    () =>
      data?.entities.filter(
        (entity) =>
          !entity.parent &&
          ((entity.is_active && (!navigation || pageNavigation.has(entity.code))) ||
            (showInactive && entity.page_management?.can_manage))
      ) || [],
    [data?.entities, showInactive, navigation, pageNavigation]
  );
  const subtypeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entity of data?.entities ?? [])
      if (entity.parent && entity.is_active) counts.set(entity.parent, (counts.get(entity.parent) ?? 0) + 1);
    return counts;
  }, [data?.entities]);
  const normalizedSearch = normalizePersianSearch(search);
  const visible = entities.filter(
    (entity) =>
      (category === "all" || pageNavigation.get(entity.code)?.category === category) &&
      normalizePersianSearch(`${entityDisplayTitle(entity.title)} ${entity.description}`).includes(normalizedSearch)
  );
  const entityIcons = { ticket: Ticket, project: FolderKanban, task: CheckSquare2, leave: CalendarDays };
  return (
    <div className="engine-directory">
      <PageHeader
        title="صفحه‌ها"
        description="صفحهٔ مورد نظر را باز کنید تا اطلاعات آن را ببینید یا ثبت کنید."
        actions={
          <div className="engine-actions">
            {access?.can("EntityType.Create") && access.can("FormDesigner.Publish") && (
              <Button onClick={() => setCreatingPage(true)}>ساخت صفحهٔ جدید</Button>
            )}
            {access?.can("EntityType.View") && (
              <Link className="button button-secondary" to={categoryUrl(navigation, "/settings/engine")}>
                <Settings2 size={16} aria-hidden="true" /> مدیریت فرم‌ها
              </Link>
            )}
          </div>
        }
      />
      <section className="engine-directory-toolbar" aria-label="جستجو و دسته‌بندی فرم‌ها">
        <div className="engine-directory-count">
          <Layers3 size={20} aria-hidden="true" />
          <strong>{visible.length.toLocaleString("fa-IR")}</strong>
          <span>صفحه در دسترس</span>
        </div>
        <SearchBox value={search} onChange={setSearch} placeholder="جستجوی نام یا توضیحات صفحه…" />
        <select aria-label="دسته‌بندی صفحه‌ها" value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="all">همه صفحه‌ها</option>
          {navigation?.categories.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
        {data?.entities.some((entity) => !entity.parent && !entity.is_active && entity.page_management?.can_manage) && (
          <label>
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(event) => {
                setShowInactive(event.target.checked);
                setCategory("all");
              }}
            />{" "}
            نمایش صفحه‌های غیرفعال
          </label>
        )}
      </section>
      {isLoading ? (
        <Skeleton rows={4} cards />
      ) : error ? (
        <ErrorNotice message={errorMessage(error, "دریافت موجودیت‌ها انجام نشد.")} />
      ) : !visible.length ? (
        <EmptyState
          title={entities.length ? "فرمی پیدا نشد" : "هنوز فرمی در دسترس نیست"}
          description={
            entities.length
              ? "عبارت جستجو یا دسته‌بندی را تغییر دهید."
              : "فرم‌های فعال و مجاز این فضای کاری در این بخش نمایش داده می‌شوند."
          }
        />
      ) : (
        <div className="engine-entity-cards">
          {visible.map((entity) => {
            const Icon = entityIcons[entity.adapter as keyof typeof entityIcons] || Box;
            const subtypes = subtypeCounts.get(entity.id) ?? 0;
            return (
              <article key={entity.id} className="engine-entity-card">
                <Link
                  to={pageNavigation.get(entity.code)?.to ?? categoryUrl(navigation, `/entities/${entity.code}`)}
                  className="engine-entity-card-open"
                >
                  <div className="engine-entity-card-heading">
                    <span className="engine-entity-icon">
                      <Icon size={24} aria-hidden="true" />
                    </span>
                    <span className="engine-entity-kind">
                      {!entity.is_active ? "غیرفعال" : entity.adapter ? "فرم اصلی" : "فرم سفارشی"}
                    </span>
                  </div>
                  <h2>{entityDisplayTitle(entity.title)}</h2>
                  <p>{plainText(entity.description || "مشاهده، ثبت و ویرایش رکوردها در فرم مشترک فضای کاری")}</p>
                  <div className="engine-entity-card-footer">
                    <small>{subtypes ? `${subtypes.toLocaleString("fa-IR")} زیرنوع` : "فرم پایه"}</small>
                    <span>
                      مشاهده رکوردها <ArrowLeft size={16} aria-hidden="true" />
                    </span>
                  </div>
                </Link>
                <DeletePageButton entity={entity} />
              </article>
            );
          })}
        </div>
      )}
      {creatingPage && <NewPageDialog onClose={() => setCreatingPage(false)} />}
    </div>
  );
}

export function EntityRecordPage() {
  const { code = "", recordId = "new" } = useParams(),
    navigate = useNavigate();
  const creating = recordId === "new",
    [subtype, setSubtype] = useState("");
  const { data: catalog } = useEngineCatalog(),
    entity = catalog?.entities.find((e) => e.code === code);
  const { data: record, error: recordError } = useEngineRecord(code, creating ? "" : recordId),
    mutation = useEngineMutation();
  const recordStatus = (recordError as { response?: { status?: number } } | null)?.response?.status;
  const inverse = useEngineQuery<{ results: EnginePage["results"] }>(
    "relations",
    `entities/${code}/records/${recordId}/relations/`,
    !creating
  );
  const events = useEngineQuery<{ results: AuditEvent[] }>(
    "events",
    `entities/${code}/records/${recordId}/events/`,
    !creating
  );
  const subtypes = catalog?.entities.filter((e) => e.parent === entity?.id && e.is_active) || [];
  const [previewing, setPreviewing] = useState<"delete" | "deactivate" | null>(null);
  const run = (kind: "delete" | "active", confirm = false) =>
    mutation.mutateAsync({
      path: `entities/${code}/records/${recordId}/${kind === "delete" && confirm ? "?confirm_relations=true" : ""}`,
      method: kind === "delete" ? "delete" : "patch",
      data: kind === "active" ? { is_active: !record?.is_active, confirm_relations: confirm } : undefined,
    });
  const action = async (kind: "delete" | "active") => {
    // Deleting or deactivating first shows the server's dry run of the relation rules.
    if (kind === "delete" || record?.is_active) {
      setPreviewing(kind === "delete" ? "delete" : "deactivate");
      return;
    }
    if (!window.confirm("رکورد فعال شود؟")) return;
    await run("active").catch(() => {});
  };
  const confirmPreview = async (result: "blocked" | "delete" | "deactivate") => {
    const kind = previewing === "delete" ? "delete" : "active";
    try {
      await run(kind, true);
      setPreviewing(null);
      // A soft deactivation keeps the record; stay on it so the inactive state is visible.
      if (kind === "delete" && result === "delete") navigate(`/entities/${code}`);
    } catch {
      setPreviewing(null);
    }
  };
  if (!creating && (recordStatus === 403 || recordStatus === 404))
    return (
      <div className="engine-record-page">
        <section role="alert" className="panel">
          <h2>این رکورد پیدا نشد یا اجازهٔ دیدن آن را ندارید</h2>
          <p>اگر فکر می‌کنید باید به آن دسترسی داشته باشید، با مدیر خود تماس بگیرید.</p>
          <Link className="button button-secondary" to={`/entities/${code}`}>
            بازگشت به فهرست
          </Link>
        </section>
      </div>
    );
  return (
    <div className="engine-record-page">
      <PageHeader
        title={creating ? `ثبت ${entityDisplayTitle(entity?.title || "رکورد")}` : record?.title || "جزئیات رکورد"}
        description={creating ? "اطلاعات را تکمیل کنید و برای ذخیره، «ثبت رکورد» را بزنید." : record?.number}
        actions={
          <div className="engine-actions">
            <Link className="button button-secondary" to={`/entities/${code}`}>
              بازگشت به فهرست
            </Link>
            {record?.can_deactivate && (
              <Button variant="secondary" disabled={mutation.isPending} onClick={() => void action("active")}>
                {record.is_active ? "غیرفعال‌سازی" : "فعال‌سازی"}
              </Button>
            )}
            {record?.can_delete && (
              <Button variant="danger" disabled={mutation.isPending} onClick={() => void action("delete")}>
                حذف
              </Button>
            )}
          </div>
        }
      />
      {creating && subtypes.length > 0 && (
        <div className="engine-subtype">
          <SearchableSelect
            label="زیرنوع"
            value={subtype}
            onChange={setSubtype}
            showLabel
            options={[
              { id: "", title: "فرم اصلی" },
              ...subtypes.map((s) => ({ id: s.code, title: entityDisplayTitle(s.title) })),
            ]}
          />
        </div>
      )}
      {previewing && (
        <DeletePreviewDialog
          code={code}
          id={recordId}
          mode={previewing}
          pending={mutation.isPending}
          onConfirm={(result) => void confirmPreview(result)}
          onClose={() => setPreviewing(null)}
        />
      )}
      {mutation.error && <ErrorNotice message={errorMessage(mutation.error, "عملیات انجام نشد.")} />}
      {!creating && <EntityRecordSummary code={code} id={recordId} />}
      {!creating && ["task", "ticket"].includes(code) && <TaskNotes id={recordId} />}
      {!creating && code === "ticket" && <TicketCorePanel id={recordId} />}
      {!creating && <WorkflowPanel code={code} id={recordId} />}
      {!creating && code !== "ticket" && <RelatedRecords code={code} id={recordId} />}
      <div className="engine-record-card">
        <EngineRecordForm
          key={`${code}:${recordId}:${subtype}`}
          code={code}
          id={creating ? "" : recordId}
          subtype={subtype}
          onSaved={(row) => navigate(`/entities/${code}/${row.id}`)}
        />
      </div>
      {!creating && (
        <div className="engine-detail-extras">
          <section>
            <h2>ارتباط‌های معکوس</h2>
            {inverse.error ? (
              <p>دریافت ارتباط‌ها انجام نشد.</p>
            ) : inverse.data?.results.length ? (
              inverse.data.results.map((r) => (
                <Link key={`${r.entity}:${r.id}`} to={`/entities/${r.entity}/${r.id}`}>
                  {r.title} <small>{r.number}</small>
                </Link>
              ))
            ) : (
              <p>ارتباط قابل مشاهده‌ای وجود ندارد.</p>
            )}
          </section>
          <section>
            <h2>تاریخچه تغییرات</h2>
            {events.isLoading && <p>در حال دریافت سابقه…</p>}
            {events.error && <p role="alert">دریافت سابقه انجام نشد.</p>}
            {!events.isLoading && !events.error && !events.data?.results.length && <p>هنوز تغییری ثبت نشده است.</p>}
            <ol className="engine-audit-list">
              {events.data?.results.map((event) => {
                const field = auditFieldTitle(event.field, event.metadata);
                const hasValues = event.before != null || event.after != null;
                return (
                  <li key={event.id} className="engine-audit-item">
                    <div className="engine-audit-item-head">
                      <strong>{auditEventTitle(event)}</strong>
                      <time dateTime={event.at}>{persianDate(event.at, { hour: "2-digit", minute: "2-digit" })}</time>
                    </div>
                    <p className="engine-audit-actor">توسط {event.actor || "سامانه"}</p>
                    {field && <p className="engine-audit-field">{field}</p>}
                    {hasValues && (
                      <div className="engine-audit-values">
                        {event.before != null && <span>پیش از تغییر: {auditValue(event.before, event.field)}</span>}
                        {event.after != null && <span>پس از تغییر: {auditValue(event.after, event.field)}</span>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        </div>
      )}
    </div>
  );
}

export function EngineQuickCreate() {
  const location = useLocation(),
    createKind = useUIStore((s) => s.createKind),
    close = useUIStore((s) => s.setCreateOpen);
  const { data: catalog } = useEngineCatalog();
  const [kind, setKind] = useState(createKind === "project" ? "project" : "ticket"),
    [subtype, setSubtype] = useState("");
  const entity = catalog?.entities.find((e) => e.code === kind),
    projectId = location.pathname.match(/^\/projects\/([^/]+)/)?.[1];
  const options =
    catalog?.entities
      .filter((e) => !e.parent && e.is_active && e.can_create)
      .map((e) => ({ id: e.code, title: entityDisplayTitle(e.title) })) || [];
  const subtypes = catalog?.entities.filter((e) => e.parent === entity?.id && e.is_active) || [];
  return (
    <AccessModal title="ایجاد سریع" onClose={() => close(false)}>
      <div className="engine-quick-create">
        <SearchableSelect
          label="نوع رکورد"
          value={kind}
          options={options}
          onChange={(v) => {
            setKind(v);
            setSubtype("");
          }}
        />
        {subtypes.length > 0 && (
          <SearchableSelect
            label="زیرنوع"
            value={subtype}
            options={[
              { id: "", title: "فرم اصلی" },
              ...subtypes.map((s) => ({ id: s.code, title: entityDisplayTitle(s.title) })),
            ]}
            onChange={setSubtype}
          />
        )}
        <EngineRecordForm
          code={kind}
          subtype={subtype}
          initialValues={kind === "ticket" && projectId ? { project: projectId } : undefined}
          onSaved={() => close(false)}
          onCancel={() => close(false)}
        />
        <Link to={`/entities/${kind}/new`} onClick={() => close(false)}>
          باز کردن فرم در صفحه کامل
        </Link>
      </div>
    </AccessModal>
  );
}
