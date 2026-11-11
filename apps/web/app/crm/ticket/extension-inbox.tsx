/** Ticket-level extension requests waiting for my decision (same "waiting for me" inbox as ticket 4). */
import { useState } from "react";
import { Link } from "react-router";
import { useDecideTicketExtension, useTicketExtensionInbox } from "../api/ticket";
import type { InboxExtension } from "../api/ticket";
import { Button, Skeleton } from "../components";
import { formatWorkingMinutes } from "../workflow/model";
import { faDigits } from "./model";

function Row({ row }: { row: InboxExtension }) {
  const decide = useDecideTicketExtension(row.issue_id);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <li className="ticket-inbox-row">
      <div>
        <Link to={`/entities/ticket/${row.issue_id}`}>{row.issue_name}</Link>
        <small>
          {row.requested_by} · {formatWorkingMinutes(row.minutes)} · {row.reason}
        </small>
        <span>
          موعد فعلی {row.previous_target_text} ← پیشنهادی {row.requested_target_text}
        </span>
        {row.history.length > 0 && <small>تمدیدهای قبلی: {faDigits(row.history.length)}</small>}
      </div>
      {rejecting ? (
        <form
          className="ticket-actions"
          onSubmit={(event) => {
            event.preventDefault();
            if (reason.trim()) decide.mutate({ extensionId: row.id, approve: false, reason });
          }}
        >
          <input
            aria-label="دلیل رد"
            placeholder="دلیل رد (اجباری)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <Button type="submit" variant="danger" disabled={!reason.trim() || decide.isPending}>
            ثبت رد
          </Button>
          <Button variant="secondary" onClick={() => setRejecting(false)}>
            انصراف
          </Button>
        </form>
      ) : (
        <div className="ticket-actions">
          <Button disabled={decide.isPending} onClick={() => decide.mutate({ extensionId: row.id, approve: true })}>
            تأیید
          </Button>
          <Button variant="danger" onClick={() => setRejecting(true)}>
            رد
          </Button>
        </div>
      )}
    </li>
  );
}

export function TicketExtensionInbox() {
  const inbox = useTicketExtensionInbox();
  if (inbox.isLoading) return <Skeleton rows={2} />;
  if (!inbox.data?.length) return null;
  return (
    <section className="workflow-inbox" aria-labelledby="ticket-extension-inbox">
      <h2 id="ticket-extension-inbox">درخواست‌های تمدید موعد تیکت</h2>
      <ul className="ticket-list">
        {inbox.data.map((row) => (
          <Row key={row.id} row={row} />
        ))}
      </ul>
    </section>
  );
}
