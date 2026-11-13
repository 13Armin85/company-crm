/** One request: thread, reply with files, customer status, quotes and feedback after completion. */
import { useState } from "react";
import { Link, useParams } from "react-router";
import { portalError } from "../api/client";
import { usePortalFeedback, usePortalMessage, usePortalRequest, useQuoteDecision } from "../api/portal";
import type { PortalRequestDetail } from "../api/portal";
import {
  ErrorList,
  FeedbackForm,
  FeedbackSummary,
  FilePicker,
  MessageThread,
  PortalCard,
  QuoteCard,
  StatusPill,
} from "../components";
import { feedbackMode, fileErrors, portalDate } from "../model";

export default function PortalRequest() {
  const { id = "" } = useParams();
  const request = usePortalRequest(id);
  if (request.isLoading)
    return (
      <p className="portal-muted" aria-busy="true">
        در حال بارگذاری…
      </p>
    );
  if (request.error || !request.data)
    return (
      <div className="portal-empty" role="alert">
        <p>{portalError(request.error, "این درخواست پیدا نشد.")}</p>
        <Link to="/portal" className="portal-button">
          بازگشت به درخواست‌ها
        </Link>
      </div>
    );
  return <RequestView detail={request.data} />;
}

export function RequestView({ detail }: { detail: PortalRequestDetail }) {
  const message = usePortalMessage(detail.id);
  const decide = useQuoteDecision(detail.id);
  const feedback = usePortalFeedback(detail.id);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const mode = feedbackMode(detail);
  return (
    <div className="portal-detail">
      <div className="portal-title-row">
        <div>
          <span className="portal-number">{detail.number}</span>
          <h1>{detail.subject}</h1>
          <p className="portal-muted">ثبت در {portalDate(detail.created_at)}</p>
        </div>
        <StatusPill status={detail.status} />
      </div>
      <div className="portal-detail-grid">
        <PortalCard title="گفت‌وگو">
          <MessageThread messages={detail.messages} />
          {detail.can_message ? (
            <form
              className="portal-form portal-composer"
              onSubmit={(event) => {
                event.preventDefault();
                if (!text.trim() || fileErrors(files, detail.files).length) return;
                message.mutate(
                  { text: text.trim(), files },
                  {
                    onSuccess: () => {
                      setText("");
                      setFiles([]);
                    },
                  }
                );
              }}
            >
              <label>
                <span>پیام شما</span>
                <textarea rows={4} maxLength={5000} value={text} onChange={(event) => setText(event.target.value)} />
              </label>
              <FilePicker files={files} onChange={setFiles} rules={detail.files} disabled={message.isPending} />
              <ErrorList items={message.error ? [portalError(message.error, "ارسال پیام انجام نشد.")] : []} />
              <button type="submit" className="portal-button is-primary" disabled={message.isPending || !text.trim()}>
                ارسال پیام
              </button>
            </form>
          ) : (
            <p className="portal-muted">این درخواست بسته شده است و پیام جدید نمی‌پذیرد.</p>
          )}
        </PortalCard>
        <aside className="portal-side">
          {detail.quotes.length > 0 && (
            <PortalCard title="برآورد هزینه">
              <ErrorList items={decide.error ? [portalError(decide.error, "ثبت تصمیم انجام نشد.")] : []} />
              {detail.quotes.map((quote) => (
                <QuoteCard
                  key={quote.id}
                  quote={quote}
                  pending={decide.isPending}
                  onDecide={(decision, comment) => decide.mutate({ quoteId: quote.id, decision, comment })}
                />
              ))}
            </PortalCard>
          )}
          {mode !== "hidden" && (
            <PortalCard title="بازخورد">
              {mode === "locked" && detail.feedback ? (
                <FeedbackSummary feedback={detail.feedback} />
              ) : (
                <>
                  <FeedbackForm
                    key={detail.feedback?.submitted_at ?? "new"}
                    feedback={detail.feedback}
                    pending={feedback.isPending}
                    onSubmit={(rating, comment) => feedback.mutate({ rating, comment, edit: mode === "edit" })}
                  />
                  <ErrorList items={feedback.error ? [portalError(feedback.error, "ثبت بازخورد انجام نشد.")] : []} />
                  {feedback.isSuccess && <p className="portal-notice">بازخورد شما ثبت شد؛ سپاسگزاریم.</p>}
                </>
              )}
            </PortalCard>
          )}
        </aside>
      </div>
    </div>
  );
}
