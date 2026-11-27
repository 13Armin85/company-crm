import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser, useMembers, useWorkspaceAccess } from "../api";
import { useTicketTypes } from "../api/ticket";
import { api, errorMessage, toastError, toastSuccess, useSlug } from "../api/client";
import { Button, PageHeader, Skeleton } from "../components";
import { draftError, draftPayload, editDraft, newDraft } from "./model";
import type { ActivityDraft, SupportActivity } from "./model";
import "../../../styles/support-activity.css";

interface ActivityPage {
  results: SupportActivity[];
  total: number;
  page: number;
  page_size: number;
}

interface ActivitySummary {
  groups: {
    customer: { id: string; title: string };
    supporter: { id: string; name: string };
    kind: string;
    kind_label: string;
    duration_minutes: number;
    activity_count: number;
    resolved_ticket_count: number;
    drilldown: string;
  }[];
  duration_minutes: number;
  resolved_ticket_count: number;
}

interface RecordOption {
  id: string;
  title: string;
}

const minutes = (value: number) => `${value.toLocaleString("fa-IR")} دقیقه`;
const moment = (value: string) => new Date(value).toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short" });

function ActivityForm({
  draft,
  setDraft,
  onSubmit,
  pending,
}: {
  draft: ActivityDraft;
  setDraft: (draft: ActivityDraft | undefined) => void;
  onSubmit: (draft: ActivityDraft) => void;
  pending: boolean;
}) {
  const slug = useSlug();
  const [customerSearch, setCustomerSearch] = useState("");
  const [issueSearch, setIssueSearch] = useState("");
  const [error, setError] = useState("");
  const customers = useQuery({
    queryKey: ["support-activity-customers", slug, customerSearch],
    queryFn: async () =>
      (
        await api.get<{ results: RecordOption[] }>(`/api/workspaces/${slug}/engine/entities/customer/records/`, {
          params: { search: customerSearch, page_size: 50 },
        })
      ).data.results,
    enabled: Boolean(slug),
  });
  const issues = useQuery({
    queryKey: ["support-activity-tickets", slug, issueSearch],
    queryFn: async () =>
      (
        await api.get<{ results: RecordOption[] }>(`/api/workspaces/${slug}/engine/entities/ticket/records/`, {
          params: { search: issueSearch, page_size: 50 },
        })
      ).data.results,
    enabled: Boolean(slug),
  });
  const change = (patch: Partial<ActivityDraft>) => setDraft({ ...draft, ...patch, confirmed: false });
  const customerOptions = [...(customers.data ?? [])];
  if (draft.customerId && !customerOptions.some((row) => row.id === draft.customerId))
    customerOptions.unshift({ id: draft.customerId, title: draft.customerTitle || "مشتری انتخاب‌شده" });
  const issueOptions = [...(issues.data ?? [])];
  if (draft.issueId && !issueOptions.some((row) => row.id === draft.issueId))
    issueOptions.unshift({ id: draft.issueId, title: draft.issueTitle || "تیکت انتخاب‌شده" });

  return (
    <form
      className="support-activity-form"
      onSubmit={(event) => {
        event.preventDefault();
        const problem = draftError(draft);
        if (problem) {
          setError(problem);
          return;
        }
        setError("");
        onSubmit(draft);
      }}
    >
      <h2>{draft.id ? "اصلاح فعالیت" : "ثبت فعالیت پشتیبانی"}</h2>
      <p>زمان واقعی را وارد کنید. مدت از ساعت شروع و پایان محاسبه می‌شود.</p>
      <div className="support-activity-form-grid">
        <label>
          جست‌وجوی مشتری
          <input
            value={customerSearch}
            onChange={(event) => setCustomerSearch(event.target.value)}
            placeholder="نام مشتری"
          />
        </label>
        <label>
          مشتری
          <select
            value={draft.customerId}
            onChange={(event) => {
              const selected = customerOptions.find((row) => row.id === event.target.value);
              change({
                customerId: event.target.value,
                customerTitle: selected?.title ?? "",
                issueId: "",
                issueTitle: "",
              });
            }}
            required
          >
            <option value="">انتخاب کنید</option>
            {customerOptions.map((row) => (
              <option key={row.id} value={row.id}>
                {row.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          جست‌وجوی تیکت مرتبط
          <input
            value={issueSearch}
            onChange={(event) => setIssueSearch(event.target.value)}
            placeholder="عنوان تیکت"
          />
        </label>
        <label>
          تیکت مرتبط
          <select
            value={draft.issueId}
            onChange={(event) => {
              const selected = issueOptions.find((row) => row.id === event.target.value);
              change({ issueId: event.target.value, issueTitle: selected?.title ?? "" });
            }}
          >
            <option value="">بدون تیکت</option>
            {issueOptions.map((row) => (
              <option key={row.id} value={row.id}>
                {row.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          نوع فعالیت
          <select
            value={draft.kind}
            onChange={(event) => change({ kind: event.target.value as ActivityDraft["kind"] })}
          >
            <option value="support">پشتیبانی/رسیدگی</option>
            <option value="phone">تماس تلفنی</option>
          </select>
        </label>
        <label>
          شروع
          <input
            type="datetime-local"
            value={draft.startsAt}
            onChange={(event) => change({ startsAt: event.target.value })}
            required
          />
        </label>
        <label>
          پایان
          <input
            type="datetime-local"
            value={draft.endsAt}
            onChange={(event) => change({ endsAt: event.target.value })}
            required
          />
        </label>
        <label className="support-activity-wide">
          خلاصهٔ اقدام
          <textarea
            value={draft.summary}
            onChange={(event) => change({ summary: event.target.value })}
            rows={3}
            maxLength={2000}
          />
        </label>
        {draft.id && (
          <label className="support-activity-wide">
            دلیل اصلاح
            <input value={draft.reason} onChange={(event) => change({ reason: event.target.value })} required />
          </label>
        )}
      </div>
      {draft.startsAt && draft.endsAt && new Date(draft.endsAt) > new Date(draft.startsAt) && (
        <p>
          مدت: {minutes(Math.floor((new Date(draft.endsAt).getTime() - new Date(draft.startsAt).getTime()) / 60000))}
        </p>
      )}
      <label className="support-activity-confirm">
        <input
          type="checkbox"
          checked={draft.confirmed}
          onChange={(event) => setDraft({ ...draft, confirmed: event.target.checked })}
        />
        زمان شروع و پایان واقعی را بررسی کردم و ثبت فعالیت را تأیید می‌کنم.
      </label>
      {error && (
        <p className="support-activity-error" role="alert">
          {error}
        </p>
      )}
      {(customers.error || issues.error) && (
        <p className="support-activity-error">
          {errorMessage(customers.error || issues.error, "دریافت گزینه‌ها انجام نشد")}
        </p>
      )}
      <div className="support-activity-actions">
        <Button type="submit" disabled={pending}>
          {pending ? "در حال ثبت…" : draft.id ? "تأیید و ثبت اصلاح" : "تأیید و ثبت فعالیت"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setDraft(undefined)}>
          انصراف
        </Button>
      </div>
    </form>
  );
}

export default function SupportActivitiesPage() {
  const slug = useSlug();
  const { data: access, isLoading: accessLoading } = useWorkspaceAccess();
  const { data: currentUser } = useCurrentUser();
  const { data: ticketTypes } = useTicketTypes();
  const { data: members } = useMembers(
    undefined,
    undefined,
    Boolean(access?.can("Report.Team.View") || access?.can("Report.ViewAll"))
  );
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState<ActivityDraft>();
  const [report, setReport] = useState(false);
  const client = useQueryClient();
  const filters = params.toString();
  const base = `/api/workspaces/${slug}/support-activities/`;
  const list = useQuery({
    queryKey: ["support-activities", slug, filters],
    queryFn: async () => (await api.get<ActivityPage>(`${base}?${filters}`)).data,
    enabled: Boolean(slug),
  });
  const summary = useQuery({
    queryKey: ["support-activity-summary", slug, filters],
    queryFn: async () => (await api.get<ActivitySummary>(`${base}summary/?${filters}`)).data,
    enabled: Boolean(slug) && report,
  });
  const save = useMutation({
    mutationFn: async (values: ActivityDraft) =>
      (
        await (values.id
          ? api.put<SupportActivity>(`${base}${values.id}/`, draftPayload(values))
          : api.post<SupportActivity>(base, draftPayload(values)))
      ).data,
    onSuccess: async () => {
      setDraft(undefined);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["support-activities", slug] }),
        client.invalidateQueries({ queryKey: ["support-activity-summary", slug] }),
        client.invalidateQueries({ queryKey: ["daily-draft", slug] }),
      ]);
      toastSuccess("فعالیت تأیید و ثبت شد.");
    },
    onError: (error) => toastError(error, "ثبت فعالیت انجام نشد"),
  });
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next);
  };

  if (accessLoading) return <Skeleton rows={4} />;
  return (
    <div className="support-activity-page">
      <PageHeader
        eyebrow="گزارش‌ها"
        title="فعالیت و زمان پشتیبانی"
        description="مدت تماس و رسیدگی از بازهٔ تأییدشده محاسبه می‌شود؛ این داده حضور و غیاب یا صورتحساب نیست."
        actions={
          <Button
            onClick={() => setDraft({ ...newDraft(), issueId: params.get("issue") ?? "" })}
            disabled={!access?.can("Issue.Edit")}
          >
            ثبت فعالیت
          </Button>
        }
      />
      <div className="support-activity-actions">
        <Button variant={report ? "secondary" : "primary"} onClick={() => setReport(false)}>
          فعالیت‌ها
        </Button>
        <Button variant={report ? "primary" : "secondary"} onClick={() => setReport(true)}>
          خلاصهٔ زمان
        </Button>
        <Link className="button button-secondary" to="/daily-report">
          گزارش روزانهٔ من
        </Link>
      </div>
      {draft && (
        <ActivityForm
          draft={draft}
          setDraft={setDraft}
          onSubmit={(values) => save.mutate(values)}
          pending={save.isPending}
        />
      )}
      <div className="support-activity-filters">
        <label>
          از تاریخ{" "}
          <input
            type="date"
            value={params.get("date_from") ?? ""}
            onChange={(event) => setFilter("date_from", event.target.value)}
          />
        </label>
        <label>
          تا تاریخ{" "}
          <input
            type="date"
            value={params.get("date_to") ?? ""}
            onChange={(event) => setFilter("date_to", event.target.value)}
          />
        </label>
        <label>
          نوع{" "}
          <select value={params.get("kind") ?? ""} onChange={(event) => setFilter("kind", event.target.value)}>
            <option value="">همه</option>
            <option value="support">پشتیبانی</option>
            <option value="phone">تماس تلفنی</option>
          </select>
        </label>
        <label>
          نتیجهٔ تیکت{" "}
          <select value={params.get("result") ?? ""} onChange={(event) => setFilter("result", event.target.value)}>
            <option value="">همه</option>
            <option value="started">در حال انجام</option>
            <option value="completed">انجام‌شده</option>
            <option value="cancelled">لغوشده</option>
          </select>
        </label>
        <label>
          نوع تیکت{" "}
          <select
            value={params.get("ticket_type") ?? ""}
            onChange={(event) => setFilter("ticket_type", event.target.value)}
          >
            <option value="">همه</option>
            {ticketTypes?.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </label>
        {(access?.can("Report.Team.View") || access?.can("Report.ViewAll")) && (
          <label>
            پشتیبان{" "}
            <select
              value={params.get("supporter") ?? ""}
              onChange={(event) => setFilter("supporter", event.target.value)}
            >
              <option value="">همهٔ افراد مجاز</option>
              {members?.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName || member.email}
                </option>
              ))}
            </select>
          </label>
        )}
        {(params.has("customer") || params.has("supporter") || params.has("issue")) && (
          <Button variant="secondary" onClick={() => setParams(new URLSearchParams())}>
            پاک‌کردن فیلترهای منبع
          </Button>
        )}
      </div>
      {report ? (
        <section className="support-activity-list" aria-label="خلاصهٔ زمان">
          <h2>خلاصهٔ زمان تأییدشده: {minutes(summary.data?.duration_minutes ?? 0)}</h2>
          <p>تیکت‌های حل‌شده با پشتیبانی: {(summary.data?.resolved_ticket_count ?? 0).toLocaleString("fa-IR")}</p>
          {summary.isLoading && <Skeleton rows={4} />}
          {summary.error && <p role="alert">{errorMessage(summary.error, "دریافت خلاصهٔ زمان انجام نشد")}</p>}
          {summary.data?.groups.map((group) => (
            <article key={`${group.customer.id}:${group.supporter.id}:${group.kind}`} className="support-activity-row">
              <div>
                <b>{group.customer.title}</b>
                <span>
                  {group.supporter.name} · {group.kind_label}
                </span>
              </div>
              <div>
                <strong>{minutes(group.duration_minutes)}</strong>
                <span>{group.activity_count.toLocaleString("fa-IR")} فعالیت</span>
                {group.resolved_ticket_count > 0 && (
                  <span>{group.resolved_ticket_count.toLocaleString("fa-IR")} تیکت حل‌شده با پشتیبانی</span>
                )}
              </div>
              <Link to={group.drilldown} onClick={() => setReport(false)}>
                دیدن فعالیت‌های منبع
              </Link>
            </article>
          ))}
          {summary.data?.groups.length === 0 && <p>در این بازه فعالیت تأییدشده‌ای ثبت نشده است.</p>}
        </section>
      ) : (
        <section className="support-activity-list" aria-label="فعالیت‌های پشتیبانی">
          {list.isLoading && <Skeleton rows={5} />}
          {list.error && <p role="alert">{errorMessage(list.error, "دریافت فعالیت‌ها انجام نشد")}</p>}
          {list.data?.results.map((row) => (
            <article key={row.id} className="support-activity-row">
              <div>
                <b>{row.customer.title}</b>
                <span>
                  {row.supporter.name} · {row.kind_label}
                </span>
                <span>{row.summary}</span>
              </div>
              <div>
                <strong>{minutes(row.duration_minutes)}</strong>
                <span>
                  {moment(row.starts_at)} تا {moment(row.ends_at)}
                </span>
              </div>
              <div className="support-activity-row-actions">
                <Link to={row.issue ? `/edit/ticket/${row.issue.id}` : `/entities/customer/${row.customer.id}`}>
                  {row.issue ? "دیدن تیکت" : "دیدن مشتری"}
                </Link>
                {row.supporter.id === currentUser?.id && access?.can("Issue.Edit") && (
                  <Button variant="secondary" onClick={() => setDraft(editDraft(row))}>
                    اصلاح
                  </Button>
                )}
              </div>
            </article>
          ))}
          {list.data?.results.length === 0 && <p>فعالیتی در این بازه ثبت نشده است.</p>}
          {list.data && list.data.total > list.data.page_size && (
            <div className="support-activity-actions">
              <Button
                variant="secondary"
                disabled={list.data.page <= 1}
                onClick={() => setFilter("page", String(list.data!.page - 1))}
              >
                صفحهٔ قبل
              </Button>
              <span>
                صفحهٔ {list.data.page.toLocaleString("fa-IR")} از{" "}
                {Math.ceil(list.data.total / list.data.page_size).toLocaleString("fa-IR")}
              </span>
              <Button
                variant="secondary"
                disabled={list.data.page * list.data.page_size >= list.data.total}
                onClick={() => setFilter("page", String(list.data!.page + 1))}
              >
                صفحهٔ بعد
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
