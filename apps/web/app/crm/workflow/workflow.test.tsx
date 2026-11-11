import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type {
  InstanceActions,
  WorkflowDefinition,
  WorkflowGraph,
  WorkflowInstanceView,
  WorkflowMeta,
} from "../api/workflow";
import { DefinitionSettings, PathPreview, SimulationResult } from "./designer";
import {
  contactErrors,
  deadlineBadges,
  delayReportErrors,
  extensionErrors,
  formatWorkingMinutes,
  joinMinutes,
  localIssues,
  orderedPath,
  removeStep,
  renameStep,
  splitMinutes,
  visibleActions,
} from "./model";
import {
  ContactResolveForm,
  DeadlineBadges,
  DelayReportForm,
  ExtensionDecisionForm,
  ExtensionForm,
  MigrationSummary,
  ReasonForm,
  ReferTargetPicker,
  WorkflowPanelView,
} from "./panel";
import { WorkflowInboxList } from "./inbox-page";

const noop = () => undefined;

const graph: WorkflowGraph = {
  steps: [
    { code: "request", title: "ثبت درخواست", type: "start", status_code: "todo", assignee: { type: "subject" } },
    {
      code: "review",
      title: "تأیید مدیر مستقیم",
      type: "approval",
      status_code: "review",
      assignee: { type: "direct_manager" },
      target_minutes: 150,
    },
    { code: "done", title: "انجام شد", type: "end", status_code: "done", assignee: { type: "none" } },
  ],
  transitions: [
    { code: "submit", from: "request", to: "review", kind: "advance", label: "ارسال" },
    { code: "approve", from: "review", to: "done", kind: "approve", label: "تأیید" },
    { code: "back", from: "review", to: "request", kind: "return", label: "بازگشت برای اصلاح" },
  ],
};

const noActions: InstanceActions = {
  transitions: [],
  can_pause: false,
  pause_kinds: [],
  can_resume: false,
  can_report_delay: false,
  can_request_extension: false,
  can_decide_extension: false,
  can_reassign: false,
  can_contact_resolve: false,
  can_to_standard: false,
  can_migrate: false,
};

const run = {
  id: "r1",
  step: "review",
  title: "تأیید مدیر مستقیم",
  assignee: { id: "m", name: "مدیر تیم" },
  candidates: [],
  assignment_reason: "مدیر مستقیم (تیم پشتیبانی)",
  entered_at: "2027-01-04T08:00:00+03:30",
  target_at: "2027-01-04T10:30:00+03:30",
  target_text: "۱۴۰۵/۱۰/۱۴ ساعت ۱۰:۳۰",
  paused: false,
  pause_kind: "",
  near_due: false,
  overdue: false,
  remaining_minutes: 90,
  has_delay_report: false,
};

const instance = (patch: Partial<WorkflowInstanceView> = {}): WorkflowInstanceView => ({
  id: "i1",
  status: "running",
  revision: 3,
  error_message: "",
  definition: { id: "d1", title: "تأیید درخواست", kind: "standard" },
  version: { id: "v1", number: 2 },
  current_step: { code: "review", title: "تأیید مدیر مستقیم", type: "approval" },
  steps: graph.steps.map(({ code, title, type }) => ({ code, title, type })),
  run,
  subject: { id: "e", name: "کارمند" },
  target_at: null,
  target_text: "",
  my_role: "assignee",
  actions: noActions,
  pending_extension: null,
  extensions: [],
  timeline: [
    {
      id: "t1",
      kind: "return",
      transition: "back",
      from_step: "review",
      to_step: "request",
      actor: { id: "m", name: "مدیر تیم" },
      version: 2,
      reason: "پیوست ناقص است",
      changed_values: {},
      data: {},
      at: "2027-01-04T09:00:00+03:30",
      at_text: "۱۴۰۵/۱۰/۱۴ ساعت ۰۹:۰۰",
    },
  ],
  contact_channels: [{ code: "phone", title: "تلفن" }],
  migration_target: null,
  ...patch,
});

