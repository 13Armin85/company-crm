/** Compact deadline state on table rows and kanban cards (color + icon + text). */
import { AlertTriangle, CheckCircle2, Clock, PauseCircle } from "lucide-react";
import { BADGE_LABELS } from "./model";

const ICONS = { running: Clock, near_due: AlertTriangle, overdue: AlertTriangle, closed: CheckCircle2, not_started: PauseCircle };
const TONES: Record<string, string> = { info: "info", warning: "warning", danger: "danger", success: "success", neutral: "neutral" };

export function TicketDeadlineBadge({ badge }: { badge?: { state: string; target_text: string } }) {
  if (!badge) return null;
  const meta = BADGE_LABELS[badge.state];
  if (!meta) return null;
  const Icon = ICONS[badge.state as keyof typeof ICONS] ?? Clock;
  return (
    <span
      className={`ticket-deadline-badge ticket-pill-${TONES[meta.tone]}`}
      title={badge.target_text ? `موعد: ${badge.target_text}` : undefined}
    >
      <Icon size={12} aria-hidden />
      {meta.label}
    </span>
  );
}
