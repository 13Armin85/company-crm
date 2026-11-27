import type { ReactNode } from "react";

/** Keeps the full text visible, wrapping long content inside its cell. */
export function AutoScrollText({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className="crm-auto-scroll" title={title}>
      {children}
    </span>
  );
}
