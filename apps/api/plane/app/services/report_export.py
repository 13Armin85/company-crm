"""Ticket 8 — CSV/Excel export of a report (decision 8.11), on the existing export path.

Reuse of ``entity_view_export``: the job is an ``EntityViewExport`` row (``entity`` empty,
``report_source`` set), the file is a private ``FileAsset`` of type ``CRM_VIEW_EXPORT``,
cells go through ``safe_text`` (CSV/formula injection) and dates are Solar Hijri (``jalali``),
and the content fingerprint is re-verified at download time exactly like engine exports:
the rows are recomputed with the downloader's *current* scope and permissions, and any
difference refuses the download.

The rows are produced by ``report_sources.all_rows`` — the same scope, filters, columns and
order as the page (the page shows ``report_sources.cell`` values, the file writes the same
values). It is also the background path of a report too large for a synchronous run
(progress is reported through ``EntityViewExport.progress``).
"""

import csv
import hashlib
import json
import logging
from datetime import timedelta
from io import TextIOWrapper
from tempfile import SpooledTemporaryFile
from types import SimpleNamespace

from celery import shared_task
from django.core.files import File
from django.db import transaction
from django.utils import timezone
from openpyxl import Workbook
from rest_framework.exceptions import PermissionDenied, ValidationError

from plane.db.models import EntityViewExport, FileAsset, WorkspaceMember
from . import report_sources as sources
from .access_control import has_permission
from .entity_view_export import safe_text

logger = logging.getLogger(__name__)
BACKGROUND_LIMIT = 100000
FORMATS = {
    "csv": "text/csv; charset=utf-8",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


def _require(user, workspace, request=None):
    if (
        not user.is_active
        or not WorkspaceMember.objects.filter(workspace=workspace, member=user, is_active=True).exists()
    ):
        raise PermissionDenied("عضویت فعال برای دریافت خروجی لازم است.")
    if not has_permission(user, workspace, "Report.Export", request=request):
        raise PermissionDenied("مجوز دریافت خروجی گزارش را ندارید.")
    sources.require_view(user, workspace, request)


def _definition(job):
    from .saved_reports import get

    spec = job.definition
    source = sources.get_source(spec["source"])
    saved = get(job.workspace, job.user, spec["saved_id"]) if spec.get("saved_id") else None
    definition = sources.validate(
        source, spec["definition"], saved=saved is not None, schema_version=getattr(saved, "schema_version", None)
    )
    return source, definition


def file_cell(value):
    return safe_text(value) if isinstance(value, str) else value


def _digest(rows):
    digest = hashlib.sha256()
    for row in rows:
        digest.update(json.dumps(row, ensure_ascii=True, separators=(",", ":"), default=str).encode())
        digest.update(b"\n")
    return digest.hexdigest()


def request_export(workspace, user, data, request=None):
    from .saved_reports import get

    _require(user, workspace, request)
    fmt = data.get("format")
    if fmt not in FORMATS:
        raise ValidationError({"format": "قالب خروجی باید Excel یا CSV باشد."})
    saved = get(workspace, user, data["saved_id"]) if data.get("saved_id") else None
    source = sources.get_source(saved.source if saved else data.get("source"))
    raw = dict(saved.definition) if saved else data.get("definition")
    if saved and isinstance(data.get("definition"), dict):
        raw.update({k: v for k, v in data["definition"].items() if k in ("filters", "range", "sort")})
    definition = sources.validate(
        source, raw, saved=saved is not None, schema_version=getattr(saved, "schema_version", None)
    )
    sources.resolve_range(
        definition["range"], workspace, sources.reports.policy(workspace)["report_range_days"], timezone.now()
    )
    job = EntityViewExport.objects.create(
        workspace=workspace,
        entity=None,
        report_source=source.code,
        user=user,
        definition={"source": source.code, "definition": definition, "saved_id": str(saved.id) if saved else None},
        format=fmt,
        expires_at=timezone.now() + timedelta(hours=24),
    )
    transaction.on_commit(lambda: build_report_export.delay(str(job.id)))
    return job


def _progress(job, value):
    job.progress = value
    EntityViewExport.objects.filter(id=job.id).update(progress=value)


@shared_task(name="plane.report_export", acks_late=True, reject_on_worker_lost=True)
def build_report_export(identifier):
    job = EntityViewExport.objects.select_related("workspace", "user").get(id=identifier)
    if job.status == "ready" or job.expires_at <= timezone.now():
        return
    job.status, job.error = "running", ""
    job.save()
    _progress(job, 5)
    try:
        request = SimpleNamespace(user=job.user)
        _require(job.user, job.workspace, request)
        source, definition = _definition(job)
        columns, rows = sources.all_rows(job.workspace, job.user, source, definition, request, limit=BACKGROUND_LIMIT)
        _progress(job, 60)
        with SpooledTemporaryFile(max_size=8 * 1024 * 1024, mode="w+b") as output:
            if job.format == "xlsx":
                book = Workbook(write_only=True)
                sheet = book.create_sheet("گزارش")
                write = sheet.append
            else:
                text = TextIOWrapper(output, encoding="utf-8-sig", newline="", write_through=True)
                write = csv.writer(text).writerow
            write([safe_text(item.label) for item in columns])
            for index, row in enumerate(rows, start=1):
                write([file_cell(value) for value in row])
                if index % 2000 == 0:
                    _progress(job, 60 + int(30 * index / max(1, len(rows))))
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
                asset=File(output, name=f"report-{source.code}.{job.format}"),
                is_uploaded=True,
            )
        job.asset, job.row_count, job.fingerprint, job.status, job.progress = (
            asset,
            len(rows),
            _digest(rows),
            "ready",
            100,
        )
        job.save()
        sources.reports.audit(
            job.workspace,
            job.user,
            "saved_report.exported",
            job.id,
            after={"source": source.code, "format": job.format, "row_count": len(rows)},
            saved_id=job.definition.get("saved_id"),
        )
    except sources.TooLarge:
        job.status, job.error = "failed", "حجم این گزارش از سقف خروجی پس‌زمینه بیشتر است؛ بازه یا فیلتر را محدود کنید."
        job.save()
    except Exception:
        logger.exception("Report export failed", extra={"export_id": str(job.id)})
        job.status, job.error = "failed", "ساخت خروجی انجام نشد؛ دسترسی و تعریف گزارش را بررسی و دوباره درخواست کنید."
        job.save()


def verify_report_export(job, request=None):
    """Recompute with the downloader's current scope; any difference refuses the file."""
    if job.status != "ready" or not job.asset_id or job.expires_at <= timezone.now():
        raise ValidationError("فایل آماده نیست یا مهلت دریافت آن پایان یافته است.")
    request = request or SimpleNamespace(user=job.user)
    _require(job.user, job.workspace, request)
    source, definition = _definition(job)
    _, rows = sources.all_rows(job.workspace, job.user, source, definition, request, limit=BACKGROUND_LIMIT)
    if _digest(rows) != job.fingerprint or len(rows) != job.row_count:
        raise PermissionDenied("داده یا دسترسی از زمان ساخت فایل تغییر کرده است؛ خروجی تازه درخواست کنید.")


def job_payload(job):
    return {
        "id": str(job.id),
        "status": job.status,
        "progress": job.progress,
        "error": job.error,
        "row_count": job.row_count,
        "format": job.format,
        "source": job.report_source,
        "expires_at": job.expires_at.isoformat(),
        "created_at": job.created_at.isoformat(),
    }
