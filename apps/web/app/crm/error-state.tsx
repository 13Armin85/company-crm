import { ErrorNotice } from "@plane/ui";
import { RotateCcw } from "lucide-react";

export { ErrorNotice };

/** Replaces a screen that failed to load: the message goes to a toast, the screen offers a retry. */
export function ErrorState({ message, onRetry }: { message?: string | null | false; onRetry?: () => void }) {
  return (
    <div className="error-state">
      <ErrorNotice message={message} />
      <button type="button" className="button button-secondary" onClick={onRetry ?? (() => window.location.reload())}>
        <RotateCcw size={15} aria-hidden="true" />
        تلاش دوباره
      </button>
    </div>
  );
}
