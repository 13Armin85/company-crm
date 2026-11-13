/** Ticket 7 — "مکاتبات" tab of the ticket panel: one thread on the ticket's native comments.
 * The composer defaults to an internal note; a reply to the customer is an explicit, visibly marked choice. */
import { useState } from "react";
import { Eye, EyeOff, Paperclip } from "lucide-react";
import { PersianDatePicker } from "@plane/ui";
import { errorMessage, useSlug } from "../api/client";
import {
  portalFileUrl,
  useCreateQuote,
  usePortalNote,
  usePortalTriage,
  useSendQuote,
  useTicketPortal,
  useUpdateQuote,
} from "../api/portal";
import type { InternalQuote, MessageAccess, PortalThreadMessage, TicketPortalSummary } from "../api/portal";
import { Button, Skeleton } from "../components";
import { toFa } from "../utils";
import { formatRial, portalDate } from "../../portal/model";

const origin = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/api\/v1\/?$/, "").replace(/\/$/, "");

export const DEFAULT_ACCESS: MessageAccess = "INTERNAL";

export function AccessBadge({ access }: { access: MessageAccess }) {
  return access === "EXTERNAL" ? (
    <span className="portal-access is-external">
      <Eye size={14} aria-hidden /> قابل‌مشاهده برای مشتری
    </span>
  ) : (
    <span className="portal-access is-internal">
      <EyeOff size={14} aria-hidden /> یادداشت داخلی
    </span>
  );
}

