/** «گزارش روزانه»: one page, four sections, quick entry; leave and calendar are shown read-only. */
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { BellRing, ChevronLeft, ChevronRight, Copy, FileText, History, Sparkles, Users } from "lucide-react";
import { useWorkspaceAccess } from "../api";
import {
  useDailyMeta,
  useDay,
  useDayHistory,
  useDraft,
  usePrevious,
  useSaveDay,
  useSaveTemplates,
  useTemplates,
  useWorkOptions,
} from "../api/reports";
import type { DayEvent, ReportItem, Suggestion } from "../api/reports";
import { Button, EmptyState, PageHeader, PersianDateInput, Skeleton } from "../components";
import { errorMessage } from "../api/client";
import {
  DayContext,
  FullLeaveNotice,
  HistoryList,
  ItemSection,
  LeaveBanner,
  LockNotice,
  Pill,
  SuggestionCard,
} from "./components";
import {
  KINDS,
  dayBadge,
  emptyItem,
  itemErrors,
  itemFromSuggestion,
  itemsFromPrevious,
  itemsOf,
  pendingSuggestions,
  savePayload,
  shiftDate,
} from "./model";

function TemplatesMenu({ onUse, items }: { onUse: (item: ReportItem) => void; items: ReportItem[] }) {
  const templates = useTemplates();
  const save = useSaveTemplates();
  const [open, setOpen] = useState(false);
  const list = templates.data ?? [];
  return (
    <div className="dr-templates">
      <Button variant="secondary" icon={FileText} onClick={() => setOpen(!open)}>
        قالب شخصی
      </Button>
      {open && (
        <div className="dr-templates-menu" role="menu">
          {list.length === 0 && <p className="dr-muted">قالبی ندارید؛ یک مورد بنویسید و «ذخیره به‌عنوان قالب» را بزنید.</p>}
          {list.map((template) => (
            <div key={template.id} className="dr-template-row">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onUse({ ...emptyItem(template.kind, template.text), source_kind: "template", source_id: template.id });
                  setOpen(false);
                }}
              >
                <b>{template.title}</b> <small>{KINDS.find((k) => k.code === template.kind)?.title}</small>
              </button>
              <button
                type="button"
                aria-label="حذف قالب"
                className="dr-link-button"
                onClick={() => save.mutate(list.filter((row) => row.id !== template.id))}
              >
                حذف
              </button>
            </div>
          ))}
          {items.some((item) => item.text.trim()) && (
            <button
              type="button"
              className="dr-link-button"
              disabled={save.isPending}
              onClick={() => {
                const fresh = items
                  .filter((item) => item.text.trim() && !list.some((row) => row.text === item.text.trim()))
                  .slice(0, Math.max(0, 30 - list.length))
                  .map((item) => ({ id: crypto.randomUUID(), title: item.text.trim().slice(0, 40), kind: item.kind, text: item.text.trim() }));
                save.mutate([...list, ...fresh]);
              }}
            >
              ذخیرهٔ موارد فعلی به‌عنوان قالب
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function DailyReportPage() {
  const [params, setParams] = useSearchParams();
  const { data: access, isLoading: accessLoading } = useWorkspaceAccess();
  const meta = useDailyMeta();
  const date = params.get("date") || meta.data?.today || "";
  const user = params.get("user") || undefined;
  const day = useDay(date, user);
  const save = useSaveDay(date);
  const draft = useDraft(date);
  const previous = usePrevious(date);
  const [items, setItems] = useState<ReportItem[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [emptyDraft, setEmptyDraft] = useState("");
  const [volunteer, setVolunteer] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [query, setQuery] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const history = useDayHistory(date, user, showHistory);
  const options = useWorkOptions(query, Boolean(day.data?.can.edit));
  const revision = day.data?.report?.revision ?? 0;

  useEffect(() => {
    setItems(day.data?.report?.items ?? []);
    setErrors([]);
    // Reset local lines when the day, person or saved revision changes (not on every refetch).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, user, revision, day.data?.report?.id]);
  useEffect(() => {
    setSuggestions(null);
    setEmptyDraft("");
    setVolunteer(false);
  }, [date, user]);

  const pending = useMemo(() => pendingSuggestions(suggestions ?? [], items), [suggestions, items]);
  if (accessLoading || meta.isLoading) return <Skeleton rows={6} />;
  if (!access?.can("DailyReport.Submit") && !access?.can("DailyReport.Team.View")) return <Navigate to="/" replace />;
  if (day.isError)
    return (
      <EmptyState title="گزارش در دسترس نیست" description={errorMessage(day.error, "این گزارش پیدا نشد یا اجازهٔ دیدن آن را ندارید.")} />
    );
  if (!day.data) return <Skeleton rows={6} />;
  const data = day.data;
  const editable = data.can.edit;
  const hideForm = data.requirement === "not_required" && !data.report && !volunteer;
  const badge = dayBadge(data);
  const go = (next: string) => {
    const copy = new URLSearchParams(params);
    copy.set("date", next);
    setParams(copy);
  };
  const submit = (final: boolean) => {
    const problems = itemErrors(items, final);
    setErrors(problems);
    if (problems.length) return;
    save.mutate(savePayload(items, data, final));
  };
  const addEvent = (event: DayEvent) =>
    setItems((rows) => [...rows, { ...emptyItem("done", `شرکت در ${event.kind_label} «${event.title}»`), source_kind: "event", source_id: event.id }]);

  return (
    <div className="dr-page" dir="rtl">
      <PageHeader
        eyebrow="گزارش روزانه"
        title={data.is_mine ? "گزارش کار روزانهٔ من" : `گزارش روزانهٔ ${data.person.name}`}
        description="کارهای انجام‌شده، در حال انجام، مانع‌ها و گام بعدی را سریع ثبت کنید. مرخصی و برنامهٔ تقویم خودکار نمایش داده می‌شود."
        actions={
          <div className="dr-header-actions">
            {meta.data?.can.team && (
              <Link className="button button-secondary" to="/daily-report/team">
                <Users size={16} /> گزارش تیم
              </Link>
            )}
            <Link className="button button-ghost" to="/daily-report/settings">
              <BellRing size={16} /> یادآوری
            </Link>
          </div>
        }
      />
      <div className="dr-daybar">
        <button type="button" className="icon-button" aria-label="روز قبل" onClick={() => go(shiftDate(date, -1))}>
          <ChevronRight size={18} />
        </button>
        <div className="dr-date">
          <PersianDateInput id="daily-report-date" label="روز گزارش" value={date} onChange={(value) => value && go(value)} />
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="روز بعد"
          disabled={date >= data.today}
          onClick={() => go(shiftDate(date, 1))}
        >
          <ChevronLeft size={18} />
        </button>
        <span className="dr-weekday">
          {data.weekday} {data.date_text}
        </span>
        <Pill tone={badge.tone}>{badge.label}</Pill>
        {data.report?.is_late && data.report.status === "submitted" && <Pill tone="warning">دیرهنگام</Pill>}
      </div>
      <LeaveBanner leaves={data.leaves} />
      <LockNotice day={data} />
      {data.requirement === "off" && !data.report && <p className="dr-notice">{data.requirement_text}</p>}
      {data.requirement === "future" && <p className="dr-notice">{data.requirement_text}</p>}
      <div className="dr-layout">
        <div className="dr-main">
          {hideForm ? (
            <FullLeaveNotice onVolunteer={() => setVolunteer(true)} volunteering={volunteer} />
          ) : (
            <>
              {editable && (
                <div className="dr-toolbar">
                  <Button
                    variant="secondary"
                    icon={Sparkles}
                    disabled={draft.isPending}
                    onClick={() =>
                      draft.mutate(undefined, {
                        onSuccess: (result) => {
                          setSuggestions(result.suggestions);
                          setEmptyDraft(result.empty ?? "");
                        },
                      })
                    }
                  >
                    ساخت پیش‌نویس از فعالیت‌های امروز
                  </Button>
                  <Button
                    variant="secondary"
                    icon={Copy}
                    disabled={previous.isPending}
                    onClick={() =>
                      previous.mutate(undefined, {
                        onSuccess: (result) =>
                          result.previous
                            ? setItems((rows) => [...rows, ...itemsFromPrevious(result.previous!.items)])
                            : setErrors(["گزارش ثبت‌شدهٔ قبلی پیدا نشد."]),
                      })
                    }
                  >
                    کپی از گزارش قبلی
                  </Button>
                  <TemplatesMenu items={items} onUse={(row) => setItems((rows) => [...rows, row])} />
                </div>
              )}
              {suggestions && (
                <section className="dr-suggestions" aria-label="پیشنهادهای پیش‌نویس">
                  <header>
                    <h3>پیشنهاد از فعالیت‌های ثبت‌شدهٔ همین روز</h3>
                    <small>هر پیشنهاد فقط پس از «نگه‌دار» و ذخیرهٔ گزارش ثبت می‌شود.</small>
                  </header>
                  {emptyDraft && !pending.length && <p className="dr-muted">{emptyDraft}</p>}
                  {!emptyDraft && !pending.length && <p className="dr-muted">همهٔ پیشنهادها بررسی شد.</p>}
                  {pending.map((suggestion) => (
                    <SuggestionCard
                      key={suggestion.key}
                      suggestion={suggestion}
                      onKeep={(text) => setItems((rows) => [...rows, itemFromSuggestion(suggestion, text)])}
                      onDrop={() => setSuggestions((rows) => (rows ?? []).filter((row) => row.key !== suggestion.key))}
                    />
                  ))}
                </section>
              )}
              <div className="dr-sections">
                {KINDS.map((kind) => (
                  <ItemSection
                    key={kind.code}
                    kind={kind.code}
                    items={itemsOf(items, kind.code)}
                    disabled={!editable}
                    options={options.data}
                    onSearch={setQuery}
                    onChange={(next) => setItems((rows) => [...rows.filter((row) => row.kind !== kind.code), ...next])}
                  />
                ))}
              </div>
              {errors.length > 0 && (
                <ul className="dr-errors" role="alert">
                  {errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              )}
              {editable && (
                <div className="dr-actions">
                  <Button onClick={() => submit(true)} disabled={save.isPending}>
                    {data.report?.status === "submitted" ? "ثبت اصلاح" : "ثبت گزارش"}
                  </Button>
                  {data.report?.status !== "submitted" && (
                    <Button variant="secondary" onClick={() => submit(false)} disabled={save.isPending}>
                      ذخیرهٔ پیش‌نویس
                    </Button>
                  )}
                  <small className="dr-muted">
                    مهلت ثبت بدون «دیرهنگام»: {data.deadline_text} · امکان اصلاح تا پایان {data.editable_until_text}
                  </small>
                </div>
              )}
            </>
          )}
          {data.report && (
            <section className="dr-history-box">
              <button type="button" className="dr-link-button" onClick={() => setShowHistory(!showHistory)} aria-expanded={showHistory}>
                <History size={15} aria-hidden="true" /> سابقهٔ اصلاح
              </button>
              {showHistory && (history.data ? <HistoryList events={history.data.events} /> : <Skeleton rows={2} />)}
            </section>
          )}
        </div>
        <DayContext day={data} canSuggest={editable && !hideForm} onAddEvent={addEvent} />
      </div>
    </div>
  );
}
