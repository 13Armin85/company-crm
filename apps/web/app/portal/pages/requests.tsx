/** "My requests": status filter (company labels only), search and paging. */
import { useState } from "react";
import { Link } from "react-router";
import { ArrowUpLeft, FilePlus2, Inbox, MessageCircle, RefreshCw } from "lucide-react";
import { toFa } from "../../crm/utils";
import { portalError } from "../api/client";
import { usePortalRequests } from "../api/portal";
import { StatusPill } from "../components";
import { portalDate } from "../model";
import type { PortalRequestSummary } from "../api/portal";

export function PortalRequestCards({ requests }: { requests: PortalRequestSummary[] }) {
  return (
    <ul className="portal-request-list">
      {requests.map((item) => (
        <li key={item.id}>
          <Link to={`/portal/requests/${item.id}`} className={`portal-request ${item.unread ? "has-update" : ""}`}>
            <span className="portal-request-icon">
              <MessageCircle size={22} aria-hidden />
            </span>
            <div className="portal-request-content">
              <div className="portal-request-top">
                <span className="portal-number">{item.number}</span>
                {item.unread && <span className="portal-new">به‌روزرسانی جدید</span>}
              </div>
              <strong>{item.subject}</strong>
              <small className="portal-muted">آخرین تغییر: {portalDate(item.updated_at)}</small>
            </div>
            <div className="portal-request-tail">
              <StatusPill status={item.status} />
              <span>
                مشاهده و گفت‌وگو <ArrowUpLeft size={16} aria-hidden />
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function PortalRequests() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const list = usePortalRequests({ page, status, q: query });
  const data = list.data;
  return (
    <section className="portal-stack">
      <div className="portal-title-row portal-hero">
        <div>
          <span className="portal-eyebrow">همراه شما تا حل درخواست</span>
          <h1>درخواست‌های من</h1>
          <p>درخواست تازه ثبت کنید، پاسخ پشتیبانی را بخوانید و وضعیت رسیدگی را پیگیری کنید.</p>
        </div>
        <Link to="/portal/new" className="portal-button is-primary">
          <FilePlus2 size={18} aria-hidden /> ثبت درخواست جدید
        </Link>
      </div>
      <div className="portal-customer-summary" aria-live="polite">
        <span>
          <Inbox size={18} aria-hidden />
          {data
            ? `${toFa(data.count)} درخواست${query || status ? " با فیلتر فعلی" : " ثبت‌شده"}`
            : "در حال دریافت درخواست‌ها…"}
        </span>
        {Boolean(data?.unread) && (
          <span className="portal-unread-count">{toFa(data!.unread)} به‌روزرسانی خوانده‌نشده</span>
        )}
        <button type="button" className="portal-button" disabled={list.isFetching} onClick={() => void list.refetch()}>
          <RefreshCw size={16} aria-hidden /> تازه‌سازی
        </button>
      </div>
      <form
        className="portal-filters"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setQuery(search.trim());
        }}
      >
        <label>
          <span>جست‌وجو</span>
          <input value={search} placeholder="موضوع یا شمارهٔ درخواست" onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label>
          <span>وضعیت</span>
          <select
            value={status}
            onChange={(event) => {
              setPage(1);
              setStatus(event.target.value);
            }}
          >
            <option value="">همه</option>
            {(data?.statuses ?? []).map((item) => (
              <option key={item.code} value={item.code}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="portal-button">
          جست‌وجو
        </button>
        {(query || status) && (
          <button
            type="button"
            className="portal-button"
            onClick={() => {
              setSearch("");
              setQuery("");
              setStatus("");
              setPage(1);
            }}
          >
            پاک کردن فیلترها
          </button>
        )}
      </form>
      {list.isLoading ? (
        <p className="portal-muted" aria-busy="true">
          در حال بارگذاری…
        </p>
      ) : list.error ? (
        <div className="portal-errors" role="alert">
          {portalError(list.error, "فهرست درخواست‌ها دریافت نشد.")}{" "}
          <button type="button" className="portal-button" onClick={() => void list.refetch()}>
            تلاش دوباره
          </button>
        </div>
      ) : !data?.results.length ? (
        <div className="portal-empty">
          <p>{query || status ? "درخواستی با این شرایط پیدا نشد." : "هنوز درخواستی ثبت نکرده‌اید."}</p>
          {!query && !status && (
            <Link to="/portal/new" className="portal-button is-primary">
              ثبت نخستین درخواست
            </Link>
          )}
        </div>
      ) : (
        <>
          <PortalRequestCards requests={data.results} />
          {data.pages > 1 && (
            <nav className="portal-pager" aria-label="صفحه‌بندی">
              <button type="button" className="portal-button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                قبلی
              </button>
              <span>
                صفحهٔ {toFa(page)} از {toFa(data.pages)}
              </span>
              <button
                type="button"
                className="portal-button"
                disabled={page >= data.pages}
                onClick={() => setPage(page + 1)}
              >
                بعدی
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
