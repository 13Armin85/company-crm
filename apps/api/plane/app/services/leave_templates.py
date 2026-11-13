"""Versioned Word templates of the leave request form (ticket 6).

Every upload is a new version; nothing is ever deleted. A version can be
activated only when its validation report has no error and it is neither
expired nor deprecated. Exactly one version is active per workspace.
"""

import hashlib
from io import BytesIO
from pathlib import PurePath

from django.core.files.base import ContentFile
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from plane.db.models import LEAVE_TEMPLATE, FileAsset, LeaveTemplateVersion
from . import leave_documents as documents
from .access_control import has_permission
from .entity_records import emit_definition
from .work_calendar import local_today
from .work_calendar_actions import fa_date

STATUS_TITLES = dict(LeaveTemplateVersion.Status.choices)


def require_manager(actor, workspace, request=None):
    if not has_permission(actor, workspace, "LeaveTemplate.Manage", request=request):
        raise PermissionDenied("مدیریت قالب فرم مرخصی فقط برای نقش مجاز ممکن است.")


def _audit(workspace, actor, event_type, row, before=None, after=None, reason=""):
    event = emit_definition(workspace, actor, event_type, row, before, after)
    event.metadata = {**event.metadata, "actor_id": str(actor.id), "reason": reason}
    event.save(update_fields=["metadata"])


def errors(row):
    return [issue for issue in row.issues or [] if issue.get("level") == "error"]


def warnings(row, today):
    """Clear warnings for the admin: incomplete/invalid placeholders, expired or deprecated version."""
    result = [issue["message"] for issue in errors(row)]
    if row.status == LeaveTemplateVersion.Status.DEPRECATED:
        result.append("این نسخه منسوخ شده است و قابل استفاده نیست.")
    if row.expires_at and row.expires_at < today:
        result.append(f"اعتبار این نسخه در {fa_date(row.expires_at)} به پایان رسیده است.")
    return result


def usable_problem(row, today):
    """Why this version cannot fill a document now (None when it can)."""
    if row is None:
        return "قالب فعالی برای فرم مرخصی تعریف نشده است؛ مدیر سامانه باید قالب Word را بارگذاری و فعال کند."
    problems = warnings(row, today)
    if row.status != LeaveTemplateVersion.Status.ACTIVE:
        problems.insert(0, "این نسخهٔ قالب فعال نیست.")
    return " ".join(problems) or None


def active(workspace):
    return LeaveTemplateVersion.objects.filter(workspace=workspace, status=LeaveTemplateVersion.Status.ACTIVE).first()


def active_or_problem(workspace, now=None):
    row = active(workspace)
    problem = usable_problem(row, local_today(workspace, now))
    if problem and row is not None:
        problem = f"قالب فعال فرم مرخصی قابل استفاده نیست: {problem}"
    return row, problem


def content(row):
    try:
        with row.file.asset.open("rb") as stream:
            return stream.read()
    except OSError as exc:
        raise ValidationError("فایل قالب در ذخیره‌سازی در دسترس نیست.") from exc


def serialize(row, today):
    return {
        "id": str(row.id),
        "number": row.number,
        "title": row.title,
        "original_name": row.original_name,
        "size": row.size,
        "status": row.status,
        "status_label": STATUS_TITLES.get(row.status, row.status),
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
        "expires_text": fa_date(row.expires_at) if row.expires_at else "",
        "is_expired": bool(row.expires_at and row.expires_at < today),
        "placeholders": row.placeholders,
        "issues": row.issues,
        "warnings": warnings(row, today),
        "can_activate": row.status == LeaveTemplateVersion.Status.INACTIVE and not warnings(row, today),
        "note": row.note,
        "created_at": row.created_at.isoformat(),
        "created_by": (
            {"id": str(row.created_by_id), "name": row.created_by.display_name or row.created_by.username}
            if row.created_by_id
            else None
        ),
        "activated_at": row.activated_at.isoformat() if row.activated_at else None,
        "deprecated_at": row.deprecated_at.isoformat() if row.deprecated_at else None,
    }


def overview(workspace, now=None):
    today = local_today(workspace, now)
    rows = list(LeaveTemplateVersion.objects.filter(workspace=workspace).select_related("created_by"))
    current = next((row for row in rows if row.status == LeaveTemplateVersion.Status.ACTIVE), None)
    return {
        "versions": [serialize(row, today) for row in rows],
        "active_problem": active_or_problem(workspace, now)[1],
        "has_active": current is not None,
        "placeholders": documents.catalog(),
    }


def _get(workspace, template_id, lock=False):
    rows = LeaveTemplateVersion.objects.filter(workspace=workspace)
    if lock:
        rows = rows.select_for_update()
    try:
        row = rows.filter(id=template_id).first()
    except (ValueError, TypeError):
        row = None
    if row is None:
        raise NotFound("نسخهٔ قالب پیدا نشد.")
    return row


