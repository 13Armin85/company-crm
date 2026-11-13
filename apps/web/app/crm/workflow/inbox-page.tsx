/** «موارد منتظر اقدام من»: steps I am responsible for and extension requests I must decide. */
import { Link } from "react-router";
import { useWorkflowInbox, useWorkflowInstances } from "../api/workflow";
import type { InboxItem } from "../api/workflow";
import { useWorkspaceAccess } from "../api";
import { EmptyState, PageHeader, Skeleton } from "../components";
import { DeadlineBadges } from "./panel";
import { formatWorkingMinutes } from "./model";
import { TicketExtensionInbox } from "../ticket/extension-inbox";
import { recordHref } from "../leave/model";

function Row({ item, extra }: { item: InboxItem; extra?: string }) {
  return (
    <li className="workflow-inbox-row">
      <Link to={recordHref(item.entity, item.record_id)}>
        <strong>{item.record_title}</strong>
        <small>
          {item.entity_title} · {item.step_title}
        </small>
      </Link>
      <span>
        {item.target_text || "بدون مهلت"}
        {item.remaining_minutes !== null && !item.overdue && ` · ${formatWorkingMinutes(item.remaining_minutes)} مانده`}
      </span>
      <DeadlineBadges
        run={
          item.target_at
            ? {
                id: item.instance_id,
                step: "",
                title: item.step_title,
                assignee: null,
                candidates: [],
                assignment_reason: "",
                entered_at: "",
                target_at: item.target_at,
                target_text: item.target_text,
                paused: false,
                pause_kind: "",
                near_due: item.near_due,
                overdue: item.overdue,
                remaining_minutes: item.remaining_minutes,
                has_delay_report: false,
              }
            : null
        }
      />
      {extra && <p className="workflow-muted">{extra}</p>}
    </li>
  );
}

export function WorkflowInboxList({
  steps,
  extensions,
}: {
  steps: InboxItem[];
  extensions: (InboxItem & { requested_target_text: string; reason: string; requested_by: { name: string } | null })[];
}) {
  return (
    <div className="workflow-inbox" dir="rtl">
      <section aria-label="مرحله‌هایی که مسئول آن‌ها هستم">
        <h2>مرحله‌هایی که مسئول آن‌ها هستم</h2>
        {steps.length ? (
          <ul>
            {steps.map((item) => (
              <Row key={item.instance_id} item={item} />
            ))}
          </ul>
        ) : (
          <EmptyState title="موردی منتظر شما نیست" description="مرحله‌ای از گردش‌کارها به شما سپرده نشده است." />
        )}
      </section>
      <section aria-label="درخواست‌های تمدید برای تأیید">
        <h2>درخواست‌های تمدید برای تأیید</h2>
        {extensions.length ? (
          <ul>
            {extensions.map((item) => (
              <Row
                key={`${item.instance_id}-ext`}
                item={item}
                extra={`${item.requested_by?.name || ""}: تمدید تا ${item.requested_target_text} — ${item.reason}`}
              />
            ))}
          </ul>
        ) : (
          <p className="workflow-muted">درخواست تمدیدی منتظر تأیید شما نیست.</p>
        )}
      </section>
    </div>
  );
}

function ErrorInstances() {
  const rows = useWorkflowInstances("error");
  if (!rows.data?.length) return null;
  return (
    <section className="workflow-inbox" aria-label="فرایندهای دارای خطا" dir="rtl">
      <h2>فرایندهای دارای خطا</h2>
      <ul>
        {rows.data.map((row) => (
          <li key={row.id} className="workflow-inbox-row">
            <Link to={recordHref(row.entity, row.record_id)}>
              <strong>{row.record_title}</strong>
              <small>
                {row.definition} · {row.current_step}
              </small>
            </Link>
            <p className="workflow-error-text">{row.error_message}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function WorkflowInboxPage() {
  const inbox = useWorkflowInbox();
  const { data: access } = useWorkspaceAccess();
  return (
    <div className="workflow-inbox-page">
      <PageHeader
        eyebrow="گردش‌کار"
        title="موارد منتظر اقدام من"
        description="مرحله‌هایی که مسئول آن‌ها هستید و درخواست‌های تمدیدی که باید بررسی کنید."
      />
      {inbox.isLoading ? (
        <Skeleton rows={5} />
      ) : (
        <WorkflowInboxList steps={inbox.data?.steps || []} extensions={inbox.data?.extensions || []} />
      )}
      <TicketExtensionInbox />
      {access?.can("Workflow.ViewAll") && <ErrorInstances />}
    </div>
  );
}
