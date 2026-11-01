import { useId, useState } from "react";

/**
 * Browsers ignore autocomplete="off" for saved logins but never fill a read-only
 * field, so the field stays read-only until the user focuses it.
 */
export function useNoAutofill() {
  const name = `field-${useId().replace(/[^a-z0-9]/gi, "")}`;
  const [armed, setArmed] = useState(false);
  return {
    name,
    autoComplete: "new-password" as const,
    readOnly: !armed,
    onFocus: () => setArmed(true),
    "data-no-autofill": "true",
    "data-lpignore": "true",
    "data-1p-ignore": "true",
    "data-form-type": "other",
  };
}
