import { SurfaceTable } from "../engine/surface";
import { ScrollableTable } from "@plane/ui";
/** Report building blocks (ticket 8): result table, totals, groups, builder controls, export and sharing. */
import { useState } from "react";
import { Link } from "react-router";
import { ArrowDown, ArrowUp, Download, Info, Plus, Trash2, TriangleAlert } from "lucide-react";
import type {
  ExportJob,
  FilterRule,
  ReportDefinition,
  ReportResult,
  ReportSource,
  SavedReport,
  SourceField,
} from "../api/reports";
import { exportDownloadUrl, useExportJob, useRequestExport, useShareOptions } from "../api/reports";
import { useSlug } from "../api/client";
import { Button, IconButton, PersianDateInput } from "../components";
import { toFa } from "../utils";
import { MAX_GROUPS, RELATIVE_RANGES, changeOp, defaultFilter, displayCell, fieldOf, rangeLabel } from "./model";

export function ResultMeta({ result }: { result: ReportResult }) {
  return (
    <div className="rp-meta" role="status">
      <span>
        <b>{toFa(result.total.toLocaleString("en-US"))}</b> رکورد
      </span>
      <span>
        بازهٔ اعمال‌شده:{" "}
        {result.range
          ? `${result.range.field} از ${result.range.from_text} تا ${result.range.to_text}`
          : "بدون محدودیت تاریخ"}
      </span>
      <span>
        {result.scope.all
          ? "دامنه: همهٔ افراد شرکت"
          : result.scope.team
            ? `دامنه: شما و ${toFa(result.scope.people - 1)} نفر زیرمجموعه`
            : "دامنه: فقط دادهٔ خود شما"}
      </span>
      {result.note && <span className="rp-note">{result.note}</span>}
    </div>
  );
}

export function Aggregates({ result }: { result: ReportResult }) {
  if (!result.aggregates.length) return null;
  return (
    <dl className="rp-aggregates">
      {result.aggregates.map((agg) => (
        <div key={`${agg.fn}-${agg.field ?? ""}`}>
          <dt>{agg.label}</dt>
          <dd>{displayCell(agg.value, "number")}</dd>
          <small title={agg.method}>روش محاسبه: {agg.method}</small>
        </div>
      ))}
    </dl>
  );
}

export function Groups({ result }: { result: ReportResult }) {
  if (!result.groups.length) return null;
  return (
    <div className="rp-table-scroll" role="region" aria-label="گروه‌ها" tabIndex={0}>
      <ScrollableTable className="rp-table rp-groups">
        <thead>
          <tr>
            {result.groups[0].keys.map((key) => (
              <th key={key.field}>{key.label}</th>
            ))}
            <th>تعداد</th>
            {result.groups[0].aggregates
              .filter((agg) => agg.fn !== "count")
              .map((agg) => (
                <th key={`${agg.fn}-${agg.field}`}>{agg.label}</th>
              ))}
          </tr>
        </thead>
        <tbody>
          {result.groups.map((group) => (
            <tr key={group.keys.map((key) => String(key.value)).join("|")}>
              {group.keys.map((key) => (
                <td key={key.field}>{displayCell(key.value, "text")}</td>
              ))}
              <td>{toFa(group.count)}</td>
              {group.aggregates
                .filter((agg) => agg.fn !== "count")
                .map((agg) => (
                  <td key={`${agg.fn}-${agg.field}`}>{displayCell(agg.value, "number")}</td>
                ))}
            </tr>
          ))}
        </tbody>
      </ScrollableTable>
    </div>
  );
}

