"""Streaming view exports with authorization rechecked at request, worker and download."""

import csv
import hashlib
import json
import logging
from datetime import date, datetime
from decimal import Decimal
from io import TextIOWrapper
from tempfile import SpooledTemporaryFile
from types import SimpleNamespace

from celery import shared_task
from django.core.files import File
from django.utils import timezone
from django.db.models import Q
from openpyxl import Workbook
from rest_framework.exceptions import PermissionDenied, ValidationError

from plane.db.models import (
    EntityViewExport,
    FileAsset,
    WorkspaceMember,
    LookupValue,
    State,
    User,
    OrganizationUnit,
    OrganizationRole,
)
from .entity_views import make_query, require
from .entity_records import emit_definition

logger = logging.getLogger(__name__)


def jalali(value):
    """Gregorian date -> Solar Hijri; date-only values never pass through a timezone."""
    if isinstance(value, str):
        value = date.fromisoformat(value[:10])
    gy, gm, gd = value.year, value.month, value.day
    offsets = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
    gy2 = gy + (1 if gm > 2 else 0)
    days = (
        355666
        + 365 * gy
        + (gy2 + 3) // 4
        - (gy2 + 99) // 100
        + (gy2 + 399) // 400
        + gd
        + offsets[gm - 1]
    )
    jy = -1595 + 33 * (days // 12053)
    days %= 12053
    jy += 4 * (days // 1461)
    days %= 1461
    if days > 365:
        jy += (days - 1) // 365
        days = (days - 1) % 365
    jm = 1 + days // 31 if days < 186 else 7 + (days - 186) // 30
    jd = 1 + days % 31 if days < 186 else 1 + (days - 186) % 30
    return f"{jy:04}/{jm:02}/{jd:02}"


def flatten(value):
    if isinstance(value, list):
        return [item for nested in value for item in flatten(nested)]
    return [value] if value is not None else []


def value_labels(query, records):
    result = {}
    paths = {key for row in records for key in row["values"]}
    for path in paths:
        field = query.describe(path)
        values = set(
            str(v) for row in records for v in flatten(row["values"].get(path))
        )
        if not values:
            result[path] = {}
            continue
        labels = {}
        if field.get("lookup"):
            choices = LookupValue.objects.select_related("category").filter(
                category__workspace=query.entity.workspace,
                category__code=field["lookup"],
            )
            if field["config"].get("lookup_codes"):
                choices = choices.filter(code__in=values)
            else:
                choices = choices.filter(id__in=[v for v in values if len(v) == 36])
            labels = {
                (v.code if field["config"].get("lookup_codes") else str(v.id)): {
                    "title": v.title,
                    "color": v.color,
                    "inactive": not (v.is_active and v.category.is_active),
                }
                for v in choices
            }
        elif field["config"].get("provider") in {"project_states", "work_states"}:
            labels = {
                str(v.id): {"title": v.name, "color": v.color}
                for v in State.objects.filter(
                    workspace=query.entity.workspace,
                    id__in=[v for v in values if len(v) == 36],
                )
            }
            if field["config"].get("provider") == "work_states":
                labels.update(
                    {
                        value.code: {
                            "title": value.title,
                            "color": value.color,
                            "inactive": not value.is_active,
                        }
                        for value in LookupValue.objects.filter(
                            category__workspace=query.entity.workspace,
                            category__code="task-status",
                            code__in=values,
                        )
                    }
                )
        elif field["kind"] in {"user", "unit", "role"}:
            model = {"user": User, "unit": OrganizationUnit, "role": OrganizationRole}[
                field["kind"]
            ]
            scope = (
                {"member_workspace__workspace": query.entity.workspace}
                if field["kind"] == "user"
                else {"workspace": query.entity.workspace}
            )
            objects = model.objects.filter(
                **scope, id__in=[v for v in values if len(v) == 36]
            ).distinct()
            labels = {
                str(v.id): {
                    "title": getattr(v, "display_name", None)
                    or getattr(v, "name", None)
                    or getattr(v, "title", None)
                    or v.email
                }
                for v in objects
            }
        elif field["kind"] == "relation":
            child = query.child(field)
            title = (
                child.scalar(child.entity.title_field)
                if child.path_allowed(child.entity.title_field)
                else "number"
            )
            objects = child.rows.filter(
                Q(id__in=values) | Q(source_id__in=values)
            ).values("id", "source_id", title)
            labels = {
                str(v["source_id"] or v["id"]): {"title": v[title] or "رکورد"}
                for v in objects
            }
        elif field["kind"] == "file":
            labels = {
                str(v.id): {"title": v.attributes.get("name", "پیوست")}
                for v in FileAsset.objects.filter(
                    workspace=query.entity.workspace, id__in=values
                )
            }
        result[path] = labels
    return result


def export_query(job):
    if (
        not job.user.is_active
        or not WorkspaceMember.objects.filter(
            workspace=job.workspace, member=job.user, is_active=True
        ).exists()
    ):
        raise PermissionDenied("عضویت فعال برای دریافت خروجی لازم است.")
    request = SimpleNamespace(user=job.user)
    require(job.user, job.workspace, "Export.Data", request)
    spec = job.definition
    query = make_query(job.entity, job.user, spec["view"], request)
    query.validate(spec["view"])
    return query.prepare(spec["view"], spec.get("search", ""), spec.get("system", ""))


def kanban_choices(query):
    """Empty columns are real lookup values; long domains remain server-searchable."""
    settings = query.spec.get("settings", {})
    path = settings.get("kanban_field")
    if query.spec.get("type") != "kanban" or not path:
        return {}
    field, selected = query.describe(path), settings.get("kanban_columns", [])
    config = field["config"]
    if field.get("lookup"):
        all_values = LookupValue.objects.filter(
            category__workspace=query.entity.workspace, category__code=field["lookup"]
        ).select_related("category")
        active = all_values.filter(is_active=True, category__is_active=True)
        key = "code" if config.get("lookup_codes") else "id"
        values = list(active[:200]) + list(
            all_values.filter(**{f"{key}__in": selected})
        )
        result = {
            (v.code if key == "code" else str(v.id)): {
                "title": v.title,
                "color": v.color,
                "inactive": not (v.is_active and v.category.is_active),
            }
            for v in values
        }
    elif config.get("provider") in {"project_states", "work_states"}:
        from plane.db.models import Issue

        projects = Issue.objects.filter(
            id__in=query.rows.order_by().values("source_id")
        ).values("project_id")
        active = State.objects.filter(
            workspace=query.entity.workspace, project_id__in=projects
        ).order_by("name", "id")
        values = list(active[:200]) + list(active.filter(id__in=[value for value in selected if len(value) == 36]))
        result = {str(v.id): {"title": v.name, "color": v.color} for v in values}
        if config.get("provider") == "work_states":
            standalone = LookupValue.objects.filter(
                category__workspace=query.entity.workspace,
                category__code="task-status",
                category__is_active=True,
            )
            active_standalone = standalone.filter(is_active=True)
            choices = list(active_standalone.order_by("position", "id")[:200]) + list(
                standalone.filter(code__in=selected)
            )
            result.update({
                value.code: {
                    "title": value.title,
                    "color": value.color,
                    "inactive": not value.is_active,
                }
                for value in choices
            })
    else:
        return {}
    if active.count() > 200:
        query.warnings.append(
            "۲۰۰ ستون نخست نمایش داده شد؛ با جستجوی ستون کانبان، هر مقدار دیگر را به نما اضافه کنید."
        )
    return result


def export_records(query):
    projection = query.projection()
    rows = query.ordered().values(
        "id",
        "source_id",
        "number",
        "revision",
        "is_active",
        *query.value_aliases(projection),
    )
    for row in rows.iterator(chunk_size=1000):
        yield query.payload(row, projection)


def update_fingerprint(digest, row, displayed):
    digest.update(
        json.dumps(
            {"id": row["id"], "values": row["values"], "displayed": displayed},
            sort_keys=True,
            ensure_ascii=True,
            separators=(",", ":"),
            default=str,
        ).encode()
    )
    digest.update(b"\n")


def safe_text(value):
    value = str(value)
    return (
        "'" + value
        if value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r"))
        else value
    )


def export_cell(query, path, value, labels):
    field = query.describe(path)
    kind = field["kind"]
    if value is None:
        return ""
    if isinstance(value, list):
        return safe_text(
            "، ".join(str(export_cell(query, path, v, labels)) for v in flatten(value))
        )
    if kind in {"integer", "decimal", "money", "percent", "rating", "computed"}:
        return Decimal(str(value)) if kind != "integer" else int(value)
    if kind == "date":
        return jalali(value)
    if kind == "datetime":
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        dt = timezone.localtime(dt, query.time_zone)
        return jalali(dt.date()) + " " + dt.strftime("%H:%M:%S")
    if kind == "date_range" and isinstance(value, dict):
        return jalali(value["start"]) + " تا " + jalali(value["end"])
    if kind in {"boolean", "checkbox"}:
        return "بله" if value else "خیر"
    return safe_text(labels.get(path, {}).get(str(value), {}).get("title", value))


@shared_task(
    name="plane.entity_view_export", acks_late=True, reject_on_worker_lost=True
)
def build_entity_export(identifier):
    job = EntityViewExport.objects.select_related(
        "entity__workspace", "workspace", "user"
    ).get(id=identifier)
    if job.status == "ready" or job.expires_at <= timezone.now():
        return
    job.status, job.error = "running", ""
    job.save()
    try:
        query = export_query(job)
        columns = query.spec["columns"]
        with SpooledTemporaryFile(max_size=8 * 1024 * 1024, mode="w+b") as output:
            if job.format == "xlsx":
                book = Workbook(write_only=True)
                sheet = book.create_sheet("داده‌ها")
                write = sheet.append
            else:
                text = TextIOWrapper(
                    output, encoding="utf-8-sig", newline="", write_through=True
                )
                writer = csv.writer(text)
                write = writer.writerow
            write([safe_text(query.describe(c["field"])["title"]) for c in columns])
            digest, count, batch = hashlib.sha256(), 0, []

            def flush(records):
                labels = value_labels(query, records)
                for row in records:
                    displayed = [
                        export_cell(
                            query, c["field"], row["values"].get(c["field"]), labels
                        )
                        for c in columns
                    ]
                    update_fingerprint(digest, row, displayed)
                    write(displayed)

            for row in export_records(query):
                batch.append(row)
                count += 1
                if len(batch) == 1000:
                    flush(batch)
                    batch = []
            if batch:
                flush(batch)
            if job.format == "xlsx":
                book.save(output)
            else:
                text.flush()
                text.detach()
            output.seek(0)
            asset = FileAsset.objects.create(
                workspace=job.workspace,
                user=job.user,
                entity_type="CRM_VIEW_EXPORT",
                entity_identifier=str(job.id),
                asset=File(output, name=f"{job.entity.code}.{job.format}"),
                is_uploaded=True,
            )
        job.asset, job.row_count, job.fingerprint, job.status = (
            asset,
            count,
            digest.hexdigest(),
            "ready",
        )
        job.save()
        emit_definition(
            job.workspace,
            job.user,
            "view.export_ready",
            job,
            after={"row_count": count, "format": job.format},
        )
    except Exception:
        logger.exception("Entity view export failed", extra={"export_id": str(job.id)})
        job.status, job.error = (
            "failed",
            "ساخت خروجی انجام نشد؛ دسترسی و تنظیمات نما را بررسی و دوباره درخواست کنید.",
        )
        job.save()


def verify_export_access(job):
    if job.status != "ready" or not job.asset_id or job.expires_at <= timezone.now():
        raise ValidationError("فایل آماده نیست یا مهلت دریافت آن پایان یافته است.")
    query = export_query(job)
    digest, count = hashlib.sha256(), 0
    batch = []

    def flush(records):
        labels = value_labels(query, records)
        for row in records:
            update_fingerprint(
                digest,
                row,
                [
                    export_cell(
                        query, c["field"], row["values"].get(c["field"]), labels
                    )
                    for c in query.spec["columns"]
                ],
            )

    for row in export_records(query):
        batch.append(row)
        count += 1
        if len(batch) == 1000:
            flush(batch)
            batch = []
    if batch:
        flush(batch)
    if digest.hexdigest() != job.fingerprint or count != job.row_count:
        raise PermissionDenied(
            "داده یا دسترسی از زمان ساخت فایل تغییر کرده است؛ خروجی تازه درخواست کنید."
        )
