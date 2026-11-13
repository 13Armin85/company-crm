import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { errorMessage } from "../api";
import type { LeaveRequestSummary, LeaveTemplate, LeaveVersion } from "../api/leave";
import { leavePermissions, canAccessPath } from "../access/permission-map";
import {
  LeaveForm,
  MySignatureCard,
  PlaceholderTable,
  PreviewFrame,
  SignPanel,
  TemplateVersionRow,
  VersionList,
} from "./components";
import {
  MAX_ATTACHMENTS,
  SIGN_BUTTON,
  SIGNATURE_NOTICE,
  attachmentHint,
  attachmentKind,
  checkAttachments,
  emptyForm,
  formErrors,
  formFromVersion,
  formPayload,
  holderText,
  recordHref,
} from "./model";
import { LeaveRequestList } from "./requests-page";
import { AttachmentList, LeaveAttachments } from "./attachments";

const noop = () => undefined;
const can = (codes: string[]) => (code: string) => codes.includes(code);
const render = (node: ReactElement) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>
  );

const version: LeaveVersion = {
  id: "v1",
  number: 1,
  mode: "hourly",
  mode_label: "ساعتی",
  start_date: "2027-01-09",
  end_date: "2027-01-09",
  start_time: "10:00",
  end_time: "12:00",
  starts_at: "2027-01-09T10:00:00+03:30",
  ends_at: "2027-01-09T12:00:00+03:30",
  period_text: "۱۴۰۵/۱۰/۱۹ از ساعت ۱۰:۰۰ تا ۱۲:۰۰",
  reason: "پزشک",
  substitute: { id: "u2", name: "سارا" },
  attachments: [{ id: "a1", name: "note.pdf", size: 2048 }],
  duration_days: null,
  duration_minutes: 120,
  duration_text: "۲ ساعت کاری",
  is_locked: true,
  signed_at: "2027-01-01T09:00:00+03:30",
  signed_by: { id: "u1", name: "علی" },
  template: { id: "t1", number: 3, title: "فرم" },
  has_document: true,
  created_at: "2027-01-01T08:00:00+03:30",
};

describe("leave form rules (mirrors the server)", () => {
  it("only offers daily or hourly and never sends a category", () => {
    const html = render(
      <LeaveForm
        values={emptyForm("2027-01-09")}
        errors={{}}
        members={[]}
        durationText=""
        attachments={[]}
        onChange={noop}
      />
    );
    expect(html).toContain("روزانه");
    expect(html).toContain("ساعتی");
    expect(html).not.toContain("نوع مرخصی");
    expect(html).not.toContain("استحقاقی");
    expect(html).not.toContain('type="time"'); // daily: date only
    const payload = formPayload({ ...emptyForm("2027-01-09"), reason: " x " });
    expect(new Set(Object.keys(payload))).toEqual(
      new Set(["attachments", "end_date", "mode", "reason", "start_date", "substitute"])
    );
    expect(payload.reason).toBe("x");
  });

  it("hourly mode shows times and the read-only duration", () => {
    const html = render(
      <LeaveForm
        values={{ ...emptyForm("2027-01-09"), mode: "hourly", start_time: "10:00", end_time: "12:00" }}
        errors={{}}
        members={[{ id: "u2", name: "سارا" }]}
        durationText="۲ ساعت کاری"
        attachments={[]}
        onChange={noop}
      />
    );
    expect(html).toContain('type="time"');
    expect(html).toContain("<output");
    expect(html).toContain("۲ ساعت کاری");
    expect(html).toContain("سارا");
  });

  it("rejects end before start and zero-length hourly periods", () => {
    expect(formErrors({ ...emptyForm(), start_date: "2027-01-10", end_date: "2027-01-09" }).end_date).toBeTruthy();
    const hourly = { ...emptyForm("2027-01-09"), mode: "hourly" as const, start_time: "12:00", end_time: "12:00" };
    expect(formErrors(hourly).end_time).toBeTruthy();
    expect(formErrors({ ...hourly, end_time: "13:00" })).toEqual({});
    expect(formErrors({ ...emptyForm(), start_date: "" }).start_date).toBeTruthy();
    expect(formErrors({ ...hourly, start_time: "" }).start_time).toBeTruthy();
  });

  it("round-trips a version into the form", () => {
    const values = formFromVersion(version);
    expect(values).toMatchObject({ mode: "hourly", start_time: "10:00", substitute: "u2", attachments: ["a1"] });
    expect(formPayload(values)).toMatchObject({ start_time: "10:00", end_time: "12:00" });
  });
});