describe("designer model", () => {
  it("converts working hours and minutes", () => {
    expect(splitMinutes(150)).toEqual({ hours: 2, minutes: 30 });
    expect(joinMinutes(2, 30)).toBe(150);
    expect(joinMinutes(0, 0)).toBeNull();
    expect(formatWorkingMinutes(150)).toBe("۲ ساعت و ۳۰ دقیقه کاری");
    expect(formatWorkingMinutes(45)).toBe("۴۵ دقیقه کاری");
  });

  it("reports structural problems per step and transition", () => {
    expect(localIssues(graph)).toEqual([]);
    const broken: WorkflowGraph = {
      steps: [graph.steps[1], { ...graph.steps[1], code: "review" }],
      transitions: [{ ...graph.transitions[1], auto: true, kind: "reject", to: "ghost" }],
    };
    const messages = localIssues(broken).map((row) => row.message);
    expect(messages).toContain("گردش‌کار باید دقیقاً یک مرحلهٔ شروع داشته باشد.");
    expect(messages).toContain("گردش‌کار دست‌کم یک مرحلهٔ پایان لازم دارد.");
    expect(messages).toContain("کد مرحلهٔ «review» تکراری است.");
    expect(messages.some((text) => text.includes("نمی‌تواند خودکار باشد"))).toBe(true);
    expect(messages.some((text) => text.includes("مرحلهٔ موجودی نیست"))).toBe(true);
  });

  it("renames and removes steps everywhere they are referenced", () => {
    const renamed = renameStep(graph, "review", "manager");
    expect(renamed.transitions.map((row) => [row.from, row.to])).toEqual([
      ["request", "manager"],
      ["manager", "done"],
      ["manager", "request"],
    ]);
    expect(removeStep(graph, "review").transitions).toEqual([]);
    expect(orderedPath(graph).map((step) => step.code)).toEqual(["request", "review", "done"]);
  });

  it("renders a simple route view and a dry-run table", () => {
    const html = renderToStaticMarkup(<PathPreview graph={graph} />);
    expect(html).toContain("ثبت درخواست");
    expect(html).toContain("ارسال ← تأیید مدیر مستقیم");
    const table = renderToStaticMarkup(
      <SimulationResult
        path={[
          {
            step: "review",
            title: "تأیید مدیر مستقیم",
            type: "approval",
            status_code: "review",
            assignee: null,
            candidates: [],
            assignment_reason: "",
            error: "برای واحد تیم مدیر مستقیم یا جانشین فعالی تعریف نشده است.",
            entered_at: "x",
            target_at: null,
            target_text: "",
          },
        ]}
      />
    );
    expect(table).toContain("جانشین فعالی تعریف نشده است");
  });
});

