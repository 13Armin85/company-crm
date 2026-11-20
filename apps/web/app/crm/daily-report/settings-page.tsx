import { ConfiguredFields } from "../engine/surface";
/** «یادآوری گزارش روزانه»: personal setting (when allowed), unit settings for allowed managers and the
 * company default. Only in-app reminders exist; e-mail/SMS stay disabled until a provider is configured. */
import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { normalizePersianSearch } from "@plane/ui";
import { useReminderSettings, useSaveReminder } from "../api/reports";
import type { ReminderSettings, ReminderValue } from "../api/reports";
import { errorMessage } from "../api/client";
import { Button, EmptyState, PageHeader, SearchBox, Skeleton } from "../components";
import { toFa } from "../utils";
import { Pill } from "./components";

/** Persian week order; values are Python weekdays (Monday = 0 … Sunday = 6). */
export const WEEKDAYS = [
  { value: 5, label: "شنبه" },
  { value: 6, label: "یکشنبه" },
  { value: 0, label: "دوشنبه" },
  { value: 1, label: "سه‌شنبه" },
  { value: 2, label: "چهارشنبه" },
  { value: 3, label: "پنجشنبه" },
  { value: 4, label: "جمعه" },
];

export function ReminderEditor({
  value,
  onChange,
  disabled,
  idPrefix,
}: {
  value: Required<ReminderValue>;
  onChange: (value: Required<ReminderValue>) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  return (
    <ConfiguredFields code="daily-reminder-form">
      <div className="dr-reminder-editor">
        <label className="dr-check">
          <input
            type="checkbox"
            checked={value.enabled}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, enabled: event.target.checked })}
          />
          یادآوری فعال باشد
        </label>
        <label htmlFor={`${idPrefix}-time`}>
          ساعت یادآوری
          <input
            id={`${idPrefix}-time`}
            type="time"
            value={value.time}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, time: event.target.value })}
          />
        </label>
        <fieldset disabled={disabled}>
          <legend>روزهای هفته</legend>
          {WEEKDAYS.map((day) => (
            <label key={day.value} className="dr-check">
              <input
                type="checkbox"
                checked={value.weekdays.includes(day.value)}
                onChange={(event) =>
                  onChange({
                    ...value,
                    weekdays: event.target.checked
                      ? // eslint-disable-next-line unicorn/no-array-sort -- The web app targets ES2022; this sorts a fresh array without mutating state.
                        [...value.weekdays, day.value].sort((a, b) => a - b)
                      : value.weekdays.filter((item) => item !== day.value),
                  })
                }
              />
              {day.label}
            </label>
          ))}
        </fieldset>
        <small className="dr-muted">
          در روز غیرکاری یا تعطیل برنامهٔ شما و در روز تمام‌مرخصی تأییدشده یادآوری ارسال نمی‌شود.
        </small>
      </div>
    </ConfiguredFields>
  );
}

const full = (value: ReminderValue | null | undefined, base: Required<ReminderValue>): Required<ReminderValue> => ({
  enabled: value?.enabled ?? base.enabled,
  time: value?.time ?? base.time,
  weekdays: value?.weekdays ?? base.weekdays,
});

export function UnitRow({ unit, base }: { unit: ReminderSettings["units"][number]; base: Required<ReminderValue> }) {
  const save = useSaveReminder();
  const [value, setValue] = useState(full(unit.reminder, base));
  const [allow, setAllow] = useState<boolean>(unit.allow_personal ?? true);
  const [open, setOpen] = useState(false);
  return (
    <details className="dr-unit" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        {unit.title} {unit.reminder ? <Pill tone="info">تنظیم واحد</Pill> : <Pill tone="neutral">پیش‌فرض شرکت</Pill>}
      </summary>
      {open && (
        <>
          <ReminderEditor idPrefix={`unit-${unit.id}`} value={value} onChange={setValue} />
          <label className="dr-check">
            <input type="checkbox" checked={allow} onChange={(event) => setAllow(event.target.checked)} />
            افراد این واحد می‌توانند یادآوری شخصی تنظیم کنند
          </label>
          <Button
            disabled={save.isPending}
            onClick={() => save.mutate({ level: "unit", unit: unit.id, reminder: value, allow_personal: allow })}
          >
            ذخیرهٔ تنظیم واحد
          </Button>
        </>
      )}
    </details>
  );
}

type Policy = {
  reminder: Required<ReminderValue>;
  allow_personal: boolean;
  deadline_time: string;
  edit_window: { mode: "working_days" | "week_end"; days: number };
  report_range_days: number;
  personal_report_limit: number;
};

