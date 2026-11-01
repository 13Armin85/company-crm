import { useEffect } from "react";

/** Errors are never rendered inline; the app shows them as small toasts. */
export const ERROR_NOTICE_EVENT = "crm:error-notice";

export function notifyError(message: string) {
  if (typeof window === "undefined" || !message) return;
  window.dispatchEvent(new CustomEvent<string>(ERROR_NOTICE_EVENT, { detail: message }));
}

export function ErrorNotice({ message }: { message?: string | null | false }) {
  useEffect(() => {
    if (message) notifyError(message);
  }, [message]);
  return null;
}
