/** Ticket 7 — "درگاه مشتری" settings: portal accounts (Portal.Account.Manage) and the customer-visible
 * status list, mapping and limits (Portal.Settings.Manage). The server validates every value again. */
import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { useWorkspaceAccess } from "../api";
import {
  useCreatePortalAccount,
  useIssuePortalLink,
  usePortalAccountOptions,
  usePortalAccounts,
  usePortalAdminSettings,
  useSavePortalSettings,
  useUpdatePortalAccount,
} from "../api/portal";
import type { PortalSettingsDoc, PortalSettingsPayload, SetupLink } from "../api/portal";
import { portalPermissions } from "../access/permission-map";
import { Button, PageHeader, Skeleton } from "../components";
import { persianDate, toFa } from "../utils";

/** Labels referenced by the mapping must stay in the allowed list (the server refuses otherwise too). */
export const settingsProblems = (doc: PortalSettingsDoc) => {
  const codes = new Set(doc.labels.map((item) => item.code));
  const problems: string[] = [];
  if (!doc.labels.length) problems.push("دست‌کم یک برچسب مجاز لازم است.");
  if (doc.labels.some((item) => !/^[a-z][a-z0-9_]{1,39}$/.test(item.code)))
    problems.push("کد برچسب باید با حرف لاتین کوچک شروع شود و فقط حروف، عدد و _ داشته باشد.");
  if (doc.labels.some((item) => !item.title.trim())) problems.push("عنوان هیچ برچسبی نباید خالی باشد.");
  if (codes.size !== doc.labels.length) problems.push("کد برچسب‌ها نباید تکراری باشد.");
  const used = [...Object.values(doc.status_map), ...Object.values(doc.stage_labels), doc.default_label];
  if (used.some((code) => !codes.has(code))) problems.push("نگاشتی به برچسبی خارج از فهرست مجاز اشاره می‌کند.");
  return problems;
};

const linkUrl = (link: SetupLink) => `${window.location.origin}${link.path}`;

function LinkNotice({ link }: { link: SetupLink }) {
  return (
    <div className="portal-link-notice" role="status">
      <p>
        این پیوند یک‌بارمصرف را خودتان به مشتری تحویل دهید (ارسال خودکار ایمیل فعال نیست). اعتبار تا{" "}
        {persianDate(link.expires_at, { year: "numeric", hour: "2-digit" })}:
      </p>
      <input readOnly dir="ltr" value={linkUrl(link)} onFocus={(event) => event.target.select()} />
      <Button variant="secondary" onClick={() => void navigator.clipboard?.writeText(linkUrl(link))}>
        رونوشت پیوند
      </Button>
    </div>
  );
}