function CompanySettings({ policy }: { policy: Policy }) {
  const save = useSaveReminder();
  const [value, setValue] = useState<Policy>(policy);
  return (
    <section className="dr-card">
      <h2>پیش‌فرض شرکت</h2>
      <ReminderEditor
        idPrefix="company"
        value={value.reminder}
        onChange={(reminder) => setValue({ ...value, reminder })}
      />
      <div className="dr-grid">
        <label>
          مهلت ثبت بدون «دیرهنگام» (ساعت همان روز)
          <input
            type="time"
            value={value.deadline_time}
            onChange={(event) => setValue({ ...value, deadline_time: event.target.value })}
          />
        </label>
        <label>
          دورهٔ اصلاح پس از ثبت
          <select
            value={value.edit_window.mode}
            onChange={(event) =>
              setValue({
                ...value,
                edit_window: { ...value.edit_window, mode: event.target.value as Policy["edit_window"]["mode"] },
              })
            }
          >
            <option value="working_days">تا پایان N روز کاری بعد</option>
            <option value="week_end">تا پایان هفته (جمعه)</option>
          </select>
        </label>
        {value.edit_window.mode === "working_days" && (
          <label>
            تعداد روز کاری
            <input
              type="number"
              min={0}
              max={30}
              value={value.edit_window.days}
              onChange={(event) =>
                setValue({ ...value, edit_window: { ...value.edit_window, days: Number(event.target.value) } })
              }
            />
          </label>
        )}
        <label>
          سقف بازهٔ گزارش (روز)
          <input
            type="number"
            min={1}
            max={731}
            value={value.report_range_days}
            onChange={(event) => setValue({ ...value, report_range_days: Number(event.target.value) })}
          />
        </label>
        <label>
          سقف گزارش ذخیره‌شدهٔ هر فرد
          <input
            type="number"
            min={1}
            max={500}
            value={value.personal_report_limit}
            onChange={(event) => setValue({ ...value, personal_report_limit: Number(event.target.value) })}
          />
        </label>
      </div>
      <label className="dr-check">
        <input
          type="checkbox"
          checked={value.allow_personal}
          onChange={(event) => setValue({ ...value, allow_personal: event.target.checked })}
        />
        افراد می‌توانند یادآوری شخصی تنظیم کنند (مگر واحدشان خلاف آن را بگوید)
      </label>
      <Button
        disabled={save.isPending}
        onClick={() =>
          save.mutate({
            level: "workspace",
            data: {
              reminder: value.reminder,
              allow_personal: value.allow_personal,
              deadline_time: value.deadline_time,
              edit_window: value.edit_window,
              report_range_days: value.report_range_days,
              personal_report_limit: value.personal_report_limit,
            },
          })
        }
      >
        ذخیرهٔ پیش‌فرض شرکت
      </Button>
    </section>
  );
}

export default function DailyReportSettingsPage() {
  const settings = useReminderSettings();
  const save = useSaveReminder();
  const [personal, setPersonal] = useState<Required<ReminderValue> | null>(null);
  const [unitSearch, setUnitSearch] = useState("");
  useEffect(() => {
    if (settings.data) setPersonal(full(settings.data.personal, settings.data.effective));
  }, [settings.data]);
  if (settings.isError)
    return (
      <EmptyState
        title="تنظیمات گزارش در دسترس نیست"
        description={errorMessage(settings.error, "خواندن تنظیمات ممکن نشد.")}
      />
    );
  if (!settings.data || !personal) return <Skeleton rows={5} />;
  const data = settings.data;
  return (
    <div className="dr-page" dir="rtl">
      <PageHeader
        eyebrow="گزارش روزانه"
        title="یادآوری گزارش روزانه"
        description="اولویت: تنظیم شخصی (اگر مدیر اجازه داده باشد) ← تنظیم واحد ← پیش‌فرض شرکت."
      />
      <section className="dr-card">
        <h2>
          <BellRing size={18} aria-hidden="true" /> یادآوری فعلی شما
        </h2>
        <p>
          {data.effective.enabled ? `هر روز کاری ساعت ${toFa(data.effective.time)}` : "یادآوری خاموش است"} ·{" "}
          <Pill tone="neutral">منبع: {data.source_label}</Pill>
        </p>
        <h3>تنظیم شخصی</h3>
        {data.allow_personal ? (
          <>
            <ReminderEditor idPrefix="personal" value={personal} onChange={setPersonal} />
            <div className="dr-actions">
              <Button disabled={save.isPending} onClick={() => save.mutate({ level: "personal", reminder: personal })}>
                ذخیرهٔ تنظیم شخصی
              </Button>
              {data.personal && (
                <Button variant="ghost" onClick={() => save.mutate({ level: "personal", reminder: null })}>
                  بازگشت به تنظیم واحد/شرکت
                </Button>
              )}
            </div>
          </>
        ) : (
          <p className="dr-muted">تغییر یادآوری شخصی برای واحد شما توسط مدیر مجاز نشده است.</p>
        )}
        <h3>کانال‌ها</h3>
        <ul className="dr-channels">
          {data.channels.map((channel) => (
            <li key={channel.code}>
              {channel.title}{" "}
              {channel.enabled ? <Pill tone="success">فعال</Pill> : <Pill tone="neutral">{channel.note}</Pill>}
            </li>
          ))}
        </ul>
      </section>
      {data.units.length > 0 && (
        <section className="dr-card">
          <h2>تنظیم واحدها</h2>
          {data.units.length > 10 && (
            <SearchBox value={unitSearch} onChange={setUnitSearch} placeholder="جستجوی واحد سازمانی…" />
          )}
          {data.units
            .filter((unit) => normalizePersianSearch(unit.title).includes(normalizePersianSearch(unitSearch)))
            .map((unit) => (
              <UnitRow key={unit.id} unit={unit} base={full(null, data.effective)} />
            ))}
        </section>
      )}
      {data.can_manage_workspace && data.workspace && <CompanySettings policy={data.workspace as unknown as Policy} />}
    </div>
  );
}
