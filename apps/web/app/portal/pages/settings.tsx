/** The customer's own notification choices. External channels stay disabled until the company enables them. */
import { portalError } from "../api/client";
import { usePortalSession, usePortalSettings } from "../api/portal";
import { ErrorList, PortalCard } from "../components";

export default function PortalSettings() {
  const session = usePortalSession();
  const save = usePortalSettings();
  const account = session.data;
  if (!account) return null;
  const rows: { key: "portal" | "email" | "sms"; label: string; available: boolean; hint: string }[] = [
    { key: "portal", label: "نشان «به‌روزرسانی جدید» در درگاه", available: true, hint: "" },
    {
      key: "email",
      label: "ایمیل",
      available: account.channels_available.email,
      hint: "غیرفعال تا راه‌اندازی سرویس ایمیل توسط شرکت",
    },
    {
      key: "sms",
      label: "پیامک",
      available: account.channels_available.sms,
      hint: "غیرفعال تا راه‌اندازی سرویس پیامک توسط شرکت",
    },
  ];
  return (
    <PortalCard title="تنظیمات اعلان">
      <ul className="portal-settings">
        {rows.map((row) => (
          <li key={row.key}>
            <label>
              <input
                type="checkbox"
                checked={account.notify[row.key]}
                disabled={!row.available || save.isPending}
                onChange={(event) => save.mutate({ [row.key]: event.target.checked })}
              />
              <span>{row.label}</span>
            </label>
            {!row.available && <small className="portal-muted">{row.hint}</small>}
          </li>
        ))}
      </ul>
      <ErrorList items={save.error ? [portalError(save.error, "ذخیرهٔ تنظیمات انجام نشد.")] : []} />
      <p className="portal-muted">
        حساب: {account.username} · نشست پس از {account.idle_minutes} دقیقه بی‌کاری به پایان می‌رسد.
      </p>
    </PortalCard>
  );
}
