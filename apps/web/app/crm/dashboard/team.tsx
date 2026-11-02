import { ErrorState } from "../error-state";
import "../../../styles/team.css";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  CalendarOff,
  Clock3,
  GripVertical,
  LayoutGrid,
  Network,
  Palette,
  Rows3,
  Search,
  SlidersHorizontal,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
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
const statusNames: Record<string, string> = {
  green: "در حال کار",
  red: "بدون کار",
  gray: "غایب",
  yellow: "زرد",
  orange: "نارنجی",
  blue: "آبی",
};
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
        // eslint-disable-next-line promise/always-return -- the preview only updates state.
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
  const trayTasks = [...new Map(cards.flatMap((card) => card.active_tasks).map((task) => [task.id, task])).values()];
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
      <ErrorState message={errorMessage(data.error, "دریافت تیم انجام نشد")} onRetry={() => void data.refetch()} />
    );
  return (
    <div className="dashboard-team team-v2">
      <div className="team-toolbar">
        <label className="team-search">
          <Search size={15} aria-hidden="true" />
          <span className="sr-only">جستجوی نام</span>
          <input placeholder="جستجوی عضو…" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
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
          <option value="name">مرتب‌سازی: نام</option>
          <option value="workload">مرتب‌سازی: بار کاری</option>
        </select>
        <div className="team-segment" role="group" aria-label="نوع نمایش">
          <button type="button" aria-pressed={view === "cards"} onClick={() => setView("cards")} title="نمای کارت">
            <LayoutGrid size={15} aria-hidden="true" />
            <span>کارت</span>
          </button>
          <button type="button" aria-pressed={view === "tree"} onClick={() => setView("tree")} title="نمای درختی">
            <Network size={15} aria-hidden="true" />
            <span>درختی</span>
          </button>
        </div>
        <button
          type="button"
          className="team-icon-toggle"
          aria-pressed={compact}
          onClick={() => setCompact(!compact)}
          title={compact ? "نمایش کارت کامل" : "نمایش کارت فشرده"}
          aria-label={compact ? "نمایش کارت کامل" : "نمایش کارت فشرده"}
        >
          <Rows3 size={16} aria-hidden="true" />
        </button>
        <details className="team-more">
          <summary>
            <SlidersHorizontal size={15} aria-hidden="true" />
            تنظیمات
          </summary>
          <div className="team-more-panel">
            <label className="team-check">
              <input type="checkbox" checked={descendants} onChange={(event) => setDescendants(event.target.checked)} />
              نمایش همه زیرمجموعه‌ها
            </label>
            <label className="team-check">
              <input type="checkbox" checked={Boolean(settings.data?.alert_enabled)} onChange={toggleAlerts} />
              هشدار برای اعضای بدون کار
            </label>
            <label className="team-alert-minutes">
              <span>هشدار پس از</span>
              <input
                aria-label="دقیقه هشدار"
                type="number"
                min={5}
                max={480}
                defaultValue={settings.data?.alert_minutes || 30}
                key={settings.data?.alert_minutes}
                onBlur={async (event) => {
                  try {
                    await api.put(`${dashboardUrl(slug)}team/settings/`, {
                      alert_minutes: Number(event.target.value),
                    });
                    await settings.refetch();
                    toast("فاصله هشدار ذخیره شد", "success");
                  } catch (error) {
                    toast(errorMessage(error, "تنظیم هشدار انجام نشد"), "error");
                  }
                }}
              />
              <span>دقیقه</span>
            </label>
            <small>هشدارها فقط در ساعت کاری ۸ تا ۱۶ ارسال می‌شوند.</small>
            {access?.can("Dashboard.Team.Rules") && (
              <Button variant="secondary" icon={Palette} onClick={() => setRulesOpen(true)}>
                قواعد رنگ وضعیت
              </Button>
            )}
          </div>
        </details>
      </div>
      {Object.keys(data.data?.summary || {}).length > 0 && (
        <div className="team-status-chips" role="group" aria-label="فیلتر وضعیت">
          {Object.entries(data.data?.summary || {}).map(([color, count]) => (
            <button
              type="button"
              key={color}
              className={`team-chip team-${color}`}
              aria-pressed={status === color}
              onClick={() => setStatus(status === color ? "" : color)}
            >
              <i aria-hidden="true" />
              {cards.find((card) => (rulePreview[card.id]?.color || card.color) === color)?.label ||
                statusNames[color] ||
                color}
              <b>{toFa(Number(count))}</b>
            </button>
          ))}
        </div>
      )}
      {trayTasks.length > 0 && (
        <div className="team-tray">
          <span className="team-tray-hint">
            <GripVertical size={14} aria-hidden="true" />
            برای ارجاع، کار را روی کارت فرد بکشید
          </span>
          <div className="team-tray-list">
            {trayTasks.map((task) => (
              <span
                key={task.id}
                draggable
                onDragStart={(event) => event.dataTransfer.setData("task-id", task.id)}
                title={task.title}
              >
                <small>{task.number}</small>
                {task.title}
              </span>
            ))}
          </div>
        </div>
      )}
      {cards.length ? (
        <div className={`team-grid ${view === "tree" ? "tree" : ""} ${compact ? "compact" : ""}`}>
          {cards.map((card) => {
            const color = rulePreview[card.id]?.color || card.color;
            const workload = Math.min(100, Math.max(0, card.workload_percent));
            return (
              <article
                key={card.id}
                // eslint-disable-next-line jsx-a11y/prefer-tag-over-role -- the card contains its own links.
                role="button"
                tabIndex={0}
                aria-label={`جزئیات ${card.name}`}
                style={{ "--unit-depth": card.unit_depth } as CSSProperties}
                className={`team-member team-${color}`}
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
                <header className="team-member-head">
                  <span className="team-member-avatar">
                    {card.avatar ? <img src={card.avatar} alt="" /> : card.name.slice(0, 1)}
                    <i
                      className={`team-presence ${card.presence === "absent" ? "is-absent" : ""}`}
                      aria-hidden="true"
                    />
                  </span>
                  <div className="team-member-id">
                    <strong>{card.name}</strong>
                    <small>
                      {[card.position, view === "tree" ? card.unit_path : card.unit].filter(Boolean).join(" · ")}
                    </small>
                  </div>
                  <span className="team-member-status">{rulePreview[card.id]?.label || card.label}</span>
                </header>
                {!compact && (
                  <>
                    <dl className="team-member-stats">
                      <div>
                        <dt>باز</dt>
                        <dd>{toFa(card.open_count)}</dd>
                      </div>
                      <div className={card.in_progress_count ? "is-active" : ""}>
                        <dt>در حال انجام</dt>
                        <dd>{toFa(card.in_progress_count)}</dd>
                      </div>
                      <div className={card.overdue_count ? "is-late" : ""}>
                        <dt>تأخیری</dt>
                        <dd>{toFa(card.overdue_count)}</dd>
                      </div>
                    </dl>
                    <div className="team-member-load">
                      <div>
                        <span>بار کاری</span>
                        <b>{toFa(workload)}٪</b>
                      </div>
                      <div
                        className="team-member-bar"
                        role="progressbar"
                        aria-label="بار کاری"
                        aria-valuenow={workload}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <i style={{ width: `${workload}%` }} />
                      </div>
                    </div>
                    <div className="team-member-tasks">
                      {card.active_tasks.length ? (
                        <>
                          {card.active_tasks.slice(0, 3).map((task) => (
                            <Link
                              key={task.id}
                              to={`/entities/ticket/${task.id}`}
                              onClick={(event) => event.stopPropagation()}
                            >
                              <span>{task.title}</span>
                              <small>{elapsed(task.started_at)}</small>
                            </Link>
                          ))}
                          {card.active_tasks.length > 3 && (
                            <small className="team-member-more">و {toFa(card.active_tasks.length - 3)} کار دیگر</small>
                          )}
                        </>
                      ) : (
                        <p className="team-member-idle">کار در حال انجامی ندارد</p>
                      )}
                    </div>
                    {card.presence === "absent" && (
                      <p className="team-member-absence">
                        <CalendarOff size={14} aria-hidden="true" />
                        <span>
                          {card.reason || "غیبت ثبت‌شده"} · بازگشت {dateText(card.return_at)}
                          {card.substitute?.name ? ` · جانشین: ${card.substitute.name}` : ""}
                        </span>
                      </p>
                    )}
                    <footer className="team-member-foot">
                      <Clock3 size={13} aria-hidden="true" />
                      آخرین فعالیت: {dateText(card.last_activity)}
                    </footer>
                  </>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="team-empty">
          <UsersRound size={24} aria-hidden="true" />
          <strong>{data.data?.empty || "عضوی با این فیلترها پیدا نشد"}</strong>
          {(search || unit || role || status) && (
            <Button
              variant="secondary"
              onClick={() => {
                setSearch("");
                setUnit("");
                setRole("");
                setStatus("");
              }}
            >
              پاک کردن فیلترها
            </Button>
          )}
        </div>
      )}
      {selected && (
        <div className="dashboard-overlay" role="presentation" onMouseDown={() => setSelected("")}>
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
        <div className="dashboard-overlay" role="presentation" onMouseDown={() => setRulesOpen(false)}>
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
                // eslint-disable-next-line react/no-array-index-key -- rule order is the identity while dragging.
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
