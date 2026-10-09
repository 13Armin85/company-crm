import type { ReactNode } from "react";
import { DialogTitle } from "@headlessui/react";
import { ModalCore } from "@plane/ui";
import { X } from "lucide-react";

export { CompactMultiSelector as MultiSelector } from "@plane/ui";

export function AccessModal({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  return (
    <ModalCore
      isOpen
      handleClose={() => {
        if (!busy) onClose();
      }}
      className="create-modal access-modal"
    >
      <header>
        <DialogTitle as="h2">{title}</DialogTitle>
        <button type="button" className="plain-icon" aria-label="بستن" disabled={busy} onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      {children}
    </ModalCore>
  );
}

export const passwordError = (password: string, confirmation: string) =>
  !password || !confirmation
    ? "هر دو رمز عبور الزامی است."
    : password !== confirmation
      ? "رمز عبور و تأیید آن یکسان نیستند."
      : password.length < 8
        ? "رمز عبور باید حداقل ۸ نویسه باشد."
        : "";
