/** One report: run (base source or saved report), builder with live preview, save / copy / delete / share, export. */
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { Copy, Play, Save, SlidersHorizontal, Trash2, RefreshCw } from "lucide-react";
import { useWorkspaceAccess } from "../api";
import {
  useCopySavedReport,
  useCreateSavedReport,
  useDeleteSavedReport,
  useReportCatalog,
  useRunReport,
  useSavedReport,
  useUpdateSavedReport,
} from "../api/reports";
import type { ReportDefinition, SavedReport } from "../api/reports";
import { Button, EmptyState, PageHeader, Skeleton } from "../components";
import { errorMessage } from "../api/client";
import {
  Aggregates,
  Builder,
  ExportPanel,
  Groups,
  IncompatibleNotice,
  ResultMeta,
  ResultTable,
  ShareEditor,
} from "./components";
import { definitionErrors, definitionForDate, incompatibleError, repairDefinition, tooLarge } from "./model";

type Sharing = Pick<SavedReport, "visibility" | "shared_roles" | "shared_units">;

export default function ReportPage() {
  const { code, id } = useParams();
  const [searchParams] = useSearchParams();
  const selectedDate = searchParams.get("date");
  const navigate = useNavigate();
  const { data: access, isLoading } = useWorkspaceAccess();
  const catalog = useReportCatalog();
  const saved = useSavedReport(id);
  const create = useCreateSavedReport();
  const update = useUpdateSavedReport();
  const copy = useCopySavedReport();
  const remove = useDeleteSavedReport();
  const source = catalog.data?.sources.find((row) => row.code === (saved.data?.source ?? code));
  const [draft, setDraft] = useState<ReportDefinition | null>(null);
  const [applied, setApplied] = useState<ReportDefinition | null>(null);
  const [overridden, setOverridden] = useState(false);
  const [page, setPage] = useState(1);
  const [building, setBuilding] = useState(false);
  const [name, setName] = useState("");
  const [sharing, setSharing] = useState<Sharing>({ visibility: "personal", shared_roles: [], shared_units: [] });

  useEffect(() => {
    if (!source) return;
    const merged = definitionForDate(source, saved.data?.definition, id ? null : selectedDate);
    setDraft(merged);
    setApplied(merged);
    setOverridden(false);
    setPage(1);
    setName(saved.data?.name ?? source.title);
    if (saved.data)
      setSharing({
        visibility: saved.data.visibility,
        shared_roles: saved.data.shared_roles,
        shared_units: saved.data.shared_units,
      });
  }, [source, saved.data, id, selectedDate]);

  const run = useRunReport(
    // A saved report runs its stored definition until the viewer changes something (then as overrides).
    { source: source?.code, savedId: id, definition: id && !overridden ? {} : applied, page },
    Boolean(source && applied)
  );
  if (isLoading || catalog.isLoading || (id && saved.isLoading)) return <Skeleton rows={6} />;
  if (!access?.can("Report.View") && !access?.can("Report.ViewAll")) return <Navigate to="/" replace />;
  if (catalog.isError)
    return (
      <EmptyState
        title="منابع گزارش در دسترس نیست"
        description={errorMessage(catalog.error, "خواندن منابع گزارش ممکن نشد.")}
      />
    );
  if (saved.isError)
    return <EmptyState title="گزارش پیدا نشد" description={errorMessage(saved.error, "این گزارش در دسترس نیست.")} />;
  if (!source || !draft || !applied)
    return <EmptyState title="منبع گزارش پیدا نشد" description="این نوع گزارش وجود ندارد." />;

  const can = catalog.data!.can;
  const errors = definitionErrors(source, draft);
  const incompatible = incompatibleError(run.error);
  const heavy = tooLarge(run.error);
  const mine = saved.data?.mine ?? false;
  const apply = () => {
    if (errors.length) return;
    setApplied(draft);
    setOverridden(true);
    setPage(1);
  };
  const body = { name: name.trim(), source: source.code, definition: draft, ...(can.share ? sharing : {}) };

  return (
    <div className="rp-page" dir="rtl">
      <PageHeader
        eyebrow="گزارش‌ها"
        title={saved.data?.name ?? source.title}
        description={saved.data?.description || source.description}
        actions={
          <>
            <Button variant="secondary" icon={RefreshCw} disabled={run.isFetching} onClick={() => void run.refetch()}>
              {run.isFetching ? "در حال به‌روزرسانی…" : "به‌روزرسانی گزارش"}
            </Button>
            {can.build && (
              <Button variant="secondary" icon={SlidersHorizontal} onClick={() => setBuilding(!building)}>
                {building ? "بستن سازنده" : "سازندهٔ گزارش"}
              </Button>
            )}
            {saved.data && !mine && can.build && (
              <Button
                variant="secondary"
                icon={Copy}
                onClick={() =>
                  copy.mutate(saved.data!.id, { onSuccess: (row) => navigate(`/reports/saved/${row.id}`) })
                }
              >
                کپی
              </Button>
            )}
            {saved.data && mine && (
              <Button
                variant="ghost"
                icon={Trash2}
                onClick={() => {
                  if (window.confirm("این گزارش حذف شود؟"))
                    remove.mutate(saved.data!.id, { onSuccess: () => navigate("/reports") });
                }}
              >
                حذف
              </Button>
            )}
          </>
        }
      />
      <Link className="rp-back" to="/reports">
        بازگشت به فهرست گزارش‌ها
      </Link>
      {Boolean(source.connections?.length) && (
        <nav className="rp-connections" aria-label="بخش‌های مرتبط با گزارش">
          <span>بخش‌های مرتبط:</span>
          {source.connections?.map((connection) => (
            <Link className="button button-ghost" key={connection.path} to={connection.path}>
              {connection.title}
            </Link>
          ))}
        </nav>
      )}
      {building && (
        <section className="rp-build" aria-label="سازندهٔ گزارش">
          <Builder source={source} definition={draft} onChange={setDraft} />
          {errors.length > 0 && (
            <ul className="dr-errors" role="alert">
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
          <div className="rp-save">
            <label>
              نام گزارش
              <input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
            </label>
            {can.share && (!saved.data || mine) && <ShareEditor value={sharing} onChange={setSharing} />}
            <div className="dr-actions">
              <Button icon={Play} disabled={errors.length > 0} onClick={apply}>
                پیش‌نمایش
              </Button>
              {saved.data && mine && saved.data.can.edit && (
                <Button
                  icon={Save}
                  disabled={errors.length > 0 || !name.trim() || update.isPending}
                  onClick={() =>
                    update.mutate(
                      { id: saved.data!.id, revision: saved.data!.revision, ...body },
                      { onSuccess: () => setOverridden(false) }
                    )
                  }
                >
                  ذخیره
                </Button>
              )}
              <Button
                variant={saved.data ? "secondary" : "primary"}
                icon={Save}
                disabled={errors.length > 0 || !name.trim() || create.isPending}
                onClick={() =>
                  create.mutate(
                    { ...body, name: saved.data && body.name === saved.data.name ? `نسخه از ${body.name}` : body.name },
                    { onSuccess: (row) => navigate(`/reports/saved/${row.id}`) }
                  )
                }
              >
                ذخیره به‌عنوان گزارش جدید
              </Button>
            </div>
          </div>
        </section>
      )}
      {incompatible && (
        <IncompatibleNotice
          message={incompatible.message}
          missing={incompatible.missing}
          onEdit={
            can.build
              ? () => {
                  setDraft(repairDefinition(source, draft));
                  setBuilding(true);
                }
              : undefined
          }
        />
      )}
      {heavy && can.export && (
        <ExportPanel key={JSON.stringify(applied)} source={source.code} savedId={id} definition={applied} heavy />
      )}
      {heavy && !can.export && <p className="dr-muted">برای اجرای این گزارش بازه یا فیلتر را محدود کنید.</p>}
      {run.isLoading && <Skeleton rows={6} />}
      {run.isError && !incompatible && !heavy && (
        <EmptyState title="اجرای گزارش ممکن نشد" description={errorMessage(run.error, "اجرای گزارش ممکن نشد.")} />
      )}
      {run.data && !run.isError && (
        <>
          <ResultMeta result={run.data} />
          <Aggregates result={run.data} />
          <Groups result={run.data} />
          <ResultTable result={run.data} onPage={setPage} />
          {can.export && (
            <ExportPanel key={JSON.stringify(applied)} source={source.code} savedId={id} definition={applied} />
          )}
        </>
      )}
    </div>
  );
}
