import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
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
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Menus restore their trigger on the next frame. Mobile Dialogs focus their
    // container, so establish control focus after that restoration has finished.
    let focusFrame = 0;
    const menuFrame = requestAnimationFrame(() => {
      focusFrame = requestAnimationFrame(() => {
        const button = closeButton.current;
        if (button && !button.closest('[role="dialog"]')?.contains(document.activeElement))
          button.focus({ preventScroll: true });
      });
    });
    return () => {
      cancelAnimationFrame(menuFrame);
      cancelAnimationFrame(focusFrame);
    };
  }, []);
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
        <button
          ref={closeButton}
          type="button"
          className="plain-icon"
          aria-label="بستن"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      {children}
    </ModalCore>
  );
}

export const passwordError = (password: string, confirmation: string) =>
  !password || !confirmation
    ? "وارد کردن رمز عبور و تکرار آن الزامی است."
    : password !== confirmation
      ? "رمز عبور و تکرار آن یکسان نیستند."
      : password.length < 8
        ? "رمز عبور باید حداقل ۸ نویسه باشد."
        : "";
