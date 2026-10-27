import { useQuery } from "@tanstack/react-query";
import { PersianDatePicker } from "@plane/ui";
import { api } from "../api";
import { useUIStore } from "../store";
import type { DashboardWidget } from "./types";

interface ViewOption {
  id: string;
  name: string;
}
interface FieldOption {
  code: string;
  title: string;
  kind: string;
  filterable: boolean;
  table_visible: boolean;
  operators: string[];
}

export function DashboardWidgetSettings({
  widget,
  entities,
  update,
}: {
  widget: DashboardWidget;
  entities: { code: string; title: string }[];
  update: (value: DashboardWidget) => void;
}) {
  const slug = useUIStore((state) => state.workspaceSlug) || "";
  const entity = String(widget.config.entity || "ticket");
  const views = useQuery({
    queryKey: ["dashboard-views", slug, entity],
    enabled: Boolean(slug && entity),
    queryFn: async (): Promise<{ results: ViewOption[]; system: ViewOption[] }> =>
      (await api.get(`/api/workspaces/${slug}/engine/entities/${entity}/views/`)).data,
  });
  const schema = useQuery({
    queryKey: ["dashboard-fields", slug, entity],
    enabled: Boolean(slug && entity),
    queryFn: async (): Promise<{ fields: FieldOption[] }> =>
      (await api.get(`/api/workspaces/${slug}/engine/entities/${entity}/view-schema/`)).data,
  });
  const fields = schema.data?.fields || [];
  const filter = widget.config.filter as { field?: string; op?: string; value?: unknown } | undefined;
  const filterField = fields.find((field) => field.code === filter?.field);
  const period = widget.config.period as { start?: string; end?: string } | undefined;
  function set(key: string, value: unknown) {
    update({ ...widget, config: { ...widget.config, [key]: value } });
  }
  function setFilter(key: string, value: unknown) {
    if (key === "field" && !value) {
      set("filter", null);
      return;
    }
    set("filter", { field: filter?.field || "", op: filter?.op || "eq", value: filter?.value || "", [key]: value });
  }
  return (
    <div className="dashboard-settings">
      <label>
        عنوان
        <input value={widget.title || ""} onChange={(event) => update({ ...widget, title: event.target.value })} />
      </label>
      <label>
        منبع داده
        <select
          value={entity}
          onChange={(event) =>
            update({
              ...widget,
              config: { ...widget.config, entity: event.target.value, view_id: null, filter: null, date_field: "" },
            })
          }
        >
          {entities.map((item) => (
            <option key={item.code} value={item.code}>
              {item.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        جدول ذخیره‌شده
        <select
          value={String(widget.config.view_id || "")}
          onChange={(event) => set("view_id", event.target.value || null)}
        >
          <option value="">جدول پیش‌فرض</option>
          {views.data?.results.map((view) => (
            <option key={view.id} value={view.id}>
              {view.name}
            </option>
          ))}
          {views.data?.system.map((view) => (
            <option key={view.id} value={view.id}>
              {view.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        بازه تازه‌سازی
        <select
          value={Number(widget.config.refresh_seconds || 0)}
          onChange={(event) => set("refresh_seconds", Number(event.target.value))}
        >
          <option value={0}>خاموش</option>
          <option value={30}>۳۰ ثانیه</option>
          <option value={60}>۱ دقیقه</option>
          <option value={300}>۵ دقیقه</option>
        </select>
      </label>
      <h3>فیلتر اضافه</h3>
      <label>
        ستون
        <select value={filter?.field || ""} onChange={(event) => setFilter("field", event.target.value)}>
          <option value="">بدون فیلتر</option>
          {fields
            .filter((field) => field.filterable)
            .map((field) => (
              <option key={field.code} value={field.code}>
                {field.title}
              </option>
            ))}
        </select>
      </label>
      {filter?.field && (
        <>
          <label>
            شرط
            <select value={filter.op || "eq"} onChange={(event) => setFilter("op", event.target.value)}>
              {(filterField?.operators || ["eq"]).map((op) => (
                <option key={op} value={op}>
                  {(
                    {
                      eq: "برابر",
                      ne: "نابرابر",
                      gt: "بیشتر",
                      gte: "حداقل",
                      lt: "کمتر",
                      lte: "حداکثر",
                      contains: "شامل",
                    } as Record<string, string>
                  )[op] || op}
                </option>
              ))}
            </select>
          </label>
          <label>
            مقدار
            <input value={String(filter.value ?? "")} onChange={(event) => setFilter("value", event.target.value)} />
          </label>
        </>
      )}
      <h3>بازه زمانی</h3>
      <label>
        از
        <PersianDatePicker
          label="شروع بازه زمانی"
          value={period?.start || ""}
          max={period?.end}
          onChange={(start) => set("period", { ...period, start })}
        />
      </label>
      <label>
        تا
        <PersianDatePicker
          label="پایان بازه زمانی"
          value={period?.end || ""}
          min={period?.start}
          onChange={(end) => set("period", { ...period, end })}
        />
      </label>
      {widget.type === "counter" && (
        <>
          <label>
            محاسبه
            <select
              value={String(widget.config.operation || "count")}
              onChange={(event) => set("operation", event.target.value)}
            >
              <option value="count">تعداد</option>
              <option value="sum">جمع</option>
              <option value="avg">میانگین</option>
            </select>
          </label>
          {widget.config.operation !== "count" && (
            <label>
              فیلد عددی
              <select value={String(widget.config.field || "")} onChange={(event) => set("field", event.target.value)}>
                <option value="">انتخاب کنید</option>
                {fields
                  .filter((field) => ["number", "currency", "rating", "percent"].includes(field.kind))
                  .map((field) => (
                    <option key={field.code} value={field.code}>
                      {field.title}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </>
      )}
      {widget.type === "chart" && (
        <>
          <label>
            نوع نمودار
            <select value={String(widget.config.chart || "bar")} onChange={(event) => set("chart", event.target.value)}>
              <option value="bar">ستونی</option>
              <option value="line">خطی</option>
              <option value="pie">دایره‌ای</option>
              <option value="donut">دونات</option>
              <option value="stacked">انباشته</option>
            </select>
          </label>
          <label>
            گروه‌بندی
            <select
              value={String(widget.config.group_by || "")}
              onChange={(event) => set("group_by", event.target.value)}
            >
              <option value="">انتخاب کنید</option>
              {fields
                .filter((field) => field.filterable)
                .map((field) => (
                  <option key={field.code} value={field.code}>
                    {field.title}
                  </option>
                ))}
            </select>
          </label>
          {widget.config.chart === "stacked" && (
            <label>
              گروه دوم
              <select
                value={String(widget.config.stack_by || "")}
                onChange={(event) => set("stack_by", event.target.value)}
              >
                <option value="">انتخاب کنید</option>
                {fields
                  .filter((field) => field.filterable)
                  .map((field) => (
                    <option key={field.code} value={field.code}>
                      {field.title}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </>
      )}
      {widget.type === "calendar" && (
        <>
          <label>
            نمای تقویم
            <select
              value={String(widget.config.calendar_view || "month")}
              onChange={(event) => set("calendar_view", event.target.value)}
            >
              <option value="month">ماهانه</option>
              <option value="week">هفتگی</option>
            </select>
          </label>
          <label>
            فیلد تاریخ
            <select
              value={String(widget.config.date_field || "")}
              onChange={(event) => set("date_field", event.target.value)}
            >
              <option value="">انتخاب کنید</option>
              {fields
                .filter((field) => ["date", "datetime"].includes(field.kind))
                .map((field) => (
                  <option key={field.code} value={field.code}>
                    {field.title}
                  </option>
                ))}
            </select>
          </label>
        </>
      )}
      {widget.type === "progress" && (
        <>
          <label>
            ستون شرط
            <select
              value={String((widget.config.condition as { field?: string } | undefined)?.field || "")}
              onChange={(event) => set("condition", { field: event.target.value, op: "eq", value: "" })}
            >
              <option value="">انتخاب کنید</option>
              {fields
                .filter((field) => field.filterable)
                .map((field) => (
                  <option key={field.code} value={field.code}>
                    {field.title}
                  </option>
                ))}
            </select>
          </label>
          <label>
            مقدار هدف
            <input
              value={String((widget.config.condition as { value?: string } | undefined)?.value || "")}
              onChange={(event) =>
                set("condition", { ...(widget.config.condition as object), value: event.target.value })
              }
            />
          </label>
        </>
      )}
      {["table", "my-work", "approvals", "unassigned"].includes(widget.type) && (
        <label>
          تعداد ردیف
          <input
            type="number"
            min={1}
            max={50}
            value={Number(widget.config.rows || 8)}
            onChange={(event) => set("rows", Number(event.target.value))}
          />
        </label>
      )}
      {widget.type === "table" && (
        <label>
          ستون‌های جدول
          <select
            multiple
            size={Math.min(8, Math.max(4, fields.length))}
            value={Array.isArray(widget.config.columns) ? (widget.config.columns as string[]) : []}
            onChange={(event) =>
              set(
                "columns",
                Array.from(event.target.selectedOptions, (option) => option.value)
              )
            }
          >
            {fields
              .filter((field) => field.table_visible)
              .map((field) => (
                <option key={field.code} value={field.code}>
                  {field.title}
                </option>
              ))}
          </select>
          <small>برای انتخاب چند ستون، Ctrl را نگه دارید؛ بدون انتخاب، ستون‌های جدول ذخیره‌شده استفاده می‌شود.</small>
        </label>
      )}
      {widget.type === "note" && (
        <label>
          یادداشت
          <textarea value={String(widget.config.text || "")} onChange={(event) => set("text", event.target.value)} />
        </label>
      )}
      {widget.type === "links" && (
        <label>
          پیوندهای سریع؛ هر خط: عنوان | مسیر
          <textarea
            value={
              Array.isArray(widget.config.links)
                ? (widget.config.links as { title: string; href: string }[])
                    .map((link) => `${link.title} | ${link.href}`)
                    .join("\n")
                : ""
            }
            onChange={(event) =>
              set(
                "links",
                event.target.value
                  .split("\n")
                  .map((line) => line.split("|").map((part) => part.trim()))
                  .filter((parts) => parts.length === 2 && parts[1].startsWith("/"))
                  .map(([title, href]) => ({ title, href }))
              )
            }
          />
        </label>
      )}
      <p>هر ویجت دادهٔ مجاز را مستقل از بقیه و از همان لایهٔ جدول‌ها دریافت می‌کند.</p>
    </div>
  );
}
