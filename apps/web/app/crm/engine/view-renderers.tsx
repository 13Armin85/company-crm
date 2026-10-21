import { useState, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router";
import {
  SchemaDataGrid,
  SchemaDrivenForm,
  parseDateOnly,
  PersianCalendarNavigation,
  zonedDateTime,
  zonedDateTimeToISO,
} from "@plane/ui";
import type { FieldValue, FormValues } from "@plane/ui";
import { jalaaliMonthLength, toGregorian } from "jalaali-js";
import { ViewValue, appearance, numberText, icons } from "./view-value";
import { Button } from "../components";
import { useEngineSchema, useEngineRecord, useEngineMutation, fieldErrors } from "./api";
import { useSchemaTransport } from "./record-form";
import type { ViewDefinition, ViewField, ViewResult, ViewRow, ViewStyle } from "./view-types";
import { entityDisplaySchema } from "./presentation";

export { ViewValue, appearance, numberText } from "./view-value";

export function InlineViewEditor({
  code,
  row,
  field,
  onClose,
}: {
  code: string;
  row: ViewRow;
  field: ViewField;
  onClose: () => void;
}) {
  const schema = useEngineSchema(code, "", row.id),
    record = useEngineRecord(code, row.id),
    transport = useSchemaTransport(code, "", false, row.id),
    mutation = useEngineMutation();
  const [values, setValues] = useState<FormValues>({ [field.field_code]: row.values[field.code] ?? null });
  const definition = schema.data?.fields.find((f) => f.code === field.field_code);
  if (!definition)
    return (
      <span>
        {schema.isLoading ? "دریافت قواعد…" : "فیلد قابل ویرایش نیست."}
        <button type="button" onClick={onClose}>
          بستن
        </button>
      </span>
    );
  const single = {
    ...schema.data!,
    fields: schema.data!.fields,
    layout: { tabs: [], sections: [{ id: "cell", columns: 1 as const, bindings: [{ field: definition.code }] }] },
  };
  return (
    <form
      className="engine-inline-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void mutation
          .mutateAsync({
            method: "patch",
            path: `entities/${code}/records/${row.id}/`,
            data: { values, revision: row.revision },
          })
          .then(onClose)
          .catch(() => {});
      }}
    >
      <SchemaDrivenForm
        {...transport}
        schema={entityDisplaySchema(single)}
        values={{ ...record.data?.values, ...values }}
        onChange={(next) => setValues({ [field.field_code]: next[field.field_code] })}
        editing
        errors={fieldErrors(mutation.error)}
        disabled={mutation.isPending}
      />
      {mutation.error && (
        <p role="alert">
          {Object.values(fieldErrors(mutation.error)).join("، ") ||
            "ویرایش انجام نشد؛ مجوز و قواعد فیلد را بررسی کنید."}
        </p>
      )}
      <Button type="submit" disabled={mutation.isPending || definition.config.readonly}>
        ذخیره
      </Button>
      <Button type="button" variant="secondary" onClick={onClose}>
        انصراف
      </Button>
    </form>
  );
}

