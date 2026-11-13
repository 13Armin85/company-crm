/** Ticket 7 — customer portal and the internal correspondence tab (frontend side). */
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { portalApi, PORTAL_PREFIX } from "./api/client";
import type { PortalQuote, PortalRequestDetail } from "./api/portal";
import { FeedbackForm, MessageThread, QuoteCard } from "./components";
import {
  feedbackMode,
  fileErrors,
  formatRial,
  quoteActions,
  quoteDecisionErrors,
  requestErrors,
  statusTone,
} from "./model";
import { RequestView } from "./pages/request";
import { passwordErrors } from "./pages/setup";
import { Composer, DEFAULT_ACCESS, InternalThread, QuoteEditor, QuoteList } from "../crm/ticket/portal-tab";
import type { TicketPortalSummary } from "../crm/api/portal";
import { settingsProblems } from "../crm/pages/portal-settings";
import { canAccessPath, portalPermissions } from "../crm/access/permission-map";

const noop = () => undefined;
const can = (codes: string[]) => (code: string) => codes.includes(code);

function withClient(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>
  );
}

const quote = (extra: Partial<PortalQuote> = {}): PortalQuote => ({
  id: "q1",
  number: "Q-0001",
  version: 1,
  amount: "5000000",
  items: "تعویض قطعه",
  valid_until: "2026-12-01",
  status: { code: "sent", title: "ارسال‌شده به مشتری" },
  decided_at: null,
  decision_comment: "",
  can_decide: true,
  ...extra,
});

const detail = (extra: Partial<PortalRequestDetail> = {}): PortalRequestDetail => ({
  id: "r1",
  number: "T-12",
  subject: "خرابی چاپگر",
  status: { code: "in_progress", title: "در حال انجام" },
  created_at: "2026-11-13T10:00:00+03:30",
  updated_at: "2026-11-13T11:00:00+03:30",
  unread: false,
  messages: [
    {
      id: "m1",
      author: { kind: "customer", name: "خانم الف" },
      kind: "message",
      text: "<script>alert(1)</script> کاغذ گیر می‌کند",
      created_at: "2026-11-13T10:00:00+03:30",
      created_text: "",
      files: [{ id: "f1", name: "photo.png", size: 2048, content_type: "image/png", url: "/api/portal/v1/files/f1/" }],
    },
    {
      id: "m2",
      author: { kind: "staff", name: "تیم پشتیبانی" },
      kind: "message",
      text: "در حال بررسی است",
      created_at: "2026-11-13T11:00:00+03:30",
      created_text: "",
      files: [],
    },
  ],
  quotes: [],
  feedback: null,
  can_feedback: false,
  can_message: true,
  files: { max_count: 5, max_size: 5 * 1024 * 1024, extensions: ["pdf", "png"] },
  ...extra,
});

const summary = (extra: Partial<TicketPortalSummary> = {}): TicketPortalSummary => ({
  is_portal: true,
  stage: "accepted",
  stage_title: "پذیرفته‌شده",
  customer_status: { code: "in_progress", title: "در حال انجام" },
  account: { display_name: "خانم الف", customer: "c1" },
  messages: [
    {
      id: "n1",
      access: "INTERNAL",
      kind: "message",
      author: { kind: "staff", name: "کارمند" },
      text: "یادداشت محرمانه",
      created_at: null,
      created_text: "",
      files: [],
    },
    {
      id: "n2",
      access: "EXTERNAL",
      kind: "message",
      author: { kind: "staff", name: "کارمند" },
      text: "پاسخ",
      created_at: null,
      created_text: "",
      files: [],
    },
  ],
  quotes: [],
  feedback: null,
  can: { note: true, reply: true, triage: false, quote: true, feedback: true },
  staff_name: "team",
  team_name: "تیم پشتیبانی",
  ...extra,
});

describe("portal client", () => {
  it("talks only to the portal API prefix", () => {
    expect(PORTAL_PREFIX).toBe("/api/portal/v1/");
    expect(portalApi.defaults.baseURL?.endsWith("/api/portal/v1/")).toBe(true);
    expect(portalApi.defaults.withCredentials).toBe(true);
  });
});

describe("portal rendering", () => {
  it("renders the thread as text, marks the customer's own messages and links files through the API", () => {
    const html = renderToStaticMarkup(<MessageThread messages={detail().messages} />);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("خانم الف (شما)");
    expect(html).toContain("/api/portal/v1/files/f1/");
  });

  it("never shows an internal-note marker in the customer view", () => {
    const html = withClient(<RequestView detail={detail()} />);
    expect(html).not.toContain("یادداشت داخلی");
    expect(html).not.toContain("INTERNAL");
    expect(html).toContain("ارسال پیام");
  });

  it("shows the feedback form only after completion", () => {
    expect(withClient(<RequestView detail={detail()} />)).not.toContain("ثبت بازخورد");
    const done = detail({ can_feedback: true, status: { code: "done", title: "انجام‌شده" } });
    expect(withClient(<RequestView detail={done} />)).toContain("ثبت بازخورد");
    const locked = detail({
      can_feedback: true,
      feedback: { rating: 4, comment: "", submitted_at: "x", edited: false, editable_until: "x", can_edit: false },
    });
    expect(withClient(<RequestView detail={locked} />)).toContain("بازخورد شما");
    expect(feedbackMode(detail())).toBe("hidden");
    expect(feedbackMode(done)).toBe("new");
    expect(feedbackMode(locked)).toBe("locked");
    expect(renderToStaticMarkup(<FeedbackForm feedback={null} onSubmit={noop} />)).toContain('role="radiogroup"');
  });

  it("offers quote buttons only for a sent and still valid version", () => {
    expect(quoteActions(quote()).map((a) => a.id)).toEqual(["approved", "revision_requested", "rejected"]);
    expect(quoteActions(quote({ can_decide: false }))).toEqual([]);
    expect(quoteActions(quote({ status: { code: "approved", title: "تأییدشده" }, can_decide: false }))).toEqual([]);
    const sent = renderToStaticMarkup(<QuoteCard quote={quote()} onDecide={noop} />);
    expect(sent).toContain("تأیید برآورد");
    expect(sent).toContain("درخواست اصلاح");
    const approved = renderToStaticMarkup(
      <QuoteCard
        quote={quote({
          status: { code: "approved", title: "تأییدشده" },
          can_decide: false,
          decided_at: "2026-11-13T12:00:00Z",
        })}
        onDecide={noop}
      />
    );
    expect(approved).not.toContain("تأیید برآورد");
    expect(approved).toContain("تصمیم شما");
    expect(approved).not.toContain("بله، ثبت قطعی");
    expect(quoteDecisionErrors("revision_requested", "")).toHaveLength(1);
    expect(quoteDecisionErrors("approved", "")).toEqual([]);
  });

  it("hides the composer of a closed request", () => {
    expect(withClient(<RequestView detail={detail({ can_message: false })} />)).toContain("پیام جدید نمی‌پذیرد");
  });
});

