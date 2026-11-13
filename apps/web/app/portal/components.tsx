/** Presentational pieces of the customer portal. All text from the server is rendered as text. */
import { useId, useState } from "react";
import type { ReactNode } from "react";
import { Paperclip, Star, X } from "lucide-react";
import { toFa } from "../crm/utils";
import { fileHref } from "./api/client";
import type { PortalFeedback, PortalMessage, PortalQuote, PortalStatus } from "./api/portal";
import {
  CONFIRM_TEXT,
  RATING_LABELS,
  acceptAttribute,
  fileErrors,
  formatRial,
  formatSize,
  portalDate,
  quoteActions,
  quoteDecisionErrors,
  statusTone,
} from "./model";
import type { FileRules, QuoteAction } from "./model";

export function StatusPill({ status }: { status: PortalStatus }) {
  return <span className={`portal-status is-${statusTone(status.code)}`}>{status.title}</span>;
}

export function ErrorList({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="portal-errors" role="alert">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export function FilePicker({
  files,
  onChange,
  rules,
  disabled,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  rules?: FileRules;
  disabled?: boolean;
}) {
  const id = useId();
  const problems = fileErrors(files, rules);
  return (
    <div className="portal-files">
      <label htmlFor={id} className={`portal-attach ${disabled ? "is-disabled" : ""}`}>
        <Paperclip size={16} aria-hidden /> پیوست فایل
      </label>
      <input
        id={id}
        type="file"
        multiple
        hidden
        disabled={disabled}
        accept={acceptAttribute(rules)}
        onChange={(event) => {
          onChange([...files, ...Array.from(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />
      {files.length > 0 && (
        <ul className="portal-file-list">
          {files.map((file, index) => (
            <li key={`${file.name}-${file.size}-${file.lastModified}`}>
              <span>{file.name}</span>
              <small>{formatSize(file.size)}</small>
              <button
                type="button"
                className="portal-icon-button"
                aria-label={`حذف ${file.name}`}
                onClick={() => onChange(files.filter((_, i) => i !== index))}
              >
                <X size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <ErrorList items={problems} />
    </div>
  );
}

const KIND_LABELS: Record<string, string> = {
  rejection: "دلیل رد",
  info_request: "درخواست تکمیل اطلاعات",
  approval: "پذیرش درخواست",
  contact: "خلاصهٔ تماس",
};

export function MessageThread({ messages }: { messages: PortalMessage[] }) {
  if (!messages.length) return <p className="portal-muted">هنوز پیامی ثبت نشده است.</p>;
  return (
    <ol className="portal-thread" aria-label="پیام‌های درخواست">
      {messages.map((message) => (
        <li key={message.id} className={`portal-message is-${message.author.kind}`}>
          <header>
            <strong>{message.author.kind === "customer" ? `${message.author.name} (شما)` : message.author.name}</strong>
            {KIND_LABELS[message.kind] && <span className="portal-kind">{KIND_LABELS[message.kind]}</span>}
            <time dateTime={message.created_at ?? undefined}>{portalDate(message.created_at)}</time>
          </header>
          <p className="portal-text">{message.text}</p>
          {message.files.length > 0 && (
            <ul className="portal-file-list">
              {message.files.map((file) => (
                <li key={file.id}>
                  <a href={fileHref(file.url)} rel="noopener">
                    <Paperclip size={14} aria-hidden /> {file.name}
                  </a>
                  <small>{formatSize(file.size)}</small>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

export function QuoteCard({
  quote,
  pending,
  onDecide,
}: {
  quote: PortalQuote;
  pending?: boolean;
  onDecide: (action: QuoteAction, comment: string) => void;
}) {
  const [action, setAction] = useState<QuoteAction | null>(null);
  const [comment, setComment] = useState("");
  const [confirming, setConfirming] = useState(false);
  const errors = action ? quoteDecisionErrors(action, comment) : [];
  const actions = quoteActions(quote);
  return (
    <article className="portal-quote" aria-label={`برآورد نسخهٔ ${toFa(quote.version)}`}>
      <header>
        <div>
          <span className="portal-muted">برآورد هزینه · نسخهٔ {toFa(quote.version)}</span>
          <strong className="portal-amount">{formatRial(quote.amount)}</strong>
        </div>
        <span
          className={`portal-status is-${quote.status.code === "approved" ? "success" : quote.status.code === "rejected" ? "danger" : quote.status.code === "revision_requested" ? "warning" : "info"}`}
        >
          {quote.status.title}
        </span>
      </header>
      <p className="portal-text">{quote.items}</p>
      <p className="portal-muted">اعتبار تا {portalDate(quote.valid_until, false)}</p>
      {quote.decided_at && (
        <p className="portal-muted">
          تصمیم شما در {portalDate(quote.decided_at)}
          {quote.decision_comment ? ` — «${quote.decision_comment}»` : ""}
        </p>
      )}
      {quote.status.code === "sent" && !quote.can_decide && (
        <p className="portal-muted">مهلت اعتبار این برآورد گذشته است؛ نسخهٔ جدید را از تیم پشتیبانی بخواهید.</p>
      )}
      {actions.length > 0 && !action && (
        <div className="portal-actions">
          {actions.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`portal-button ${item.id === "approved" ? "is-primary" : item.id === "rejected" ? "is-danger" : ""}`}
              onClick={() => {
                setAction(item.id);
                setConfirming(false);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      {action && actions.length > 0 && (
        <form
          className="portal-decision"
          onSubmit={(event) => {
            event.preventDefault();
            if (errors.length) return;
            if (CONFIRM_TEXT[action] && !confirming) {
              setConfirming(true);
              return;
            }
            onDecide(action, comment);
          }}
        >
          <label>
            <span>{action === "revision_requested" ? "چه چیزی باید اصلاح شود؟" : "توضیح (اختیاری)"}</span>
            <textarea value={comment} maxLength={1000} onChange={(event) => setComment(event.target.value)} />
          </label>
          <ErrorList items={comment || action === "revision_requested" ? errors : []} />
          {confirming && (
            <p className="portal-confirm" role="alert">
              {CONFIRM_TEXT[action]}
            </p>
          )}
          <div className="portal-actions">
            <button type="submit" className="portal-button is-primary" disabled={pending}>
              {confirming ? "بله، ثبت قطعی" : action === "revision_requested" ? "ارسال درخواست اصلاح" : "ادامه"}
            </button>
            <button type="button" className="portal-button" onClick={() => setAction(null)} disabled={pending}>
              انصراف
            </button>
          </div>
        </form>
      )}
    </article>
  );
}

export function RatingInput({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <div className="portal-rating" role="radiogroup" aria-label="امتیاز">
      {[1, 2, 3, 4, 5].map((score) => (
        <button
          key={score}
          type="button"
          role="radio"
          aria-checked={value === score}
          aria-label={`${toFa(score)} از ۵ — ${RATING_LABELS[score]}`}
          className={`portal-star ${score <= value ? "is-on" : ""}`}
          onClick={() => onChange(score)}
        >
          <Star size={22} aria-hidden />
        </button>
      ))}
      <span className="portal-muted">{value ? RATING_LABELS[value] : "یک امتیاز انتخاب کنید"}</span>
    </div>
  );
}

export function FeedbackForm({
  feedback,
  pending,
  onSubmit,
}: {
  feedback: PortalFeedback | null;
  pending?: boolean;
  onSubmit: (rating: number, comment: string) => void;
}) {
  const [rating, setRating] = useState(feedback?.rating ?? 0);
  const [comment, setComment] = useState(feedback?.comment ?? "");
  const [tried, setTried] = useState(false);
  return (
    <form
      className="portal-feedback"
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (rating < 1) return;
        onSubmit(rating, comment);
      }}
    >
      <h3>{feedback ? "ویرایش بازخورد" : "نظر شما دربارهٔ این درخواست"}</h3>
      <RatingInput value={rating} onChange={setRating} />
      <label>
        <span>توضیح (اختیاری)</span>
        <textarea value={comment} maxLength={2000} onChange={(event) => setComment(event.target.value)} />
      </label>
      <ErrorList items={tried && rating < 1 ? ["امتیاز ۱ تا ۵ را انتخاب کنید."] : []} />
      {feedback?.editable_until && <p className="portal-muted">قابل ویرایش تا {portalDate(feedback.editable_until)}</p>}
      <button type="submit" className="portal-button is-primary" disabled={pending}>
        {feedback ? "ذخیرهٔ تغییر" : "ثبت بازخورد"}
      </button>
    </form>
  );
}

export function FeedbackSummary({ feedback }: { feedback: PortalFeedback }) {
  return (
    <section className="portal-feedback is-done" aria-label="بازخورد ثبت‌شده">
      <h3>بازخورد شما</h3>
      <p>
        {toFa(feedback.rating)} از ۵ — {RATING_LABELS[feedback.rating]}
      </p>
      {feedback.comment && <p className="portal-text">{feedback.comment}</p>}
    </section>
  );
}

export function PortalCard({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="portal-card">
      <header>
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}
