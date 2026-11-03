/** Live region that renders queued toasts and error notices. */
import { ERROR_NOTICE_EVENT } from "@plane/ui";
import { useEffect } from "react";
import { CheckCircle2, CircleAlert, CircleDot, X } from "lucide-react";
import { useUIStore } from "../store";

export function ToastRegion() {
  const toasts = useUIStore((state) => state.toasts);
  const remove = useUIStore((state) => state.removeToast);
  useEffect(() => {
    const show = (event: Event) => {
      const message = (event as CustomEvent<string>).detail;
      if (message) useUIStore.getState().toast(message, "error");
    };
    window.addEventListener(ERROR_NOTICE_EVENT, show);
    return () => window.removeEventListener(ERROR_NOTICE_EVENT, show);
  }, []);
  return (
    <div className="toast-region" aria-live="polite">
      {toasts.map((toast) => (
        <button key={toast.id} className={`toast toast-${toast.kind}`} onClick={() => remove(toast.id)}>
          {toast.kind === "error" ? (
            <CircleAlert size={18} />
          ) : toast.kind === "info" ? (
            <CircleDot size={18} />
          ) : (
            <CheckCircle2 size={18} />
          )}
          <span>{toast.message}</span>
          <X size={14} />
        </button>
      ))}
    </div>
  );
}
