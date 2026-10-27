import { useState } from "react";
import { Button } from "../components";
import { errorMessage } from "../api";
import { useEngineMutation, useEngineSlug, enginePath } from "./api";
import { DuplicateFeedback, duplicateDetails } from "./duplicate-feedback";

type ImportResult = {
  results: { row: number; ok: boolean; error?: unknown; warnings: unknown[] }[];
  success_count: number;
  rejected_count: number;
};

export function RecordImport({ code, subtype }: { code: string; subtype: string }) {
  const slug = useEngineSlug();
  const mutation = useEngineMutation("گزارش ورود داده آماده شد");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  return (
    <section className="engine-view-settings">
      <p>فایل Excel را طبق الگو آماده کنید. ردیف‌های نامعتبر با دلیل رد می‌شوند؛ ردیف‌های معتبر شماره خودکار می‌گیرند.</p>
      <a href={`${enginePath(slug)}/entities/${code}/import/`}>دریافت الگوی Excel</a>
      <label>
        فایل ورود داده
        <input type="file" accept=".xlsx" onChange={(event) => setFile(event.target.files?.[0] || null)} />
      </label>
      <Button
        disabled={!file || mutation.isPending}
        onClick={() => {
          if (!file) return;
          const data = new FormData();
          data.append("file", file);
          if (subtype) data.append("subtype", subtype);
          void mutation
            .mutateAsync({ path: `entities/${code}/import/`, data })
            .then((response) => setResult(response as ImportResult))
            .catch(() => {});
        }}
      >
        ورود داده‌ها
      </Button>
      {mutation.error && <p role="alert">{errorMessage(mutation.error, "ورود داده انجام نشد.")}</p>}
      {result && (
        <>
          <p role="status">
            {result.success_count.toLocaleString("fa-IR")} ردیف ثبت و {result.rejected_count.toLocaleString("fa-IR")}{" "}
            ردیف رد شد.
          </p>
          <div>
            {result.results.map((row) => (
              <div key={row.row} className="engine-view-rule">
                <strong>
                  ردیف {row.row.toLocaleString("fa-IR")}؛ {row.ok ? "ثبت شد" : "رد شد"}
                </strong>
                {Boolean(row.error) && (
                  <>
                    <p>{errorMessage({ response: { data: row.error } }, "اطلاعات ردیف معتبر نیست.")}</p>
                    <DuplicateFeedback details={duplicateDetails({ response: { data: row.error } })} />
                  </>
                )}
                {row.warnings.map((warning) => (
                  <p key={JSON.stringify(warning)}>
                    {typeof warning === "string" ? warning : "رکورد با هشدار ثبت شده است."}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
