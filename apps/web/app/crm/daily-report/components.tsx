/** Presentational parts of the daily report (ticket 8). Leave, schedule, events and presence are
 * read-only here: they come live from their own pages and are never written by this form. */
import { useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Link } from "react-router";
import { CalendarClock, CalendarOff, Check, History, Lightbulb, Link2, Lock, Pencil, Plus, Trash2, X } from "lucide-react";
import type { DayEvent, DayLeave, DayPayload, HistoryEvent, ItemKind, ReportItem, Suggestion, WorkOptions } from "../api/reports";
import { Button, IconButton } from "../components";
import { persianDate, toFa } from "../utils";
import { EFFORT_LABEL, FULL_LEAVE_TEXT, KINDS, PRESENCE_LABEL, emptyItem, minutesText, parseEffort, sourceKindLabel } from "./model";

export type Tone = "success" | "warning" | "danger" | "neutral" | "info";

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`dr-pill dr-pill-${tone}`}>{children}</span>;
}

const time = (iso: string) => toFa(new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tehran" }));

/** Approved leave of the day, read live from the leave request. There is no leave category. */
export function LeaveBanner({ leaves }: { leaves: DayLeave[] }) {
  if (!leaves.length) return null;
  return (
    <section className="dr-leave" aria-label="مرخصی تأییدشدهٔ این روز">
      <CalendarOff size={18} aria-hidden="true" />
      <div className="dr-leave-body">
        {leaves.map((leave) => (
          <p key={leave.id}>
            <strong>مرخصی {leave.mode_label} تأییدشده</strong> — {leave.period_text} ({leave.duration_text})
            {leave.full_day ? " · کل روز کاری" : " · بخشی از روز"}{" "}
            <Link to={leave.url}>مشاهدهٔ درخواست</Link>
          </p>
        ))}
        <small>این اطلاعات از درخواست مرخصی خوانده می‌شود و در گزارش ذخیره نمی‌شود.</small>
      </div>
    </section>
  );
}

export function FullLeaveNotice({ onVolunteer, volunteering }: { onVolunteer: () => void; volunteering: boolean }) {
  return (
    <section className="dr-notice" role="status">
      <strong>{FULL_LEAVE_TEXT}</strong>
      <p>یادآوری برای این روز ارسال نمی‌شود و در فهرست «ثبت‌نشده» مدیر نمی‌آیید.</p>
      {!volunteering && (
        <Button variant="secondary" onClick={onVolunteer}>
          با این حال گزارش می‌نویسم
        </Button>
      )}
    </section>
  );
}

/** Today's schedule, meetings/missions and self-reported presence (all read-only). */
export function DayContext({
  day,
  canSuggest,
  onAddEvent,
}: {
  day: DayPayload;
  canSuggest: boolean;
  onAddEvent: (event: DayEvent) => void;
}) {
  const schedule = day.schedule;
  return (
    <aside className="dr-context" aria-label="برنامهٔ این روز">
      <section>
        <h3>
          <CalendarClock size={16} aria-hidden="true" /> برنامهٔ امروز
        </h3>
        <p>
          {schedule.is_working && schedule.start && schedule.end
            ? `${schedule.label} · ${toFa(schedule.start)} تا ${toFa(schedule.end)}`
            : schedule.label}
        </p>
      </section>
      <section>
        <h3>جلسه‌ها و مأموریت‌ها</h3>
        {day.events.length ? (
          <ul className="dr-events">
            {day.events.map((event) => (
              <li key={event.id}>
                <span>
                  <b>{event.kind_label}:</b> {event.title}
                  <small>{event.time_text}</small>
                </span>
                {event.past ? (
                  canSuggest &&
                  event.confirmation !== "not_done" && (
                    <button type="button" className="dr-link-button" onClick={() => onAddEvent(event)}>
                      افزودن به انجام‌شده
                    </button>
                  )
                ) : (
                  <small className="dr-muted">برنامه‌ریزی‌شده — هنوز انجام‌شده نیست</small>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="dr-muted">رویدادی برای این روز ثبت نشده است.</p>
        )}
      </section>
      <section>
        <h3>اعلام حضور</h3>
        {day.presence ? (
          <p>
            <Pill tone="info">{PRESENCE_LABEL}</Pill> <small>ثبت در {time(day.presence.declared_at)}</small>
          </p>
        ) : (
          <p className="dr-muted">اعلام حضوری ثبت نشده است.</p>
        )}
      </section>
    </aside>
  );
}

function LinkPicker({
  item,
  options,
  onSearch,
  onPick,
  disabled,
}: {
  item: ReportItem;
  options?: WorkOptions;
  onSearch: (query: string) => void;
  onPick: (link: Pick<ReportItem, "issue" | "project">) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const label = item.issue ? `${item.issue.number ?? ""} ${item.issue.title}`.trim() : item.project?.name;
  return (
    <div className="dr-picker">
      {label ? (
        <span className="dr-chip">
          <Link2 size={13} aria-hidden="true" />
          {item.issue?.id && !item.issue.hidden ? <Link to={`/edit/ticket/${item.issue.id}`}>{label}</Link> : label}
          {!disabled && (
            <button type="button" aria-label="حذف پیوند" onClick={() => onPick({ issue: null, project: null })}>
              <X size={12} />
            </button>
          )}
        </span>
      ) : (
        !disabled && (
          <button type="button" className="dr-link-button" onClick={() => setOpen(!open)} aria-expanded={open}>
            <Link2 size={13} aria-hidden="true" /> پیوند به کار یا پروژه
          </button>
        )
      )}
      {open && (
        <div className="dr-picker-menu" role="listbox" aria-label="کارهای من">
          <input autoFocus placeholder="جست‌وجو در کارهای من…" onChange={(event) => onSearch(event.target.value)} />
          {options?.tickets.map((ticket) => (
            <button
              type="button"
              role="option"
              aria-selected={false}
              key={ticket.id}
              onClick={() => {
                onPick({ issue: { id: ticket.id, title: ticket.title, number: ticket.number }, project: null });
                setOpen(false);
              }}
            >
              <b>{ticket.number}</b> {ticket.title} <small>{ticket.status}</small>
            </button>
          ))}
          {options?.projects.map((project) => (
            <button
              type="button"
              role="option"
              aria-selected={false}
              key={project.id}
              onClick={() => {
                onPick({ issue: null, project });
                setOpen(false);
              }}
            >
              <small>پروژه</small> {project.name}
            </button>
          ))}
          {options && !options.tickets.length && !options.projects.length && <p className="dr-muted">موردی پیدا نشد.</p>}
        </div>
      )}
    </div>
  );
}

/** One of the four sections. Enter adds a line; the server re-validates everything. */
export function ItemSection({
  kind,
  items,
  onChange,
  disabled,
  options,
  onSearch,
}: {
  kind: ItemKind;
  items: ReportItem[];
  onChange: (items: ReportItem[]) => void;
  disabled?: boolean;
  options?: WorkOptions;
  onSearch: (query: string) => void;
}) {
  const meta = KINDS.find((entry) => entry.code === kind)!;
  const [draft, setDraft] = useState("");
  const add = () => {
    if (!draft.trim()) return;
    onChange([...items, emptyItem(kind, draft.trim())]);
    setDraft("");
  };
  const update = (index: number, patch: Partial<ReportItem>) =>
    onChange(items.map((item, position) => (position === index ? { ...item, ...patch } : item)));
  return (
    <section className={`dr-section dr-section-${kind}`} aria-label={meta.title}>
      <header>
        <h3>{meta.title}</h3>
        <small>{meta.hint}</small>
      </header>
      <ol className="dr-items">
        {items.map((item, index) => (
          <li key={item.id ?? `${item.source_kind}-${item.source_id}-${index}`} className="dr-item">
            <textarea
              aria-label={`${meta.title} ${toFa(index + 1)}`}
              value={item.text}
              rows={Math.min(4, Math.max(1, Math.ceil(item.text.length / 70)))}
              disabled={disabled}
              onChange={(event) => update(index, { text: event.target.value })}
            />
            <div className="dr-item-tools">
              <LinkPicker item={item} options={options} onSearch={onSearch} disabled={disabled} onPick={(link) => update(index, link)} />
              {kind === "blocker" && (
                <label className="dr-check">
                  <input
                    type="checkbox"
                    checked={item.needs_help}
                    disabled={disabled}
                    onChange={(event) => update(index, { needs_help: event.target.checked })}
                  />
                  نیاز به کمک دارم
                </label>
              )}
              <label className="dr-effort" title={EFFORT_LABEL}>
                <span>{EFFORT_LABEL}</span>
                <input
                  inputMode="numeric"
                  placeholder="دقیقه"
                  disabled={disabled}
                  value={item.effort_minutes === null ? "" : toFa(item.effort_minutes)}
                  onChange={(event) => update(index, { effort_minutes: parseEffort(event.target.value) })}
                />
                {item.effort_minutes ? <small>{minutesText(item.effort_minutes)}</small> : null}
              </label>
              {item.source_kind && <small className="dr-source">{sourceKindLabel(item.source_kind)}</small>}
              {!disabled && (
                <IconButton label="حذف این مورد" onClick={() => onChange(items.filter((_, position) => position !== index))}>
                  <Trash2 size={15} />
                </IconButton>
              )}
            </div>
          </li>
        ))}
      </ol>
      {!disabled && (
        <div className="dr-add">
          <input
            aria-label={`افزودن به ${meta.title}`}
            placeholder={meta.placeholder}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                add();
              }
            }}
          />
          <IconButton label={`افزودن به ${meta.title}`} onClick={add} disabled={!draft.trim()}>
            <Plus size={16} />
          </IconButton>
        </div>
      )}
    </section>
  );
}

/** A suggestion built from recorded activity: keep, edit or drop. Nothing is saved until the report is saved. */
export function SuggestionCard({
  suggestion,
  onKeep,
  onDrop,
}: {
  suggestion: Suggestion;
  onKeep: (text: string) => void;
  onDrop: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(suggestion.text);
  const kind = KINDS.find((entry) => entry.code === suggestion.kind)?.title ?? "";
  return (
    <article className="dr-suggestion" aria-label="پیشنهاد پیش‌نویس">
      <header>
        <Lightbulb size={15} aria-hidden="true" />
        <span className="dr-source">
          منبع: {suggestion.source_label}
          {suggestion.link && (
            <>
              {" · "}
              <Link to={suggestion.link}>مشاهده</Link>
            </>
          )}
        </span>
        <small>
          {kind} · {time(suggestion.at)}
        </small>
      </header>
      {editing ? (
        <textarea aria-label="ویرایش پیشنهاد" value={text} onChange={(event) => setText(event.target.value)} rows={2} />
      ) : (
        <p>{text}</p>
      )}
      <footer>
        <Button icon={Check} onClick={() => onKeep(text)} disabled={!text.trim()}>
          نگه‌دار
        </Button>
        <Button variant="secondary" icon={Pencil} onClick={() => setEditing(!editing)}>
          {editing ? "پایان ویرایش" : "ویرایش"}
        </Button>
        <Button variant="ghost" icon={Trash2} onClick={onDrop}>
          حذف
        </Button>
      </footer>
    </article>
  );
}

export function LockNotice({ day }: { day: DayPayload }) {
  if (!day.locked) return null;
  return (
    <p className="dr-lock" role="status">
      <Lock size={15} aria-hidden="true" /> {day.lock_text}
    </p>
  );
}

export function HistoryList({ events }: { events: HistoryEvent[] }) {
  if (!events.length) return <p className="dr-muted">هنوز سابقه‌ای ثبت نشده است.</p>;
  return (
    <ol className="dr-history" aria-label="سابقهٔ اصلاح">
      {events.map((event) => (
        <li key={event.id}>
          <History size={14} aria-hidden="true" />
          <div>
            <strong>{event.title}</strong> · نسخهٔ {toFa(event.revision ?? 0)} · {event.actor?.name ?? "سامانه"} ·{" "}
            {persianDate(event.at, { dateStyle: "medium", timeStyle: "short" })}
            {event.is_late && event.type === "daily_report.submitted" && <Pill tone="warning">دیرهنگام</Pill>}
            {event.added.length > 0 && <p>افزوده: {event.added.join("، ")}</p>}
            {event.removed.length > 0 && <p>حذف‌شده: {event.removed.join("، ")}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
