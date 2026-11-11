import { useEffect } from "react";
import { AccessModal } from "../access/components";
import { errorMessage } from "../api";
import { Button } from "../components";
import { ErrorNotice } from "../error-state";
import { useEngineQuery } from "./api";

export type DeleteImpact = {
  relation_id: string;
  relation_title: string;
  opposite_entity: string;
  opposite_entity_title: string;
  link_count: number;
  behavior: "block" | "detach" | "soft_deactivate";
  blocked: boolean;
};
export type DeletePreview = {
  impacts: DeleteImpact[];
  blocked: boolean;
  result: "blocked" | "delete" | "deactivate";
};

export const behaviorTitles: Record<DeleteImpact["behavior"], string> = {
  block: "حذف مسدود می‌شود",
  detach: "پیوندها جدا می‌شوند",
  soft_deactivate: "رکورد غیرفعال می‌شود و پیوندها می‌مانند",
};

const resultTitles: Record<DeletePreview["result"], string> = {
  blocked: "به‌دلیل قانون ارتباط، این عملیات مسدود است.",
  delete: "با تأیید، رکورد حذف می‌شود.",
  deactivate: "با تأیید، رکورد به‌جای حذف غیرفعال می‌شود.",
};

export function DeletePreviewContent({ preview }: { preview: DeletePreview }) {
  return (
    <div className="engine-delete-preview">
      {preview.impacts.length ? (
        <table>
          <thead>
            <tr>
              <th>ارتباط</th>
              <th>جدول مقابل</th>
              <th>تعداد پیوند</th>
              <th>رفتار</th>
            </tr>
          </thead>
          <tbody>
            {preview.impacts.map((impact) => (
              <tr
                key={`${impact.relation_id}:${impact.opposite_entity}`}
                className={impact.blocked ? "is-blocked" : ""}
              >
                <td>{impact.relation_title}</td>
                <td>{impact.opposite_entity_title}</td>
                <td>{impact.link_count.toLocaleString("fa-IR")}</td>
                <td>{impact.blocked ? "مسدود" : behaviorTitles[impact.behavior]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>این رکورد پیوند فعالی ندارد.</p>
      )}
      <p role="status">{resultTitles[preview.result]}</p>
    </div>
  );
}

/** Shows the server dry run of the relation delete rules before the user confirms. */
export function DeletePreviewDialog({
  code,
  id,
  mode,
  pending,
  onConfirm,
  onClose,
}: {
  code: string;
  id: string;
  mode: "delete" | "deactivate";
  pending: boolean;
  onConfirm: (result: DeletePreview["result"]) => void;
  onClose: () => void;
}) {
  const preview = useEngineQuery<DeletePreview>(
    "delete-preview",
    `entities/${code}/records/${id}/delete-preview/?mode=${mode}`
  );
  const { refetch } = preview;
  // Links and relation rules change between opens; never show a cached dry run.
  useEffect(() => {
    void refetch();
  }, [refetch]);
  const loading = preview.isFetching;
  return (
    <AccessModal title={mode === "delete" ? "پیش‌نمایش حذف رکورد" : "پیش‌نمایش غیرفعال‌سازی رکورد"} onClose={onClose}>
      {loading && <p>در حال بررسی ارتباط‌ها…</p>}
      {preview.error && <ErrorNotice message={errorMessage(preview.error, "بررسی اثر حذف انجام نشد.")} />}
      {preview.data && !loading && <DeletePreviewContent preview={preview.data} />}
      <footer className="engine-actions">
        <Button
          variant="danger"
          disabled={!preview.data || loading || preview.data.blocked || pending}
          onClick={() => preview.data && onConfirm(preview.data.result)}
        >
          {preview.data?.result === "deactivate" ? "تأیید غیرفعال‌سازی" : "تأیید حذف"}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          انصراف
        </Button>
      </footer>
    </AccessModal>
  );
}
