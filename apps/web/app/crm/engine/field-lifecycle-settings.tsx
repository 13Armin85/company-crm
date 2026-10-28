import { useState } from "react";
import { Database } from "lucide-react";
import { SearchableSelect } from "@plane/ui";
import { Button } from "../components";
import { errorMessage, useWorkspaceAccess } from "../api";
import { useEngineDefinitions, useEngineQuery, useEngineMutation } from "./api";
import type { FieldDefinition } from "./api";

export function FieldLifecycleSettings({ fieldCodes }: { fieldCodes?: string[] } = {}) {
  const { data: access } = useWorkspaceAccess();
  const fields = useEngineDefinitions<FieldDefinition>("fields", Boolean(access?.can("Field.View")));
  const [id, setId] = useState("");
  const field = fields.data?.find((candidate) => candidate.id === id);
  const usage = useEngineQuery<{ count: number; can_hide: boolean; can_delete: boolean; message: string }>(
    "field-usage",
    `definitions/fields/${id}/usage/`,
    Boolean(id)
  );
  const mutation = useEngineMutation();
  if (!access?.can("Field.View")) return null;
  return (
    <section className="engine-rules-card engine-rules-lifecycle" aria-labelledby="field-lifecycle-title">
      <header className="engine-rules-card-header">
        <span className="engine-rules-card-icon is-lifecycle" aria-hidden="true">
          <Database size={22} />
        </span>
        <div>
          <span className="engine-rules-eyebrow">مدیریت چرخه عمر</span>
          <h3 id="field-lifecycle-title">وضعیت فیلد و حفظ داده‌ها</h3>
          <p>فیلد را از فرم پنهان کنید یا، اگر داده‌ای ندارد، آن را کامل حذف کنید.</p>
        </div>
      </header>
      <div className="engine-rules-lifecycle-body">
        <div className="engine-rules-lifecycle-select">
          <h4>انتخاب فیلد</h4>
          <p>برای دیدن وضعیت و امکان تغییر، یک فیلد از فرم انتخاب کنید.</p>
          <SearchableSelect
            label="فیلد"
            value={id}
            options={(fields.data || [])
              .filter((candidate) => !fieldCodes || fieldCodes.includes(candidate.code))
              .map((candidate) => ({
                id: candidate.id,
                title: candidate.title + " · " + candidate.code,
              }))}
            onChange={setId}
          />
        </div>
        {field && (
          <div className="engine-rules-lifecycle-detail">
            <div className="engine-rules-rule-heading">
              <strong>{field.title}</strong>
              <span className={`engine-rules-state${field.hidden_from_form ? "" : " is-active"}`}>
                {field.hidden_from_form ? "مخفی از فرم" : "فعال در فرم"}
              </span>
            </div>
            <code dir="ltr">{field.code}</code>
            {usage.data?.message && <p>{usage.data.message}</p>}
            <div className="engine-rules-lifecycle-actions">
              {access?.can("Field.Edit") && (
                <Button
                  variant="secondary"
                  disabled={!usage.data?.can_hide || mutation.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        field.hidden_from_form
                          ? "این فیلد دوباره در فرم فعال شود؟"
                          : "فیلد از فرم مخفی شود؟ داده‌های قبلی در جدول و خروجی باقی می‌مانند."
                      )
                    )
                      void mutation
                        .mutateAsync({
                          path: `definitions/fields/${id}/`,
                          method: "patch",
                          data: { hidden_from_form: !field.hidden_from_form },
                        })
                        .catch(() => {});
                  }}
                >
                  {field.hidden_from_form ? "فعال در فرم" : "مخفی از فرم"}
                </Button>
              )}
              {access?.can("Field.Delete") && (
                <Button
                  variant="danger"
                  disabled={!usage.data?.can_delete || mutation.isPending}
                  onClick={() => {
                    if (window.confirm("این فیلد بدون داده از فرم‌ها و کتابخانه حذف شود؟"))
                      void mutation
                        .mutateAsync({ path: `definitions/fields/${id}/`, method: "delete" })
                        .then(() => setId(""))
                        .catch(() => {});
                  }}
                >
                  حذف کامل فیلد
                </Button>
              )}
            </div>
          </div>
        )}
        {!field && (
          <p className="engine-rules-empty engine-rules-lifecycle-placeholder">
            وضعیت فیلد انتخاب‌شده در اینجا نمایش داده می‌شود.
          </p>
        )}
        {(fields.error || usage.error || mutation.error) && (
          <p role="alert">
            {errorMessage(fields.error || usage.error || mutation.error, "تغییر وضعیت فیلد انجام نشد.")}
          </p>
        )}
      </div>
    </section>
  );
}
