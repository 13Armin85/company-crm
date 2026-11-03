/** Notification drawer and the single-notification detail view. */
import { ErrorNotice, IdentifierBadge } from "@plane/ui";
import { Fragment, useState } from "react";
import { Link } from "react-router";
import { Bell, CheckCircle2, MessageSquare, Sparkles, ShieldCheck, X } from "lucide-react";
import {
  useCurrentUser,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useNotificationDetails,
} from "../api";
import { AccessModal } from "../access/components";
import { useUIStore } from "../store";
import type { NotificationItem } from "../types";
import { persianDate, toFa } from "../utils";
import { IconButton, Button, Skeleton, EmptyState } from "./primitives";

export function NotificationDetails({
  notification: selected,
  onClose,
}: {
  notification: NotificationItem;
  onClose: () => void;
}) {
  const notification = useNotificationDetails(selected.id);
  const { data: currentUser } = useCurrentUser();
  const details = notification.data ?? selected;
  return (
    <AccessModal title="جزئیات اعلان" onClose={() => onClose()}>
      <section className="notification-details">
        <h3>{details.title}</h3>
        <IdentifierBadge value={details.id} label="شناسه اعلان" />
        <dl>
          {details.eventLabel && (
            <>
              <dt>نوع رویداد</dt>
              <dd>{details.eventLabel}</dd>
            </>
          )}
          {details.entityName && (
            <>
              <dt>کار مرتبط</dt>
              <dd>{details.entityName}</dd>
            </>
          )}
          {details.projectName && (
            <>
              <dt>پروژه</dt>
              <dd>{details.projectName}</dd>
            </>
          )}
          {details.actor && (
            <>
              <dt>انجام‌دهنده</dt>
              <dd>{details.actor}</dd>
            </>
          )}
          <dt>زمان</dt>
          <dd>
            {persianDate(details.time, {
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              timeZone: currentUser?.timeZone,
            })}
          </dd>
        </dl>
        {details.changes && (
          <dl aria-label="جزئیات تغییر">
            {details.changes.map((change) => (
              <Fragment key={change.label}>
                <dt>{change.label}</dt>
                <dd>{change.value}</dd>
              </Fragment>
            ))}
          </dl>
        )}
        {notification.isLoading && <p role="status">در حال دریافت متن کامل…</p>}
        {notification.isError && (
          <div className="error-state">
            <ErrorNotice message="جزئیات اعلان دریافت نشد." />
            <Button variant="secondary" onClick={() => void notification.refetch()}>
              تلاش دوباره
            </Button>
          </div>
        )}
        <p className="notification-message">{details.description || "متن تکمیلی برای این اعلان ثبت نشده است."}</p>
      </section>
      <footer>
        {details.actionHref ? (
          <Link className="button button-secondary" to={details.actionHref} onClick={() => onClose()}>
            {details.actionLabel}
          </Link>
        ) : (
          details.projectId && (
            <Link
              className="button button-secondary"
              to={`/projects/${details.projectId}?tab=issues`}
              onClick={() => onClose()}
            >
              مشاهده کارهای پروژه
            </Link>
          )
        )}
        <Button onClick={() => onClose()}>بستن</Button>
      </footer>
    </AccessModal>
  );
}

const notificationIcons = {
  mention: MessageSquare,
  assignment: CheckCircle2,
  update: Sparkles,
  comment: MessageSquare,
  security: ShieldCheck,
};
export function NotificationDrawer() {
  const open = useUIStore((state) => state.notificationOpen);
  const setOpen = useUIStore((state) => state.setNotificationOpen);
  // The full list is only downloaded while the drawer is open; the badge polls a count.
  const { data = [], isLoading, isError, refetch } = useNotifications(undefined, false, open);
  const [tab, setTab] = useState<"all" | "unread">("all");
  const shown = tab === "unread" ? data.filter((item) => !item.read) : data;
  const [selected, setSelected] = useState<NotificationItem>();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  return (
    <>
      <button className={`overlay ${open ? "is-open" : ""}`} aria-label="بستن اعلان‌ها" onClick={() => setOpen(false)} />
      <aside
        className={`notification-drawer ${open ? "is-open" : ""}`}
        aria-label="اعلان‌های شما"
        aria-hidden={!open}
        inert={!open}
      >
        <header>
          <div>
            <h2>اعلان‌ها</h2>
            <span>{toFa(data.filter((item) => !item.read).length)} خوانده‌نشده</span>
          </div>
          <IconButton label="بستن" onClick={() => setOpen(false)}>
            <X size={19} />
          </IconButton>
        </header>
        <div className="drawer-filter">
          <button
            type="button"
            className={tab === "all" ? "active" : ""}
            aria-pressed={tab === "all"}
            onClick={() => setTab("all")}
          >
            همه
          </button>
          <button
            type="button"
            className={tab === "unread" ? "active" : ""}
            aria-pressed={tab === "unread"}
            onClick={() => setTab("unread")}
          >
            خوانده‌نشده
          </button>
          <button
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending || isLoading || data.every((item) => item.read)}
          >
            خواندن همه
          </button>
        </div>
        <div className="notification-list">
          {isError && (
            <div className="error-state">
              <ErrorNotice message="اعلان‌ها دریافت نشدند." />
              <Button variant="secondary" onClick={() => void refetch()}>
                تلاش دوباره
              </Button>
            </div>
          )}
          {isLoading ? (
            <Skeleton rows={5} />
          ) : shown.length ? (
            shown.map((item) => {
              const Icon = notificationIcons[item.type];
              return (
                <button
                  type="button"
                  key={item.id}
                  className={item.read ? "" : "unread"}
                  onClick={() => {
                    setSelected(item);
                    setOpen(false);
                    if (!item.read) markRead.mutate(item.id);
                  }}
                >
                  <span className="notification-icon">
                    <Icon size={17} />
                  </span>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.preview ?? item.description}</p>
                    {(item.entityName || item.projectName) && (
                      <small className="notification-context">
                        {[
                          item.entityName ? `کار: ${item.entityName}` : undefined,
                          item.projectName ? `پروژه: ${item.projectName}` : undefined,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    )}
                    <time>{persianDate(item.time, { year: "numeric" })}</time>
                  </div>
                  {!item.read && <i />}
                </button>
              );
            })
          ) : !isError ? (
            <EmptyState
              icon={Bell}
              title={tab === "unread" ? "اعلان خوانده‌نشده‌ای ندارید" : "اعلانی ندارید"}
              description="اعلان‌های تازه اینجا دیده می‌شوند."
            />
          ) : null}
        </div>
        <Link to="/inbox" onClick={() => setOpen(false)} className="drawer-all">
          مشاهده همه اعلان‌ها
        </Link>
      </aside>
      {selected && <NotificationDetails notification={selected} onClose={() => setSelected(undefined)} />}
    </>
  );
}
