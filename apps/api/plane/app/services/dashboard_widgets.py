"""Independent widget data handlers backed by the ticket-six EntityQuery."""

from datetime import date, timedelta
from html import unescape
import re

from django.db.models import Avg, Case, Count, F, IntegerField, Q, Sum, Value, When
from django.db.models.functions import Coalesce
from django.utils import timezone
from django.utils.html import strip_tags
from rest_framework.exceptions import ValidationError

from plane.db.models import EntityEvent, EntityType, Issue, IssueAssignee, User, UserAbsence, OrganizationUnitMember, OrganizationUnitDelegate
from .dashboard_layout import WIDGETS
from .entity_query import EntityQuery, json_value
from .entity_views import make_query


def _display_text(value, limit=None):
    """Plain text for dashboard summaries; rich-text HTML stays in stored records."""
    text = str(value or "")
    for _ in range(2):
        text = strip_tags(re.sub(
            r"</(?:p|div|li|h[1-6]|blockquote)>|<br\s*/?>", " ", unescape(text), flags=re.IGNORECASE,
        ))
    text = re.sub(r"\s+", " ", unescape(text)).strip()
    return text[:limit] if limit else text


def _source(widget, request, workspace):
    from plane.app.views.workspace.entity_views import resolve_definition

    config = widget.get("config", {})
    code = config.get("entity", "ticket")
    if not isinstance(code, str) or len(code) > 80:
        raise ValidationError("منبع ویجت معتبر نیست.")
    entity = EntityType.objects.filter(workspace=workspace, code=code, parent__isnull=True, is_active=True).first()
    if not entity:
        raise ValidationError("منبع ویجت پیدا نشد؛ تنظیمات آن را اصلاح کنید.")
    definition, system = resolve_definition(entity, request, {"view_id": config.get("view_id")})
    query = make_query(entity, request.user, definition, request)
    query.prepare(definition, system=system)
    if widget.get("type") == "table" and isinstance(config.get("columns"), list):
        columns = [code for code in config["columns"][:30] if isinstance(code, str) and query.path_allowed(code)]
        if columns:
            query.spec = {**query.spec, "columns": [{"field": code, "width": 180} for code in dict.fromkeys(columns)]}
    if getattr(request, "_engine_empty_saved_filter", False):
        query.rows = query.rows.none()
    extra = config.get("filter")
    if extra:
        predicate = query.predicate(extra)
        query.rows = query.rows.filter(predicate)
    query.dashboard_base_rows = query.rows
    period = config.get("period")
    if period and not isinstance(period, dict):
        raise ValidationError("بازه زمانی معتبر نیست.")
    if period and period.get("start") and period.get("end"):
        try:
            start = date.fromisoformat(period["start"])
            end = date.fromisoformat(period["end"])
            if end < start or (end - start).days > 3660:
                raise ValueError()
        except (KeyError, ValueError, TypeError):
            raise ValidationError("بازه زمانی معتبر نیست.")
        query.rows = query.rows.filter(created_at__date__gte=start, created_at__date__lte=end)
    return entity, query


def _metric(query, config):
    operation = config.get("operation", "count")
    if operation == "count":
        return query.rows.count()
    if operation not in {"sum", "avg"}:
        raise ValidationError("نوع محاسبه معتبر نیست.")
    path = config.get("field")
    if not query.path_allowed(path):
        return None
    field = query.describe(path)
    if field["kind"] not in {"number", "currency", "rating", "percent"}:
        raise ValidationError("محاسبه جمع یا میانگین فقط روی فیلد عددی مجاز است.")
    alias = query.scalar(path)
    result = query.rows.aggregate(value=Sum(alias) if operation == "sum" else Avg(alias))
    return json_value(result["value"] or 0)


def _ticket_rows(query):
    if query.entity.code != "ticket":
        raise ValidationError("این ویجت به دادهٔ کارها نیاز دارد.")
    return Issue.objects.filter(id__in=query.rows.values("source_id"), workspace=query.entity.workspace)