export function InternalThread({ id, messages }: { id: string; messages: PortalThreadMessage[] }) {
  const slug = useSlug();
  if (!messages.length) return <p className="ticket-muted">هنوز پیام یا یادداشتی ثبت نشده است.</p>;
  return (
    <ol className="portal-thread is-internal" aria-label="مکاتبات تیکت">
      {messages.map((message) => (
        <li
          key={message.id}
          className={`portal-message is-${message.author.kind} ${message.access === "INTERNAL" ? "is-note" : ""}`}
        >
          <header>
            <strong>{message.author.name || "سامانه"}</strong>
            <AccessBadge access={message.access} />
            <time dateTime={message.created_at ?? undefined}>{message.created_text}</time>
          </header>
          <p className="portal-text">{message.text}</p>
          {message.files.length > 0 && (
            <ul className="portal-file-list">
              {message.files.map((file) => (
                <li key={file.id}>
                  <a href={`${origin}${portalFileUrl(slug ?? "", id, file.id)}`} rel="noopener">
                    <Paperclip size={14} aria-hidden /> {file.name}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

export function Composer({ id, data }: { id: string; data: Pick<TicketPortalSummary, "can" | "is_portal"> }) {
  const note = usePortalNote(id);
  const [access, setAccess] = useState<MessageAccess>(DEFAULT_ACCESS);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  if (!data.can.note) return null;
  const external = access === "EXTERNAL";
  return (
    <form
      className={`portal-composer is-${external ? "external" : "internal"}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!text.trim()) return;
        note.mutate(
          { text: text.trim(), access, files },
          {
            onSuccess: () => {
              setText("");
              setFiles([]);
              setAccess(DEFAULT_ACCESS);
            },
          }
        );
      }}
    >
      <div className="ticket-chips" role="radiogroup" aria-label="سطح دید پیام">
        <button
          type="button"
          role="radio"
          aria-checked={!external}
          className={`ticket-chip ${!external ? "is-active" : ""}`}
          onClick={() => setAccess("INTERNAL")}
        >
          <EyeOff size={14} aria-hidden /> یادداشت داخلی
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={external}
          disabled={!data.can.reply}
          aria-describedby={data.can.reply ? undefined : "portal-reply-why"}
          className={`ticket-chip ${external ? "is-active is-external" : ""}`}
          onClick={() => setAccess("EXTERNAL")}
        >
          <Eye size={14} aria-hidden /> پاسخ به مشتری
        </button>
      </div>
      {!data.can.reply && (
        <p id="portal-reply-why" className="ticket-muted">
          {data.is_portal ? "مجوز «پاسخ به مشتری» را ندارید." : "این تیکت از درگاه مشتری ثبت نشده است."}
        </p>
      )}
      <label>
        <span>{external ? "پاسخ (مشتری این متن را می‌بیند)" : "یادداشت داخلی (مشتری نمی‌بیند)"}</span>
        <textarea rows={3} maxLength={5000} value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      <label className="portal-attach">
        <Paperclip size={14} aria-hidden /> پیوست ({toFa(files.length)})
        <input
          type="file"
          multiple
          hidden
          onChange={(event) => {
            setFiles([...files, ...Array.from(event.target.files ?? [])]);
            event.target.value = "";
          }}
        />
      </label>
      {note.error && <p className="ticket-error-text">{errorMessage(note.error, "ثبت پیام انجام نشد.")}</p>}
      <Button type="submit" disabled={note.isPending || !text.trim()}>
        {external ? "ارسال برای مشتری" : "ثبت یادداشت داخلی"}
      </Button>
    </form>
  );
}

export function TriageBar({ id, data }: { id: string; data: TicketPortalSummary }) {
  const triage = usePortalTriage(id);
  const [mode, setMode] = useState<"reject" | "need_info" | null>(null);
  const [message, setMessage] = useState("");
  if (!data.can.triage) return null;
  return (
    <section className="portal-triage" aria-label="تریاژ درخواست درگاه">
      <p>
        <strong>درخواست درگاه — {data.stage_title}</strong>
      </p>
      {!mode ? (
        <div className="ticket-chips">
          <Button disabled={triage.isPending} onClick={() => triage.mutate({ action: "approve" })}>
            تأیید و ورود به جریان کار
          </Button>
          <Button variant="secondary" onClick={() => setMode("need_info")}>
            درخواست تکمیل اطلاعات
          </Button>
          <Button variant="secondary" onClick={() => setMode("reject")}>
            رد درخواست
          </Button>
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!message.trim()) return;
            triage.mutate({ action: mode, message: message.trim() }, { onSuccess: () => setMode(null) });
          }}
        >
          <label>
            <span>{mode === "reject" ? "دلیل رد (برای مشتری نمایش داده می‌شود)" : "پرسش از مشتری"}</span>
            <textarea rows={3} value={message} onChange={(event) => setMessage(event.target.value)} />
          </label>
          <div className="ticket-chips">
            <Button type="submit" disabled={triage.isPending || !message.trim()}>
              ثبت
            </Button>
            <Button variant="secondary" onClick={() => setMode(null)}>
              انصراف
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

const tomorrow = () => new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);

export function QuoteEditor({
  id,
  quote,
  base,
  onDone,
}: {
  id: string;
  /** The draft being edited; absent for a new version. */
  quote?: InternalQuote;
  /** A new version starts from the latest one (revision request), with a fresh validity date. */
  base?: InternalQuote;
  onDone: () => void;
}) {
  const create = useCreateQuote(id);
  const update = useUpdateQuote(id);
  const source = quote ?? base;
  const [amount, setAmount] = useState(source?.amount ?? "");
  const [items, setItems] = useState(source?.items ?? "");
  const [validUntil, setValidUntil] = useState(quote?.valid_until ?? tomorrow());
  const pending = create.isPending || update.isPending;
  return (
    <form
      className="portal-quote-form"
      onSubmit={(event) => {
        event.preventDefault();
        const body = { amount: amount.replace(/\D/g, ""), items, valid_until: validUntil };
        if (quote) update.mutate({ quoteId: quote.id, ...body }, { onSuccess: onDone });
        else create.mutate(body, { onSuccess: onDone });
      }}
    >
      <label>
        <span>مبلغ (ریال)</span>
        <input inputMode="numeric" dir="ltr" value={amount} onChange={(event) => setAmount(event.target.value)} />
      </label>
      <label>
        <span>شرح اقلام</span>
        <textarea rows={3} value={items} onChange={(event) => setItems(event.target.value)} />
      </label>
      <PersianDatePicker label="اعتبار تا" id={`quote-valid-${id}`} value={validUntil} onChange={setValidUntil} />
      <div className="ticket-chips">
        <Button type="submit" disabled={pending}>
          {quote ? "ذخیرهٔ پیش‌نویس" : "ساخت پیش‌نویس"}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          انصراف
        </Button>
      </div>
    </form>
  );
}

export function QuoteList({ id, data }: { id: string; data: TicketPortalSummary }) {
  const send = useSendQuote(id);
  const [editing, setEditing] = useState<InternalQuote | "new" | null>(null);
  const open = data.quotes.some((q) => q.status.code === "draft" || q.status.code === "sent");
  const approved = data.quotes.some((q) => q.status.code === "approved");
  return (
    <section className="portal-quotes" aria-label="برآورد هزینه">
      <header className="ticket-card-head">
        <h3>برآورد هزینه</h3>
        {data.can.quote && !open && !approved && editing === null && (
          <Button variant="secondary" onClick={() => setEditing("new")}>
            {data.quotes.length ? "نسخهٔ جدید" : "ساخت برآورد"}
          </Button>
        )}
      </header>
      {editing && (
        <QuoteEditor
          id={id}
          quote={editing === "new" ? undefined : editing}
          base={editing === "new" ? data.quotes[0] : undefined}
          onDone={() => setEditing(null)}
        />
      )}
      {!data.quotes.length && !editing && <p className="ticket-muted">برآوردی ثبت نشده است.</p>}
      <ul className="portal-quote-list">
        {data.quotes.map((quote) => (
          <li key={quote.id} className={`portal-quote is-${quote.status.code}`}>
            <div>
              <strong>
                نسخهٔ {toFa(quote.version)} · {formatRial(quote.amount)}
              </strong>
              <span className="ticket-muted">
                {quote.status.title} · اعتبار تا {portalDate(quote.valid_until, false)}
              </span>
              {quote.decided_at && (
                <span className="ticket-muted">
                  تصمیم {quote.decided_by} در {portalDate(quote.decided_at)}
                  {quote.decision_comment ? ` — «${quote.decision_comment}»` : ""}
                </span>
              )}
            </div>
            {data.can.quote && quote.can_edit && (
              <div className="ticket-chips">
                <Button variant="secondary" onClick={() => setEditing(quote)}>
                  ویرایش
                </Button>
                <Button disabled={send.isPending} onClick={() => send.mutate({ quoteId: quote.id })}>
                  ارسال برای مشتری
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PortalTab({ id }: { id: string }) {
  const portal = useTicketPortal(id);
  if (portal.isLoading) return <Skeleton rows={3} />;
  if (portal.error || !portal.data)
    return <p className="ticket-error-text">{errorMessage(portal.error, "مکاتبات تیکت دریافت نشد.")}</p>;
  const data = portal.data;
  return (
    <section className="ticket-history portal-tab" aria-label="مکاتبات">
      {data.is_portal && data.account && (
        <p className="ticket-muted">
          ثبت از درگاه مشتری توسط «{data.account.display_name}» · وضعیتی که مشتری می‌بیند:{" "}
          <strong>{data.customer_status?.title}</strong>
        </p>
      )}
      <TriageBar id={id} data={data} />
      <InternalThread id={id} messages={data.messages} />
      <Composer id={id} data={data} />
      {data.is_portal && <QuoteList id={id} data={data} />}
      {data.feedback && (
        <section className="portal-feedback is-done" aria-label="بازخورد مشتری">
          <h3>بازخورد مشتری</h3>
          <p>
            {toFa(data.feedback.rating)} از ۵{data.feedback.edited ? " (ویرایش‌شده)" : ""}
          </p>
          {data.feedback.comment && <p className="portal-text">{data.feedback.comment}</p>}
        </section>
      )}
    </section>
  );
}