describe("record panel", () => {
  it("shows only actions the server allowed", () => {
    expect(visibleActions(noActions)).toEqual([]);
    const html = renderToStaticMarkup(
      <WorkflowPanelView instance={instance()} onAction={noop} onDecideExtension={noop} />
    );
    expect(html).not.toContain('aria-label="اقدام‌های مجاز"');
    expect(html).not.toContain("درخواست تمدید");
    const allowed = renderToStaticMarkup(
      <WorkflowPanelView
        instance={instance({
          actions: {
            ...noActions,
            transitions: [
              { code: "approve", label: "تأیید", kind: "approve", to: "done", reason_required: false, blocked: false },
            ],
            can_request_extension: true,
          },
        })}
        onAction={noop}
        onDecideExtension={noop}
      />
    );
    expect(allowed).toContain("تأیید");
    expect(allowed).toContain("درخواست تمدید");
    expect(allowed).not.toContain("ارجاع مدیریتی");
    expect(allowed).not.toContain("ثبت تماس و حل");
  });

  it("shows step, assignee, deadline, remaining time and history", () => {
    const html = renderToStaticMarkup(
      <WorkflowPanelView instance={instance()} onAction={noop} onDecideExtension={noop} />
    );
    expect(html).toContain("مدیر تیم");
    expect(html).toContain("۱۴۰۵/۱۰/۱۴ ساعت ۱۰:۳۰");
    expect(html).toContain("۱ ساعت و ۳۰ دقیقه کاری");
    expect(html).toContain("دلیل: پیوست ناقص است");
    expect(html).toContain("نسخهٔ ۲");
  });

  it("labels near-due and overdue deadlines", () => {
    expect(deadlineBadges({ ...run, near_due: true }).map((b) => b.label)).toEqual(["نزدیک موعد"]);
    expect(deadlineBadges({ ...run, overdue: true, near_due: false }).map((b) => b.label)).toEqual(["دیرکرد"]);
    expect(deadlineBadges({ ...run, target_at: null })).toEqual([]);
    expect(renderToStaticMarkup(<DeadlineBadges run={{ ...run, overdue: true }} />)).toContain("دیرکرد");
    const blocked = renderToStaticMarkup(
      <WorkflowPanelView
        instance={instance({
          run: { ...run, overdue: true },
          actions: {
            ...noActions,
            can_report_delay: true,
            transitions: [
              { code: "approve", label: "تأیید", kind: "approve", to: "done", reason_required: false, blocked: true },
            ],
          },
        })}
        onAction={noop}
        onDecideExtension={noop}
      />
    );
    expect(blocked).toContain("گزارش دیرکرد");
    expect(blocked).toContain("پیش از ادامه، گزارش دیرکرد را ثبت کنید");
  });

  it("shows the error message of a failed instance", () => {
    const html = renderToStaticMarkup(
      <WorkflowPanelView
        instance={instance({
          status: "error",
          error_message: "برای واحد بایگانی مدیر مستقیم یا جانشین فعالی تعریف نشده است.",
          run: null,
        })}
        onAction={noop}
        onDecideExtension={noop}
      />
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("برای واحد بایگانی");
  });
});

describe("forms", () => {
  it("reason form marks the reason as required", () => {
    const html = renderToStaticMarkup(<ReasonForm title="رد" submitLabel="رد" onSubmit={noop} onCancel={noop} />);
    expect(html).toContain("دلیل (الزامی)");
    expect(html).toContain("required");
  });

  it("delay report needs reason, progress and a future expected time", () => {
    const now = Date.parse("2027-01-04T12:00:00+03:30");
    expect(delayReportErrors({ reason: "", progress: "", expected_at: "" }, now)).toHaveLength(3);
    expect(delayReportErrors({ reason: "a", progress: "b", expected_at: "2027-01-04T11:00:00+03:30" }, now)).toEqual([
      "زمان مورد انتظار باید در آینده باشد.",
    ]);
    expect(renderToStaticMarkup(<DelayReportForm onSubmit={noop} onCancel={noop} />)).toContain(
      "زمان جدید مورد انتظار"
    );
  });

  it("extension request and decision", () => {
    const current = "2027-01-04T10:30:00+03:30";
    expect(extensionErrors({ mode: "minutes", hours: 0, minutes: 0, target_at: "", reason: "" }, current)).toEqual([
      "مدت تمدید را وارد کنید.",
      "دلیل تمدید را بنویسید.",
    ]);
    expect(
      extensionErrors(
        { mode: "moment", hours: 0, minutes: 0, target_at: "2027-01-04T09:00:00+03:30", reason: "x" },
        current
      )
    ).toEqual(["مهلت جدید باید بعد از مهلت فعلی باشد."]);
    expect(
      renderToStaticMarkup(<ExtensionForm current={current} currentText="۱۰:۳۰" onSubmit={noop} onCancel={noop} />)
    ).toContain("تا تأیید مدیر مستقیم، همین مهلت معتبر است");
    const decision = renderToStaticMarkup(
      <ExtensionDecisionForm
        extension={{
          id: "x",
          scope: "step",
          status: "pending",
          requested_by: { id: "e", name: "کارمند" },
          previous_target_at: current,
          previous_target_text: "۱۰:۳۰",
          requested_target_at: current,
          requested_target_text: "۱۲:۳۰",
          reason: "منتظر قطعه",
          decided_by: null,
          decision_reason: "",
          created_at: current,
        }}
        onDecide={noop}
      />
    );
    expect(decision).toContain("تأیید تمدید");
    expect(decision).toContain("رد تمدید");
  });

  it("contact form needs channel, contact, time, summary and outcome", () => {
    const now = Date.parse("2027-01-04T12:00:00+03:30");
    expect(
      contactErrors({ channel: "", contact_name: "", contact_at: "", summary: "", outcome: "" }, now)
    ).toHaveLength(5);
    expect(
      contactErrors(
        { channel: "phone", contact_name: "a", contact_at: "2027-01-05T12:00:00+03:30", summary: "s", outcome: "o" },
        now
      )
    ).toEqual(["زمان تماس نمی‌تواند در آینده باشد."]);
    const html = renderToStaticMarkup(
      <ContactResolveForm channels={[{ code: "phone", title: "تلفن" }]} onSubmit={noop} onCancel={noop} />
    );
    expect(html).toContain("خلاصهٔ گفتگو");
    expect(html).toContain("ثبت تماس و حل");
  });

  it("inbox lists my steps and extension requests", () => {
    const item = {
      instance_id: "i1",
      entity: "ticket",
      entity_title: "کار",
      record_id: "r1",
      record_title: "قطعی شبکه",
      step_title: "رسیدگی",
      target_at: run.target_at,
      target_text: run.target_text,
      near_due: true,
      overdue: false,
      remaining_minutes: 30,
    };
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <WorkflowInboxList steps={[item]} extensions={[]} />
      </MemoryRouter>
    );
    expect(html).toContain("قطعی شبکه");
    expect(html).toContain("نزدیک موعد");
    expect(html).toContain("درخواست تمدیدی منتظر تأیید شما نیست");
  });
});