def _table_display_values(payload, query, request, workspace):
    """Return readable ticket relations while keeping raw IDs for filters and links."""
    for row in payload["results"]:
        display = row.setdefault("display_values", {})
        for key, value in row["values"].items():
            if isinstance(value, str) and ("<" in value or "&" in value):
                display[key] = _display_text(value) or "—"
    if query.entity.code != "ticket" or not payload["results"]:
        return payload
    columns = {column["field"] for column in query.spec["columns"]}
    show_project = "project" in columns and query.path_allowed("project")
    show_assignees = "ticket_assignees" in columns and query.path_allowed("ticket_assignees")
    project_names = {}
    if show_project:
        from .entity_records import native_queryset

        project_ids = {row["values"].get("project") for row in payload["results"] if row["values"].get("project")}
        project_entity = EntityType.objects.filter(workspace=workspace, code="project", parent__isnull=True, is_active=True).first()
        if project_entity and project_ids:
            project_names = {
                str(identifier): name for identifier, name in native_queryset(project_entity, request.user, request)
                .filter(id__in=project_ids).values_list("id", "name")
            }
    assignee_names = {}
    if show_assignees:
        assignee_ids = {
            identifier for row in payload["results"]
            for identifier in (row["values"].get("ticket_assignees") or [])
        }
        if assignee_ids:
            assignee_names = {
                str(user.id): user.display_name or f"{user.first_name} {user.last_name}".strip() or user.username
                for user in User.objects.filter(id__in=assignee_ids)
            }
    for row in payload["results"]:
        display = row.setdefault("display_values", {})
        if show_project:
            display["project"] = project_names.get(str(row["values"].get("project"))) or "—"
        if show_assignees:
            display["ticket_assignees"] = "، ".join(
                assignee_names[str(identifier)] for identifier in (row["values"].get("ticket_assignees") or [])
                if str(identifier) in assignee_names
            ) or "—"
    return payload


def _chart_labels(query, path, values):
    from .entity_view_export import value_labels

    records = [{"values": {path: value}} for value in values]
    return {
        key: item["title"]
        for key, item in value_labels(query, records).get(path, {}).items()
    }



def _activity_value_labels(query, rows, fields):
    """Readable titles for stored choice, user, relation and state values in activity events."""
    from .entity_view_export import value_labels

    samples = [
        {"values": {row.field: value}}
        for row in rows if row.field in fields
        for value in (row.before, row.after) if value not in (None, "", [])
    ]
    if not samples:
        return {}
    try:
        return {path: {key: item["title"] for key, item in found.items()} for path, found in value_labels(query, samples).items()}
    except (KeyError, TypeError, ValueError):
        return {}


def _activity_value(value, labels):
    """A short, readable form of one stored value; None when it cannot be shown meaningfully."""
    if value in (None, "", []):
        return ""
    if isinstance(value, bool):
        return "بله" if value else "خیر"
    if isinstance(value, list):
        parts = [_activity_value(item, labels) for item in value[:5]]
        parts = [part for part in parts if part]
        return "، ".join(parts) or None
    if isinstance(value, (str, int, float)):
        text = str(value)
        if text in labels:
            return _display_text(labels[text], 80)
        if len(text) == 36 and text.count("-") == 4:
            return None  # An unresolved identifier says nothing to a reader.
        return _display_text(text, 80)
    return None


