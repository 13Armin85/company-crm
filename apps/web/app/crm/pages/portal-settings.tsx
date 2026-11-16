import { SurfaceTable, ConfiguredFields } from "../engine/surface";
/** Ticket 7 — "درگاه مشتری" settings: portal accounts (Portal.Account.Manage) and the customer-visible
 * status list, mapping and limits (Portal.Settings.Manage). The server validates every value again. */
import { useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { ArrowUpLeft, Globe, Inbox, KeyRound, Settings2, Users, UserRound, Power } from "lucide-react";
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
import { Button, EmptyState, PageHeader, SearchBox, Skeleton } from "../components";
import { persianDate, toFa } from "../utils";
import { CustomerRequests } from "./portal-requests";
import { ErrorNotice } from "../error-state";
import { errorMessage } from "../api/client";
import { accountState, accountStates, filterAccounts } from "./portal-account-model";
import type { AccountState } from "./portal-account-model";

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

export function Accounts() {
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
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<AccountState | "all">("all");
  const rows = filterAccounts(accounts.data ?? [], query, status);
  return (
    <section className="portal-admin-card portal-accounts" aria-label="حساب‌های درگاه">
      <div className="portal-section-heading">
        <div>
          <h2>
            <Users size={20} aria-hidden="true" /> حساب‌های مشتریان
          </h2>
          <p>حساب هر مشتری، وضعیت دسترسی و پیوند تعیین گذرواژه را از اینجا مدیریت کنید.</p>
        </div>
        {accounts.data && <span className="portal-account-count">{toFa(accounts.data.length)} حساب</span>}
      </div>
      <ConfiguredFields code="portal-accounts">
        <details className="portal-account-create">
          <summary>افزودن حساب مشتری</summary>
          <form
            className="portal-admin-form"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate(
                { ...form, contact_record_id: form.contact_record_id || undefined },
                {
                  onSuccess: (data) => {
                    setLink(data.setup);
                    setForm({
                      username: "",
                      display_name: "",
                      email: "",
                      customer_record_id: "",
                      contact_record_id: "",
                    });
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
                placeholder="مثلاً سارا احمدی"
                value={form.display_name}
                onChange={(event) => setForm({ ...form, display_name: event.target.value })}
              />
            </label>
            <label>
              <span>نام کاربری</span>
              <input
                required
                dir="ltr"
                autoComplete="off"
                placeholder="مثلاً sara.ahmadi"
                value={form.username}
                onChange={(event) => setForm({ ...form, username: event.target.value.toLowerCase() })}
              />
            </label>
            <label>
              <span>ایمیل (اختیاری)</span>
              <input
                dir="ltr"
                type="email"
                placeholder="مثلاً sara@example.com"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </label>
            <div className="portal-account-form-footer">
              <p>پس از ساخت حساب، پیوند تعیین گذرواژه را به مشتری تحویل دهید.</p>
              <Button type="submit" disabled={create.isPending || options.isLoading || Boolean(options.error)}>
                {create.isPending ? "در حال ساخت حساب…" : "ساخت حساب و صدور پیوند"}
              </Button>
            </div>
          </form>
        </details>
      </ConfiguredFields>
      {(create.error || update.error || issue.error || options.error || accounts.error) && (
        <ErrorNotice
          message={errorMessage(
            create.error || update.error || issue.error || options.error || accounts.error,
            "عملیات حساب درگاه انجام نشد."
          )}
        />
      )}
      {link && <LinkNotice link={link} />}
      <div className="portal-account-filters">
        <SearchBox value={query} onChange={setQuery} placeholder="جستجوی نام، نام کاربری یا مشتری…" />
        <label className="portal-account-status-filter">
          <span>وضعیت حساب</span>
          <select
            aria-label="وضعیت حساب"
            value={status}
            onChange={(event) => setStatus(event.target.value as AccountState | "all")}
          >
            <option value="all">همهٔ وضعیت‌ها</option>
            {Object.entries(accountStates).map(([code, title]) => (
              <option key={code} value={code}>
                {title}
              </option>
            ))}
          </select>
        </label>
        {accounts.data && (
          <p className="portal-result-count" role="status">
            {toFa(rows.length)} از {toFa(accounts.data.length)} حساب
          </p>
        )}
      </div>
      {accounts.isLoading ? (
        <Skeleton rows={3} />
      ) : accounts.error ? (
        <Button variant="secondary" onClick={() => void accounts.refetch()}>
          تلاش دوباره
        </Button>
      ) : !rows.length ? (
        <EmptyState
          icon={Users}
          title={accounts.data?.length ? "حسابی با این مشخصات پیدا نشد" : "هنوز حساب مشتری ساخته نشده است"}
          description={
            accounts.data?.length
              ? "عبارت جستجو یا وضعیت انتخاب‌شده را تغییر دهید."
              : "از «افزودن حساب مشتری» برای ایجاد دسترسی به درگاه استفاده کنید."
          }
          action={
            accounts.data?.length ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setQuery("");
                  setStatus("all");
                }}
              >
                پاک‌کردن فیلترها
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="portal-table-wrap">
          <SurfaceTable
            code="portal-accounts"
            className="leave-table portal-accounts-table"
            aria-label="حساب‌های مشتریان"
          >
            <thead>
              <tr>
                <th scope="col">نام</th>
                <th scope="col">نام کاربری</th>
                <th scope="col">مشتری</th>
                <th scope="col">وضعیت</th>
                <th scope="col">آخرین ورود</th>
                <th scope="col">اقدام</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="portal-account-person">
                      <span className="portal-account-avatar" aria-hidden="true">
                        <UserRound size={18} />
                      </span>
                      <div>
                        <strong>{row.display_name}</strong>
                        {row.email && (
                          <small>
                            <bdi dir="ltr">{row.email}</bdi>
                          </small>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    <bdi className="portal-account-username" dir="ltr">
                      {row.username}
                    </bdi>
                  </td>
                  <td>
                    <div className="portal-account-customer">
                      <strong>{row.customer.title}</strong>
                      {row.contact && <small>مخاطب: {row.contact.title}</small>}
                    </div>
                  </td>
                  <td>
                    <span className={`portal-account-status is-${accountState(row)}`}>
                      <i aria-hidden="true" />
                      {accountStates[accountState(row)]}
                    </span>
                  </td>
                  <td>
                    {row.last_login_at ? (
                      <time className="portal-account-login" dateTime={row.last_login_at}>
                        {persianDate(row.last_login_at, { year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </time>
                    ) : (
                      <span className="portal-account-no-login">هنوز وارد نشده</span>
                    )}
                  </td>
                  <td>
                    <div className="portal-account-actions">
                      <Button
                        variant="secondary"
                        icon={Power}
                        disabled={update.isPending}
                        onClick={() => update.mutate({ id: row.id, is_active: !row.is_active })}
                      >
                        {row.is_active ? "غیرفعال‌سازی" : "فعال‌سازی"}
                      </Button>
                      {row.is_active && (
                        <Button
                          variant="ghost"
                          icon={KeyRound}
                          disabled={issue.isPending}
                          onClick={() => issue.mutate(row.id, { onSuccess: setLink })}
                        >
                          {row.has_password ? "بازنشانی گذرواژه" : "پیوند تعیین گذرواژه"}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </SurfaceTable>
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
    <ConfiguredFields code="portal-settings-form">
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
        <SurfaceTable code="portal-status-labels" className="leave-table">
          <thead>
            <tr>
              <th>کد</th>
              <th>عنوان برای مشتری</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {doc.labels.map((item, index) => (
              // eslint-disable-next-line react/no-array-index-key -- Labels are controlled positional slots and their editable codes can be blank or duplicated while typing.
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
        </SurfaceTable>
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
              onChange={(event) =>
                setDoc({ ...doc, staff_name: event.target.value as PortalSettingsDoc["staff_name"] })
              }
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
    </ConfiguredFields>
  );
}

export default function PortalSettingsPage() {
  const [params, setParams] = useSearchParams();
  const { data: access, isLoading } = useWorkspaceAccess();
  const accounts = access?.can(portalPermissions.manageAccounts) ?? false;
  const settings = access?.can(portalPermissions.manageSettings) ?? false;
  const allowed = Object.values(portalPermissions).some((permission) => access?.can(permission));
  const section = params.get("section") || "requests";
  const active =
    section === "accounts" && accounts
      ? "accounts"
      : section === "settings" && (accounts || settings)
        ? "settings"
        : "requests";
  const payload = usePortalAdminSettings(accounts || settings);
  if (isLoading) return <Skeleton rows={5} />;
  if (!allowed) return <Navigate to="/" replace />;
  return (
    <div className="leave-page portal-admin" dir="rtl">
      <PageHeader
        eyebrow="ارتباط با مشتریان"
        title="درگاه مشتری"
        description="درخواست‌های مشتریان را یک‌جا ببینید، پاسخ دهید و دسترسی به درگاه را مدیریت کنید."
        actions={
          <Link className="button button-secondary" to="/portal" target="_blank" rel="noreferrer">
            <Globe size={16} /> مشاهدهٔ درگاه مشتری <ArrowUpLeft size={15} />
          </Link>
        }
      />
      <nav className="portal-admin-tabs" aria-label="بخش‌های مدیریت درگاه">
        {[
          { id: "requests", title: "درخواست‌های مشتریان", icon: Inbox, visible: true },
          { id: "accounts", title: "حساب‌های مشتریان", icon: Users, visible: accounts },
          { id: "settings", title: "تنظیمات درگاه", icon: Settings2, visible: accounts || settings },
        ]
          .filter((item) => item.visible)
          .map(({ id, title, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={active === id ? "page" : undefined}
              onClick={() => setParams({ section: id })}
            >
              <Icon size={18} />
              {title}
            </button>
          ))}
      </nav>
      {active === "requests" && <CustomerRequests />}
      {active === "accounts" && <Accounts />}
      {active === "settings" &&
        (payload.error ? (
          <ErrorNotice message={errorMessage(payload.error, "تنظیمات درگاه دریافت نشد.")} />
        ) : payload.data ? (
          <StatusSettings payload={payload.data} />
        ) : (
          <Skeleton rows={4} />
        ))}
    </div>
  );
}