describe("portal checks", () => {
  it("validates requests, files, passwords and formats money", () => {
    expect(requestErrors("ab", "کوتاه")).toHaveLength(2);
    expect(requestErrors("خرابی", "شرح کامل درخواست")).toEqual([]);
    expect(fileErrors([{ name: "a.exe", size: 1 }])).toHaveLength(1);
    expect(fileErrors([{ name: "a.pdf", size: 6 * 1024 * 1024 }])).toHaveLength(1);
    expect(fileErrors(Array.from({ length: 6 }, (_, i) => ({ name: `${i}.pdf`, size: 1 })))).toHaveLength(1);
    expect(passwordErrors("short", "other")).toHaveLength(2);
    expect(formatRial("5000000")).toBe("۵٬۰۰۰٬۰۰۰ ریال");
    expect(statusTone("rejected")).toBe("danger");
    expect(statusTone("anything-else")).toBe("neutral");
  });
});

describe("internal correspondence tab", () => {
  it("defaults the composer to an internal note and marks a customer reply explicitly", () => {
    expect(DEFAULT_ACCESS).toBe("INTERNAL");
    const html = withClient(<Composer id="t1" data={summary()} />);
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>.*?یادداشت داخلی/);
    expect(html).toMatch(/role="radio" aria-checked="false"[^>]*>.*?پاسخ به مشتری/);
    expect(html).toContain("ثبت یادداشت داخلی");
    expect(html).toContain("is-internal");
  });

  it("disables a customer reply without the permission or on a non-portal ticket", () => {
    const html = withClient(
      <Composer id="t1" data={summary({ can: { ...summary().can, reply: false }, is_portal: false })} />
    );
    expect(html).toContain("این تیکت از درگاه مشتری ثبت نشده است.");
    expect(html).toMatch(/aria-checked="false" disabled=""/);
  });

  it("marks each message's visibility", () => {
    const html = withClient(<InternalThread id="t1" messages={summary().messages} />);
    expect(html).toContain("یادداشت داخلی");
    expect(html).toContain("قابل‌مشاهده برای مشتری");
    expect(html).toContain("is-note");
  });

  it("shows quote send only for drafts", () => {
    const draft = {
      ...quote({ status: { code: "draft", title: "پیش‌نویس" } }),
      decided_by: null,
      can_edit: true,
      can_send: true,
    };
    const html = withClient(<QuoteList id="t1" data={summary({ quotes: [draft] })} />);
    expect(html).toContain("ارسال برای مشتری");
    const sent = { ...draft, status: { code: "sent", title: "ارسال‌شده" }, can_edit: false, can_send: false };
    expect(withClient(<QuoteList id="t1" data={summary({ quotes: [sent] })} />)).not.toContain("ارسال برای مشتری");
  });

  it("starts a new quote version from the latest one", () => {
    const latest = {
      ...quote({ status: { code: "revision_requested", title: "درخواست اصلاح" } }),
      decided_by: "x",
      can_edit: false,
      can_send: false,
    };
    const html = withClient(<QuoteEditor id="t1" base={latest} onDone={noop} />);
    expect(html).toContain("تعویض قطعه");
    expect(html).toContain('value="5000000"');
    expect(html).toContain("ساخت پیش‌نویس");
  });

  it("refuses settings that point outside the allowed label list", () => {
    const doc = {
      labels: [{ code: "reviewing", title: "در حال بررسی" }],
      status_map: { "category:todo": "secret" },
      stage_labels: {},
      default_label: "reviewing",
      staff_name: "team" as const,
      team_name: "تیم",
      feedback_edit_hours: 72,
      files: { max_count: 5, max_size: 1, extensions: ["pdf"] },
      session: { idle_minutes: 30, absolute_hours: 12 },
      lockout: { attempts: 5, minutes: 15 },
      notify_channels: { email: false, sms: false },
    };
    expect(settingsProblems(doc)).toContain("نگاشتی به برچسبی خارج از فهرست مجاز اشاره می‌کند.");
    expect(settingsProblems({ ...doc, status_map: { "category:todo": "reviewing" } })).toEqual([]);
  });

  it("guards the settings page with either portal management code", () => {
    expect(canAccessPath("/portal-settings", can([]))).toBe(false);
    expect(canAccessPath("/portal-settings", can([portalPermissions.manageAccounts]))).toBe(true);
    expect(canAccessPath("/portal-settings", can([portalPermissions.manageSettings]))).toBe(true);
  });
});
