/** "My requests": status filter (company labels only), search and paging. */
import { useState } from "react";
import { Link } from "react-router";
import { toFa } from "../../crm/utils";
import { portalError } from "../api/client";
import { usePortalRequests } from "../api/portal";
import { StatusPill } from "../components";
import { portalDate } from "../model";

export default function PortalRequests() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const list = usePortalRequests({ page, status, q: query });
  const data = list.data;
  return (
    <section className="portal-stack">
      <div className="portal-title-row">
        <h1>درخواست‌های من</h1>
        <Link to="/portal/new" className="portal-button is-primary">
          ثبت درخواست جدید
        </Link>
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
          <ul className="portal-request-list">
            {data.results.map((item) => (
              <li key={item.id}>
                <Link to={`/portal/requests/${item.id}`} className="portal-request">
                  <span className="portal-number">{item.number}</span>
                  <strong>{item.subject}</strong>
                  {item.unread && <span className="portal-new">به‌روزرسانی جدید</span>}
                  <StatusPill status={item.status} />
                  <small className="portal-muted">آخرین تغییر: {portalDate(item.updated_at)}</small>
                </Link>
              </li>
            ))}
          </ul>
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
