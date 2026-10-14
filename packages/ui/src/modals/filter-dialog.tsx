import type { ReactNode } from "react";
import { DialogDescription, DialogTitle } from "@headlessui/react";
import { X } from "lucide-react";
import { EModalWidth } from "./constants";
import { ModalCore } from "./modal-core";

export interface FilterDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  children: ReactNode;
  resultCount: number;
  resultLabel: string;
  loading?: boolean;
  validationMessage?: string;
  onClose: () => void;
  onApply: () => void;
  onReset: () => void;
}

export function FilterDialog({
  isOpen,
  title,
  description,
  children,
  resultCount,
  resultLabel,
  loading = false,
  validationMessage,
  onClose,
  onApply,
  onReset,
}: FilterDialogProps) {
  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} width={EModalWidth.XXL} className="data-filter-dialog">
      <header dir="rtl">
        <div>
          <DialogTitle as="h2">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </div>
        <button type="button" onClick={onClose} aria-label="بستن فیلتر">
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <div className="data-filter-body" dir="rtl">
        {children}
      </div>
      <footer dir="rtl">
        {validationMessage ? (
          <p role="alert" className="data-filter-error">
            {validationMessage}
          </p>
        ) : (
          <p role="status" aria-live="polite">
            {loading ? "در حال دریافت داده‌ها…" : `${resultCount.toLocaleString("fa-IR")} ${resultLabel}`}
          </p>
        )}
        <div className="data-filter-actions">
          <button type="button" onClick={onReset}>
            بازنشانی انتخاب‌ها
          </button>
          <button type="button" onClick={onClose}>
            انصراف
          </button>
          <button
            type="button"
            className="data-filter-apply"
            onClick={onApply}
            disabled={loading || Boolean(validationMessage)}
          >
            اعمال فیلتر
          </button>
        </div>
      </footer>
    </ModalCore>
  );
}
