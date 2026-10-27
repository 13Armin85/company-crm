import { useState } from "react";
import {
  AtSign,
  Bell,
  BellRing,
  CheckCheck,
  CheckCircle2,
  ChevronLeft,
  MessageSquare,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router";
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications } from "../api";
import { Button, EmptyState, NotificationDetails, PageHeader, SearchBox, Skeleton, TabBar } from "../components";
import { matchesRecordSearch } from "../identifiers";
import type { NotificationItem } from "../types";
import { persianDate, toFa } from "../utils";

const icons = {
  mention: AtSign,
  assignment: CheckCircle2,
  update: Sparkles,
  comment: MessageSquare,
  security: ShieldCheck,
};
const typeLabels: Record<NotificationItem["type"], string> = {
  mention: "اشاره به شما",
  assignment: "واگذاری کار",
  update: "به‌روزرسانی",
  comment: "نظر جدید",
  security: "حساب کاربری",
};

export default function InboxPage() {
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<NotificationItem>();
  const { data = [], isLoading, isError, refetch } = useNotifications();
  const markAll = useMarkAllNotificationsRead();
  const markRead = useMarkNotificationRead();
  const unreadCount = data.filter((item) => !item.read).length;
  const mentionCount = data.filter((item) => item.type === "mention").length;
  const tabItems =
    tab === "unread"
      ? data.filter((item) => !item.read)
      : tab === "mentions"
        ? data.filter((item) => item.type === "mention")
        : data;
  const shown = tabItems.filter((item) =>
    matchesRecordSearch(query, [
      item.id,
      item.entityId,
      item.title,
      item.description,
      item.entityName,
      item.projectName,
    ])
  );

  return (
    <div className="inbox-page">
      <PageHeader
        eyebrow="مرکز اعلان‌ها"
        title="صندوق ورودی"
        description="خبرهای مهم کارها و پروژه‌ها را یک‌جا دنبال کنید."
        actions={
          <>
            <Button
              variant="secondary"
              icon={CheckCheck}
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending || isLoading || unreadCount === 0}
            >
              {markAll.isPending ? "در حال خواندن همه…" : "خواندن همه"}
            </Button>
            <Link className="icon-button" to="/settings" aria-label="تنظیمات اعلان‌ها" title="تنظیمات اعلان‌ها">
              <Settings2 size={19} />
            </Link>
          </>
        }
      />

      <section className="inbox-overview" aria-label="خلاصه صندوق ورودی">
        <div className="inbox-overview-lead">
          <span className="inbox-overview-icon" aria-hidden="true">
            <BellRing size={25} />
          </span>
          <div>
            <span className="inbox-overview-eyebrow">در یک نگاه</span>
            <h2>{unreadCount ? `${toFa(unreadCount)} اعلان خوانده‌نشده` : "همه اعلان‌ها خوانده شده‌اند"}</h2>
            <p>
              {unreadCount ? "تازه‌ترین رویدادهای مهم منتظر بررسی شما هستند." : "وقتی خبر تازه‌ای برسد، همین‌جا می‌بینید."}
            </p>
          </div>
        </div>
        <div className="inbox-overview-stats">
          <div>
            <span>همه اعلان‌ها</span>
            <strong>{toFa(data.length)}</strong>
          </div>
          <div>
            <span>اشاره‌ها</span>
            <strong>{toFa(mentionCount)}</strong>
          </div>
        </div>
      </section>

      <section className="inbox-card" aria-label="فهرست اعلان‌ها">
        <div className="inbox-toolbar">
          <div>
            <h2>اعلان‌های شما</h2>
            <p>رویدادها را مرور کنید و برای دیدن جزئیات، روی هر اعلان بزنید.</p>
          </div>
          <SearchBox value={query} onChange={setQuery} placeholder="جست‌وجو در اعلان‌ها…" />
        </div>
        <TabBar
          items={[
            { id: "all", label: "همه", count: data.length },
            { id: "unread", label: "خوانده‌نشده", count: unreadCount },
            { id: "mentions", label: "اشاره‌ها", count: mentionCount },
          ]}
          active={tab}
          onChange={setTab}
        />
        {!isLoading && !isError && (
          <div className="inbox-results-label">
            <span>{toFa(shown.length)} اعلان</span>
            <span>جدیدترین در ابتدا</span>
          </div>
        )}
        {isError ? (
          <div role="alert" className="inline-error">
            اعلان‌ها دریافت نشدند.
            <Button variant="secondary" onClick={() => void refetch()}>
              تلاش دوباره
            </Button>
          </div>
        ) : isLoading ? (
          <Skeleton rows={5} />
        ) : shown.length ? (
          <div className="inbox-list">
            {shown.map((item) => {
              const Icon = icons[item.type];
              return (
                <button
                  type="button"
                  key={item.id}
                  className={`inbox-item inbox-item--${item.type}${item.read ? "" : " unread"}`}
                  onClick={() => {
                    setSelected(item);
                    if (!item.read) markRead.mutate(item.id);
                  }}
                >
                  <span className="inbox-icon" aria-hidden="true">
                    <Icon size={20} />
                  </span>
                  <span className="inbox-item-body">
                    <span className="inbox-item-kicker">{typeLabels[item.type]}</span>
                    <span className="inbox-item-heading">
                      <h3>{item.title}</h3>
                      {!item.read && <span className="inbox-new">جدید</span>}
                    </span>
                    <span className="inbox-item-preview">{item.preview ?? item.description}</span>
                    {(item.entityName || item.projectName || item.actor) && (
                      <span className="inbox-item-context">
                        {item.entityName && <span>کار: {item.entityName}</span>}
                        {item.projectName && <span>پروژه: {item.projectName}</span>}
                        {item.actor && <span>{item.actor}</span>}
                      </span>
                    )}
                  </span>
                  <span className="inbox-item-aside">
                    <time dateTime={item.time || undefined}>{persianDate(item.time, { year: "numeric" })}</time>
                    <ChevronLeft size={18} aria-hidden="true" />
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={Bell}
            title={query ? "اعلانی پیدا نشد" : "اینجا خلوت است"}
            description={
              query ? "عبارت دیگری را جست‌وجو کنید یا فیلترها را تغییر دهید." : "اعلان تازه‌ای در این بخش وجود ندارد."
            }
          />
        )}
      </section>
      {selected && <NotificationDetails notification={selected} onClose={() => setSelected(undefined)} />}
    </div>
  );
}
