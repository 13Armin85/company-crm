const sessionEndedEvent = "crm-session-ended";
export const sessionSignalKey = "crm-session-signal";

export function hidePrivateContent() {
  if (typeof document !== "undefined") document.documentElement.dataset.crmSessionHidden = "true";
}

export function revealPrivateContent() {
  if (typeof document !== "undefined") delete document.documentElement.dataset.crmSessionHidden;
}

export function publishSessionEnd() {
  if (typeof window === "undefined") return;
  hidePrivateContent();
  window.dispatchEvent(new Event(sessionEndedEvent));
  try {
    // Only a random notification is persisted; no identity, permission or token.
    localStorage.setItem(sessionSignalKey, `${Date.now()}:${Math.random()}`);
  } catch {
    // Storage can be disabled. Focus and server verification remain authoritative.
  }
}

export function subscribeToSessionEnd(handler: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === sessionSignalKey && event.newValue) {
      hidePrivateContent();
      handler();
    }
  };
  window.addEventListener(sessionEndedEvent, handler);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(sessionEndedEvent, handler);
    window.removeEventListener("storage", storage);
  };
}