describe("version migration, group referral and definition settings", () => {
  it("offers the move to the latest version only when the server sends a target", () => {
    const allowed = { ...noActions, can_migrate: true };
    const without = renderToStaticMarkup(
      <WorkflowPanelView instance={instance({ actions: allowed })} onAction={noop} onDecideExtension={noop} />
    );
    expect(without).not.toContain("انتقال به نسخهٔ");
    const html = renderToStaticMarkup(
      <WorkflowPanelView
        instance={instance({
          actions: allowed,
          migration_target: { id: "v3", number: 3, steps: [{ code: "check", title: "بررسی" }] },
        })}
        onAction={noop}
        onDecideExtension={noop}
      />
    );
    expect(html).toContain("انتقال به نسخهٔ ۳");
  });

  it("lets a referral go to a group when roles exist", () => {
    const roles = [{ id: "r1", name: "کارشناسان فنی" }];
    const group = renderToStaticMarkup(
      <ReferTargetPicker mode="role" onModeChange={noop} roles={roles} roleId="r1" onRoleChange={noop} people={null} />
    );
    expect(group).toContain("کدام گروه؟");
    const person = renderToStaticMarkup(
      <ReferTargetPicker
        mode="user"
        onModeChange={noop}
        roles={[]}
        roleId=""
        onRoleChange={noop}
        people={<span>انتخاب فرد</span>}
      />
    );
    expect(person).toContain("انتخاب فرد");
    expect(person).not.toContain("کدام گروه؟");
  });

  it("summarises what a migration changes and blocks an impossible one", () => {
    const html = renderToStaticMarkup(
      <MigrationSummary
        preview={{
          before: { version: 1, step: "review", assignee: { id: "m", name: "مدیر تیم" }, target_at: null },
          after: {
            version: 2,
            step: "check",
            step_title: "بررسی ارشد",
            assignee: { id: "u", name: "مدیر بالادست" },
            target_text: "۱۴۰۵/۱۰/۱۵ ساعت ۰۹:۰۰",
          },
          problems: ["وضعیت رکورد در مرحلهٔ مقصد تغییر می‌کند."],
          can_migrate: true,
        }}
      />
    );
    expect(html).toContain("مرحلهٔ «بررسی ارشد»");
    expect(html).toContain("مدیر بالادست");
    expect(html).toContain("وضعیت رکورد در مرحلهٔ مقصد تغییر می‌کند.");
    expect(html).not.toContain("انتقال ممکن نیست");
    const blocked = renderToStaticMarkup(
      <MigrationSummary
        preview={{
          before: { version: 1, step: "review", assignee: null, target_at: null },
          after: null,
          problems: ["مرحلهٔ فعلی در نسخهٔ جدید نیست؛ مرحلهٔ مقصد را انتخاب کنید."],
          can_migrate: false,
        }}
      />
    );
    expect(blocked).toContain("با این انتخاب انتقال ممکن نیست.");
    expect(blocked).toContain('role="alert"');
  });

  it("shows the settings of a definition, including the overall deadline and the record person", () => {
    const meta = {
      fields: [
        { code: "ticket_assignees", title: "مسئولان", kind: "user" },
        { code: "title", title: "عنوان", kind: "text" },
      ],
    } as WorkflowMeta;
    const definition = {
      id: "d1",
      entity: "ticket",
      subtype: null,
      title: "تأیید",
      kind: "fast_path",
      is_active: true,
      settings: { instance_target_minutes: 990, subject_field: "ticket_assignees", require_manager_close: true },
      versions: [],
    } as WorkflowDefinition;
    const html = renderToStaticMarkup(
      <DefinitionSettings definition={definition} meta={meta} readOnly={false} onSave={noop} />
    );
    expect(html).toContain('value="16"');
    expect(html).toContain('value="30"');
    expect(html).toContain("فرد رکورد");
    expect(html).toContain("بستن تیکت با تأیید مدیر مستقیم");
    expect(html).toContain("ذخیرهٔ تنظیمات");
    const readOnly = renderToStaticMarkup(
      <DefinitionSettings definition={{ ...definition, kind: "standard" }} meta={meta} readOnly onSave={noop} />
    );
    expect(readOnly).not.toContain("ذخیرهٔ تنظیمات");
    expect(readOnly).not.toContain("بستن تیکت با تأیید مدیر مستقیم");
  });
});
