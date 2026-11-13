/** Ticket page header and tabs (section 6.2):
 * «شماره · عنوان [وضعیت ▾] [ارجاع] [⋯]», «نوع · اولویت · مشتری · پروژه · ثبت‌کننده»,
 * tabs «سابقه | ارجاع‌ها | مرتبط‌ها | زیرتیکت‌ها». */
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { MoreHorizontal } from "lucide-react";
import { useChangeTicketStatus } from "../api/ticket";
import type { TicketCard } from "../api/ticket";
import { CATEGORY_TITLES, PRIORITY_LABELS } from "./model";
import type { WorkCategoryId } from "./model";

export type HeaderAction = "refer" | "contact" | "parent" | "target" | "extension" | "delay";

export function TicketHeader({ card, onAction }: { card: TicketCard; onAction: (action: HeaderAction) => void }) {
  const d = card.details;
  const status = card.status;
  const change = useChangeTicketStatus(card.id);
  const groups = (Object.keys(CATEGORY_TITLES) as WorkCategoryId[])
    .map((category) => ({ category, options: (status?.options ?? []).filter((o) => o.category === category) }))
    .filter((group) => group.options.length);
  const facts: [string, ReactNode][] = [
    ["نوع", d.type || "—"],
    ["اولویت", PRIORITY_LABELS[d.priority] || d.priority || "—"],
    [
      "مشتری",
      d.customers?.length
        ? d.customers.map((row, index) => (
            <span key={row.id}>
              {index > 0 && "، "}
              <Link to={`/entities/customer/${row.id}`}>{row.title}</Link>
            </span>
          ))
        : "—",
    ],
    ["پروژه", d.project || "بدون پروژه"],
    ["ثبت‌کننده", d.creator || "—"],
  ];
  const menu: [HeaderAction, string, boolean][] = [
    ["contact", "حل در تماس", !card.read_only && card.can.contact],
    ["parent", d.parent ? "تغییر تیکت والد" : "تعیین تیکت والد", !card.read_only],
    ["target", "تغییر مدت هدف", !card.read_only && card.deadline.can.set_target],
    ["extension", "درخواست تمدید", !card.read_only && card.deadline.can.request_extension],
    ["delay", "ثبت گزارش تأخیر", !card.read_only && card.deadline.can.report_delay],
  ];
  return (
    <header className="ticket-header">
      <div className="ticket-header-top">
        <h2 className="ticket-header-title">
          {card.number && <span className="ticket-header-number">{card.number}</span>}
          {card.title}
        </h2>
        <div className="ticket-header-actions">
          {status && (
            <label className={`ticket-status-select is-${status.category}`}>
              <span className="sr-only">وضعیت</span>
              <select
                aria-label="وضعیت"
                aria-describedby={!status.can_change ? `status-why-${card.id}` : undefined}
                value={status.current ?? ""}
                disabled={!status.can_change || change.isPending}
                onChange={(event) =>
                  status.field && change.mutate({ field: status.field, value: event.target.value })
                }
              >
                {groups.map((group) => (
                  <optgroup key={group.category} label={CATEGORY_TITLES[group.category]}>
                    {group.options.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.title}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {!status.can_change && (
                <small id={`status-why-${card.id}`} className="ticket-why">
                  {status.why}
                </small>
              )}
            </label>
          )}
          {!card.read_only && (
            <button
              type="button"
              className="button button-secondary"
              disabled={!card.can.refer || Boolean(card.active_referral)}
              aria-describedby={`refer-why-${card.id}`}
              onClick={() => onAction("refer")}
            >
              ارجاع
            </button>
          )}
          {menu.some(([, , enabled]) => enabled) && (
            <Popover className="issue-actions">
              {({ close }) => (
                <>
                  <PopoverButton className="plain-icon" aria-label="اقدام‌های دیگر تیکت" aria-haspopup="menu">
                    <MoreHorizontal size={18} />
                  </PopoverButton>
                  <PopoverPanel className="action-menu issue-action-menu" role="menu" anchor="bottom end" portal dir="rtl">
                    {menu
                      .filter(([, , enabled]) => enabled)
                      .map(([action, label]) => (
                        <button
                          key={action}
                          type="button"
                          role="menuitem"
                          className="issue-action-item"
                          onClick={() => {
                            onAction(action);
                            close();
                          }}
                        >
                          {label}
                        </button>
                      ))}
                  </PopoverPanel>
                </>
              )}
            </Popover>
          )}
        </div>
      </div>
      {!card.read_only && !card.can.refer && (
        <small id={`refer-why-${card.id}`} className="sr-only">
          فقط مسئول یا مدیر دارای مجوز ارجاع می‌تواند ارجاع دهد.
        </small>
      )}
      <dl className="ticket-header-facts">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </header>
  );
}

export type TicketTab = "history" | "portal" | "referrals" | "related" | "children";

export function TicketTabs({
  active,
  onChange,
  counts,
}: {
  active: TicketTab;
  onChange: (tab: TicketTab) => void;
  counts: Partial<Record<TicketTab, number>>;
}) {
  const tabs: [TicketTab, string][] = [
    ["history", "سابقه"],
    ["portal", "مکاتبات"],
    ["referrals", "ارجاع‌ها"],
    ["related", "مرتبط‌ها"],
    ["children", "زیرتیکت‌ها"],
  ];
  return (
    <div className="ticket-tabs" role="tablist" aria-label="بخش‌های تیکت">
      {tabs.map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          id={`ticket-tab-${id}`}
          aria-selected={active === id}
          aria-controls={`ticket-tabpanel-${id}`}
          className={`ticket-tab ${active === id ? "is-active" : ""}`}
          onClick={() => onChange(id)}
        >
          {label}
          {counts[id] !== undefined && <span className="ticket-chip-count">{counts[id]}</span>}
        </button>
      ))}
    </div>
  );
}
