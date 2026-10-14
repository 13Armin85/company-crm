import { IdentifierBadge, SearchableSelect } from "@plane/ui";
import {
  Clock3,
  FolderOpen,
  GitBranch,
  Inbox,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { useClaimTicketRoleQueue, useTicketRoleQueue } from "./api";
import { Button, EmptyState, Skeleton } from "./components";
import { filterRoleQueue, isLongWaiting, queueWaitLabel } from "./role-queue-model";
import type { QueueSort } from "./role-queue-model";
import { useUIStore } from "./store";
import { persianDate, toFa } from "./utils";

export function RoleQueue({
  canClaim,
  canViewAll,
  canViewProject,
}: {
  canClaim: boolean;
  canViewAll: boolean;
  canViewProject: boolean;
}) {
  const slug = useUIStore((state) => state.workspaceSlug) ?? "";
  const { data: entries = [], isLoading, isFetching, isError, refetch } = useTicketRoleQueue();
  const claim = useClaimTicketRoleQueue(slug);
  const [search, setSearch] = useState("");
  const [roleId, setRoleId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [sort, setSort] = useState<QueueSort>("oldest");
  const queue = entries.filter((entry) => entry.status === "open");
  const visible = filterRoleQueue(queue, { search, roleId, projectId, sort });
  const oldest = filterRoleQueue(queue, { search: "", roleId: "", projectId: "", sort: "oldest" })[0];
  const roleOptions = Array.from(new Map(queue.map((entry) => [entry.requiredRoleId, entry.roleName])).entries())
    .map(([id, title]) => ({ id, title: title || "نقش بدون نام" }))
    // eslint-disable-next-line unicorn/no-array-sort -- map created a new array; support the ES2022 browser target.
    .sort((a, b) => a.title.localeCompare(b.title, "fa"));
  const projectOptions = Array.from(new Map(queue.map((entry) => [entry.projectId, entry.projectName])).entries())
    .map(([id, title]) => ({ id, title: title || "پروژه بدون نام" }))
    // eslint-disable-next-line unicorn/no-array-sort -- map created a new array; support the ES2022 browser target.
    .sort((a, b) => a.title.localeCompare(b.title, "fa"));
  const filtered = Boolean(search.trim() || roleId || projectId);
  const resetFilters = () => {
    setSearch("");
    setRoleId("");
    setProjectId("");
  };

  return (
    <section className="role-queue management-section" id="role-queue" aria-labelledby="role-queue-title">
      <header className="role-queue-heading">
        <div className="role-queue-intro">
          <span className="role-queue-symbol" aria-hidden="true">
            <Inbox size={23} />
          </span>
          <div>
            <h2 id="role-queue-title">صف کارهای نقش‌ها</h2>
            <p>
              {canViewAll
                ? "کارهای منتظر پذیرش در نقش‌های سازمان را بررسی و پیگیری کنید."
                : "کارهای مرتبط با نقش شما اینجا منتظر پذیرش هستند."}
            </p>
          </div>
        </div>
        <button
          className="button button-secondary role-queue-refresh"
          type="button"
          disabled={isFetching}
          aria-label="به‌روزرسانی صف کارها"
          onClick={() => void refetch()}
        >
          <RefreshCw size={16} className={isFetching ? "role-queue-spin" : undefined} aria-hidden="true" />
          به‌روزرسانی
        </button>
      </header>

      {isError && (
        <div className="role-queue-error" role="alert">
          <p>دریافت صف کارها انجام نشد. {entries.length ? "اطلاعات قبلی نمایش داده می‌شود." : "اتصال را بررسی کنید."}</p>
          <Button variant="secondary" disabled={isFetching} onClick={() => void refetch()}>
            تلاش دوباره
          </Button>
        </div>
      )}
      {isLoading ? (
        <Skeleton rows={4} />
      ) : (
        (!isError || entries.length > 0) && (
          <>
            <dl className="role-queue-summary">
              <div>
                <dt>
                  <Inbox size={16} aria-hidden="true" />
                  منتظر پذیرش
                </dt>
                <dd>
                  {toFa(queue.length)} <small>کار</small>
                </dd>
              </div>
              <div>
                <dt>
                  <ShieldCheck size={16} aria-hidden="true" />
                  نقش‌های مورد نیاز
                </dt>
                <dd>
                  {toFa(roleOptions.length)} <small>نقش</small>
                </dd>
              </div>
              <div>
                <dt>
                  <Clock3 size={16} aria-hidden="true" />
                  بیشترین زمان انتظار
                </dt>
                <dd className="role-queue-wait-stat">{oldest ? queueWaitLabel(oldest) : "—"}</dd>
              </div>
            </dl>

            <div className="role-queue-toolbar">
              <label className="role-queue-search">
                <span>جست‌وجو در صف</span>
                <div>
                  <Search size={17} aria-hidden="true" />
                  <input
                    type="search"
                    aria-label="جست‌وجو در صف کارها"
                    placeholder="عنوان کار، نقش یا پروژه…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
              </label>
              <div className="role-queue-field">
                <label htmlFor="queue-role-filter">نقش</label>
                <SearchableSelect
                  id="queue-role-filter"
                  label="فیلتر نقش صف"
                  value={roleId}
                  onChange={setRoleId}
                  options={[{ id: "", title: "همه نقش‌ها" }, ...roleOptions]}
                />
              </div>
              <div className="role-queue-field">
                <label htmlFor="queue-project-filter">پروژه</label>
                <SearchableSelect
                  id="queue-project-filter"
                  label="فیلتر پروژه صف"
                  value={projectId}
                  onChange={setProjectId}
                  options={[{ id: "", title: "همه پروژه‌ها" }, ...projectOptions]}
                />
              </div>
              <div className="role-queue-field">
                <label htmlFor="queue-sort">ترتیب نمایش</label>
                <select id="queue-sort" value={sort} onChange={(event) => setSort(event.target.value as QueueSort)}>
                  <option value="oldest">قدیمی‌ترین اول</option>
                  <option value="newest">جدیدترین اول</option>
                </select>
              </div>
            </div>
            <div className="role-queue-results">
              <p role="status" aria-live="polite">
                {toFa(visible.length)} کار{filtered && ` از ${toFa(queue.length)} کار`} در صف
              </p>
              {filtered && (
                <button type="button" onClick={resetFilters}>
                  نمایش همه کارها
                </button>
              )}
            </div>
            {!canClaim && queue.length > 0 && (
              <p className="role-queue-permission">
                <ShieldCheck size={15} aria-hidden="true" />
                برای پذیرش کار، دسترسی دریافت از صف لازم است.
              </p>
            )}

            {!queue.length ? (
              <EmptyState
                icon={Inbox}
                title="کاری در انتظار پذیرش نیست"
                description="وقتی کار تازه‌ای برای نقش شما وارد صف شود، اینجا نمایش داده می‌شود."
              />
            ) : !visible.length ? (
              <EmptyState
                icon={Search}
                title="کاری با این مشخصات پیدا نشد"
                description="عبارت جست‌وجو یا فیلتر نقش و پروژه را تغییر دهید."
                action={
                  <Button variant="secondary" onClick={resetFilters}>
                    نمایش همه کارها
                  </Button>
                }
              />
            ) : (
              <ul className="role-queue-grid" aria-label="کارهای منتظر پذیرش">
                {visible.map((entry) => {
                  const pending = claim.isPending && claim.variables === entry.id;
                  const hasDate = Boolean(entry.createdAt && Number.isFinite(Date.parse(entry.createdAt)));
                  return (
                    <li key={entry.id}>
                      <article
                        className="role-queue-card"
                        aria-labelledby={`queue-title-${entry.id}`}
                        aria-busy={pending}
                      >
                        <div className="role-queue-card-top">
                          <span className="role-queue-role">
                            <ShieldCheck size={14} aria-hidden="true" />
                            {entry.roleName || "نقش بدون نام"}
                          </span>
                          {isLongWaiting(entry) && <span className="role-queue-aged">بیش از یک روز در صف</span>}
                        </div>
                        <h3 id={`queue-title-${entry.id}`}>{entry.issueName || "کار بدون عنوان"}</h3>
                        <IdentifierBadge value={entry.issueIdentifier || entry.issueId} label="شناسه کار" />
                        <dl className="role-queue-metadata">
                          <div>
                            <dt>
                              <FolderOpen size={15} aria-hidden="true" />
                              پروژه
                            </dt>
                            <dd>
                              {canViewProject ? (
                                <Link to={`/projects/${entry.projectId}`}>{entry.projectName || "پروژه بدون نام"}</Link>
                              ) : (
                                entry.projectName || "پروژه بدون نام"
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt>
                              <GitBranch size={15} aria-hidden="true" />
                              مسیر ارجاع
                            </dt>
                            <dd>{entry.ruleName || "بدون نام"}</dd>
                          </div>
                          <div>
                            <dt>
                              <Clock3 size={15} aria-hidden="true" />
                              ورود به صف
                            </dt>
                            <dd>
                              {hasDate ? (
                                <time dateTime={entry.createdAt}>
                                  {persianDate(entry.createdAt, {
                                    year: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </time>
                              ) : (
                                "زمان ثبت نامشخص"
                              )}
                            </dd>
                          </div>
                        </dl>
                        <footer>
                          <span className="role-queue-wait">
                            <Clock3 size={14} aria-hidden="true" />
                            {queueWaitLabel(entry)}
                            {hasDate ? " در انتظار" : ""}
                          </span>
                          {canClaim && (
                            <button
                              className="button button-primary"
                              type="button"
                              disabled={claim.isPending}
                              aria-label={`پذیرش کار ${entry.issueName || "بدون عنوان"}`}
                              onClick={() => claim.mutate(entry.id)}
                            >
                              {pending ? (
                                <LoaderCircle size={16} className="role-queue-spin" aria-hidden="true" />
                              ) : (
                                <UserCheck size={16} aria-hidden="true" />
                              )}
                              {pending ? "در حال دریافت…" : "پذیرش کار"}
                            </button>
                          )}
                        </footer>
                        {claim.isError && claim.variables === entry.id && (
                          <p className="role-queue-claim-error" role="alert">
                            دریافت کار انجام نشد. دوباره تلاش کنید.
                          </p>
                        )}
                      </article>
                    </li>
                  );
                })}
              </ul>
            )}
            {canClaim && queue.length > 0 && (
              <p className="role-queue-help">با پذیرش کار، مسئولیت آن به شما واگذار می‌شود و از این صف خارج می‌شود.</p>
            )}
          </>
        )
      )}
    </section>
  );
}
