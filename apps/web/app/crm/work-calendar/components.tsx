/** Presentational pieces of the work calendar. Data and permissions come from the server via props. */
import { useState } from "react";
import type { FormEvent } from "react";
import {
  CompactMultiSelector,
  PersianDatePicker,
  PersianDateTimePicker,
  PersianTimePicker,
  SearchableSelect,
} from "@plane/ui";
import { CalendarCheck, Plus, Trash2 } from "lucide-react";
import type {
  CalendarPerson,
  PendingItem,
  PresenceView,
  WeekDayInput,
  WorkEventKind,
  WorkMode,
} from "../api/work-calendar";
import { Button, EmptyState } from "../components";
import { persianDate } from "../utils";
import { LAYERS, WEEK_ORDER, WORK_MODE_LABELS, defaultWeek, validateWeek } from "./model";
import type { DayChip, LayerId } from "./model";

export function LayerChips({ chips }: { chips: DayChip[] }) {
  if (!chips.length) return null;
  return (
    <div className="work-layer-chips">
      {chips.map((chip) => (
        <article key={chip.key} className={`work-chip work-chip-${chip.layer}`} title={chip.detail || chip.label}>
          <b>{chip.label}</b>
          {chip.detail && <small>{chip.detail}</small>}
          {chip.flag && <em className="work-chip-flag">{chip.flag}</em>}
        </article>
      ))}
    </div>
  );
}

