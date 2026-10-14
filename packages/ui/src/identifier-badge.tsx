"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export async function copyIdentifier(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const previousFocus = document.activeElement as HTMLElement | null;
  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  try {
    input.select();
    if (!document.execCommand("copy")) throw new Error("Clipboard unavailable");
  } finally {
    input.remove();
    previousFocus?.focus();
  }
}

export function IdentifierBadge({ value, label = "شناسه" }: { value: string; label?: string }) {
  const [copiedValue, setCopiedValue] = useState("");
  const [failed, setFailed] = useState(false);
  const copied = copiedValue === value;
  return (
    <span className="identifier-badge">
      <button
        type="button"
        className="identifier-copy"
        title={`${label}: ${value}`}
        aria-label={`کپی ${label}: ${value}`}
        onClick={async (event) => {
          event.stopPropagation();
          event.preventDefault();
          try {
            await copyIdentifier(value);
            setCopiedValue(value);
            setFailed(false);
          } catch {
            setFailed(true);
          }
        }}
      >
        <span dir="ltr">{value}</span>
        {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      </button>
      <span className="sr-only" role="status">
        {failed ? "کپی انجام نشد؛ شناسه را انتخاب و کپی کنید." : copied ? "شناسه کپی شد." : ""}
      </span>
    </span>
  );
}