@transaction.atomic
def upload(workspace, actor, upload_file, data, request=None):
    require_manager(actor, workspace, request)
    if upload_file is None:
        raise ValidationError({"file": "فایل قالب Word (.docx) را انتخاب کنید."})
    if PurePath(upload_file.name or "").suffix.lower() != ".docx":
        raise ValidationError({"file": "فقط فایل Word با پسوند .docx پذیرفته می‌شود."})
    if upload_file.size > documents.MAX_TEMPLATE_BYTES:
        raise ValidationError({"file": "حجم فایل قالب بیش از ۵ مگابایت است."})
    data_bytes = upload_file.read(documents.MAX_TEMPLATE_BYTES + 1)
    report = documents.validate_template(data_bytes)
    file_errors = [issue for issue in report["issues"] if issue["code"] == "file"]
    if file_errors:
        raise ValidationError({"file": file_errors[0]["message"], "issues": report["issues"]})
    title = str(data.get("title") or "").strip()[:255] or "فرم درخواست مرخصی"
    expires = data.get("expires_at") or None
    if expires:
        from datetime import date

        try:
            expires = date.fromisoformat(str(expires))
        except ValueError:
            raise ValidationError({"expires_at": "تاریخ انقضا معتبر نیست."})
    last = LeaveTemplateVersion.objects.select_for_update().filter(workspace=workspace).order_by("-number").first()
    name = PurePath(upload_file.name).name
    asset = FileAsset.objects.create(
        workspace=workspace,
        user=actor,
        asset=ContentFile(data_bytes, name=name),
        entity_type=LEAVE_TEMPLATE,
        entity_identifier="",
        size=len(data_bytes),
        is_uploaded=True,
        attributes={
            "name": name,
            "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
    )
    row = LeaveTemplateVersion.objects.create(
        workspace=workspace,
        number=(last.number if last else 0) + 1,
        title=title,
        file=asset,
        original_name=name,
        sha256=hashlib.sha256(data_bytes).hexdigest(),
        size=len(data_bytes),
        placeholders=report["placeholders"],
        issues=report["issues"],
        expires_at=expires,
        note=str(data.get("note") or "")[:2000],
        created_by=actor,
    )
    asset.entity_identifier = str(row.id)
    asset.save(update_fields=["entity_identifier"])
    _audit(
        workspace,
        actor,
        "leave.template.uploaded",
        row,
        None,
        {"number": row.number, "sha256": row.sha256, "issues": row.issues},
    )
    return row


@transaction.atomic
def activate(workspace, actor, template_id, request=None, now=None):
    require_manager(actor, workspace, request)
    row = _get(workspace, template_id, lock=True)
    today = local_today(workspace, now)
    if row.status == LeaveTemplateVersion.Status.ACTIVE:
        return row
    if row.status == LeaveTemplateVersion.Status.DEPRECATED:
        raise ValidationError("نسخهٔ منسوخ قابل فعال‌سازی نیست؛ قالب را دوباره بارگذاری کنید.")
    problems = warnings(row, today)
    if problems:
        raise ValidationError({"detail": "قالب نامعتبر قابل فعال‌سازی نیست.", "issues": problems})
    previous = (
        LeaveTemplateVersion.objects.select_for_update()
        .filter(workspace=workspace, status=LeaveTemplateVersion.Status.ACTIVE)
        .first()
    )
    if previous is not None:
        previous.status = LeaveTemplateVersion.Status.INACTIVE
        previous.save(update_fields=["status", "updated_at"])
    row.status = LeaveTemplateVersion.Status.ACTIVE
    row.activated_at, row.activated_by = timezone.now(), actor
    row.save(update_fields=["status", "activated_at", "activated_by", "updated_at"])
    _audit(
        workspace,
        actor,
        "leave.template.activated",
        row,
        {"active": previous.number if previous else None},
        {"active": row.number},
    )
    return row


@transaction.atomic
def update(workspace, actor, template_id, data, request=None):
    """Set the expiry date or deprecate a version. Deprecation is final."""
    require_manager(actor, workspace, request)
    row = _get(workspace, template_id, lock=True)
    before = {"status": row.status, "expires_at": row.expires_at.isoformat() if row.expires_at else None}
    if "expires_at" in data:
        value = data.get("expires_at")
        if value in (None, ""):
            row.expires_at = None
        else:
            from datetime import date

            try:
                row.expires_at = date.fromisoformat(str(value))
            except ValueError:
                raise ValidationError({"expires_at": "تاریخ انقضا معتبر نیست."})
    if data.get("deprecate") is True and row.status != LeaveTemplateVersion.Status.DEPRECATED:
        row.status = LeaveTemplateVersion.Status.DEPRECATED
        row.deprecated_at, row.deprecated_by = timezone.now(), actor
    row.save()
    after = {"status": row.status, "expires_at": row.expires_at.isoformat() if row.expires_at else None}
    _audit(workspace, actor, "leave.template.updated", row, before, after, str(data.get("reason") or "")[:2000])
    return row


def sample():
    return BytesIO(documents.build_sample_template())