describe("signing is an explicit, explained action", () => {
  it("disables the button and shows why when not allowed", () => {
    const html = render(<SignPanel canSign={false} blockers={["هنوز اجازه نداده‌اید"]} hasPreview onSign={noop} />);
    expect(html).toContain(SIGN_BUTTON);
    expect(html).toContain("disabled");
    expect(html).toContain("هنوز اجازه نداده‌اید");
    expect(html).toContain(SIGNATURE_NOTICE);
  });

  it("needs a preview before signing", () => {
    expect(render(<SignPanel canSign blockers={[]} hasPreview={false} onSign={noop} />)).toContain("disabled");
    expect(render(<SignPanel canSign blockers={[]} hasPreview onSign={noop} />)).not.toContain("disabled");
  });

  it("asks for consent on the exact image and explains it is not a digital signature", () => {
    const signature = {
      id: "s1",
      uploaded_at: "2027-01-01",
      content_type: "image/png",
      size: 10,
      has_consent: false,
      consent_at: null,
      consent_revoked_at: null,
    };
    const html = render(<MySignatureCard signature={signature} imageUrl="/img" onGrant={noop} onRevoke={noop} />);
    expect(html).toContain("اجازهٔ درج آن را می‌دهم");
    expect(html).toContain(SIGNATURE_NOTICE);
    const granted = render(
      <MySignatureCard signature={{ ...signature, has_consent: true }} imageUrl="/img" onGrant={noop} onRevoke={noop} />
    );
    expect(granted).toContain("لغو اجازه");
    expect(render(<MySignatureCard signature={null} imageUrl="" onGrant={noop} onRevoke={noop} />)).toContain(
      "بارگذاری نشده"
    );
  });

  it("renders the preview in a script-free sandbox", () => {
    const html = render(<PreviewFrame html="<p>x</p>" title="پیش‌نمایش" />);
    expect(html).toContain('sandbox=""');
    expect(html.toLowerCase()).toContain('srcdoc="&lt;p&gt;x&lt;/p&gt;"');
  });
});

describe("versions, templates and lists", () => {
  it("keeps every signed version downloadable", () => {
    const html = render(
      <VersionList versions={[{ ...version, number: 2 }, version]} documentHref={(v) => `/doc/${v.number}`} />
    );
    expect(html).toContain("/doc/1");
    expect(html).toContain("/doc/2");
    expect(html).toContain("(قفل)");
    expect(html).toContain("نسخهٔ ۳");
  });

  it("shows template warnings and blocks activating an invalid version", () => {
    const row: LeaveTemplate = {
      id: "t1",
      number: 2,
      title: "فرم",
      original_name: "form.docx",
      size: 100,
      status: "inactive",
      status_label: "غیرفعال",
      expires_at: null,
      expires_text: "",
      is_expired: false,
      placeholders: [],
      issues: [{ code: "missing", level: "error", message: "جایگاه الزامی «{{signature}}» در قالب نیست" }],
      warnings: ["جایگاه الزامی «{{signature}}» در قالب نیست"],
      can_activate: false,
      note: "",
      created_at: "",
      created_by: null,
    };
    const html = render(
      <TemplateVersionRow row={row} fileHref="/f" onActivate={noop} onDeprecate={noop} onExpiry={noop} />
    );
    expect(html).toContain("signature");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>.*فعال‌سازی/);
    // Expiry uses the project's Persian date picker (no Gregorian browser input); clearing appears only when set.
    expect(html).not.toContain('type="date"');
    expect(html).not.toContain("برداشتن تاریخ انقضا");
    const expiring = render(
      <TemplateVersionRow
        row={{ ...row, expires_at: "2027-03-20" }}
        fileHref="/f"
        onActivate={noop}
        onDeprecate={noop}
        onExpiry={noop}
      />
    );
    expect(expiring).toContain("برداشتن تاریخ انقضا");
    const placeholders = render(
      <PlaceholderTable placeholders={[{ key: "employee_name", title: "نام", required: true }]} />
    );
    expect(placeholders).toContain("{{employee_name}}");
  });

  it("lists requests with status and current holder", () => {
    const row: LeaveRequestSummary = {
      id: "r1",
      number: "LRQ-00001",
      status: "pending",
      status_label: "در انتظار تأیید",
      revision: 3,
      requester: { id: "u1", name: "علی" },
      created_at: "",
      current: version,
      holder: { step: "تأیید مدیر مستقیم", people: [{ id: "m", name: "مدیر" }], error: "" },
      is_mine: true,
    };
    const html = render(<LeaveRequestList rows={[row]} />);
    expect(html).toContain("/leave-requests/r1");
    expect(html).toContain("نزد مدیر");
    expect(holderText({ status: "draft", holder: null })).toContain("پیش‌نویس");
    expect(holderText({ status: "pending", holder: { step: "x", people: [], error: "بدون مدیر" } })).toContain("خطا");
  });

  it("routes inbox rows and guards admin pages by permission", () => {
    expect(recordHref("leave_request", "abc")).toBe("/leave-requests/abc");
    expect(recordHref("ticket", "abc")).toBe("/entities/ticket/abc");
    expect(canAccessPath("/leave-templates", can(["Workflow.View"]))).toBe(false);
    expect(canAccessPath("/leave-templates", can([leavePermissions.manageTemplates]))).toBe(true);
    expect(canAccessPath("/signatures", can([leavePermissions.manageSignatures]))).toBe(true);
    expect(canAccessPath("/leave-requests/abc", can(["Workflow.View"]))).toBe(true);
  });
});

