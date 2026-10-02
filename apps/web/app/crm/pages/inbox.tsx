import { useState } from "react";
import { AtSign, Bell, CheckCheck, CheckCircle2, MessageSquare, Settings2, Sparkles } from "lucide-react";
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications } from "../api";
import { Button, EmptyState, PageHeader, Skeleton, TabBar } from "../components";
import { Link } from "react-router";
import { persianDate } from "../utils";

const icons = { mention: AtSign, assignment: CheckCircle2, update: Sparkles, comment: MessageSquare };
export default function InboxPage() {
  const [tab, setTab] = useState("all");
  const { data = [], isLoading } = useNotifications();
  const markAll = useMarkAllNotificationsRead();
  const markRead = useMarkNotificationRead();
  const shown =
    tab === "unread"
      ? data.filter((item) => !item.read)
      : tab === "mentions"
        ? data.filter((item) => item.type === "mention")
        : data;
  return (
    <div>
      <PageHeader
        eyebrow="مرکز اعلان‌ها"
        title="صندوق ورودی"
        description="به‌روزرسانی‌ها، اشاره‌ها و رویدادهای مهم شما"
        actions={
          <>
            <Button variant="secondary" icon={CheckCheck} onClick={() => markAll.mutate()} disabled={markAll.isPending}>
              خواندن همه
            </Button>
            <Link className="icon-button" to="/settings">
              <Settings2 size={19} />
            </Link>
          </>
        }
      />
      <div className="inbox-card">
        <TabBar
          items={[
            { id: "all", label: "همه", count: data.length },
            { id: "unread", label: "خوانده‌نشده", count: data.filter((item) => !item.read).length },
            { id: "mentions", label: "اشاره‌ها" },
          ]}
          active={tab}
          onChange={setTab}
        />
        {isLoading ? (
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
                  onClick={() => !item.read && markRead.mutate(item.id)}
                >
                  <span className="inbox-icon">
                    <Icon size={18} />
                  </span>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.description}</p>
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
    </div>
  );
}
