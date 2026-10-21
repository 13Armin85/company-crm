import { useState } from "react";
import { Link, useNavigate, useParams, useLocation } from "react-router";
import { ArrowLeft, Box, CalendarDays, CheckSquare2, FolderKanban, Layers3, Settings2, Ticket } from "lucide-react";
import { SearchableSelect } from "@plane/ui";
import { Button, EmptyState, PageHeader, SearchBox, Skeleton } from "../components";
import { AccessModal } from "../access/components";
import { errorMessage, useWorkspaceAccess } from "../api";
import { useUIStore } from "../store";
import { persianDate } from "../utils";
import { EngineRecordForm } from "./record-form";
import { EntityRecordSummary } from "./record-summary";
import { useEngineCatalog, useEngineQuery, useEngineRecord, useEngineMutation } from "./api";
import type { AuditEvent, EnginePage } from "./api";
import { entityDisplayTitle } from "./presentation";

export function EntityDirectoryPage() {
  const { data, isLoading, error } = useEngineCatalog();
  const { data: access } = useWorkspaceAccess();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const entities = data?.entities.filter((entity) => !entity.parent && entity.is_active) || [];
  const visible = entities.filter(
    (entity) =>
      (category === "all" || (category === "native" ? Boolean(entity.adapter) : !entity.adapter)) &&
      `${entityDisplayTitle(entity.title)} ${entity.description}`.includes(search.trim())
  );
  const entityIcons = { ticket: Ticket, project: FolderKanban, task: CheckSquare2, leave: CalendarDays };
  return (
    <div className="engine-directory">
      <PageHeader
        title="موجودیت‌ها و فرم‌ها"
        description="فرم مورد نظر را انتخاب کنید؛ رکوردها را ببینید، ثبت کنید و ویرایش کنید."
        actions={
          access?.can("EntityType.View") ? (
            <Link className="button button-secondary" to="/settings/engine">
              <Settings2 size={16} aria-hidden="true" /> مدیریت فرم‌ها
            </Link>
          ) : undefined
        }
      />
      <section className="engine-directory-toolbar" aria-label="جستجو و دسته‌بندی فرم‌ها">
        <div className="engine-directory-count">
          <Layers3 size={20} aria-hidden="true" />
          <strong>{entities.length.toLocaleString("fa-IR")}</strong>
          <span>فرم در دسترس</span>
        </div>
        <SearchBox value={search} onChange={setSearch} placeholder="جستجوی نام یا توضیحات فرم…" />
        <div className="engine-directory-filters" role="group" aria-label="دسته‌بندی فرم‌ها">
          {[
            { id: "all", title: "همه فرم‌ها" },
            { id: "native", title: "فرم‌های اصلی" },
            { id: "custom", title: "فرم‌های سفارشی" },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={category === item.id}
              onClick={() => setCategory(item.id)}
            >
              {item.title}
            </button>
          ))}
        </div>
      </section>
      {isLoading ? (
        <Skeleton rows={4} cards />
      ) : error ? (
        <p role="alert">{errorMessage(error, "دریافت موجودیت‌ها انجام نشد.")}</p>
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
            const subtypes = data?.entities.filter((item) => item.parent === entity.id && item.is_active).length || 0;
            return (
              <Link key={entity.id} to={`/entities/${entity.code}`} className="engine-entity-card">
                <div className="engine-entity-card-heading">
                  <span className="engine-entity-icon">
                    <Icon size={24} aria-hidden="true" />
                  </span>
                  <span className="engine-entity-kind">{entity.adapter ? "فرم اصلی" : "فرم سفارشی"}</span>
                </div>
                <h2>{entityDisplayTitle(entity.title)}</h2>
                <p>{entity.description || "مشاهده، ثبت و ویرایش رکوردها در فرم مشترک فضای کاری"}</p>
                <div className="engine-entity-card-footer">
                  <small>{subtypes ? `${subtypes.toLocaleString("fa-IR")} زیرنوع` : "فرم پایه"}</small>
                  <span>
                    مشاهده رکوردها <ArrowLeft size={16} aria-hidden="true" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

const eventTitles: Record<string, string> = {
  "record.created": "ثبت رکورد",
  "record.updated": "ویرایش رکورد",
  "record.field_changed": "تغییر فیلد",
  "record.status_changed": "تغییر وضعیت",
  "record.deactivated": "غیرفعال‌سازی",
  "record.activated": "فعال‌سازی",
};
export function EntityRecordPage() {
  const { code = "", recordId = "new" } = useParams(),
    navigate = useNavigate();
  const creating = recordId === "new",
    [subtype, setSubtype] = useState("");
  const { data: catalog } = useEngineCatalog(),
    entity = catalog?.entities.find((e) => e.code === code);
  const { data: record } = useEngineRecord(code, creating ? "" : recordId),
    mutation = useEngineMutation();
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
  const action = async (kind: "delete" | "active") => {
    if (
      !window.confirm(
        kind === "delete"
          ? "این رکورد حذف شود؟ داده مرتبط ممکن است همچنان به آن ارجاع دهد."
          : `رکورد ${record?.is_active ? "غیرفعال" : "فعال"} شود؟`
      )
    )
      return;
    const run = (confirm = false) =>
      mutation.mutateAsync({
        path: `entities/${code}/records/${recordId}/${kind === "delete" && confirm ? "?confirm_relations=true" : ""}`,
        method: kind === "delete" ? "delete" : "patch",
        data: kind === "active" ? { is_active: !record?.is_active, confirm_relations: confirm } : undefined,
      });
    try {
      await run();
      if (kind === "delete") navigate(`/entities/${code}`);
    } catch (error) {
      if (
        (error as { response?: { status: number } }).response?.status === 409 &&
        window.confirm("این رکورد ارتباط فعال دارد. با وجود این ارتباط‌ها ادامه می‌دهید؟")
      ) {
        await run(true);
        if (kind === "delete") navigate(`/entities/${code}`);
      }
    }
  };
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
      {!creating && <EntityRecordSummary code={code} id={recordId} />}
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
            {events.data?.results.map((event) => (
              <details key={event.id}>
                <summary>
                  {eventTitles[event.type] || "تغییر رکورد"} · {event.actor} · {persianDate(event.at)}
                </summary>
                <p>{event.field}</p>
                <div className="engine-audit-values">
                  <span>
                    مقدار پیشین:{" "}
                    {typeof event.before === "object" ? JSON.stringify(event.before) : String(event.before ?? "—")}
                  </span>
                  <span>
                    مقدار جدید:{" "}
                    {typeof event.after === "object" ? JSON.stringify(event.after) : String(event.after ?? "—")}
                  </span>
                </div>
              </details>
            ))}
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
  const [kind, setKind] = useState(
      createKind === "project" ? "project" : location.pathname.startsWith("/projects/") ? "ticket" : "task"
    ),
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
