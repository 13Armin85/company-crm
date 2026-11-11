import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { RoutingRule, TicketCard, TicketDeadline } from "../api/ticket";
import { TicketDeadlineBadge } from "./deadline-badge";
import {
  DEADLINE_STATES,
  contactErrors,
  deadlineSummary,
  delayErrors,
  extensionErrors,
  minutesFrom,
  moveRule,
  progressPercent,
  ruleProblems,
  ruleSentence,
  targetErrors,
} from "./model";
import { TicketPresetBar } from "./preset-bar";
import {
  ContactDialog,
  DelayDialog,
  ExtensionDialog,
  OverdueBanner,
  ReferralCard,
  TargetCard,
  TicketDetailsCard,
} from "./ticket-panel";
import { isUnassignedEntry } from "../role-queue-model";
import { ticketActionPermissions } from "../access/permission-map";

const noop = () => undefined;

const base: TicketDeadline = {
  state: "running",
  category: "in_progress",
  category_title: "در حال انجام",
  target_minutes: 480,
  target_origin: "type",
  ticket_minutes: null,
  type_minutes: 480,
  total_minutes: 480,
  started_at: "2026-11-14T10:00:00+03:30",
  started_text: "شنبه ۲۳ آبان ۱۴۰۵ ساعت ۱۰:۰۰",
  target_at: "2026-11-16T11:00:00+03:30",
  target_text: "دوشنبه ۲۵ آبان ۱۴۰۵ ساعت ۱۱:۰۰",
  remaining_minutes: 180,
  overdue_minutes: 0,
  spent_minutes: null,
  calendar: { source: "person", label: "برنامهٔ فرد", help: "برنامهٔ کاری شخصی مسئول", source_id: "s1", builtin: false },
  overdue_flagged_at: null,
  pending_extension: null,
  extensions: [],
  last_delay_report: null,
  delay_report_needed: false,
  can: { set_target: false, request_extension: true, report_delay: false, decide_extension: false },
  why: { request_extension: "", report_delay: "گزارش تأخیر فقط پس از گذشتن موعد لازم است." },
};

const details: TicketCard["details"] = {
  creator: "colleague",
  type: "پشتیبانی",
  project: null,
  priority: "urgent",
  due_date: null,
  estimate: null,
  labels: [],
  parent: { id: "p1", name: "والد" },
  parent_hidden: false,
  children: [{ id: "c1", name: "فرزند" }],
};

const card = (deadline: Partial<TicketDeadline> = {}, extra: Partial<TicketCard> = {}): TicketCard => ({
  id: "t1",
  details,
  deadline: { ...base, ...deadline },
  referrals: [],
  active_referral: null,
  read_only: false,
  contact_channels: [
    { code: "phone", title: "تلفن" },
    { code: "onsite", title: "حضوری" },
  ],
  can: { refer: true, contact: true },
  ...extra,
});

const target = (deadline: Partial<TicketDeadline>, readOnly = false) =>
  renderToStaticMarkup(
    <TargetCard deadline={{ ...base, ...deadline }} readOnly={readOnly} onSetTarget={noop} onExtension={noop} onDecide={noop} />
  );

