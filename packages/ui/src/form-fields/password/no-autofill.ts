import { useEffect, useId, useState } from "react";

// Masking a text field keeps the browser from treating it as a login password,
// so it neither fills nor suggests saved passwords. Browsers without the mask
// fall back to a real password field after mounting.
const canMask = () => typeof CSS === "undefined" || CSS.supports("-webkit-text-security", "disc");

/** Props for a secret field the browser must never fill or suggest values for. */
export function useNoAutofill() {
  const name = `field-${useId().replace(/[^a-z0-9]/gi, "")}`;
  const [masked, setMasked] = useState(true);
  useEffect(() => setMasked(canMask()), []);
  return {
    name,
    type: masked ? "text" : "password",
    autoComplete: masked ? ("off" as const) : ("new-password" as const),
    autoCapitalize: "off",
    autoCorrect: "off",
    spellCheck: false,
    "data-no-autofill": "true",
    "data-secret": String(masked),
    "data-lpignore": "true",
    "data-1p-ignore": "true",
    "data-form-type": "other",
  };
}
