/** «گزارش‌ها»: base reports (sources with their default definition) and saved reports (mine / shared). */
import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { ArrowUpLeft, ClipboardList, Copy, FileBarChart, Trash2, Users } from "lucide-react";
import { useWorkspaceAccess } from "../api";
import { useCopySavedReport, useDeleteSavedReport, useReportCatalog, useSavedReports } from "../api/reports";
import type { ReportSource, SavedReport } from "../api/reports";
import { Button, EmptyState, PageHeader, Skeleton, TabBar } from "../components";
import { errorMessage } from "../api/client";
import { Pill } from "../daily-report/components";

export function SourceCard({ source }: { source: ReportSource }) {
  return (
    <Link className="rp-card" to={`/reports/source/${source.code}`}>
      <span className="rp-card-icon">
        <FileBarChart size={22} aria-hidden="true" />
      </span>
      <div className="rp-card-content">
        <h3>{source.title}</h3>
        <p>{source.description}</p>
        <small>
          <Users size={13} aria-hidden="true" /> {source.team ? "شما و افراد زیرمجموعه" : "فقط دادهٔ شما"}
        </small>
      </div>
      <ArrowUpLeft className="rp-card-arrow" size={18} aria-hidden="true" />
    </Link>
  );
}

export function SavedList({
  rows,
  onDelete,
  onCopy,
}: {
  rows: SavedReport[];
  onDelete: (id: string) => void;
  onCopy: (id: string) => void;
}) {
  if (!rows.length) return <EmptyState title="گزارشی نیست" description="گزارشی در این فهرست ذخیره نشده است." />;
  return (
    <ul className="rp-saved">
      {rows.map((row) => (
        <li key={row.id}>
          <Link to={`/reports/saved/${row.id}`}>
            <b>{row.name}</b>
            <small>
              {row.source_title} · {row.mine ? "ساخت شما" : `از ${row.owner.name}`}
            </small>
          </Link>
          {row.visibility === "shared" && <Pill tone="info">اشتراکی</Pill>}
          <div className="rp-saved-actions">
            {row.can.copy && (
              <Button variant="ghost" icon={Copy} onClick={() => onCopy(row.id)}>
                کپی
              </Button>
            )}
            {row.can.delete && (
              <Button variant="ghost" icon={Trash2} onClick={() => onDelete(row.id)}>
                حذف
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function ReportsPage() {
  const { data: access, isLoading } = useWorkspaceAccess();
  const catalog = useReportCatalog();
  const saved = useSavedReports();
  const remove = useDeleteSavedReport();
  const copy = useCopySavedReport();
  const navigate = useNavigate();
  const [tab, setTab] = useState("base");
  if (isLoading || catalog.isLoading) return <Skeleton rows={6} cards />;
  if (!access?.can("Report.View") && !access?.can("Report.ViewAll")) return <Navigate to="/" replace />;
  if (catalog.isError)
    return (
      <EmptyState title="گزارش‌ها در دسترس نیست" description={errorMessage(catalog.error, "مشاهدهٔ گزارش‌ها ممکن نشد.")} />
    );
  const rows = saved.data ?? [];
  const mine = rows.filter((row) => row.mine);
  const shared = rows.filter((row) => !row.mine);
  return (
    <div className="rp-page" dir="rtl">
      <PageHeader
        eyebrow="گزارش‌ها"
        title="گزارش‌ها"
        description="گزارش‌های یکپارچهٔ کارها، مرخصی، عدم حضور، مشتریان و پروژه‌ها را ببینید، ذخیره کنید و خروجی بگیرید."
        actions={
          <>
            {(access.can("DailyReport.Team.View") || access.can("Report.ViewAll")) && (
              <Link className="button button-secondary" to="/daily-report/team">
                <Users size={16} /> گزارش روزانهٔ تیم
              </Link>
            )}
            {(access.can("DailyReport.Submit") ||
              access.can("DailyReport.Team.View") ||
              access.can("Report.ViewAll")) && (
              <Link className="button button-ghost" to="/daily-report">
                <ClipboardList size={16} /> گزارش روزانهٔ من
              </Link>
            )}
          </>
        }
      />
      <TabBar
        items={[
          { id: "base", label: "گزارش‌های پایه", count: catalog.data?.sources.length },
          { id: "mine", label: "گزارش‌های من", count: mine.length },
          { id: "shared", label: "اشتراکی با من", count: shared.length },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "base" && (
        <div className="rp-cards">
          {catalog.data?.sources.map((source) => (
            <SourceCard key={source.code} source={source} />
          ))}
        </div>
      )}
      {tab !== "base" &&
        (saved.isLoading ? (
          <Skeleton rows={4} />
        ) : saved.isError ? (
          <EmptyState
            title="گزارش‌های ذخیره‌شده در دسترس نیست"
            description={errorMessage(saved.error, "خواندن گزارش‌ها ممکن نشد.")}
          />
        ) : (
          <SavedList
            rows={tab === "mine" ? mine : shared}
            onDelete={(id) => {
              if (window.confirm("این گزارش حذف شود؟ دادهٔ منبع تغییری نمی‌کند.")) remove.mutate(id);
            }}
            onCopy={(id) => copy.mutate(id, { onSuccess: (row) => navigate(`/reports/saved/${row.id}`) })}
          />
        ))}
    </div>
  );
}
