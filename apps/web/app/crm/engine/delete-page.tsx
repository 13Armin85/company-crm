import { useState } from "react";
import { Trash2 } from "lucide-react";
import { AccessModal } from "../access/components";
import { errorMessage } from "../api";
import { Button } from "../components";
import { ErrorNotice } from "../error-state";
import { useEngineMutation } from "./api";
import type { EntityDefinition } from "./api";

export function DeletePageButton({ entity, onRemoved }: { entity: EntityDefinition; onRemoved?: () => void }) {
  const [open, setOpen] = useState(false);
  if (!entity.page_management?.can_manage) return null;
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)} aria-label={`حذف صفحهٔ ${entity.title}`}>
        <Trash2 size={15} aria-hidden="true" /> حذف صفحه
      </Button>
      {open && <DeletePageDialog entity={entity} onClose={() => setOpen(false)} onRemoved={onRemoved} />}
    </>
  );
}

export function DeletePageDialog({
  entity,
  onClose,
  onRemoved,
}: {
  entity: EntityDefinition;
  onClose: () => void;
  onRemoved?: () => void;
}) {
  const mutation = useEngineMutation("عملیات صفحه انجام شد");
  const [error, setError] = useState<unknown>(null);
  const controls = entity.page_management;
  const blockers = controls?.delete_blockers ?? [];
  const remove = async (action: "delete" | "archive" | "restore") => {
    setError(null);
    try {
      await mutation.mutateAsync({
        path: `definitions/entities/${entity.id}/`,
        method: action === "delete" ? "delete" : "patch",
        data: action === "delete" ? undefined : { is_active: action === "restore" },
      });
      onClose();
      onRemoved?.();
    } catch (failure) {
      setError(failure);
    }
  };
  return (
    <AccessModal title={`حذف صفحهٔ «${entity.title}»`} onClose={onClose} busy={mutation.isPending}>
      {blockers.length ? (
        <>
          <p>این صفحه وابستگی دارد و قابل حذف نیست:</p>
          <ul>
            {blockers.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          {controls?.can_archive && <p>با غیرفعال‌سازی، صفحه از فهرست خارج می‌شود و اطلاعات آن حفظ می‌ماند.</p>}
        </>
      ) : controls?.can_restore ? (
        <p>این صفحه غیرفعال است. می‌توانید آن را دوباره فعال کنید یا در صورت نداشتن وابستگی حذف کنید.</p>
      ) : controls?.can_delete ? (
        <p>صفحه و تنظیمات فرم آن حذف می‌شوند. این کار قابل بازگشت نیست.</p>
      ) : (
        <p>با غیرفعال‌سازی، صفحه از فهرست خارج می‌شود و اطلاعات آن حفظ می‌ماند.</p>
      )}
      <ErrorNotice
        message={error ? errorMessage(error, "حذف صفحه انجام نشد؛ ممکن است وابستگی جدیدی ایجاد شده باشد.") : undefined}
      />
      <footer className="engine-actions">
        {controls?.can_delete && (
          <Button variant="danger" disabled={mutation.isPending} onClick={() => void remove("delete")}>
            حذف صفحه
          </Button>
        )}
        {controls?.can_archive && (blockers.length > 0 || !controls.can_delete) && (
          <Button variant="secondary" disabled={mutation.isPending} onClick={() => void remove("archive")}>
            غیرفعال‌سازی صفحه
          </Button>
        )}
        {controls?.can_restore && (
          <Button disabled={mutation.isPending} onClick={() => void remove("restore")}>
            فعال‌سازی صفحه
          </Button>
        )}
        <Button variant="secondary" disabled={mutation.isPending} onClick={onClose}>
          انصراف
        </Button>
      </footer>
    </AccessModal>
  );
}