function withClient(node: ReactNode, seed?: (client: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed?.(client);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("target card states (section 6.2)", () => {
  it("shows no target with a manager action only for the manager", () => {
    const html = target({ state: "none", target_minutes: null, total_minutes: null, can: { ...base.can, request_extension: false } });
    expect(html).toContain("مدت هدف تعیین نشده");
    expect(html).not.toContain("تعیین مدت هدف");
    const manager = target({ state: "none", target_minutes: null, can: { ...base.can, set_target: true } });
    expect(manager).toContain("تعیین مدت هدف");
  });

  it("explains that the clock starts with the first start", () => {
    expect(target({ state: "not_started", started_text: "", remaining_minutes: null })).toContain(
      "محاسبه با نخستین شروع کار آغاز می‌شود"
    );
  });

  it("running: neutral progress, remaining working time, calendar source with explanation", () => {
    const html = target({});
    expect(html).toContain("ساعت کاری");
    expect(html).toContain("مانده");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain("برنامهٔ فرد");
    expect(html).toContain('title="برنامهٔ کاری شخصی مسئول"');
    expect(html).toContain("پیش‌فرض نوع تیکت");
  });

  it("near due and overdue use color + icon + text", () => {
    expect(target({ state: "near_due", remaining_minutes: 60 })).toContain("نزدیک موعد");
    const overdue = target({
      state: "overdue",
      remaining_minutes: 0,
      overdue_minutes: 120,
      last_delay_report: {
        id: "r",
        reason: "قطعه نرسید",
        progress: "۸۰٪",
        expected_at: null,
        expected_text: "سه‌شنبه",
        target_at: null,
        reporter: "e",
        created_at: null,
      },
    });
    expect(overdue).toContain("دیرکرده");
    expect(overdue).toContain("۲ ساعت کاری تأخیر");
    expect(overdue).toContain("ticket-pill-danger");
    expect(overdue).toContain("<svg");
    expect(overdue).toContain("قطعه نرسید");
  });

  it("pending extension keeps the current deadline and shows the approver", () => {
    const html = target({
      pending_extension: {
        id: "x",
        status: "pending",
        status_title: "در انتظار تأیید",
        minutes: 120,
        reason: "منتظر قطعه",
        decision_reason: "",
        previous_target_at: base.target_at,
        previous_target_text: "دوشنبه ۱۱:۰۰",
        requested_target_at: null,
        requested_target_text: "دوشنبه ۱۴:۰۰",
        requested_by: "employee",
        approver: "manager",
        decided_by: "",
        decided_at: null,
        created_at: null,
      },
      can: { ...base.can, request_extension: false },
      why: { ...base.why, request_extension: "یک درخواست تمدید در انتظار تأیید است." },
    });
    expect(html).toContain("تمدید در انتظار تأیید manager");
    expect(html).toContain("موعد فعلی همچنان دوشنبه ۱۱:۰۰ است");
    expect(html).toContain("disabled");
    expect(html).toContain("یک درخواست تمدید در انتظار تأیید است.");
    expect(html).not.toContain("تأیید تمدید");
  });

  it("approver sees decide buttons", () => {
    const html = target({
      pending_extension: {
        id: "x",
        status: "pending",
        status_title: "",
        minutes: 60,
        reason: "r",
        decision_reason: "",
        previous_target_at: null,
        previous_target_text: "",
        requested_target_at: null,
        requested_target_text: "",
        requested_by: "e",
        approver: "m",
        decided_by: "",
        decided_at: null,
        created_at: null,
      },
      can: { ...base.can, decide_extension: true },
    });
    expect(html).toContain("تأیید تمدید");
    expect(html).toContain("رد تمدید");
  });

  it("closed shows spent against target; read-only hides write actions", () => {
    expect(target({ state: "closed", spent_minutes: 120, total_minutes: 480 })).toContain(
      "صرف‌شده ۲ ساعت کاری از ۸ ساعت کاری"
    );
    expect(target({}, true)).not.toContain("درخواست تمدید");
  });

  it("every state has a label, a tone and an icon", () => {
    for (const presentation of Object.values(DEADLINE_STATES)) {
      expect(presentation.label).toBeTruthy();
      expect(presentation.icon).toBeTruthy();
    }
  });
});

describe("overdue banner and delay report", () => {
  it("banner only when overdue, with the report action for the assignee", () => {
    expect(renderToStaticMarkup(<OverdueBanner deadline={base} onReport={noop} />)).toBe("");
    const html = renderToStaticMarkup(
      <OverdueBanner
        deadline={{ ...base, state: "overdue", overdue_minutes: 120, delay_report_needed: true, can: { ...base.can, report_delay: true } }}
        onReport={noop}
      />
    );
    expect(html).toContain("۲ ساعت کاری از موعد گذشته");
    expect(html).toContain("دلیل تأخیر، وضعیت پیشرفت و زمان پایان جدید را ثبت کنید.");
    expect(html).toContain("ثبت گزارش تأخیر");
  });

  it("delay dialog has three required inputs and the official-deadline note", () => {
    const html = withClient(<DelayDialog id="t1" onClose={noop} bare />);
    expect(html).toContain("دلیل تأخیر");
    expect(html).toContain("وضعیت پیشرفت");
    expect(html).toContain("زمان پایان جدید");
    expect(html).toContain("این برآورد موعد رسمی را تغییر نمی‌دهد؛ برای تغییر موعد درخواست تمدید بدهید.");
    expect(delayErrors("", "", null)).toHaveLength(3);
    expect(delayErrors("x", "y", "2000-01-01T00:00:00Z")).toEqual(["زمان پایان جدید باید در آینده باشد."]);
  });
});

describe("extension dialog (section 6.3)", () => {
  it("shows the live server preview, recipient and guidance", () => {
    const html = withClient(<ExtensionDialog id="t1" onClose={noop} bare />, (client) =>
      client.setQueryData(["ticket-extension-preview", "", "t1", 60], {
        current_target_at: "",
        current_target_text: "دوشنبه ۱۱:۰۰",
        requested_target_at: "",
        requested_target_text: "دوشنبه ۱۳:۰۰",
        minutes: 60,
        approver: { id: "m", name: "مدیر تیم", relation: "مدیر مستقیم" },
      })
    );
    expect(html).toContain("پایان جدید در صورت تأیید: دوشنبه ۱۳:۰۰");
    expect(html).toContain("گیرنده: مدیر تیم (مدیر مستقیم)");
    expect(html).toContain("تا تأیید مدیر، موعد فعلی تغییر نمی‌کند. این تمدید اضافه‌کاری یا ساعت حضور نیست.");
    expect(html).toContain("ساعت کاری");
    expect(html).toContain("دقیقهٔ کاری");
  });

  it("validates duration and reason", () => {
    expect(extensionErrors(null, "")).toHaveLength(2);
    expect(extensionErrors(90, "دلیل")).toEqual([]);
    expect(minutesFrom("1", "30")).toBe(90);
    expect(minutesFrom("0", "0")).toBeNull();
    expect(minutesFrom("1", "75")).toBeNull();
    expect(targetErrors(null, "x", true)).toEqual([]);
    expect(targetErrors(null, "", false)).toHaveLength(2);
  });
});

describe("first-contact resolution (section 6.6)", () => {
  it("channel chips from ticket-source and two large outcomes", () => {
    const html = withClient(<ContactDialog id="t1" card={card()} onClose={noop} bare />);
    expect(html).toContain("تلفن");
    expect(html).toContain("حضوری");
    expect(html).toContain("حل شد — تیکت بسته شود");
    expect(html).toContain("حل نشد — ادامه در مسیر عادی");
    expect(html).toContain('role="radiogroup"');
    expect(contactErrors({ channel: "", contactName: "", summary: "", resolved: null })).toHaveLength(4);
  });
});

describe("referral card", () => {
  it("target sees accept / reject / forward; others wait", () => {
    const active = { id: "d", to_id: "u2", to: "colleague", by: "employee", reason: "تخصص", mine: true };
    const mine = renderToStaticMarkup(
      <ReferralCard card={card({}, { active_referral: active })} onRefer={noop} onRespond={noop} onAccept={noop} />
    );
    expect(mine).toContain("پذیرش");
    expect(mine).toContain("رد با دلیل");
    expect(mine).toContain("ارجاع به فرد دیگر");
    const other = renderToStaticMarkup(
      <ReferralCard card={card({}, { active_referral: { ...active, mine: false } })} onRefer={noop} onRespond={noop} onAccept={noop} />
    );
    expect(other).toContain("در انتظار پاسخ colleague");
    expect(other).toContain("یک ارجاع در انتظار پاسخ است.");
  });

  it("without permission the refer action is disabled with a reason; read-only hides it", () => {
    const html = renderToStaticMarkup(
      <ReferralCard card={card({}, { can: { refer: false, contact: true } })} onRefer={noop} onRespond={noop} onAccept={noop} />
    );
    expect(html).toContain("disabled");
    expect(html).toContain("فقط مسئول یا مدیر دارای مجوز ارجاع می‌تواند ارجاع دهد.");
    const readOnly = renderToStaticMarkup(
      <ReferralCard card={card({}, { read_only: true })} onRefer={noop} onRespond={noop} onAccept={noop} />
    );
    expect(readOnly).not.toContain('class="ticket-action"');
  });
});

describe("ready filters and deadline badges (section 6.7)", () => {
  it("renders all five presets with server counts", () => {
    const html = renderToStaticMarkup(
      <TicketPresetBar value="overdue" counts={{ all: 12, mine: 3, unassigned: 2, overdue: 1, closed: 6 }} onChange={noop} />
    );
    for (const label of ["همه", "من", "بدون مسئول", "عقب‌افتاده", "بسته‌شده"]) expect(html).toContain(label);
    expect(html).toContain("۱۲");
    expect(html).toContain('aria-selected="true"');
  });

  it("badge has icon and text for each state", () => {
    expect(renderToStaticMarkup(<TicketDeadlineBadge badge={{ state: "overdue", target_text: "x" }} />)).toContain("دیرکرده");
    expect(renderToStaticMarkup(<TicketDeadlineBadge badge={{ state: "near_due", target_text: "x" }} />)).toContain("نزدیک موعد");
    expect(renderToStaticMarkup(<TicketDeadlineBadge />)).toBe("");
  });

  it("unassigned queue entries are recognised", () => {
    expect(isUnassignedEntry({ requiredRoleId: "null" })).toBe(true);
    expect(isUnassignedEntry({ requiredRoleId: "r1" })).toBe(false);
  });
});

describe("routing rule editor model (section 6.8)", () => {
  const rule: RoutingRule = {
    id: "r1",
    name: "فوری‌ها",
    unit_id: null,
    unit_title: "",
    required_role_id: null,
    role_name: "",
    is_active: true,
    position: 1,
    conditions: { priorities: ["urgent"], type_ids: ["t1"] },
    method: "round_robin",
    method_title: "نوبتی",
    target_user_id: null,
    target_user_name: "",
    member_ids: ["a", "b"],
    shadowed_by: null,
  };

  it("summarises a rule as a sentence", () => {
    expect(ruleSentence(rule, { t1: "پشتیبانی" })).toBe("اگر [نوع = پشتیبانی] و [اولویت = فوری] ← نوبتی به ۲ نفر");
    expect(ruleSentence({ ...rule, conditions: {}, method: "user", target_user_name: "علی" })).toBe(
      "برای همهٔ تیکت‌ها ← فرد ثابت به علی"
    );
  });

  it("checks required inputs per method", () => {
    expect(ruleProblems({ ...rule, method: "user" })).toContain("فرد ثابت را انتخاب کنید.");
    expect(ruleProblems({ ...rule, method: "group" })).toContain("نقش گروه را انتخاب کنید.");
    expect(ruleProblems({ ...rule, member_ids: [] })).toContain("اعضای نوبت را انتخاب کنید یا نقش/واحد را مشخص کنید.");
    expect(ruleProblems(rule)).toEqual([]);
  });

  it("reorders with up/down", () => {
    expect(moveRule(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveRule(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
  });
});

describe("summary helpers and permissions", () => {
  it("summaries and progress", () => {
    expect(deadlineSummary({ ...base, state: "overdue", overdue_minutes: 30 })).toBe("۳۰ دقیقه کاری تأخیر");
    expect(progressPercent(base)).toBe(63);
    expect(progressPercent({ ...base, state: "closed" })).toBeNull();
  });

  it("registers the ticket permission codes", () => {
    expect(ticketActionPermissions.setTarget).toBe("Ticket.TargetSet");
    expect(ticketActionPermissions.manageRules).toBe("Routing.Manage");
  });
});

describe("core fields (ن۱)", () => {
  it("shows creator, type, priority, parent and children with links", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TicketDetailsCard card={card()} onParent={noop} />
      </MemoryRouter>
    );
    expect(html).toContain("ثبت‌کننده");
    expect(html).toContain("colleague");
    expect(html).toContain("پشتیبانی");
    expect(html).toContain("فوری");
    expect(html).toContain('href="/entities/ticket/p1"');
    expect(html).toContain("زیرتیکت‌ها");
    expect(html).toContain("تغییر تیکت والد");
    const hidden = renderToStaticMarkup(
      <MemoryRouter>
        <TicketDetailsCard card={card({}, { details: { ...details, parent: null, parent_hidden: true }, read_only: true })} onParent={noop} />
      </MemoryRouter>
    );
    expect(hidden).toContain("تیکت والد خارج از دسترسی شماست");
    expect(hidden).not.toContain("تعیین تیکت والد");
  });
});

describe("status categories (ن۶)", () => {
  it("uses exactly the server's mapping table (ticket_core.GROUP_CATEGORY / STATUS_CATEGORY)", async () => {
    const { GROUP_CATEGORY, STATUS_CATEGORY, workCategory } = await import("./model");
    expect(GROUP_CATEGORY).toEqual({
      backlog: "todo",
      unstarted: "todo",
      triage: "todo",
      started: "in_progress",
      completed: "done",
      cancelled: "done",
    });
    expect(STATUS_CATEGORY).toEqual({
      todo: "todo",
      in_progress: "in_progress",
      review: "in_progress",
      blocked: "in_progress",
      done: "done",
    });
    expect(workCategory({ group: "cancelled" })).toBe("done");
    expect(workCategory({ status: "custom" })).toBe("todo");
  });
});

describe("ticket header and tabs (۶.۲)", () => {
  it("shows number, title, grouped status menu and the facts line", async () => {
    const { TicketHeader, TicketTabs } = await import("./ticket-header");
    const html = withClient(
      <TicketHeader
        card={card(
          {},
          {
            title: "قطعی سامانه",
            number: "TT1921",
            details: { ...details, customers: [{ id: "c1", title: "بانک نمونه" }] },
            status: {
              field: "ticket_state",
              current: "in_progress",
              category: "in_progress",
              can_change: true,
              why: "",
              options: [
                { id: "todo", title: "برای انجام", category: "todo" },
                { id: "in_progress", title: "در حال انجام", category: "in_progress" },
                { id: "done", title: "انجام‌شده", category: "done" },
              ],
            },
          }
        )}
        onAction={noop}
      />
    );
    expect(html).toContain("TT1921");
    expect(html).toContain("قطعی سامانه");
    expect(html).toContain('aria-label="وضعیت"');
    expect(html).toContain('<optgroup label="انجام‌نشده">');
    expect(html).toContain('<optgroup label="در حال انجام">');
    expect(html).toContain("بانک نمونه");
    for (const label of ["نوع", "اولویت", "مشتری", "پروژه", "ثبت‌کننده"]) expect(html).toContain(`<dt>${label}</dt>`);
    expect(html).toContain('aria-label="اقدام‌های دیگر تیکت"');
    const locked = withClient(
      <TicketHeader
        card={card(
          {},
          {
            status: {
              field: "ticket_state",
              current: "todo",
              category: "todo",
              can_change: false,
              why: "اجازهٔ تغییر وضعیت این تیکت را ندارید.",
              options: [{ id: "todo", title: "برای انجام", category: "todo" }],
            },
          }
        )}
        onAction={noop}
      />
    );
    expect(locked).toContain("disabled");
    expect(locked).toContain("اجازهٔ تغییر وضعیت این تیکت را ندارید.");
    const tabs = renderToStaticMarkup(<TicketTabs active="history" onChange={noop} counts={{ referrals: 2 }} />);
    for (const label of ["سابقه", "ارجاع‌ها", "مرتبط‌ها", "زیرتیکت‌ها"]) expect(tabs).toContain(label);
    expect(tabs).toContain('aria-selected="true"');
  });
});
