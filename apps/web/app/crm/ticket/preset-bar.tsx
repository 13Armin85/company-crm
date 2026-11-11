/** Ready filters of the ticket list (ن۷); counts come from the server after its visibility filter. */
import { PRESETS, faDigits } from "./model";
import type { PresetId } from "./model";

export function TicketPresetBar({
  value,
  counts,
  onChange,
}: {
  value: PresetId;
  counts?: Record<string, number>;
  onChange: (preset: PresetId) => void;
}) {
  return (
    <div className="ticket-presets" role="tablist" aria-label="فیلترهای آماده تیکت">
      {PRESETS.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={value === item.id}
          className={`ticket-chip ${value === item.id ? "is-active" : ""}`}
          onClick={() => onChange(item.id)}
        >
          {item.label}
          {counts && counts[item.id] !== undefined && (
            <span className="ticket-chip-count">{faDigits(counts[item.id])}</span>
          )}
        </button>
      ))}
    </div>
  );
}