function Accounts() {
  const accounts = usePortalAccounts();
  const options = usePortalAccountOptions();
  const create = useCreatePortalAccount();
  const update = useUpdatePortalAccount();
  const issue = useIssuePortalLink();
  const [form, setForm] = useState({
    username: "",
    display_name: "",
    email: "",
    customer_record_id: "",
    contact_record_id: "",
  });
  const [link, setLink] = useState<SetupLink | null>(null);
  return (
    <section className="portal-admin-card" aria-label="حساب‌های درگاه">
      <h2>حساب‌های درگاه</h2>
      <form
        className="portal-admin-form"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate(
            { ...form, contact_record_id: form.contact_record_id || undefined },
            {
              onSuccess: (data) => {
                setLink(data.setup);
                setForm({ username: "", display_name: "", email: "", customer_record_id: "", contact_record_id: "" });
              },
            }
          );
        }}
      >
        <label>
          <span>مشتری</span>
          <select
            required
            value={form.customer_record_id}
            onChange={(event) => setForm({ ...form, customer_record_id: event.target.value })}
          >
            <option value="">انتخاب کنید</option>
            {(options.data?.customer ?? []).map((row) => (
              <option key={row.id} value={row.id}>
                {row.title} ({row.number})
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>مخاطب (اختیاری)</span>
          <select
            value={form.contact_record_id}
            onChange={(event) => setForm({ ...form, contact_record_id: event.target.value })}
          >
            <option value="">بدون مخاطب</option>
            {(options.data?.contact ?? []).map((row) => (
              <option key={row.id} value={row.id}>
                {row.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>نام نمایشی</span>
          <input
            required
            value={form.display_name}
            onChange={(event) => setForm({ ...form, display_name: event.target.value })}
          />
        </label>
        <label>
          <span>نام کاربری</span>
          <input
            required
            dir="ltr"
            value={form.username}
            onChange={(event) => setForm({ ...form, username: event.target.value.toLowerCase() })}
          />
        </label>
        <label>
          <span>ایمیل (اختیاری)</span>
          <input
            dir="ltr"
            type="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />
        </label>
        <Button type="submit" disabled={create.isPending}>
          ساخت حساب و صدور پیوند
        </Button>
      </form>
      {link && <LinkNotice link={link} />}
      {!accounts.data ? (
        <Skeleton rows={3} />
      ) : !accounts.data.length ? (
        <p className="ticket-muted">هنوز حساب درگاهی ساخته نشده است.</p>
      ) : (
        <div className="portal-table-wrap">
          <table className="leave-table">
            <thead>
              <tr>
                <th>نام</th>
                <th>نام کاربری</th>
                <th>مشتری</th>
                <th>وضعیت</th>
                <th>آخرین ورود</th>
                <th>اقدام</th>
              </tr>
            </thead>
            <tbody>
              {accounts.data.map((row) => (
                <tr key={row.id}>
                  <td>{row.display_name}</td>
                  <td dir="ltr">{row.username}</td>
                  <td>
                    {row.customer.title}
                    {row.contact ? ` · ${row.contact.title}` : ""}
                  </td>
                  <td>
                    {!row.is_active
                      ? "غیرفعال"
                      : row.locked
                        ? "قفل موقت"
                        : row.has_password
                          ? "فعال"
                          : "منتظر تعیین گذرواژه"}
                  </td>
                  <td>
                    {row.last_login_at ? persianDate(row.last_login_at, { year: "numeric", hour: "2-digit" }) : "—"}
                  </td>
                  <td className="leave-actions">
                    <Button
                      variant="secondary"
                      disabled={update.isPending}
                      onClick={() => update.mutate({ id: row.id, is_active: !row.is_active })}
                    >
                      {row.is_active ? "غیرفعال‌سازی" : "فعال‌سازی"}
                    </Button>
                    {row.is_active && (
                      <Button
                        variant="ghost"
                        disabled={issue.isPending}
                        onClick={() => issue.mutate(row.id, { onSuccess: setLink })}
                      >
                        پیوند تعیین/بازنشانی گذرواژه
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StatusSettings({ payload }: { payload: PortalSettingsPayload }) {
  const save = useSavePortalSettings();
  const [doc, setDoc] = useState<PortalSettingsDoc>(payload.settings);
  useEffect(() => setDoc(payload.settings), [payload.settings]);
  const problems = settingsProblems(doc);
  const readOnly = !payload.can_edit;
  const labelSelect = (value: string | undefined, onChange: (code: string) => void, allowEmpty = false) => (
    <select value={value ?? ""} disabled={readOnly} onChange={(event) => onChange(event.target.value)}>
      {allowEmpty && <option value="">— از دستهٔ وضعیت —</option>}
      {doc.labels.map((item) => (
        <option key={item.code} value={item.code}>
          {item.title}
        </option>
      ))}
    </select>
  );
  const setMap = (key: string, code: string) => {
    const next = { ...doc.status_map };
    if (code) next[key] = code;
    else delete next[key];
    setDoc({ ...doc, status_map: next });
  };
  return (
    <form
      className="portal-admin-card"
      aria-label="تنظیمات درگاه"
      onSubmit={(event) => {
        event.preventDefault();
        if (!problems.length) save.mutate(doc);
      }}
    >
      <h2>وضعیت‌های قابل‌نمایش برای مشتری</h2>
      <p className="ticket-muted">
        مشتری فقط برچسب‌های این فهرست را می‌بیند؛ نام وضعیت‌های داخلی هرگز نمایش داده نمی‌شود. وضعیت نگاشت‌نشده با برچسب
        پیش‌فرض نشان داده می‌شود.
      </p>
      <table className="leave-table">
        <thead>
          <tr>
            <th>کد</th>
            <th>عنوان برای مشتری</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {doc.labels.map((item, index) => (
            <tr key={index}>
              <td>
                <input
                  dir="ltr"
                  disabled={readOnly}
                  value={item.code}
                  onChange={(event) =>
                    setDoc({
                      ...doc,
                      labels: doc.labels.map((l, i) => (i === index ? { ...l, code: event.target.value } : l)),
                    })
                  }
                />
              </td>
              <td>
                <input
                  disabled={readOnly}
                  value={item.title}
                  onChange={(event) =>
                    setDoc({
                      ...doc,
                      labels: doc.labels.map((l, i) => (i === index ? { ...l, title: event.target.value } : l)),
                    })
                  }
                />
              </td>
              <td>
                {!readOnly && (
                  <Button
                    variant="ghost"
                    onClick={() => setDoc({ ...doc, labels: doc.labels.filter((_, i) => i !== index) })}
                  >
                    حذف
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!readOnly && (
        <Button
          variant="secondary"
          onClick={() => setDoc({ ...doc, labels: [...doc.labels, { code: "", title: "" }] })}
        >
          افزودن برچسب
        </Button>
      )}
      <h3>نگاشت وضعیت داخلی → برچسب مشتری</h3>
      <div className="portal-map">
        {payload.categories.map((row) => (
          <label key={row.key}>
            <span>دستهٔ «{row.title}»</span>
            {labelSelect(doc.status_map[row.key], (code) => setMap(row.key, code), true)}
          </label>
        ))}
        {payload.statuses.map((row) => (
          <label key={row.key}>
            <span>وضعیت «{row.title}» (تیکت بدون پروژه)</span>
            {labelSelect(doc.status_map[row.key], (code) => setMap(row.key, code), true)}
          </label>
        ))}
        {payload.stages
          .filter((row) => row.code !== "accepted")
          .map((row) => (
            <label key={row.code}>
              <span>مرحلهٔ تریاژ «{row.title}»</span>
              {labelSelect(doc.stage_labels[row.code], (code) =>
                setDoc({ ...doc, stage_labels: { ...doc.stage_labels, [row.code]: code } })
              )}
            </label>
          ))}
        <label>
          <span>برچسب پیش‌فرض (وضعیت نگاشت‌نشده)</span>
          {labelSelect(doc.default_label, (code) => setDoc({ ...doc, default_label: code }))}
        </label>
      </div>
      <h3>پاسخ‌دهنده و بازخورد</h3>
      <div className="portal-map">
        <label>
          <span>نام پاسخ‌دهنده برای مشتری</span>
          <select
            disabled={readOnly}
            value={doc.staff_name}
            onChange={(event) => setDoc({ ...doc, staff_name: event.target.value as PortalSettingsDoc["staff_name"] })}
          >
            <option value="team">نام تیم</option>
            <option value="display_name">نام نمایشی کارمند</option>
          </select>
        </label>
        <label>
          <span>نام تیم</span>
          <input
            disabled={readOnly}
            value={doc.team_name}
            onChange={(event) => setDoc({ ...doc, team_name: event.target.value })}
          />
        </label>
        <label>
          <span>مهلت ویرایش بازخورد (ساعت)</span>
          <input
            type="number"
            min={0}
            max={720}
            disabled={readOnly}
            value={doc.feedback_edit_hours}
            onChange={(event) => setDoc({ ...doc, feedback_edit_hours: Number(event.target.value) })}
          />
        </label>
        <label>
          <span>بی‌کاری تا پایان نشست (دقیقه)</span>
          <input
            type="number"
            min={5}
            disabled={readOnly}
            value={doc.session.idle_minutes}
            onChange={(event) =>
              setDoc({ ...doc, session: { ...doc.session, idle_minutes: Number(event.target.value) } })
            }
          />
        </label>
        <label>
          <span>بیشینهٔ عمر نشست (ساعت)</span>
          <input
            type="number"
            min={1}
            disabled={readOnly}
            value={doc.session.absolute_hours}
            onChange={(event) =>
              setDoc({ ...doc, session: { ...doc.session, absolute_hours: Number(event.target.value) } })
            }
          />
        </label>
        <label>
          <span>حداکثر فایل در هر پیام</span>
          <input
            type="number"
            min={1}
            max={10}
            disabled={readOnly}
            value={doc.files.max_count}
            onChange={(event) => setDoc({ ...doc, files: { ...doc.files, max_count: Number(event.target.value) } })}
          />
        </label>
      </div>
      <h3>کانال‌های اعلان به مشتری</h3>
      <ul className="portal-settings">
        <li>
          <label>
            <input type="checkbox" checked disabled /> <span>اعلان درون‌درگاهی (همیشه فعال)</span>
          </label>
        </li>
        {(["email", "sms"] as const).map((channel) => {
          const available = payload.server_channels.includes(channel);
          return (
            <li key={channel}>
              <label>
                <input
                  type="checkbox"
                  disabled={readOnly || !available}
                  checked={doc.notify_channels[channel]}
                  onChange={(event) =>
                    setDoc({ ...doc, notify_channels: { ...doc.notify_channels, [channel]: event.target.checked } })
                  }
                />
                <span>{channel === "email" ? "ایمیل" : "پیامک"}</span>
              </label>
              {!available && <small className="ticket-muted">غیرفعال تا تنظیم سرویس</small>}
            </li>
          );
        })}
      </ul>
      {problems.length > 0 && (
        <ul className="ticket-errors" role="alert">
          {problems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <Button type="submit" disabled={save.isPending || problems.length > 0}>
          ذخیرهٔ تنظیمات درگاه
        </Button>
      )}
      <p className="ticket-muted">
        پسوندهای مجاز فایل: {doc.files.extensions.join("، ")} · حداکثر حجم{" "}
        {toFa(Math.round(doc.files.max_size / 1024 / 1024))} مگابایت
      </p>
    </form>
  );
}

export default function PortalSettingsPage() {
  const { data: access, isLoading } = useWorkspaceAccess();
  const accounts = access?.can(portalPermissions.manageAccounts) ?? false;
  const settings = access?.can(portalPermissions.manageSettings) ?? false;
  const payload = usePortalAdminSettings(accounts || settings);
  if (isLoading) return <Skeleton rows={5} />;
  if (!accounts && !settings) return <Navigate to="/" replace />;
  return (
    <div className="leave-page portal-admin" dir="rtl">
      <PageHeader
        eyebrow="تنظیمات"
        title="درگاه مشتری"
        description="حساب‌های مشتری، وضعیت‌هایی که مشتری می‌بیند و کانال‌های اعلان. نشانی درگاه برای مشتری: /portal"
      />
      {accounts && <Accounts />}
      {payload.data ? <StatusSettings payload={payload.data} /> : <Skeleton rows={4} />}
    </div>
  );
}
