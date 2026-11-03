/** Small presentational building blocks shared by every CRM page. */
import { PersianDatePicker } from "@plane/ui";
import { useContext, useEffect } from "react";
import { ChoiceLabelsContext } from "../choice-label-context";
import type { ReactNode } from "react";
import { Archive, CircleAlert, Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCurrentUser } from "../api";
import { TableTabPicker, useHiddenTabs } from "../engine/table-tab-picker";
import type { Member, Priority, Status } from "../types";
import { priorityFa, statusFa, toFa } from "../utils";

export function IconButton({
  children,
  label,
  onClick,
  className = "",
  disabled = false,
}: {
  children: ReactNode;
  label: string;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`icon-button ${className}`}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="section-header">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  icon: Icon,
  onClick,
  type = "button",
  disabled,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  icon?: LucideIcon;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button className={`button button-${variant}`} type={type} onClick={onClick} disabled={disabled}>
      {Icon && <Icon size={16} />}
      {children}
    </button>
  );
}

export function Avatar({ member, size = "md" }: { member?: Member; size?: "sm" | "md" | "lg" }) {
  if (!member) return <span className={`avatar avatar-${size} avatar-empty`}>؟</span>;
  return (
    <span className={`avatar avatar-${size}`} style={{ background: member.avatarColor }} title={member.displayName}>
      {member.avatarUrl ? <img src={member.avatarUrl} alt={member.displayName} /> : member.initials}
      {member.online && <i />}
    </span>
  );
}

export function AvatarStack({ members = [], max = 3 }: { members?: Member[]; max?: number }) {
  return (
    <div className="avatar-stack">
      {members.slice(0, max).map((member) => (
        <Avatar key={member.id} member={member} size="sm" />
      ))}
      {members.length > max && <span className="avatar avatar-sm avatar-more">+{toFa(members.length - max)}</span>}
    </div>
  );
}

export function StatusBadge({
  status,
  code,
  label,
  color,
}: {
  status: Status;
  code?: string;
  label?: string;
  color?: string;
}) {
  const choices = useContext(ChoiceLabelsContext);
  const option = choices.task_status.find((o) => o.id === code);
  const title =
    label && !["Backlog", "Todo", "In Progress", "Review", "Done", "Blocked", "Cancelled"].includes(label)
      ? label
      : label
        ? statusFa[status]
        : option?.title || statusFa[status];
  return (
    <span
      className={`status status-${status.replace(" ", "-").toLowerCase()}`}
      style={{ color: color || option?.color }}
    >
      <i />
      {title}
    </span>
  );
}
export function PriorityBadge({ priority, code }: { priority: Priority; code?: string }) {
  const choices = useContext(ChoiceLabelsContext);
  const option = choices.priority.find((o) => o.id === (code || priority.toLowerCase()));
  return (
    <span className={`priority priority-${priority.toLowerCase()}`} style={{ color: option?.color }}>
      <CircleAlert size={13} />
      {option?.title ||
        (code && !["urgent", "high", "medium", "low", "none"].includes(code) ? code : priorityFa[priority])}
    </span>
  );
}

export function Skeleton({ rows = 3, cards = false }: { rows?: number; cards?: boolean }) {
  return (
    <div className={cards ? "skeleton-grid" : "skeleton-list"}>
      {Array.from({ length: rows }, (_, index) => `skeleton-${index + 1}`).map((id) => (
        <div className={cards ? "skeleton-card" : "skeleton-row"} key={id}>
          <i />
          <span />
          <b />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon: Icon = Archive,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span>
        <Icon size={24} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function TabBar({
  items,
  active,
  onChange,
  chooserKey,
}: {
  items: { id: string; label: string; count?: number }[];
  active: string;
  onChange: (id: string) => void;
  /** Lets each viewer choose which of these tabs to show. */
  chooserKey?: string;
}) {
  const [hidden, setHidden] = useHiddenTabs(chooserKey || "");
  const visible = chooserKey ? items.filter((item) => !hidden.includes(item.id)) : items;
  const shown = visible.length ? visible : items.slice(0, 1);
  const activeShown = shown.some((item) => item.id === active);
  const fallbackId = shown[0]?.id;
  useEffect(() => {
    if (!activeShown && fallbackId) onChange(fallbackId);
  }, [activeShown, fallbackId, onChange]);
  const bar = (
    <div className="tab-bar">
      {shown.map((item) => (
        <button key={item.id} className={item.id === active ? "active" : ""} onClick={() => onChange(item.id)}>
          {item.label}
          {item.count !== undefined && <span>{toFa(item.count)}</span>}
        </button>
      ))}
    </div>
  );
  if (!chooserKey) return bar;
  return (
    <div className="tab-bar-with-chooser">
      {bar}
      <TableTabPicker
        includeMain={false}
        tabs={items.map((item) => ({ id: item.id, title: item.label }))}
        hidden={hidden.filter((id) => items.some((item) => item.id === id))}
        onChange={setHidden}
      />
    </div>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder = "جستجو...",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="search-box">
      <Search size={17} />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

export function PersianDateInput({
  id,
  value,
  onChange,
  disabled,
  label,
}: {
  id: string;
  value?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const { data: user } = useCurrentUser();
  return (
    <PersianDatePicker
      label={label}
      disabled={disabled}
      id={id}
      value={value}
      onChange={onChange}
      timeZone={user?.timeZone}
    />
  );
}