const file = (name: string, size = 1000) => new File([new Uint8Array(size)], name);

describe("attachments section", () => {
  const config = { max_file_size: 5 * 1024 * 1024, extensions: ["pdf", "jpg", "png", "docx", "xlsx", "txt"] };

  it("pre-checks type, size, empty files and the ten-file limit like the server", () => {
    const { accepted, rejected } = checkAttachments(
      [file("a.pdf"), file("virus.exe"), file("big.png", 6 * 1024 * 1024), file("empty.txt", 0)],
      0,
      config
    );
    expect(accepted.map((item) => item.name)).toEqual(["a.pdf"]);
    expect(rejected).toHaveLength(3);
    expect(rejected[0]).toContain("virus.exe");
    const full = checkAttachments([file("b.pdf"), file("c.pdf")], MAX_ATTACHMENTS - 1, config);
    expect(full.accepted).toHaveLength(1);
    expect(full.rejected[0]).toContain("حداکثر");
    expect(attachmentKind("Scan.PDF")).toBe("pdf");
    expect(attachmentKind("photo.jpeg")).toBe("image");
    expect(attachmentKind("list.xlsx")).toBe("sheet");
    expect(attachmentHint(config)).toContain("PDF");
    expect(attachmentHint(config)).toContain("۵ مگابایت"); // no trailing «.۰»
  });

  it("shows a drop zone, file cards with download links, pending uploads and an accessible remove", () => {
    const html = render(
      <LeaveAttachments
        items={[{ id: "a1", name: "medical-note.pdf", size: 2048 }]}
        pending={[{ key: 1, name: "scan.png", size: 4096 }]}
        config={config}
        hrefFor={(id) => `/files/${id}`}
        onAdd={noop}
        onRemove={noop}
      />
    );
    expect(html).toContain("leave-dropzone");
    expect(html).toMatch(/type="file"[^>]*multiple/);
    expect(html).toContain('accept=".pdf,.jpg,.png,.docx,.xlsx,.txt"');
    expect(html).toContain('href="/files/a1"');
    expect(html).toContain("leave-file-icon-pdf");
    expect(html).toContain("در حال بارگذاری");
    expect(html).toContain('aria-label="حذف «medical-note.pdf» از درخواست"');
    expect(html).toContain("۲ از ۱۰");
    expect(html).not.toContain("نوع مرخصی");
  });

  it("is read-only without handlers and disables the zone when full", () => {
    const readOnly = render(<AttachmentList items={[{ id: "a1", name: "x.docx", size: 10 }]} hrefFor={(id) => id} />);
    expect(readOnly).not.toContain('type="file"');
    expect(readOnly).not.toContain("leave-file-remove");
    expect(render(<AttachmentList items={[]} />)).toContain("بدون پیوست");
    const items = Array.from({ length: MAX_ATTACHMENTS }, (_, index) => ({
      id: `f${index}`,
      name: `${index}.pdf`,
      size: 1,
    }));
    const full = render(<LeaveAttachments items={items} config={config} onAdd={noop} onRemove={noop} />);
    expect(full).toContain("is-full");
    expect(full).toMatch(/type="file"[^>]*disabled/);
  });
});

describe("leave errors stay Persian", () => {
  it("names leave fields in Persian instead of the raw API key", () => {
    const reason = "در این بازه هیچ روز کاری وجود ندارد.";
    const message = errorMessage({ response: { status: 400, data: { end_date: [reason] } } }, "محاسبهٔ مدت ممکن نشد");
    expect(message).toContain("تاریخ پایان");
    expect(message).not.toContain("end date");
    expect(errorMessage({ response: { status: 400, data: { substitute: ["x"] } } }, "خطا")).toContain("جانشین");
  });
});
