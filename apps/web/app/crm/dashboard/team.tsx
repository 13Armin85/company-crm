import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, GripVertical, Trash2, X } from "lucide-react";
import { Link } from "react-router";
import { api, errorMessage, useWorkspaceAccess } from "../api";
import { Button, Skeleton } from "../components";
import { useUIStore } from "../store";
import { persianDate, toFa } from "../utils";
import { dashboardUrl, useTeamData } from "./api";
import type { TeamCard } from "./types";

interface TeamRule {
  metric: string;
  op: string;
  value: string | number;
  color: string;
  label: string;
}
interface TeamSettings {
  rules: TeamRule[];
  alert_enabled: boolean;
  alert_minutes: number;
}
const dateText = (value: string | null) =>
  value ? persianDate(value, { year: "numeric", hour: "2-digit" }) : "ثبت نشده";
const elapsed = (value: string) => {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  return minutes < 60 ? `${minutes} دقیقه` : `${Math.floor(minutes / 60)} ساعت`;
};

export function TeamWidget() {
  const slug = useUIStore((state) => state.workspaceSlug) || "";
  const toast = useUIStore((state) => state.toast);
  const { data: access } = useWorkspaceAccess();
  const client = useQueryClient();
  const [descendants, setDescendants] = useState(false);
  const [search, setSearch] = useState("");
  const [unit, setUnit] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("name");
  const [view, setView] = useState<"cards" | "tree">("cards");
  const [compact, setCompact] = useState(false);
  const [selected, setSelected] = useState("");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rules, setRules] = useState<TeamRule[]>([]);
  const [rulePreview, setRulePreview] = useState<Record<string, { color: string; label: string }>>({});
  const data = useTeamData({ descendants, search, unit, role, status, sort });
  const settings = useQuery({
    queryKey: ["dashboard-team-settings", slug],
    enabled: Boolean(slug),
    queryFn: async (): Promise<TeamSettings> => (await api.get(`${dashboardUrl(slug)}team/settings/`)).data,
  });
  const details = useQuery({
    queryKey: ["dashboard-team-detail", slug, selected],
    enabled: Boolean(slug && selected),
    queryFn: async (): Promise<{
      card: TeamCard;
      week_activity: Record<string, number>;
      hours_logged: number | null;
    }> => (await api.get(`${dashboardUrl(slug)}team/members/${selected}/`)).data,
  });
  useEffect(() => {
    if (settings.data) setRules(settings.data.rules);
  }, [settings.data]);
  useEffect(() => {
    if (!rulesOpen || !slug) return;
    const timer = window.setTimeout(() => {
      api
        .post(`${dashboardUrl(slug)}team/settings/`, { rules })
        .then((response) => {
          setRulePreview(
            Object.fromEntries(
              response.data.cards.map((item: { id: string; color: string; label: string }) => [
                item.id,
                { color: item.color, label: item.label },
              ])
            )
          );
        })
        .catch(() => setRulePreview({}));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [rulesOpen, rules, slug]);
  const cards = data.data?.cards || [];
  const units = [...new Map(cards.map((card) => [card.unit_id, card.unit])).entries()];
  const roles = [
    ...new Map(cards.flatMap((card) => card.roles.map((item) => [item.id, item.name] as const))).entries(),
  ];
  async function assign(card: TeamCard, taskId: string, confirmed = false) {
    if (!access?.can("Dashboard.Team.Assign")) return;
    try {
      await api.post(`${dashboardUrl(slug)}team/members/${card.id}/assign/`, {
        task_id: taskId,
        confirm_absent: confirmed,
      });
      toast("کار ارجاع شد", "success");
      await client.invalidateQueries({ queryKey: ["dashboard-team", slug] });
    } catch (error) {
      const reply = error as {
        response?: { status?: number; data?: { warning?: string; substitute?: { name: string } } };
      };
      if (reply.response?.status === 409 && !confirmed) {
        if (
          confirm(
            `${reply.response.data?.warning || "فرد غایب است"}\nجانشین: ${reply.response.data?.substitute?.name || "تعریف نشده"}\nبا این حال ارجاع شود؟`
          )
        )
          await assign(card, taskId, true);
      } else toast(errorMessage(error, "ارجاع انجام نشد"), "error");
    }
  }
  async function remind(card: TeamCard) {
    try {
      await api.post(`${dashboardUrl(slug)}team/members/${card.id}/remind/`, {});
      toast("یادآور ارسال شد", "success");
    } catch (error) {
      toast(errorMessage(error, "یادآور ارسال نشد"), "error");
    }
  }
  async function saveRules() {
    try {
      await api.put(`${dashboardUrl(slug)}team/settings/`, { rules });
      await client.invalidateQueries({ queryKey: ["dashboard-team", slug] });
      setRulePreview({});
      setRulesOpen(false);
      toast("قواعد ذخیره شد", "success");
    } catch (error) {
      toast(errorMessage(error, "ذخیره قواعد انجام نشد"), "error");
    }
  }
  async function toggleAlerts() {
    try {
      await api.put(`${dashboardUrl(slug)}team/settings/`, { alert_enabled: !settings.data?.alert_enabled });
      await settings.refetch();
      toast("تنظیم هشدار ذخیره شد", "success");
    } catch (error) {
      toast(errorMessage(error, "تغییر هشدار انجام نشد"), "error");
    }
  }
  if (data.isLoading)
    return (
      <div className="dashboard-widget-skeleton">
        <span />
        <span />
        <span />
      </div>
    );
  if (data.isError)
    return (
      <div className="dashboard-widget-error">
        {errorMessage(data.error, "دریافت تیم انجام نشد")} <Button onClick={() => data.refetch()}>تلاش دوباره</Button>
      </div>
    );
  return (
    <div className="dashboard-team">
      <div className="dashboard-team-toolbar">
        <label>
          <input type="checkbox" checked={descendants} onChange={(event) => setDescendants(event.target.checked)} /> کل
          زیرمجموعه
        </label>
        <input placeholder="جستجوی نام" value={search} onChange={(event) => setSearch(event.target.value)} />
        <select aria-label="فیلتر واحد" value={unit} onChange={(event) => setUnit(event.target.value)}>
          <option value="">همه واحدها</option>
          {units.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select aria-label="فیلتر نقش" value={role} onChange={(event) => setRole(event.target.value)}>
          <option value="">همه نقش‌ها</option>
          {roles.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select aria-label="مرتب‌سازی" value={sort} onChange={(event) => setSort(event.target.value)}>
          <option value="name">نام</option>
          <option value="workload">بار کاری</option>
        </select>
        <button onClick={() => setView(view === "cards" ? "tree" : "cards")}>
          {view === "cards" ? "نمای درختی" : "نمای کارت"}
        </button>
        <button onClick={() => setCompact(!compact)}>{compact ? "کارت کامل" : "کارت فشرده"}</button>
        {access?.can("Dashboard.Team.Rules") && <button onClick={() => setRulesOpen(true)}>قواعد رنگ</button>}
        <label>
          هشدار پس از{" "}
          <input
            aria-label="دقیقه هشدار"
            type="number"
            min={5}
            max={480}
            defaultValue={settings.data?.alert_minutes || 30}
            key={settings.data?.alert_minutes}
            onBlur={async (event) => {
              try {
                await api.put(`${dashboardUrl(slug)}team/settings/`, { alert_minutes: Number(event.target.value) });
                await settings.refetch();
                toast("فاصله هشدار ذخیره شد", "success");
              } catch (error) {
                toast(errorMessage(error, "تنظیم هشدار انجام نشد"), "error");
              }
            }}
          />{" "}
          دقیقه بدون کار، ساعت کاری ۸ تا ۱۶
        </label>
        <button onClick={toggleAlerts}>{settings.data?.alert_enabled ? "خاموش کردن هشدار" : "روشن کردن هشدار"}</button>
      </div>
      <div className="dashboard-team-summary">
        {Object.entries(data.data?.summary || {}).map(([color, count]) => (
          <button
            key={color}
            className={`team-${color} ${status === color ? "active" : ""}`}
            onClick={() => setStatus(status === color ? "" : color)}
          >
            {count}{" "}
            {({ green: "سبز", red: "قرمز", gray: "غایب", yellow: "زرد", orange: "نارنجی" } as Record<string, string>)[
              color
            ] || color}
          </button>
        ))}
      </div>
      <div className="dashboard-team-task-tray">
        {[...new Map(cards.flatMap((card) => card.active_tasks).map((task) => [task.id, task])).values()].map(
          (task) => (
            <span
              key={task.id}
              draggable
              onDragStart={(event) => event.dataTransfer.setData("task-id", task.id)}
              title="برای ارجاع روی کارت فرد بکشید"
            >
              {task.number} · {task.title}
            </span>
          )
        )}
      </div>
      {cards.length ? (
        <div className={`dashboard-team-cards ${view === "tree" ? "tree" : ""}`}>
          {cards.map((card) => (
            <article
              key={card.id}
              role="button"
              tabIndex={0}
              style={{ "--unit-depth": card.unit_depth } as CSSProperties}
              className={`dashboard-team-card team-${rulePreview[card.id]?.color || card.color} ${compact ? "compact" : ""}`}
              onClick={() => setSelected(card.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") setSelected(card.id);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                const taskId = event.dataTransfer.getData("task-id");
                if (taskId) assign(card, taskId);
              }}
            >
              <div className="team-card-head">
                <span className="team-avatar">
                  {card.avatar ? <img src={card.avatar} alt="" /> : card.name.slice(0, 1)}
                </span>
                <div>
                  <strong>{card.name}</strong>
                  <small>
                    {card.position} · {view === "tree" ? card.unit_path : card.unit}
                  </small>
                </div>
                <b>{rulePreview[card.id]?.label || card.label}</b>
              </div>
              {!compact && (
                <>
                  <div className="team-active-tasks">
                    {card.active_tasks.length
                      ? card.active_tasks.map((task) => (
                          <Link
                            key={task.id}
                            to={`/entities/ticket/${task.id}`}
                            onClick={(event) => event.stopPropagation()}
                          >
                            {task.number || ""} {task.title} · {elapsed(task.started_at)}
                          </Link>
                        ))
                      : "کار در حال انجام ندارد"}
                  </div>
                  <div className="team-counts">
                    <span>{card.open_count} باز</span>
                    <span>{card.overdue_count} تأخیری</span>
                    <span>{card.in_progress_count} در حال انجام</span>
                  </div>
                  <div className="team-workload">
                    <i style={{ width: `${Math.min(100, card.workload_percent)}%` }} />
                  </div>
                  <small>
                    بار کاری {card.workload_percent}٪ · آخرین فعالیت {dateText(card.last_activity)}
                  </small>
                  {card.presence === "absent" && (
                    <small>
                      دلیل: {card.reason || "ثبت نشده"} · بازگشت: {dateText(card.return_at)} · جانشین:{" "}
                      {card.substitute?.name || "ندارد"}
                    </small>
                  )}
                </>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="dashboard-empty-small">{data.data?.empty || "کارتی با این فیلتر پیدا نشد."}</div>
      )}
      {selected && (
        <div className="dashboard-overlay" onMouseDown={() => setSelected("")}>
          <aside className="dashboard-drawer" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <h2>{details.data?.card.name || "جزئیات عضو"}</h2>
              <button onClick={() => setSelected("")} aria-label="بستن">
                <X />
              </button>
            </header>
            {details.isLoading ? (
              <Skeleton rows={4} />
            ) : (
              details.data && (
                <>
                  <p>
                    کارهای باز: {details.data.card.open_count} · دارای تأخیر: {details.data.card.overdue_count}
                  </p>
                  <p>کارهای امروز و در حال انجام:</p>
                  {details.data.card.active_tasks.map((task) => (
                    <Link key={task.id} to={`/entities/ticket/${task.id}`}>
                      {task.number} · {task.title}
                    </Link>
                  ))}
                  {access?.can("Dashboard.Team.Rules") && (
                    <label>
                      ظرفیت کار{" "}
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        defaultValue={details.data.card.capacity}
                        key={details.data.card.id}
                        onBlur={async (event) => {
                          try {
                            await api.patch(`${dashboardUrl(slug)}team/members/${details.data!.card.id}/`, {
                              capacity: Number(event.target.value),
                            });
                            await client.invalidateQueries({ queryKey: ["dashboard-team", slug] });
                            toast("ظرفیت ذخیره شد", "success");
                          } catch (error) {
                            toast(errorMessage(error, "ذخیره ظرفیت انجام نشد"), "error");
                          }
                        }}
                      />
                    </label>
                  )}
                  <p>ساعت‌های ثبت‌شده: {details.data.hours_logged ?? "داده‌ای موجود نیست"}</p>
                  <p>آخرین فعالیت: {dateText(details.data.card.last_activity)}</p>
                  <div className="dashboard-week">
                    {Object.entries(details.data.week_activity).map(([day, count]) => (
                      <span key={day}>
                        {persianDate(day, { year: "numeric" })}: {toFa(count)}
                      </span>
                    ))}
                  </div>
                  <div className="dashboard-detail-actions">
                    <Link to="/my-work">ارجاع کار جدید</Link>
                    <Link to="/calendar">تقویم و مرخصی‌ها</Link>
                    <Link to="/organization">جانشین</Link>
                    {access?.can("Dashboard.Team.Remind") && (
                      <Button variant="secondary" icon={Bell} onClick={() => remind(details.data!.card)}>
                        یادآوری
                      </Button>
                    )}
                  </div>
                </>
              )
            )}
          </aside>
        </div>
      )}
      {rulesOpen && (
        <div className="dashboard-overlay" onMouseDown={() => setRulesOpen(false)}>
          <aside className="dashboard-drawer" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <h2>قواعد رنگ کارت</h2>
              <button onClick={() => setRulesOpen(false)} aria-label="بستن">
                <X />
              </button>
            </header>
            <p>اولین قاعدهٔ برقرار رنگ کارت را تعیین می‌کند. ترتیب را با کشیدن تغییر دهید.</p>
            {rules.map((rule, index) => (
              <div
                className="dashboard-rule"
                key={index}
                draggable
                onDragStart={(event) => event.dataTransfer.setData("rule-index", String(index))}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  const from = Number(event.dataTransfer.getData("rule-index"));
                  if (from === index || from < 0) return;
                  const copy = [...rules];
                  const [item] = copy.splice(from, 1);
                  copy.splice(index, 0, item);
                  setRules(copy);
                }}
              >
                <GripVertical size={16} />
                <select
                  aria-label="منبع قاعده"
                  value={rule.metric}
                  onChange={(event) =>
                    setRules((current) =>
                      current.map((item, n) => (n === index ? { ...item, metric: event.target.value } : item))
                    )
                  }
                >
                  <option value="presence">حضور</option>
                  <option value="in_progress">کار در حال انجام</option>
                  <option value="overdue">کار تأخیری</option>
                  <option value="inactive_hours">ساعت بدون فعالیت</option>
                  <option value="workload">بار کاری</option>
                </select>
                <select
                  aria-label="عملگر قاعده"
                  value={rule.op}
                  onChange={(event) =>
                    setRules((current) =>
                      current.map((item, n) => (n === index ? { ...item, op: event.target.value } : item))
                    )
                  }
                >
                  <option value="eq">برابر</option>
                  <option value="gt">بیشتر از</option>
                  <option value="gte">حداقل</option>
                  <option value="lt">کمتر از</option>
                </select>
                <input
                  aria-label="مقدار قاعده"
                  value={String(rule.value)}
                  onChange={(event) =>
                    setRules((current) =>
                      current.map((item, n) =>
                        n === index
                          ? {
                              ...item,
                              value: item.metric === "presence" ? event.target.value : Number(event.target.value),
                            }
                          : item
                      )
                    )
                  }
                />
                <select
                  aria-label="رنگ قاعده"
                  value={rule.color}
                  onChange={(event) =>
                    setRules((current) =>
                      current.map((item, n) => (n === index ? { ...item, color: event.target.value } : item))
                    )
                  }
                >
                  <option value="yellow">زرد</option>
                  <option value="green">سبز</option>
                  <option value="red">قرمز</option>
                  <option value="gray">خاکستری</option>
                  <option value="orange">نارنجی</option>
                  <option value="blue">آبی</option>
                </select>
                <input
                  aria-label="برچسب قاعده"
                  value={rule.label}
                  onChange={(event) =>
                    setRules((current) =>
                      current.map((item, n) => (n === index ? { ...item, label: event.target.value } : item))
                    )
                  }
                />
                <button
                  aria-label="حذف قاعده"
                  onClick={() => setRules((current) => current.filter((_, n) => n !== index))}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <Button
              variant="secondary"
              onClick={() =>
                setRules((current) => [
                  ...current,
                  { metric: "inactive_hours", op: "gt", value: 3, color: "yellow", label: "بدون فعالیت" },
                ])
              }
            >
              قاعده جدید
            </Button>
            <div className="dashboard-rule-actions">
              <Button
                variant="secondary"
                onClick={async () => {
                  try {
                    const response = await api.post(`${dashboardUrl(slug)}team/settings/`, { rules });
                    setRulePreview(
                      Object.fromEntries(
                        response.data.cards.map((item: { id: string; color: string; label: string }) => [
                          item.id,
                          { color: item.color, label: item.label },
                        ])
                      )
                    );
                    toast(`پیش‌نمایش با داده واقعی: ${response.data.cards.length} کارت`, "info");
                  } catch (error) {
                    toast(errorMessage(error, "پیش‌نمایش انجام نشد"), "error");
                  }
                }}
              >
                پیش‌نمایش زنده
              </Button>
              <Button onClick={saveRules}>ذخیره</Button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