export function ResultTable({ result, onPage }: { result: ReportResult; onPage: (page: number) => void }) {
  if (!result.rows.length) return <p className="rp-empty">با این فیلترها رکوردی پیدا نشد.</p>;
  return (
    <>
      <div className="rp-table-heading">
        <div>
          <strong>ردیف‌های گزارش</strong>
          {result.rows.some((row) => row.link) && <small>برای دیدن جزئیات، روی پیوند هر ردیف بزنید.</small>}
        </div>
        <span>
          نمایش {toFa((result.page - 1) * result.page_size + 1)} تا{" "}
          {toFa(Math.min(result.page * result.page_size, result.total))} از {toFa(result.total)} رکورد
        </span>
      </div>
      <div className="rp-table-scroll" role="region" aria-label="نتیجهٔ گزارش" tabIndex={0}>
        <SurfaceTable code={`report-${result.source}`} dynamicColumns className="rp-table">
          <thead>
            <tr>
              {result.columns.map((column) => (
                <th key={column.key} scope="col">
                  {column.label}
                  {column.method && (
                    <span
                      className="rp-method"
                      title={`روش محاسبه: ${column.method}`}
                      aria-label={`روش محاسبه: ${column.method}`}
                    >
                      <Info size={12} />
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, index) => (
              // eslint-disable-next-line react/no-array-index-key -- This immutable server page can contain identical aggregate rows without record identities.
              <tr key={`${result.page}-${index}`}>
                {result.columns.map((column, position) => (
                  <td
                    key={column.key}
                    data-type={result.columns[position].type}
                    data-field={result.columns[position].key}
                  >
                    {position === 0 && row.link ? (
                      <Link to={row.link}>{displayCell(row.cells[position], column.type)}</Link>
                    ) : (
                      displayCell(row.cells[position], column.type)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </SurfaceTable>
      </div>
      {result.pages > 1 && (
        <nav className="rp-pager" aria-label="صفحه‌بندی">
          <Button variant="ghost" disabled={result.page <= 1} onClick={() => onPage(result.page - 1)}>
            قبلی
          </Button>
          <span>
            صفحهٔ {toFa(result.page)} از {toFa(result.pages)}
          </span>
          <Button variant="ghost" disabled={result.page >= result.pages} onClick={() => onPage(result.page + 1)}>
            بعدی
          </Button>
        </nav>
      )}
    </>
  );
}

export function IncompatibleNotice({
  message,
  missing,
  onEdit,
}: {
  message: string;
  missing: string[];
  onEdit?: () => void;
}) {
  return (
    <section className="rp-incompatible" role="alert">
      <TriangleAlert size={18} aria-hidden="true" />
      <div>
        <strong>تعریف گزارش با ساختار فعلی سازگار نیست</strong>
        <p>{message}</p>
        {missing.length > 0 && <p>ستون‌های حذف‌شده: {missing.join("، ")}</p>}
        {onEdit && (
          <Button variant="secondary" onClick={onEdit}>
            ویرایش گزارش
          </Button>
        )}
      </div>
    </section>
  );
}

function FilterValue({
  field,
  rule,
  onChange,
}: {
  field: SourceField;
  rule: FilterRule;
  onChange: (value: unknown) => void;
}) {
  if (["empty", "not_empty"].includes(rule.op)) return null;
  if (field.type === "bool")
    return (
      <select
        aria-label="مقدار"
        value={rule.value ? "1" : "0"}
        onChange={(event) => onChange(event.target.value === "1")}
      >
        <option value="1">بله</option>
        <option value="0">خیر</option>
      </select>
    );
  if (field.type === "choice" && ["in", "not_in"].includes(rule.op)) {
    const values = Array.isArray(rule.value) ? (rule.value as string[]) : [];
    return (
      <div className="rp-choices">
        {field.choices.map((choice) => (
          <label key={choice.code} className="dr-check">
            <input
              type="checkbox"
              checked={values.includes(choice.code)}
              onChange={(event) =>
                onChange(event.target.checked ? [...values, choice.code] : values.filter((v) => v !== choice.code))
              }
            />
            {choice.title}
          </label>
        ))}
      </div>
    );
  }
  if (field.type === "choice")
    return (
      <select aria-label="مقدار" value={String(rule.value ?? "")} onChange={(event) => onChange(event.target.value)}>
        {field.choices.map((choice) => (
          <option key={choice.code} value={choice.code}>
            {choice.title}
          </option>
        ))}
      </select>
    );
  if (field.type === "date" || field.type === "datetime")
    return (
      <PersianDateInput
        id={`filter-${field.key}`}
        label="تاریخ"
        value={String(rule.value ?? "")}
        onChange={(value) => onChange(value)}
      />
    );
  if (field.type === "number")
    return (
      <input
        aria-label="مقدار"
        type="number"
        value={Number(rule.value ?? 0)}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    );
  return (
    <input aria-label="مقدار" value={String(rule.value ?? "")} onChange={(event) => onChange(event.target.value)} />
  );
}

export function Builder({
  source,
  definition,
  onChange,
}: {
  source: ReportSource;
  definition: ReportDefinition;
  onChange: (definition: ReportDefinition) => void;
}) {
  const set = (patch: Partial<ReportDefinition>) => onChange({ ...definition, ...patch });
  // Person filters are applied server-side (narrowed to the viewer's scope); the builder offers the rest.
  const filterable = source.fields.filter((field) => field.filter && field.type !== "person");
  const numeric = source.fields.filter((field) => field.type === "number" && field.agg);
  const move = (index: number, step: number) => {
    const columns = [...definition.columns];
    const [item] = columns.splice(index, 1);
    columns.splice(index + step, 0, item);
    set({ columns });
  };
  return (
    <div className="rp-builder">
      <fieldset>
        <legend>ستون‌ها</legend>
        <ol className="rp-columns">
          {definition.columns.map((key, index) => (
            <li key={key}>
              <span>{fieldOf(source, key)?.label ?? key}</span>
              <IconButton label="بالا" disabled={index === 0} onClick={() => move(index, -1)}>
                <ArrowUp size={14} />
              </IconButton>
              <IconButton
                label="پایین"
                disabled={index === definition.columns.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown size={14} />
              </IconButton>
              <IconButton
                label="حذف ستون"
                onClick={() => set({ columns: definition.columns.filter((c) => c !== key) })}
              >
                <Trash2 size={14} />
              </IconButton>
            </li>
          ))}
        </ol>
        <select
          aria-label="افزودن ستون"
          value=""
          onChange={(event) => event.target.value && set({ columns: [...definition.columns, event.target.value] })}
        >
          <option value="">+ افزودن ستون…</option>
          {source.fields
            .filter((field) => !definition.columns.includes(field.key))
            .map((field) => (
              <option key={field.key} value={field.key}>
                {field.label}
              </option>
            ))}
        </select>
      </fieldset>
      <fieldset>
        <legend>بازهٔ زمانی ({source.date_label})</legend>
        <select
          aria-label="نوع بازه"
          value={
            definition.range
              ? definition.range.type === "relative"
                ? String(definition.range.days)
                : "absolute"
              : "none"
          }
          onChange={(event) => {
            const value = event.target.value;
            if (value === "none") set({ range: null });
            else if (value === "absolute") set({ range: { type: "absolute", from: "", to: "" } });
            else set({ range: { type: "relative", days: Number(value) } });
          }}
        >
          {!source.range_required && <option value="none">بدون محدودیت تاریخ</option>}
          {RELATIVE_RANGES.map((days) => (
            <option key={days} value={days}>
              {toFa(days)} روز گذشته
            </option>
          ))}
          <option value="absolute">بازهٔ دلخواه…</option>
        </select>
        {definition.range?.type === "absolute" && (
          <div className="rp-range">
            <PersianDateInput
              id="report-range-from"
              label="از"
              value={definition.range.from}
              onChange={(value) => set({ range: { ...definition.range!, from: value } })}
            />
            <PersianDateInput
              id="report-range-to"
              label="تا"
              value={definition.range.to}
              onChange={(value) => set({ range: { ...definition.range!, to: value } })}
            />
          </div>
        )}
        <small className="dr-muted">{rangeLabel(definition.range)}</small>
      </fieldset>
      <fieldset>
        <legend>فیلترها</legend>
        {definition.filters.map((rule, index) => {
          const field = fieldOf(source, rule.field);
          if (!field) return null;
          const update = (next: FilterRule) =>
            set({ filters: definition.filters.map((row, i) => (i === index ? next : row)) });
          return (
            // eslint-disable-next-line react/no-array-index-key -- Repeated filters for the same field are separate controlled slots in the definition.
            <div className="rp-filter" key={`${rule.field}-${index}`}>
              <select
                aria-label="فیلد"
                value={rule.field}
                onChange={(event) => update(defaultFilter(fieldOf(source, event.target.value)!))}
              >
                {filterable.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="عملگر"
                value={rule.op}
                onChange={(event) => update(changeOp(rule, field, event.target.value))}
              >
                {field.ops.map((op) => (
                  <option key={op.code} value={op.code}>
                    {op.title}
                  </option>
                ))}
              </select>
              <FilterValue field={field} rule={rule} onChange={(value) => update({ ...rule, value })} />
              <IconButton
                label="حذف فیلتر"
                onClick={() => set({ filters: definition.filters.filter((_, i) => i !== index) })}
              >
                <Trash2 size={14} />
              </IconButton>
            </div>
          );
        })}
        {filterable.length > 0 && (
          <Button
            variant="ghost"
            icon={Plus}
            onClick={() => set({ filters: [...definition.filters, defaultFilter(filterable[0])] })}
          >
            افزودن فیلتر
          </Button>
        )}
      </fieldset>
      <fieldset>
        <legend>ترتیب</legend>
        {definition.sort.map((rule, index) => (
          // eslint-disable-next-line react/no-array-index-key -- Controlled sort slots may temporarily use the same editable field.
          <div className="rp-filter" key={`${rule.field}-${index}`}>
            <select
              aria-label="مرتب‌سازی بر اساس"
              value={rule.field}
              onChange={(event) =>
                set({
                  sort: definition.sort.map((row, i) => (i === index ? { ...row, field: event.target.value } : row)),
                })
              }
            >
              {source.fields.map((field) => (
                <option key={field.key} value={field.key}>
                  {field.label}
                </option>
              ))}
            </select>
            <select
              aria-label="جهت"
              value={rule.dir}
              onChange={(event) =>
                set({
                  sort: definition.sort.map((row, i) =>
                    i === index ? { ...row, dir: event.target.value as "asc" | "desc" } : row
                  ),
                })
              }
            >
              <option value="asc">صعودی</option>
              <option value="desc">نزولی</option>
            </select>
            <IconButton label="حذف ترتیب" onClick={() => set({ sort: definition.sort.filter((_, i) => i !== index) })}>
              <Trash2 size={14} />
            </IconButton>
          </div>
        ))}
        <Button
          variant="ghost"
          icon={Plus}
          onClick={() => set({ sort: [...definition.sort, { field: definition.columns[0], dir: "asc" }] })}
        >
          افزودن ترتیب
        </Button>
      </fieldset>
      <fieldset>
        <legend>گروه‌بندی (حداکثر ۲ سطح)</legend>
        {[0, 1].map((level) =>
          level <= definition.group_by.length && level < MAX_GROUPS ? (
            <select
              key={level}
              aria-label={`گروه‌بندی سطح ${toFa(level + 1)}`}
              value={definition.group_by[level] ?? ""}
              onChange={(event) => {
                const next = [...definition.group_by];
                if (event.target.value) next[level] = event.target.value;
                else next.splice(level);
                set({ group_by: next.filter(Boolean) });
              }}
            >
              <option value="">بدون گروه‌بندی</option>
              {source.fields
                .filter((field) => field.group)
                .map((field) => (
                  <option key={field.key} value={field.key}>
                    {field.label}
                  </option>
                ))}
            </select>
          ) : null
        )}
      </fieldset>
      <fieldset>
        <legend>شمارش و جمع</legend>
        <label className="dr-check">
          <input
            type="checkbox"
            checked={definition.aggregates.some((agg) => agg.fn === "count")}
            onChange={(event) =>
              set({
                aggregates: event.target.checked
                  ? [{ fn: "count" }, ...definition.aggregates]
                  : definition.aggregates.filter((agg) => agg.fn !== "count"),
              })
            }
          />
          شمارش رکوردها
        </label>
        {numeric.map((field) =>
          (["sum", "avg"] as const).map((fn) => (
            <label key={`${fn}-${field.key}`} className="dr-check">
              <input
                type="checkbox"
                checked={definition.aggregates.some((agg) => agg.fn === fn && agg.field === field.key)}
                onChange={(event) =>
                  set({
                    aggregates: event.target.checked
                      ? [...definition.aggregates, { fn, field: field.key }]
                      : definition.aggregates.filter((agg) => !(agg.fn === fn && agg.field === field.key)),
                  })
                }
              />
              {fn === "sum" ? "جمع" : "میانگین"} {field.label}
            </label>
          ))
        )}
      </fieldset>
    </div>
  );
}

function ExportStatus({ job }: { job: ExportJob }) {
  const slug = useSlug();
  const live = useExportJob(job.id);
  const current = live.data ?? job;
  if (current.status === "failed") return <p className="dr-error">{current.error}</p>;
  if (current.status !== "ready")
    return (
      <div
        className="rp-progress"
        role="progressbar"
        aria-valuenow={current.progress}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ width: `${current.progress}%` }} />
        <small>در حال ساخت خروجی… {toFa(current.progress)}٪</small>
      </div>
    );
  return (
    <a className="button button-secondary" href={exportDownloadUrl(slug, current.id)}>
      <Download size={16} /> دریافت فایل ({toFa(current.row_count)} ردیف)
    </a>
  );
}

export function ExportPanel({
  source,
  savedId,
  definition,
  heavy,
}: {
  source: string;
  savedId?: string;
  definition: ReportDefinition;
  heavy?: boolean;
}) {
  const request = useRequestExport();
  const [job, setJob] = useState<ExportJob | null>(null);
  const start = (format: "csv" | "xlsx") =>
    request.mutate(savedId ? { saved_id: savedId, definition, format } : { source, definition, format }, {
      onSuccess: (data) => setJob(data),
    });
  return (
    <div className="rp-export">
      {heavy && <p className="dr-muted">این گزارش برای نمایش هم‌زمان بزرگ است؛ آن را در پس‌زمینه به فایل تبدیل کنید.</p>}
      <Button variant="secondary" icon={Download} disabled={request.isPending} onClick={() => start("csv")}>
        خروجی CSV
      </Button>
      <Button variant="secondary" icon={Download} disabled={request.isPending} onClick={() => start("xlsx")}>
        خروجی Excel
      </Button>
      {job && <ExportStatus job={job} />}
    </div>
  );
}

export function ShareEditor({
  value,
  onChange,
}: {
  value: Pick<SavedReport, "visibility" | "shared_roles" | "shared_units">;
  onChange: (value: Pick<SavedReport, "visibility" | "shared_roles" | "shared_units">) => void;
}) {
  const options = useShareOptions(true);
  const toggle = (key: "shared_roles" | "shared_units", id: string, on: boolean) =>
    onChange({ ...value, [key]: on ? [...value[key], id] : value[key].filter((item) => item !== id) });
  return (
    <fieldset className="rp-share">
      <legend>اشتراک‌گذاری</legend>
      <label className="dr-check">
        <input
          type="radio"
          checked={value.visibility === "personal"}
          onChange={() => onChange({ ...value, visibility: "personal" })}
        />
        شخصی (فقط من)
      </label>
      <label className="dr-check">
        <input
          type="radio"
          checked={value.visibility === "shared"}
          onChange={() => onChange({ ...value, visibility: "shared" })}
        />
        اشتراک با نقش یا واحد
      </label>
      {value.visibility === "shared" && options.data && (
        <div className="rp-share-lists">
          <div>
            <b>نقش‌ها</b>
            {options.data.roles.map((role) => (
              <label key={role.id} className="dr-check">
                <input
                  type="checkbox"
                  checked={value.shared_roles.includes(role.id)}
                  onChange={(event) => toggle("shared_roles", role.id, event.target.checked)}
                />
                {role.name}
              </label>
            ))}
          </div>
          <div>
            <b>واحدها</b>
            {options.data.units.map((unit) => (
              <label key={unit.id} className="dr-check">
                <input
                  type="checkbox"
                  checked={value.shared_units.includes(unit.id)}
                  onChange={(event) => toggle("shared_units", unit.id, event.target.checked)}
                />
                {unit.name}
              </label>
            ))}
          </div>
        </div>
      )}
      <small className="dr-muted">اشتراک هیچ دسترسی داده‌ای نمی‌دهد: هر گیرنده فقط دادهٔ دامنهٔ خودش را می‌بیند.</small>
    </fieldset>
  );
}