export function ViewRenderer({
  code,
  definition,
  data,
  fields,
  onChange,
  selected,
  onSelect,
  onMove,
  calendarDate,
  onCalendarDate,
}: {
  code: string;
  definition: ViewDefinition;
  data: ViewResult;
  fields: ViewField[];
  onChange: (value: ViewDefinition) => void;
  selected: string[];
  onSelect: (ids: string[]) => void;
  onMove: (row: ViewRow, field: string, value: FieldValue) => Promise<void>;
  calendarDate: string;
  onCalendarDate: (date: string) => void;
}) {
  const [editing, setEditing] = useState<{ id: string; field: string; top: number; left: number } | null>(null),
    dragged = useRef<ViewRow | null>(null);
  const columns = definition.columns.map((c) => ({
    ...c,
    title: fields.find((f) => f.code === c.field)?.title || "فیلد بدون عنوان",
  }));
  const cell = (row: ViewRow, path: string): ReactNode => {
    const field = fields.find((f) => f.code === path),
      style = { color: row.styles.row.color, ...row.styles.cells[path], ...row.styles.badges[path] };
    return (
      <span className="engine-view-cell" style={appearance(row.styles.cells[path])}>
        {columns[0]?.field === path && ["table", "list"].includes(definition.type) && row.styles.row.icon && (
          <span role="img" aria-label={row.styles.row.icon}>
            {icons[row.styles.row.icon]}
          </span>
        )}
        {field?.kind !== "relation" && (path === "title" || columns[0]?.field === path) ? (
          <Link draggable={false} to={`/entities/${code}/${row.id}`}>
            <ViewValue field={field} value={row.values[path]} labels={data.labels[path]} style={style} />
          </Link>
        ) : (
          <ViewValue field={field} value={row.values[path]} labels={data.labels[path]} style={style} />
        )}
        {row.can_edit &&
          field &&
          (!row.editable_fields || row.editable_fields.includes(path)) &&
          !field.config.readonly &&
          !path.includes(".") &&
          !["computed"].includes(field.kind) && (
            <button
              type="button"
              className="engine-inline-trigger"
              aria-label={`ویرایش ${field.title}`}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setEditing({
                  id: row.id,
                  field: path,
                  top: Math.min(rect.bottom + 6, window.innerHeight - 360),
                  left: Math.max(10, Math.min(rect.left, window.innerWidth - 430)),
                });
              }}
            >
              ✎
            </button>
          )}
      </span>
    );
  };
  const card = (row: ViewRow) => (
    <article
      key={row.id}
      className="engine-view-card"
      style={appearance(row.styles.row)}
      draggable={
        row.can_edit &&
        (!row.editable_fields ||
          row.editable_fields.includes(
            (definition.type === "kanban" ? definition.settings?.kanban_field : definition.settings?.calendar_field) ||
              ""
          )) &&
        ["kanban", "calendar"].includes(definition.type) &&
        !fields.find(
          (f) =>
            f.code ===
            (definition.type === "kanban" ? definition.settings?.kanban_field : definition.settings?.calendar_field)
        )?.config.readonly
      }
      onDragStart={(event) => {
        dragged.current = row;
        event.dataTransfer.setData("application/x-crm-record", row.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => {
        dragged.current = null;
      }}
    >
      <div className="engine-actions">
        <input
          type="checkbox"
          aria-label={`انتخاب ${row.title}`}
          checked={selected.includes(row.id)}
          onChange={(e) => onSelect(e.target.checked ? [...selected, row.id] : selected.filter((id) => id !== row.id))}
        />
        <Link draggable={false} to={`/entities/${code}/${row.id}`}>
          {row.number}
        </Link>
        {row.styles.row.icon && (
          <span role="img" aria-label={row.styles.row.icon}>
            {icons[row.styles.row.icon]}
          </span>
        )}
      </div>
      {columns.map((column) => (
        <div key={column.field}>
          <small>{column.title}</small>
          {cell(row, column.field)}
        </div>
      ))}
    </article>
  );
  const axis = definition.settings?.kanban_field || "";
  const kanbanValues = [
    ...new Set([
      ...(definition.settings?.kanban_columns || []),
      "",
      ...Object.keys(data.labels[axis] || {}),
      ...data.results.map((row) => String(row.values[axis] ?? "")),
    ]),
  ];
  const chosen = parseDateOnly(calendarDate)!,
    monthDays = jalaaliMonthLength(chosen.jy, chosen.jm),
    first = toGregorian(chosen.jy, chosen.jm, 1),
    offset = (new Date(Date.UTC(first.gy, first.gm - 1, first.gd)).getUTCDay() + 1) % 7;
  const days = Array.from({ length: Math.ceil((monthDays + offset) / 7) * 7 }, (_, i) => i - offset + 1);
  const dateField = definition.settings?.calendar_field || "";
  const dated = (row: ViewRow) => {
    const value = row.values[dateField];
    return typeof value === "string"
      ? value.includes("T")
        ? zonedDateTime(value, data.time_zone || "Asia/Tehran")?.date || ""
        : value.slice(0, 10)
      : value && !Array.isArray(value) && typeof value === "object"
        ? value.start
        : "";
  };
  return (
    <>
      {definition.type === "table" && (
        <SchemaDataGrid
          groupKey={definition.group ? (row) => row.group_key || "null" : undefined}
          groupLabel={(key) => {
            const group = data.groups.find((g) => g.key === key);
            return group ? (
              <span>
                <ViewValue
                  value={group.value}
                  field={fields.find((f) => f.code === definition.group)}
                  labels={data.labels[definition.group || ""]}
                />{" "}
                · {group.count.toLocaleString("fa-IR")} رکورد{" "}
                {Object.entries(group.totals).map(([path, total]) => (
                  <span key={path}>
                    {" "}
                    · {fields.find((f) => f.code === path)?.title}: جمع {numberText(total.sum)}
                  </span>
                ))}
              </span>
            ) : (
              key
            );
          }}
          columns={columns}
          rows={data.results}
          selected={selected}
          onSelect={onSelect}
          onColumnsChange={(next) =>
            onChange({ ...definition, columns: next.map(({ field, width, pin }) => ({ field, width, pin })) })
          }
          rowStyle={(row) =>
            ({
              ...appearance(row.styles.row),
              "--grid-row-bg": appearance(row.styles.row).backgroundColor,
            }) as CSSProperties
          }
          cellStyle={(row, column) => appearance(row.styles.cells[column.field])}
          renderCell={(row, column) => cell(row, column.field)}
          renderFooter={(column) =>
            data.totals[column.field] ? (
              <span>
                جمع: {numberText(data.totals[column.field].sum)}
                <br />
                میانگین: {numberText(data.totals[column.field].avg)}
              </span>
            ) : null
          }
        />
      )}
      {definition.type === "list" && (
        <div className="engine-compact-view">
          {data.results.map((row) => (
            <div key={row.id} style={appearance(row.styles.row)}>
              <input
                type="checkbox"
                aria-label={`انتخاب ${row.title}`}
                checked={selected.includes(row.id)}
                onChange={(e) =>
                  onSelect(e.target.checked ? [...selected, row.id] : selected.filter((id) => id !== row.id))
                }
              />
              {columns.map((c) => (
                <span key={c.field}>{cell(row, c.field)}</span>
              ))}
            </div>
          ))}
        </div>
      )}
      {definition.type === "cards" && <div className="engine-card-view">{data.results.map(card)}</div>}
      {definition.type === "kanban" &&
        (axis ? (
          <div className="engine-kanban-view">
            {kanbanValues.map((value) => (
              <section
                key={value}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const moving = dragged.current;
                  if (moving && !data.labels[axis]?.[value]?.inactive) void onMove(moving, axis, value || null);
                  dragged.current = null;
                }}
              >
                <h3>{data.labels[axis]?.[value]?.title || value || "بدون مقدار"}</h3>
                {data.results.filter((row) => String(row.values[axis] ?? "") === value).map(card)}
              </section>
            ))}
          </div>
        ) : (
          <p>فیلد دراپ‌دانی محور کانبان را انتخاب کنید.</p>
        ))}
      {definition.type === "calendar" && (
        <div className="engine-calendar-view">
          <PersianCalendarNavigation
            value={calendarDate}
            onChange={onCalendarDate}
            timeZone={data.time_zone || "Asia/Tehran"}
            description="رکوردهای ماه انتخاب‌شده؛ صفحه‌بندی پایین نما در دسترس است"
          />
          {!dateField ? (
            <p>فیلد تاریخ محور تقویم را انتخاب کنید.</p>
          ) : (
            <div className="engine-calendar-grid">
              {["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"].map((day) => (
                <strong key={day}>{day}</strong>
              ))}
              {days.map((day, index) => {
                const greg = day > 0 && day <= monthDays ? toGregorian(chosen.jy, chosen.jm, day) : null,
                  iso = greg
                    ? `${greg.gy}-${String(greg.gm).padStart(2, "0")}-${String(greg.gd).padStart(2, "0")}`
                    : "";
                return (
                  <div
                    key={index}
                    className={iso ? "" : "engine-calendar-outside"}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const moving = dragged.current;
                      if (moving && iso) {
                        const old = moving.values[dateField];
                        const next =
                          typeof old === "string" && old.includes("T")
                            ? zonedDateTimeToISO(
                                iso,
                                zonedDateTime(old, data.time_zone || "Asia/Tehran")!.time,
                                data.time_zone || "Asia/Tehran"
                              )
                            : old && typeof old === "object" && !Array.isArray(old)
                              ? {
                                  start: iso,
                                  end: new Date(
                                    new Date(iso).getTime() +
                                      Math.max(0, new Date(old.end).getTime() - new Date(old.start).getTime())
                                  )
                                    .toISOString()
                                    .slice(0, 10),
                                }
                              : iso;
                        if (next) void onMove(moving, dateField, next);
                      }
                      dragged.current = null;
                    }}
                  >
                    <small>{iso ? day.toLocaleString("fa-IR") : ""}</small>
                    {iso &&
                      data.results
                        .filter((row) => {
                          const value = row.values[dateField];
                          return value && typeof value === "object" && !Array.isArray(value)
                            ? value.start <= iso && value.end >= iso
                            : dated(row) === iso;
                        })
                        .map(card)}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {editing &&
        (() => {
          const row = data.results.find((r) => r.id === editing.id),
            field = fields.find((f) => f.code === editing.field);
          return row && field ? (
            <div
              className="engine-inline-panel"
              role="dialog"
              aria-label={`ویرایش ${field.title}`}
              style={{
                position: "fixed",
                top: Math.max(10, editing.top),
                left: editing.left,
                bottom: "auto",
                width: "min(410px, calc(100vw - 20px))",
                maxHeight: "80vh",
                overflow: "auto",
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") setEditing(null);
              }}
            >
              <InlineViewEditor code={code} row={row} field={field} onClose={() => setEditing(null)} />
            </div>
          ) : null;
        })()}
    </>
  );
}