export function LayerFilter({ enabled, onChange }: { enabled: Set<LayerId>; onChange: (next: Set<LayerId>) => void }) {
  return (
    <fieldset className="work-layer-filter">
      <legend>لایه‌های تقویم</legend>
      {LAYERS.map((layer) => (
        <label key={layer.id} className={`work-layer-toggle work-chip-${layer.id}`}>
          <input
            type="checkbox"
            checked={enabled.has(layer.id)}
            onChange={(event) => {
              const next = new Set(enabled);
              if (event.target.checked) next.add(layer.id);
              else next.delete(layer.id);
              onChange(next);
            }}
          />
          <span>{layer.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function PersonPicker({
  people,
  value,
  onChange,
}: {
  people: CalendarPerson[];
  value: string;
  onChange: (id: string) => void;
}) {
  if (people.length < 2) return null;
  const relation = { self: "خودم", direct: "زیرمجموعهٔ مستقیم", ancestor: "زیرمجموعهٔ غیرمستقیم" } as const;
  return (
    <div className="work-person-picker">
      <label htmlFor="work-calendar-person">تقویم فرد</label>
      <SearchableSelect
        id="work-calendar-person"
        label="انتخاب فرد"
        value={value}
        onChange={onChange}
        options={people.map((person) => ({
          id: person.id,
          title: person.name,
          description: person.relation ? relation[person.relation] : person.can_view ? undefined : "فقط در دسترس بودن",
        }))}
      />
    </div>
  );
}

export function PresenceToday({
  state,
  onDeclare,
  onCancel,
  busy,
}: {
  state?: { can_declare: boolean; is_working_day: boolean; declaration: PresenceView | null };
  onDeclare: () => void;
  onCancel: (id: string) => void;
  busy?: boolean;
}) {
  if (!state || state.is_working_day) return null;
  return (
    <section className="work-presence" aria-label="اعلام حضور امروز">
      <div>
        <strong>امروز طبق برنامهٔ شما روز کاری نیست.</strong>
        <p>
          اگر امروز سر کار هستید می‌توانید آن را اعلام کنید. این اعلام فقط گفتهٔ خود شماست، حضور فیزیکی را اثبات نمی‌کند و
          نبودِ آن هیچ اثری ندارد.
        </p>
      </div>
      {state.declaration ? (
        <div className="work-presence-done">
          <span className="work-chip work-chip-presence">اعلام‌شده توسط خود فرد</span>
          <Button variant="secondary" disabled={busy} onClick={() => onCancel(state.declaration!.id)}>
            لغو اعلام
          </Button>
        </div>
      ) : (
        state.can_declare && (
          <Button icon={CalendarCheck} disabled={busy} onClick={onDeclare}>
            امروز در محل کار هستم
          </Button>
        )
      )}
    </section>
  );
}

export function PendingConfirmations({
  items,
  onConfirm,
  busy,
}: {
  items: PendingItem[];
  onConfirm: (item: PendingItem, outcome: "done" | "not_done", summary: string) => void;
  busy?: boolean;
}) {
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const kinds = { meeting: "جلسه", mission: "مأموریت", event: "رویداد کاری", presence: "اعلام حضور" };
  return (
    <section className="work-pending" aria-label="موارد منتظر تأیید شما">
      <h2>موارد منتظر تأیید شما</h2>
      <p className="work-muted">
        رویداد برنامه‌ریزی‌شده به‌معنای انجام‌شده نیست. فقط خودتان می‌توانید انجام‌شدن هر مورد را تأیید کنید.
      </p>
      {!items.length ? (
        <EmptyState title="موردی منتظر تأیید نیست" description="رویدادهای گذشته و اعلام‌های حضور شما اینجا می‌آیند." />
      ) : (
        <ul>
          {items.map((item) => (
            <li key={`${item.source_type}-${item.source_id}`}>
              <div>
                <span className={`work-chip work-chip-${item.kind}`}>{kinds[item.kind]}</span>
                <b>{item.title}</b>
                <small>
                  {persianDate(item.starts_at, {
                    year: "numeric",
                    hour: item.source_type === "event" ? "2-digit" : undefined,
                  })}
                </small>
              </div>
              <textarea
                aria-label="خلاصهٔ اختیاری"
                placeholder="خلاصهٔ اختیاری"
                value={summaries[item.source_id] ?? ""}
                onChange={(event) => setSummaries({ ...summaries, [item.source_id]: event.target.value })}
              />
              <div className="work-pending-actions">
                <Button disabled={busy} onClick={() => onConfirm(item, "done", summaries[item.source_id] ?? "")}>
                  انجام شد
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onConfirm(item, "not_done", summaries[item.source_id] ?? "")}
                >
                  انجام نشد
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const modeOptions = (Object.keys(WORK_MODE_LABELS) as WorkMode[]).map((mode) => ({
  id: mode || "none",
  title: WORK_MODE_LABELS[mode],
}));

export function WeeklyScheduleEditor({
  initial,
  minDate,
  timeZone,
  saving,
  onSubmit,
  onCancel,
}: {
  initial?: WeekDayInput[];
  minDate?: string;
  timeZone?: string;
  saving?: boolean;
  onSubmit: (payload: { effective_from: string; effective_to?: string; reason: string; days: WeekDayInput[] }) => void;
  onCancel?: () => void;
}) {
  const [days, setDays] = useState<WeekDayInput[]>(() => {
    const source = initial?.length === 7 ? initial : defaultWeek();
    return WEEK_ORDER.map(({ weekday }) => ({ ...source.find((day) => day.weekday === weekday)! }));
  });
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const errors = [
    ...(effectiveFrom ? [] : ["تاریخ شروع اعتبار برنامه الزامی است."]),
    ...(reason.trim() ? [] : ["دلیل یا توضیح تغییر را بنویسید."]),
    ...(effectiveTo && effectiveFrom && effectiveTo < effectiveFrom
      ? ["تاریخ پایان اعتبار باید بعد از تاریخ شروع باشد."]
      : []),
    ...validateWeek(days),
  ];
  const update = (weekday: number, patch: Partial<WeekDayInput>) =>
    setDays((current) => current.map((day) => (day.weekday === weekday ? { ...day, ...patch } : day)));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (errors.length) return;
    onSubmit({ effective_from: effectiveFrom, effective_to: effectiveTo || undefined, reason: reason.trim(), days });
  };
  return (
    <form className="work-schedule-editor" aria-label="ویرایش برنامهٔ هفتگی" onSubmit={submit}>
      <p className="work-muted">
        هر ذخیره یک نسخهٔ تاریخ‌دار جدید می‌سازد و نسخهٔ قبلی بسته می‌شود ولی حذف نمی‌شود. تغییر برنامه هیچ مرخصی، غیبت یا
        تخلفی ثبت نمی‌کند.
      </p>
      <table>
        <thead>
          <tr>
            <th>روز</th>
            <th>روز کاری</th>
            <th>شروع</th>
            <th>پایان</th>
            <th>استراحت‌ها</th>
            <th>شیوهٔ کار</th>
          </tr>
        </thead>
        <tbody>
          {WEEK_ORDER.map(({ weekday, label }) => {
            const day = days.find((item) => item.weekday === weekday)!;
            return (
              <tr key={weekday} data-weekday={weekday} data-working={day.is_working}>
                <th scope="row">{label}</th>
                <td>
                  <label className="work-check">
                    <input
                      type="checkbox"
                      aria-label={`${label} روز کاری است`}
                      checked={day.is_working}
                      onChange={(event) => update(weekday, { is_working: event.target.checked })}
                    />
                    <span>{day.is_working ? "کاری" : "غیرکاری"}</span>
                  </label>
                </td>
                <td>
                  <PersianTimePicker
                    label={`شروع ${label}`}
                    value={day.start}
                    disabled={!day.is_working}
                    onChange={(start) => update(weekday, { start })}
                  />
                </td>
                <td>
                  <PersianTimePicker
                    label={`پایان ${label}`}
                    value={day.end}
                    disabled={!day.is_working}
                    onChange={(end) => update(weekday, { end })}
                  />
                </td>
                <td>
                  {day.breaks.map((item, index) => (
                    // Breaks have no identity of their own; their position is the identity.
                    // oxlint-disable-next-line react/no-array-index-key
                    <div className="work-break" key={index}>
                      <PersianTimePicker
                        label={`شروع استراحت ${label}`}
                        value={item.start}
                        disabled={!day.is_working}
                        onChange={(start) =>
                          update(weekday, {
                            breaks: day.breaks.map((row, i) => (i === index ? { ...row, start } : row)),
                          })
                        }
                      />
                      <PersianTimePicker
                        label={`پایان استراحت ${label}`}
                        value={item.end}
                        disabled={!day.is_working}
                        onChange={(end) =>
                          update(weekday, { breaks: day.breaks.map((row, i) => (i === index ? { ...row, end } : row)) })
                        }
                      />
                      <button
                        type="button"
                        className="work-icon-button"
                        aria-label={`حذف استراحت ${label}`}
                        onClick={() => update(weekday, { breaks: day.breaks.filter((_, i) => i !== index) })}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  {day.is_working && (
                    <button
                      type="button"
                      className="work-link-button"
                      onClick={() => update(weekday, { breaks: [...day.breaks, { start: "12:00", end: "12:30" }] })}
                    >
                      <Plus size={14} /> افزودن استراحت
                    </button>
                  )}
                </td>
                <td>
                  <SearchableSelect
                    label={`شیوهٔ کار ${label}`}
                    value={day.work_mode || "none"}
                    disabled={!day.is_working}
                    onChange={(mode) => update(weekday, { work_mode: (mode === "none" ? "" : mode) as WorkMode })}
                    options={modeOptions}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="work-form-row">
        <PersianDatePicker
          label="معتبر از تاریخ"
          required
          value={effectiveFrom}
          min={minDate}
          timeZone={timeZone}
          onChange={setEffectiveFrom}
        />
        <PersianDatePicker
          label="معتبر تا تاریخ (اختیاری)"
          value={effectiveTo}
          min={effectiveFrom || minDate}
          timeZone={timeZone}
          onChange={setEffectiveTo}
        />
      </div>
      <label className="work-field">
        <span>دلیل یا توضیح تغییر</span>
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} required />
      </label>
      {submitted && errors.length > 0 && (
        <ul className="work-errors" role="alert">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
      <div className="work-form-actions">
        <Button type="submit" disabled={saving}>
          ثبت نسخهٔ جدید برنامه
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            انصراف
          </Button>
        )}
      </div>
    </form>
  );
}

export function ExceptionForm({
  minDate,
  timeZone,
  saving,
  onSubmit,
  onCancel,
}: {
  minDate?: string;
  timeZone?: string;
  saving?: boolean;
  onSubmit: (payload: {
    date_from: string;
    date_to: string;
    is_working: boolean;
    start?: string;
    end?: string;
    reason: string;
  }) => void;
  onCancel?: () => void;
}) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [isWorking, setIsWorking] = useState(true);
  const [start, setStart] = useState("12:00");
  const [end, setEnd] = useState("18:00");
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const errors = [
    ...(dateFrom ? [] : ["تاریخ استثنا الزامی است."]),
    ...(reason.trim() ? [] : ["دلیل یا توضیح تغییر را بنویسید."]),
    ...(isWorking && end <= start ? ["ساعت پایان باید بعد از ساعت شروع باشد."] : []),
  ];
  return (
    <form
      className="work-exception-form"
      aria-label="استثنای تاریخ‌دار"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (errors.length) return;
        onSubmit({
          date_from: dateFrom,
          date_to: dateTo || dateFrom,
          is_working: isWorking,
          ...(isWorking ? { start, end } : {}),
          reason: reason.trim(),
        });
      }}
    >
      <p className="work-muted">استثنا فقط همان تاریخ‌ها را تغییر می‌دهد و برنامهٔ هفتگی دست نمی‌خورد.</p>
      <div className="work-form-row">
        <PersianDatePicker
          label="از تاریخ"
          required
          value={dateFrom}
          min={minDate}
          timeZone={timeZone}
          onChange={setDateFrom}
        />
        <PersianDatePicker
          label="تا تاریخ (اختیاری)"
          value={dateTo}
          min={dateFrom || minDate}
          timeZone={timeZone}
          onChange={setDateTo}
        />
      </div>
      <label className="work-check">
        <input type="checkbox" checked={isWorking} onChange={(event) => setIsWorking(event.target.checked)} />
        <span>در این تاریخ‌ها کار می‌کند</span>
      </label>
      {isWorking && (
        <div className="work-form-row">
          <PersianTimePicker label="شروع" value={start} onChange={setStart} />
          <PersianTimePicker label="پایان" value={end} onChange={setEnd} />
        </div>
      )}
      <label className="work-field">
        <span>دلیل یا توضیح</span>
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} required />
      </label>
      {submitted && errors.length > 0 && (
        <ul className="work-errors" role="alert">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
      <div className="work-form-actions">
        <Button type="submit" disabled={saving}>
          ثبت استثنا
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            انصراف
          </Button>
        )}
      </div>
    </form>
  );
}

const kindOptions: { id: WorkEventKind; title: string }[] = [
  { id: "meeting", title: "جلسه" },
  { id: "mission", title: "مأموریت" },
  { id: "event", title: "رویداد کاری" },
];

export function WorkEventForm({
  people,
  defaultParticipant,
  timeZone,
  saving,
  onSubmit,
  onCancel,
}: {
  people: CalendarPerson[];
  defaultParticipant: string;
  timeZone?: string;
  saving?: boolean;
  onSubmit: (payload: {
    kind: WorkEventKind;
    title: string;
    description: string;
    private_note: string;
    starts_at: string;
    ends_at: string;
    all_day: boolean;
    participant_ids: string[];
  }) => void;
  onCancel?: () => void;
}) {
  const [kind, setKind] = useState<WorkEventKind>("meeting");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [privateNote, setPrivateNote] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [participants, setParticipants] = useState<string[]>([defaultParticipant]);
  const [submitted, setSubmitted] = useState(false);
  const errors = [
    ...(title.trim() ? [] : ["عنوان رویداد الزامی است."]),
    ...(startsAt && endsAt ? [] : ["زمان شروع و پایان را انتخاب کنید."]),
    ...(startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)
      ? ["پایان رویداد باید بعد از شروع آن باشد."]
      : []),
    ...(participants.length ? [] : ["دست‌کم یک فرد مرتبط انتخاب کنید."]),
  ];
  return (
    <form
      className="work-event-form"
      aria-label="رویداد کاری جدید"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (errors.length) return;
        onSubmit({
          kind,
          title: title.trim(),
          description,
          private_note: privateNote,
          starts_at: startsAt,
          ends_at: endsAt,
          all_day: false,
          participant_ids: participants,
        });
      }}
    >
      <div className="work-form-row">
        <SearchableSelect
          label="نوع"
          value={kind}
          onChange={(value) => setKind(value as WorkEventKind)}
          options={kindOptions}
        />
        <label className="work-field">
          <span>عنوان</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} required />
        </label>
      </div>
      <div className="work-form-row">
        <PersianDateTimePicker label="شروع" value={startsAt} timeZone={timeZone} onChange={setStartsAt} />
        <PersianDateTimePicker label="پایان" value={endsAt} timeZone={timeZone} onChange={setEndsAt} />
      </div>
      <CompactMultiSelector
        label="افراد مرتبط"
        options={people
          .filter((person) => person.can_schedule)
          .map((person) => ({ id: person.id, title: person.name }))}
        selected={participants}
        onChange={setParticipants}
      />
      <label className="work-field">
        <span>توضیح (فقط برای افراد مرتبط و مدیران مجاز)</span>
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} />
      </label>
      <label className="work-field">
        <span>یادداشت محرمانه</span>
        <textarea value={privateNote} onChange={(event) => setPrivateNote(event.target.value)} />
      </label>
      <p className="work-muted">همکاران دیگر فقط بازهٔ زمانی را با عنوان «در دسترس نیست» می‌بینند.</p>
      {submitted && errors.length > 0 && (
        <ul className="work-errors" role="alert">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
      <div className="work-form-actions">
        <Button type="submit" disabled={saving}>
          ثبت رویداد
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            انصراف
          </Button>
        )}
      </div>
    </form>
  );
}
