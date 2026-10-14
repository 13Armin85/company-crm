import { useState } from "react";
import { AtSign, Bell, CheckCheck, CheckCircle2, MessageSquare, Settings2, ShieldCheck, Sparkles } from "lucide-react";
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications } from "../api";
import type { NotificationItem } from "../types";
import { Button, EmptyState, NotificationDetails, PageHeader, SearchBox, Skeleton, TabBar } from "../components";
import { Link } from "react-router";
import { persianDate } from "../utils";
import { matchesRecordSearch } from "../identifiers";

const icons = {
  mention: AtSign,
  assignment: CheckCircle2,
  update: Sparkles,
  comment: MessageSquare,
  security: ShieldCheck,
};
export default function InboxPage() {
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<NotificationItem>();
  const { data = [], isLoading, isError, refetch } = useNotifications();
  const markAll = useMarkAllNotificationsRead();
  const markRead = useMarkNotificationRead();
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
    <div>
      <PageHeader
        eyebrow="مرکز اعلان‌ها"
        title="صندوق ورودی"
        description="به‌روزرسانی‌ها، اشاره‌ها و رویدادهای مهم شما"
        actions={
          <>
            <Button
              variant="secondary"
              icon={CheckCheck}
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending || isLoading || data.every((item) => item.read)}
            >
              {markAll.isPending ? "در حال خواندن همه…" : "خواندن همه"}
            </Button>
            <Link className="icon-button" to="/settings">
              <Settings2 size={19} />
            </Link>
          </>
        }
      />
      <div className="inbox-card">
        <SearchBox value={query} onChange={setQuery} placeholder="جستجوی شناسه یا متن اعلان…" />
        <TabBar
          items={[
            { id: "all", label: "همه", count: data.length },
            { id: "unread", label: "خوانده‌نشده", count: data.filter((item) => !item.read).length },
            { id: "mentions", label: "اشاره‌ها" },
          ]}
          active={tab}
          onChange={setTab}
        />
        {isError ? (
          <div role="alert" className="inline-error">
            دریافت اعلان‌ها انجام نشد.
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
                  className={item.read ? "" : "unread"}
                  onClick={() => {
                    setSelected(item);
                    if (!item.read) markRead.mutate(item.id);
                  }}
                >
                  <span className="inbox-icon">
                    <Icon size={18} />
                  </span>
                  <div>
                    <h3>{item.title}</h3>
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
            })}
          </div>
        ) : (
          <EmptyState icon={Bell} title="اینجا خلوت است" description="اعلان تازه‌ای در این بخش وجود ندارد." />
        )}
      </div>
      {selected && <NotificationDetails notification={selected} onClose={() => setSelected(undefined)} />}
    </div>
  );
}
