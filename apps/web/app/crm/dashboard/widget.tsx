import { Link, useNavigate } from "react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { persianDate, persianDateValue } from "../utils";
import { errorMessage } from "../api";
import { Button } from "../components";
import { useWidgetData } from "./api";
import { DashboardCalendar } from "./calendar";
import { TeamWidget } from "./team";
import type { DashboardWidget } from "./types";

const colors = ["#5865d9", "#33a187", "#e4a93a", "#d57577", "#8c76d4"];
const displayDate = (value: unknown) =>
  value
    ? persianDate(String(value), {
        year: "numeric",
        ...(String(value).includes("T") ? { hour: "2-digit" as const } : {}),
      })
    : "ثبت نشده";

export function WidgetContent({ widget }: { widget: DashboardWidget }) {
  return widget.type === "team-cards" ? (
    <TeamWidget />
  ) : widget.type === "calendar" ? (
    <DashboardCalendar widget={widget} />
  ) : (
    <DataWidget widget={widget} />
  );
}

function DataWidget({ widget }: { widget: DashboardWidget }) {
  const result = useWidgetData(widget);
  const navigate = useNavigate();
  const entity = String(widget.config.entity || "ticket");
  const goTable = (segment?: { field: string; op: string; value: unknown }) => {
    const params = new URLSearchParams();
    if (widget.config.view_id) params.set("view", String(widget.config.view_id));
    const filter = widget.config.filter;
    const combined = filter && segment ? { op: "and", rules: [filter, segment] } : segment || filter;
    if (combined) params.set("dashboard_filter", JSON.stringify(combined));
    navigate(`/entities/${entity}${params.size ? `?${params}` : ""}`);
  };
  if (result.isLoading)
    return (
      <div className="dashboard-widget-skeleton">
        <span />
        <span />
        <span />
      </div>
    );
  if (result.isError)
    return (
      <div className="dashboard-widget-error">
        <p>{errorMessage(result.error, "دریافت ویجت انجام نشد")}</p>
        <Button variant="secondary" onClick={() => result.refetch()}>
          تلاش دوباره
        </Button>
      </div>
    );
  const data = result.data || {};
  if (data.hidden) return <div className="dashboard-empty-small">دادهٔ این ویجت در دسترسی شما نیست.</div>;
  const rows = Array.isArray(data.results)
    ? (data.results as {
        id: string;
        number: string;
        title: string;
        values: Record<string, unknown>;
        display_values?: Record<string, string>;
      }[])
    : [];
  const items = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];
  if (widget.type === "counter")
    return (
      <button className="dashboard-counter" onClick={() => goTable()}>
        <strong>{String(data.value ?? 0)}</strong>
        <span>
          {data.previous === null || data.previous === undefined
            ? "باز کردن جدول"
            : `دوره قبل: ${String(data.previous)}`}
        </span>
      </button>
    );
  if (widget.type === "table") {
    const headers = Array.isArray(data.headers) ? (data.headers as { field: string; title: string }[]) : [];
    return rows.length ? (
      <div className="dashboard-mini-table">
        <table>
          <thead>
            <tr>
              {headers.map((header) => (
                <th key={header.field}>{header.title}</th>
              ))}
              <th>رکورد</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} draggable onDragStart={(event) => event.dataTransfer.setData("task-id", row.id)}>
                {headers.map((header) => (
                  <td key={header.field}>
                    {row.display_values?.[header.field] ?? persianDateValue(row.values?.[header.field])}
                  </td>
                ))}
                <td>
                  <Link to={`/entities/${entity}/${row.id}`}>{row.number || row.title}</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <div className="dashboard-empty-small">رکوردی برای نمایش وجود ندارد.</div>
    );
  }
  if (["my-work", "approvals", "unassigned"].includes(widget.type))
    return rows.length ? (
      <div className="dashboard-mini-table">
        {rows.map((row) => (
          <div key={row.id} draggable onDragStart={(event) => event.dataTransfer.setData("task-id", row.id)}>
            <Link to={`/entities/${entity}/${row.id}`}>
              {row.number} · {row.title}
            </Link>
          </div>
        ))}
      </div>
    ) : (
      <div className="dashboard-empty-small">{String(data.empty || "رکوردی برای نمایش وجود ندارد.")}</div>
    );
  if (widget.type === "chart") {
    const points = Array.isArray(data.points) ? (data.points as { label: string; value: number }[]) : [];
    if (!points.length) return <div className="dashboard-empty-small">داده‌ای برای نمودار وجود ندارد.</div>;
    const displayPoints = points.map((point) => ({ ...point, displayLabel: persianDateValue(point.label) }));
    const variant = String(data.chart || "bar");
    const openPoint = (point: { label?: unknown }) => {
      const field = String(widget.config.group_by || "");
      if (field) goTable({ field, op: "eq", value: point.label ?? null });
      else goTable();
    };
    return (
      <div className="dashboard-chart">
        <ResponsiveContainer width="100%" height={210}>
          {variant === "pie" || variant === "donut" ? (
            <PieChart>
              <Pie
                data={displayPoints}
                dataKey="value"
                nameKey="displayLabel"
                innerRadius={variant === "donut" ? 48 : 0}
                outerRadius={85}
                onClick={(point) => openPoint(point)}
              >
                {points.map((_, index) => (
                  <Cell fill={colors[index % colors.length]} key={index} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          ) : variant === "line" ? (
            <LineChart
              data={displayPoints}
              onClick={(event) => {
                if (event?.activePayload?.[0]?.payload) openPoint(event.activePayload[0].payload);
              }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="displayLabel" />
              <YAxis />
              <Tooltip />
              <Line dataKey="value" stroke="#5865d9" strokeWidth={2} />
            </LineChart>
          ) : (
            <BarChart
              data={displayPoints}
              onClick={(event) => {
                if (event?.activePayload?.[0]?.payload) openPoint(event.activePayload[0].payload);
              }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="displayLabel" />
              <YAxis />
              <Tooltip />
              {variant === "stacked" && Array.isArray(data.series) ? (
                (data.series as string[]).map((name, index) => (
                  <Bar key={name} dataKey={name} fill={colors[index % colors.length]} stackId="total" />
                ))
              ) : (
                <Bar dataKey="value" fill="#5865d9" />
              )}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    );
  }
  if (widget.type === "progress")
    return (
      <button className="dashboard-progress" onClick={() => goTable()}>
        <strong>{String(data.value ?? 0)}٪</strong>
        <span>
          <i style={{ width: `${Number(data.value || 0)}%` }} />
        </span>
        <small>
          {String(data.count ?? 0)} از {String(data.total ?? 0)}
        </small>
      </button>
    );
  if (widget.type === "age")
    return (
      <div className="dashboard-age">
        {["کمتر از یک روز", "۱ تا ۳ روز", "بیشتر از ۳ روز"].map((label, index) => (
          <button key={label} onClick={() => goTable()}>
            <span>{label}</span>
            <strong>{String((data.buckets as number[] | undefined)?.[index] ?? 0)}</strong>
          </button>
        ))}
      </div>
    );
  if (widget.type === "note") return <p className="dashboard-note">{String(data.value || "یادداشتی ثبت نشده است.")}</p>;
  if (widget.type === "links")
    return (
      <div className="dashboard-links">
        {Array.isArray(data.value)
          ? (data.value as { title: string; href: string }[]).map((link, index) => (
              <Link key={index} to={link.href}>
                {link.title}
              </Link>
            ))
          : null}
      </div>
    );
  if (widget.type === "activity")
    return (
      <div className="dashboard-mini-table">
        {items.length
          ? items.map((item, index) => (
              <div key={index}>
                {String(item.event)} · {displayDate(item.at)}
              </div>
            ))
          : "فعالیتی ثبت نشده است."}
      </div>
    );
  if (widget.type === "absences")
    return (
      <div className="dashboard-mini-table">
        {items.length
          ? items.map((item, index) => (
              <div key={index}>
                <Link to={`/entities/leave/${String(item.id)}`}>{String(item.name)}</Link> ·{" "}
                {String(item.reason || "بدون دلیل")} · بازگشت {displayDate(item.return_at)} · جانشین{" "}
                {String(item.substitute || "ندارد")}
              </div>
            ))
          : "غایب فعالی ثبت نشده است."}
      </div>
    );
  if (widget.type === "workload")
    return items.length ? (
      <div className="dashboard-chart">
        <ResponsiveContainer width="100%" height={210}>
          <BarChart data={items} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" />
            <YAxis type="category" dataKey="name" width={90} />
            <Tooltip />
            <Bar dataKey="count" fill="#5865d9" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    ) : (
      <div className="dashboard-empty-small">کاری ارجاع نشده است.</div>
    );
  return <div className="dashboard-empty-small">داده‌ای برای نمایش وجود ندارد.</div>;
}
