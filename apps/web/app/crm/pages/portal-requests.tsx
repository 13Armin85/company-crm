import { useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowUpLeft, Inbox, RefreshCw, Search } from "lucide-react";
import { useCustomerRequests, useTicketPortal } from "../api/portal";
import { Button, EmptyState, PageHeader, Skeleton } from "../components";
import { errorMessage } from "../api/client";
import { SurfaceTable } from "../engine/surface";
import { PortalTab } from "../ticket/portal-tab";
import { persianDate, toFa } from "../utils";
import type { CustomerRequestList } from "../api/portal";

export function CustomerRequestTable({ data }: { data: CustomerRequestList }) {
  return (
    <SurfaceTable code="portal-requests" className="leave-table portal-inbox-table">
      <thead>
        <tr>
          {["شماره", "موضوع درخواست", "مشتری", "ثبت‌کننده", "مرحلهٔ رسیدگی", "وضعیت مشتری", "تاریخ ثبت", "عملیات"].map(
            (title) => (
              <th key={title}>{title}</th>
            )
          )}
        </tr>
      </thead>
      <tbody>
        {data.results.map((row) => (
          <tr key={row.id}>
            <td>
              <Link className="portal-request-number" to={`/portal-settings/requests/${row.id}`}>
                {row.number}
              </Link>
            </td>
            <td>
              <Link to={`/portal-settings/requests/${row.id}`} className="portal-inbox-subject">
                {row.subject}
              </Link>
            </td>
            <td>{row.customer.title}</td>
            <td>{row.account.display_name}</td>
            <td>
              <span className={`portal-stage is-${row.stage}`}>{row.stage_title}</span>
            </td>
            <td>{row.status.title}</td>
            <td>{persianDate(row.created_at)}</td>
            <td>
              <Link className="button button-ghost" to={`/portal-settings/requests/${row.id}`}>
                مشاهده و پاسخ <ArrowUpLeft size={15} />
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </SurfaceTable>
  );
}

export function CustomerRequests() {
  const [page, setPage] = useState(1),
    [stage, setStage] = useState(""),
    [search, setSearch] = useState(""),
    [q, setQuery] = useState("");
  const list = useCustomerRequests({ page, stage, q });
  const data = list.data;
  return (
    <section className="portal-inbox" aria-label="درخواست‌های ثبت‌شده مشتریان">
      <div className="portal-overview-stats">
        {[
          { code: "", title: "همهٔ درخواست‌ها", key: "all" },
          { code: "pending", title: "منتظر بررسی", key: "pending" },
          { code: "awaiting_customer", title: "منتظر پاسخ مشتری", key: "awaiting_customer" },
          { code: "accepted", title: "پذیرفته‌شده", key: "accepted" },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            aria-pressed={stage === item.code}
            onClick={() => {
              setStage(item.code);
              setPage(1);
            }}
          >
            <span>{item.title}</span>
            <strong>{data ? toFa(data.counts[item.key] || 0) : "…"}</strong>
          </button>
        ))}
      </div>
      <div className="portal-admin-card">
        <header className="portal-section-heading">
          <div>
            <h2>
              <Inbox size={19} /> درخواست‌های مشتریان
            </h2>
            <p>درخواست‌های مجاز را بررسی کنید، گفت‌وگو را بخوانید و پاسخ دهید.</p>
          </div>
          <Button variant="secondary" icon={RefreshCw} disabled={list.isFetching} onClick={() => void list.refetch()}>
            به‌روزرسانی
          </Button>
        </header>
        <form
          className="portal-inbox-filters"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(search.trim());
            setPage(1);
          }}
        >
          <label>
            <span>جست‌وجوی درخواست</span>
            <input
              value={search}
              placeholder="موضوع، شمارهٔ درخواست یا نام ثبت‌کننده"
              maxLength={100}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label>
            <span>مرحلهٔ رسیدگی</span>
            <select
              value={stage}
              onChange={(event) => {
                setStage(event.target.value);
                setPage(1);
              }}
            >
              <option value="">همهٔ مرحله‌ها</option>
              {data?.stages.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" icon={Search}>
            جست‌وجو
          </Button>
          {(q || stage) && (
            <Button
              variant="ghost"
              onClick={() => {
                setSearch("");
                setQuery("");
                setStage("");
                setPage(1);
              }}
            >
              پاک کردن فیلترها
            </Button>
          )}
        </form>
        {list.isLoading ? (
          <Skeleton rows={5} />
        ) : list.error ? (
          <EmptyState
            title="درخواست‌ها دریافت نشد"
            description={errorMessage(list.error, "دوباره تلاش کنید.")}
            action={<Button onClick={() => void list.refetch()}>تلاش دوباره</Button>}
          />
        ) : data?.results.length ? (
          <>
            <p className="portal-result-count">
              {toFa(data.count)} درخواست{q || stage ? " با فیلتر فعلی" : ""}
            </p>
            <CustomerRequestTable data={data} />
            {data.pages > 1 && (
              <nav className="portal-pager" aria-label="صفحه‌بندی درخواست‌های مشتریان">
                <Button
                  variant="secondary"
                  disabled={data.page <= 1 || list.isFetching}
                  onClick={() => setPage(data.page - 1)}
                >
                  قبلی
                </Button>
                <span>
                  صفحهٔ {toFa(data.page)} از {toFa(data.pages)}
                </span>
                <Button
                  variant="secondary"
                  disabled={data.page >= data.pages || list.isFetching}
                  onClick={() => setPage(data.page + 1)}
                >
                  بعدی
                </Button>
              </nav>
            )}
          </>
        ) : (
          <EmptyState
            title={q || stage ? "درخواستی با این شرایط پیدا نشد" : "هنوز درخواستی برای نمایش نیست"}
            description="درخواست‌های ثبت‌شده در درگاه، مطابق دسترسی شما اینجا نمایش داده می‌شوند."
          />
        )}
      </div>
    </section>
  );
}

export default function CustomerRequestPage() {
  const { id = "" } = useParams();
  const query = useTicketPortal(id);
  if (query.isLoading) return <Skeleton rows={6} />;
  if (query.error || !query.data?.is_portal)
    return (
      <EmptyState
        title="درخواست در دسترس نیست"
        description={errorMessage(query.error, "این درخواست پیدا نشد یا اجازهٔ مشاهدهٔ آن را ندارید.")}
        action={
          <Link className="button button-secondary" to="/portal-settings">
            بازگشت به درخواست‌ها
          </Link>
        }
      />
    );
  const record = query.data.request;
  return (
    <div className="portal-admin portal-request-detail">
      <Link className="leave-back" to="/portal-settings">
        بازگشت به درخواست‌های مشتریان
      </Link>
      <PageHeader
        eyebrow={record?.number || "درگاه مشتری"}
        title={record?.subject || "درخواست مشتری"}
        description={`ثبت‌کننده: ${query.data.account?.display_name || "مشتری"} · ${query.data.stage_title}`}
      />
      <div className="portal-admin-card">
        <PortalTab id={id} />
      </div>
      <Link className="button button-secondary" to={`/entities/ticket/${id}`}>
        مشاهدهٔ کار و سابقهٔ پیگیری
      </Link>
    </div>
  );
}
