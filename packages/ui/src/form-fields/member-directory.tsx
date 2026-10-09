import { useId, useState } from "react";
import { Plus, Search, UserRound, UsersRound } from "lucide-react";

export type MemberDirectoryOption = {
  id: string;
  title: string;
  email?: string;
  role?: string;
  initials?: string;
  avatarUrl?: string;
};

const normalize = (text: string) =>
  text
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/\u200c/g, " ")
    .trim()
    .toLowerCase();

export function filterMemberDirectory(options: MemberDirectoryOption[], query: string) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  return options.filter((member) => {
    const text = normalize(`${member.title} ${member.email ?? ""} ${member.role ?? ""}`);
    return terms.every((term) => text.includes(term));
  });
}

export function MemberIdentity({ member }: { member: MemberDirectoryOption }) {
  const [failedAvatar, setFailedAvatar] = useState<string>();
  return (
    <span className="crm-member-identity">
      <span className="crm-member-identity-avatar" aria-hidden="true">
        {member.avatarUrl && member.avatarUrl !== failedAvatar ? (
          <img src={member.avatarUrl} alt="" onError={() => setFailedAvatar(member.avatarUrl)} />
        ) : (
          member.initials || <UserRound size={20} />
        )}
      </span>
      <span className="crm-member-identity-details">
        <span className="crm-member-identity-name" dir="auto">
          {member.title}
        </span>
        {member.email && (
          <span className="crm-member-identity-email" dir="ltr">
            {member.email}
          </span>
        )}
        {member.role && (
          <span className="crm-member-identity-role" dir="auto">
            {member.role}
          </span>
        )}
      </span>
    </span>
  );
}

export function MemberDirectory({
  options,
  onAdd,
  disabled = false,
  isLoading = false,
  hasError = false,
  onRetry,
}: {
  options: MemberDirectoryOption[];
  onAdd: (id: string) => void;
  disabled?: boolean;
  isLoading?: boolean;
  hasError?: boolean;
  onRetry?: () => void;
}) {
  const headingId = useId();
  const searchId = useId();
  const [query, setQuery] = useState("");
  const filtered = filterMemberDirectory(options, query);
  return (
    <section className="crm-member-directory" aria-labelledby={headingId} aria-busy={isLoading}>
      <header className="crm-member-directory-heading">
        <h3 id={headingId}>افزودن جانشین</h3>
        <span className="delegate-count" aria-live="polite">
          {filtered.length.toLocaleString("fa-IR")} عضو
        </span>
      </header>
      <p className="crm-member-directory-help">عضو موردنظر را پیدا کنید و با دکمهٔ افزودن به فهرست ببرید.</p>
      <label className="crm-member-directory-search" htmlFor={searchId}>
        <Search size={18} aria-hidden="true" />
        <span className="sr-only">جستجوی اعضا با نام، ایمیل یا نقش</span>
        <input
          id={searchId}
          type="search"
          placeholder="جستجوی نام، ایمیل یا نقش…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={isLoading || hasError}
          autoComplete="off"
        />
      </label>
      <div className="crm-member-directory-results">
        {isLoading ? (
          <p className="crm-member-directory-empty" role="status">
            در حال دریافت اعضا…
          </p>
        ) : hasError ? (
          <div className="crm-member-directory-empty" role="alert">
            <p>دریافت فهرست اعضا انجام نشد.</p>
            {onRetry && (
              <button type="button" onClick={onRetry}>
                تلاش دوباره
              </button>
            )}
          </div>
        ) : filtered.length ? (
          <ul className="crm-member-directory-list" aria-label="اعضای قابل افزودن">
            {filtered.map((member) => (
              <li key={member.id}>
                <MemberIdentity member={member} />
                <button
                  type="button"
                  className="crm-member-directory-add"
                  aria-label={`افزودن جانشین ${member.title}`}
                  disabled={disabled}
                  onClick={() => onAdd(member.id)}
                >
                  <Plus size={16} aria-hidden="true" />
                  <span>افزودن</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="crm-member-directory-empty" role="status">
            <UsersRound size={28} aria-hidden="true" />
            <p>{options.length ? "عضوی با این مشخصات پیدا نشد." : "عضو دیگری برای افزودن وجود ندارد."}</p>
            {query && (
              <button type="button" onClick={() => setQuery("")}>
                پاک کردن جستجو
              </button>
            )}
          </div>
        )}
      </div>
      <p className="crm-member-directory-note">
        مدیر فعلی، اعضای غیرفعال و جانشینان انتخاب‌شده در این فهرست قرار نمی‌گیرند.
      </p>
    </section>
  );
}
