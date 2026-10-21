import type { FieldValue } from "@plane/ui";
import { useEngineQuery } from "./api";
import { ViewValue } from "./view-value";
import type { ViewField, ViewResult } from "./view-types";
import { entityDisplayTitle } from "./presentation";

export function EntityRecordSummary({ code, id }: { code: string; id: string }) {
  const result = useEngineQuery<{
    fields: (ViewField & { field: string; value: FieldValue })[];
    labels: ViewResult["labels"];
  }>("summary", `entities/${code}/records/${id}/summary/`, Boolean(id && id !== "new"));
  if (!result.data?.fields.length) return null;
  return (
    <section className="engine-record-summary" aria-label="خلاصه اطلاعات">
      {result.data.fields.map((field) => (
        <div key={field.field}>
          <small>{entityDisplayTitle(field.title)}</small>
          <ViewValue field={field} value={field.value} labels={result.data!.labels[field.field]} />
        </div>
      ))}
    </section>
  );
}