def widget_data(widget, request, workspace):
    kind = widget.get("type")
    if kind not in WIDGETS:
        raise ValidationError("نوع ویجت شناخته نشده است.")
    config = widget.get("config", {})
    if kind in {"links", "note"}:
        return {"type": kind, "value": config.get("links", []) if kind == "links" else _display_text(config.get("text", ""))}
    if kind == "team-cards":
        from .dashboard_team import team_cards

        return {"type": kind, **team_cards(workspace, request.user, request, config)}
    entity, query = _source(widget, request, workspace)
    if kind == "counter":
        value = _metric(query, config)
        if value is None:
            return {"type": kind, "hidden": True}
        previous = None
        period = config.get("period")
        if period and period.get("start") and period.get("end"):
            start, end = date.fromisoformat(period["start"]), date.fromisoformat(period["end"])
            span = end - start + timedelta(days=1)
            previous_rows = query.dashboard_base_rows.filter(created_at__date__gte=start - span, created_at__date__lt=start)
            current_rows = query.rows
            query.rows = previous_rows
            previous = _metric(query, config)
            query.rows = current_rows
        return {"type": kind, "value": value, "previous": previous, "drilldown": {"entity": entity.code, "view_id": config.get("view_id"), "filter": config.get("filter")}}
    if kind == "table":
        payload = query.execute(1, min(50, max(1, int(config.get("rows", 8)))))
        return {"type": kind, **_table_display_values(payload, query, request, workspace),
                "headers": [{"field": column["field"], "title": query.describe(column["field"])["title"]} for column in query.spec["columns"]]}
    if kind == "my-work":
        if entity.code != "ticket":
            raise ValidationError("فهرست کارهای من به موجودیت کارها نیاز دارد.")
        size = min(30, max(1, int(config.get("rows", 8))))
        issues = _ticket_rows(query).filter(Q(assignee=request.user) | Q(issue_assignee__assignee=request.user)).distinct().exclude(status__in=["done", "cancelled"])
        issues = issues.filter(Q(state__isnull=True) | ~Q(state__group__in=["completed", "cancelled"]))
        count = issues.count()
        ordered_ids = list(issues.annotate(priority_rank=Case(
            When(priority="urgent", then=Value(0)), When(priority="high", then=Value(1)),
            When(priority="medium", then=Value(2)), When(priority="low", then=Value(3)),
            default=Value(4), output_field=IntegerField(),
        )).order_by("priority_rank", F("target_date").asc(nulls_last=True), "id").values_list("id", flat=True)[:size])
        query.rows = query.rows.filter(source_id__in=ordered_ids)
        payload = query.execute(1, size)
        positions = {str(identifier): index for index, identifier in enumerate(ordered_ids)}
        payload["results"].sort(key=lambda row: positions.get(str(row.get("source_id") or row["id"]), size))
        payload["count"] = count
        return {"type": kind, **payload}
    if kind == "approvals":
        if entity.code != "ticket":
            raise ValidationError("درخواست‌های منتظر تأیید به موجودیت کارها نیاز دارد.")
        size = min(30, max(1, int(config.get("rows", 8))))
        pending = _ticket_rows(query).filter(
            Q(assignee=request.user) | Q(issue_assignee__assignee=request.user)
        ).filter(Q(status="review") | Q(state__name__iexact="Review")).distinct()
        query.rows = query.rows.filter(source_id__in=pending.values("id"))
        return {"type": kind, **query.execute(1, size)}
    if kind == "unassigned":
        query.system_filter("unassigned")
        return {"type": kind, **query.execute(1, min(30, max(1, int(config.get("rows", 8)))))}
    if kind == "chart":
        path = config.get("group_by")
        if not query.path_allowed(path, "filterable"):
            return {"type": kind, "hidden": True}
        query.describe(path, "filterable")
        alias = query.scalar(path)
        if config.get("chart") == "stacked" and config.get("stack_by"):
            stack = config["stack_by"]
            if not query.path_allowed(stack, "filterable"):
                return {"type": kind, "hidden": True}
            query.describe(stack, "filterable")
            stack_alias = query.scalar(stack)
            grouped = query.rows.order_by().values(alias, stack_alias).annotate(count=Count("id")).order_by(alias, stack_alias)[:500]
            points, series = {}, set()
            group_values, stack_values = [], []
            for row in grouped:
                group_value, stack_value = json_value(row[alias]), json_value(row[stack_alias])
                group_values.append(group_value)
                stack_values.append(stack_value)
                label, category = str(group_value or "بدون مقدار"), str(stack_value or "بدون مقدار")
                points.setdefault(label, {"label": label})[category] = row["count"]
                series.add(category)
            return {"type": kind, "chart": "stacked", "points": list(points.values())[:30], "series": sorted(series), "labels": _chart_labels(query, path, group_values), "series_labels": _chart_labels(query, stack, stack_values), "drilldown": {"entity": entity.code, "view_id": config.get("view_id")}}
        values = list(query.rows.order_by().values(alias).annotate(count=Count("id")).order_by("-count")[:30])
        return {"type": kind, "chart": config.get("chart", "bar"), "points": [{"label": json_value(row[alias]), "value": row["count"]} for row in values], "labels": _chart_labels(query, path, [json_value(row[alias]) for row in values]), "drilldown": {"entity": entity.code, "view_id": config.get("view_id")}}
    if kind == "progress":
        from .entity_rules import condition_fields

        if any(not query.path_allowed(path, "filterable") for path in condition_fields(config.get("condition"))):
            return {"type": kind, "hidden": True}
        total = query.rows.count()
        if config.get("condition"):
            predicate = query.predicate(config["condition"])
            match = query.rows.filter(predicate).count()
        else:
            match = 0
        return {"type": kind, "value": round(100 * match / total, 1) if total else 0, "count": match, "total": total}
    if kind == "calendar":
        path = config.get("date_field")
        if not query.path_allowed(path):
            return {"type": kind, "hidden": True}
        field = query.describe(path)
        if field["kind"] not in {"date", "datetime"}:
            raise ValidationError("فیلد تقویم باید تاریخ باشد.")
        alias = query.scalar(path)
        title_alias = query.scalar("title") if query.path_allowed("title") else None
        calendar_range = config.get("calendar_range")
        if calendar_range is not None:
            if not isinstance(calendar_range, dict):
                raise ValidationError("بازه تقویم معتبر نیست.")
            try:
                first = date.fromisoformat(calendar_range["start"])
                last = date.fromisoformat(calendar_range["end"])
            except (KeyError, TypeError, ValueError):
                raise ValidationError("بازه تقویم معتبر نیست.")
            max_days = 7 if config.get("calendar_view") == "week" else 31
            if not 0 < (last - first).days <= max_days:
                raise ValidationError("بازه تقویم معتبر نیست.")
        else:
            today = timezone.localdate()
            if config.get("calendar_view") == "week":
                first = today - timedelta(days=(today.weekday() + 2) % 7)
                last = first + timedelta(days=7)
            else:
                first = today.replace(day=1)
                last = (first + timedelta(days=32)).replace(day=1)
        fields = ("source_id", alias, title_alias) if title_alias else ("source_id", alias)
        rows = query.rows.filter(**{f"{alias}__gte": first, f"{alias}__lt": last}).order_by(alias).values(*fields)[:100]
        return {"type": kind, "items": [{"id": str(row["source_id"]), "date": json_value(row[alias]), "title": str(row[title_alias]) if title_alias else ""} for row in rows]}
    if kind == "activity":
        rows = list(EntityEvent.objects.filter(
            workspace=workspace, entity=entity,
            record_id__in=query.rows.annotate(public_id=Coalesce("source_id", "id")).values("public_id"),
        ).exclude(event_type="record.updated").select_related("created_by").order_by("-created_at")[:30])
        title_path = entity.title_field or "title"
        title_alias = query.scalar(title_path) if query.path_allowed(title_path) else None
        record_rows = query.rows.filter(
            Q(source_id__in=[row.record_id for row in rows]) | Q(id__in=[row.record_id for row in rows])
        ).values(*(("id", "source_id", "number", "data", title_alias) if title_alias else ("id", "source_id", "number", "data")))
        records = {
            str(item["source_id"] or item["id"]): (item["number"], item["data"], item.get(title_alias) if title_alias else None)
            for item in record_rows
        }
        fields = {row.field for row in rows if row.field and query.path_allowed(row.field)}
        labels = _activity_value_labels(query, rows, fields)
        items = []
        for row in rows:
            number, data, native_title = records.get(str(row.record_id), ("", {}, None))
            field = row.field if row.field in fields else ""
            field_title = query.describe(field)["title"] if field else ""
            # Deleted records are gone from the table; their last snapshot still carries the title.
            snapshot = data if isinstance(data, dict) and data else (row.before if isinstance(row.before, dict) else {})
            if not snapshot and isinstance(row.after, dict):
                snapshot = row.after
            title = native_title or snapshot.get(title_path) or snapshot.get("title") or snapshot.get("name")
            if not title_alias:
                title = None
            actor = (row.created_by.display_name or row.created_by.email) if row.created_by else "سیستم"
            items.append({
                "id": str(row.id), "event": row.event_type, "at": row.created_at.isoformat(),
                "record_id": str(row.record_id), "record": _display_text(title or (f"شماره {number}" if number else "رکورد بدون عنوان")),
                "entity": _display_text(entity.title), "actor": _display_text(actor), "field": _display_text(field_title),
                "before": _activity_value(row.before, labels.get(field, {})) if field else None,
                "after": _activity_value(row.after, labels.get(field, {})) if field else None,
            })
        return {"type": kind, "items": items}
    if kind == "absences":
        if entity.code != "leave":
            raise ValidationError("برای ویجت عدم حضور، منبع «عدم حضور» را انتخاب کنید.")
        now = timezone.now()
        rows = UserAbsence.objects.filter(
            id__in=query.rows.values("source_id"), status=UserAbsence.Status.SCHEDULED,
            starts_at__lte=now, ends_at__gt=now,
        ).select_related("user")[:100]
        units = dict(OrganizationUnitMember.objects.filter(user_id__in=[row.user_id for row in rows], is_active=True).values_list("user_id", "unit_id"))
        deputies = {row.unit_id: row.user.display_name for row in OrganizationUnitDelegate.objects.filter(unit_id__in=units.values(), is_active=True).select_related("user").order_by("priority")}
        return {"type": kind, "items": [{"id": str(row.id), "name": row.user.display_name, "reason": row.reason, "return_at": row.ends_at.isoformat(), "substitute": deputies.get(units.get(row.user_id))} for row in rows]}
    if kind == "workload":
        if not query.path_allowed("ticket_assignees"):
            return {"type": kind, "hidden": True}
        issues = _ticket_rows(query)
        counts = IssueAssignee.objects.filter(issue__in=issues).values("assignee_id").annotate(count=Count("issue_id")).order_by("-count")[:40]
        names = dict(User.objects.filter(id__in=[row["assignee_id"] for row in counts]).values_list("id", "first_name"))
        return {"type": kind, "items": [{"user_id": str(row["assignee_id"]), "name": names.get(row["assignee_id"]) or str(row["assignee_id"]), "count": row["count"]} for row in counts]}
    if kind == "age":
        issues = _ticket_rows(query).exclude(state__group__in=["completed", "cancelled"])
        now = timezone.now()
        return {"type": kind, "buckets": [issues.filter(created_at__gte=now - timedelta(days=1)).count(), issues.filter(created_at__lt=now - timedelta(days=1), created_at__gte=now - timedelta(days=3)).count(), issues.filter(created_at__lt=now - timedelta(days=3)).count()]}
    raise ValidationError("داده ویجت قابل محاسبه نیست.")
