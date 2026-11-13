"""Signature images (ticket 6): upload, replacement, consent and audited access.

A signature here is a stored picture placed on a Word document after an explicit
user action; it is NOT a cryptographic (PKI) signature. Images are private
``FileAsset`` rows served only through ``read_image`` (self or ``Signature.Manage``)
and every upload, replacement, access, consent and revocation is recorded as an
``EntityEvent`` with the actor, time and image id.
"""

import hashlib
from pathlib import PurePath

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from plane.db.models import SIGNATURE_IMAGE, EntityEvent, FileAsset, SignatureImage, User
from .access_control import has_permission
from .entity_records import emit_definition

MAX_SIGNATURE_BYTES = 1024 * 1024
SIGNATURE_TYPES = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg"}
NOTICE = "این تصویر امضا است و امضای دیجیتال رمزنگاری‌شده نیست."
EVENT_TYPES = (
    "signature.uploaded",
    "signature.replaced",
    "signature.viewed",
    "signature.consent_granted",
    "signature.consent_revoked",
    "signature.used",
)


def _sniff(content):
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    return None


def audit(workspace, actor, event_type, row, before=None, after=None, **extra):
    event = emit_definition(workspace, actor, event_type, row, before, after)
    event.metadata = {**event.metadata, "subject_user": str(row.user_id), "actor_id": str(actor.id), **extra}
    event.save(update_fields=["metadata"])
    return event


def member(workspace, user_id):
    try:
        user = (
            User.objects.filter(
                id=user_id,
                is_active=True,
                member_workspace__workspace=workspace,
                member_workspace__is_active=True,
                member_workspace__deleted_at__isnull=True,
            )
            .distinct()
            .first()
        )
    except (TypeError, ValueError, DjangoValidationError):
        user = None
    if user is None:
        raise NotFound("این کاربر عضو فعال این شرکت نیست.")
    return user


def current(workspace, user):
    return SignatureImage.objects.filter(workspace=workspace, user=user, is_current=True).select_related("file").first()


def can_view(actor, target, workspace, request=None):
    return actor.id == target.id or has_permission(actor, workspace, "Signature.Manage", request=request)


def serialize(row, *, include_uploader=True):
    if row is None:
        return None
    data = {
        "id": str(row.id),
        "uploaded_at": row.created_at.isoformat(),
        "content_type": row.content_type,
        "size": row.size,
        "has_consent": row.has_consent,
        "consent_at": row.consent_at.isoformat() if row.consent_at else None,
        "consent_revoked_at": row.consent_revoked_at.isoformat() if row.consent_revoked_at else None,
    }
    if include_uploader and row.uploaded_by_id:
        uploader = row.uploaded_by
        data["uploaded_by"] = {"id": str(uploader.id), "name": uploader.display_name or uploader.username}
    return data


@transaction.atomic
def upload(workspace, actor, target, upload_file, request=None):
    """Upload or replace ``target``'s signature (``Signature.Manage`` only). Consent never carries over."""
    if not has_permission(actor, workspace, "Signature.Manage", request=request):
        raise PermissionDenied("فقط نقش مجاز می‌تواند تصویر امضای کاربران را بارگذاری یا جایگزین کند.")
    if upload_file is None:
        raise ValidationError({"file": "فایل تصویر امضا را انتخاب کنید."})
    extension = PurePath(upload_file.name or "").suffix.lower().lstrip(".")
    if extension not in SIGNATURE_TYPES:
        raise ValidationError({"file": "فقط تصویر PNG یا JPG پذیرفته می‌شود."})
    if upload_file.size > MAX_SIGNATURE_BYTES:
        raise ValidationError({"file": "حجم تصویر امضا نباید از ۱ مگابایت بیشتر باشد."})
    content = upload_file.read(MAX_SIGNATURE_BYTES + 1)
    if len(content) > MAX_SIGNATURE_BYTES:
        raise ValidationError({"file": "حجم تصویر امضا نباید از ۱ مگابایت بیشتر باشد."})
    kind = _sniff(content)
    if kind is None or kind != SIGNATURE_TYPES[extension]:
        raise ValidationError({"file": "محتوای فایل تصویر PNG یا JPG معتبر نیست."})
    upload_file.seek(0)
    previous = (
        SignatureImage.objects.select_for_update().filter(workspace=workspace, user=target, is_current=True).first()
    )
    now = timezone.now()
    if previous is not None:
        previous.is_current = False
        previous.replaced_at = now
        previous.save(update_fields=["is_current", "replaced_at", "updated_at"])
    asset = FileAsset.objects.create(
        workspace=workspace,
        user=target,
        asset=upload_file,
        entity_type=SIGNATURE_IMAGE,
        entity_identifier=str(target.id),
        size=len(content),
        is_uploaded=True,
        attributes={"name": f"signature.{extension}", "content_type": kind},
    )
    row = SignatureImage.objects.create(
        workspace=workspace,
        user=target,
        file=asset,
        content_type=kind,
        sha256=hashlib.sha256(content).hexdigest(),
        size=len(content),
        uploaded_by=actor,
        created_by=actor,
    )
    audit(
        workspace,
        actor,
        "signature.replaced" if previous else "signature.uploaded",
        row,
        {"signature_id": str(previous.id)} if previous else None,
        {"signature_id": str(row.id), "sha256": row.sha256},
    )
    return row


def read_image(workspace, actor, target, signature_id=None, request=None):
    """Bytes of a signature image for an authorized viewer; every access is recorded."""
    if not can_view(actor, target, workspace, request):
        raise PermissionDenied("اجازهٔ مشاهدهٔ تصویر امضای این کاربر را ندارید.")
    rows = SignatureImage.objects.filter(workspace=workspace, user=target).select_related("file")
    row = rows.filter(id=signature_id).first() if signature_id else rows.filter(is_current=True).first()
    if row is None:
        raise NotFound("تصویر امضایی برای این کاربر ثبت نشده است.")
    try:
        with row.file.asset.open("rb") as stream:
            content = stream.read()
    except OSError as exc:
        raise NotFound("فایل تصویر امضا در ذخیره‌سازی در دسترس نیست.") from exc
    audit(workspace, actor, "signature.viewed", row, None, {"signature_id": str(row.id)})
    return row, content


def image_bytes(row):
    with row.file.asset.open("rb") as stream:
        return stream.read()


@transaction.atomic
def set_consent(workspace, actor, data):
    """Grant consent for the image the user has just seen, or revoke it. Only the owner may do this."""
    row = SignatureImage.objects.select_for_update().filter(workspace=workspace, user=actor, is_current=True).first()
    if row is None:
        raise ValidationError("هنوز تصویر امضایی برای شما بارگذاری نشده است.")
    grant = data.get("grant")
    if not isinstance(grant, bool):
        raise ValidationError({"grant": "اعطا یا لغو اجازه را مشخص کنید."})
    before = serialize(row, include_uploader=False)
    now = timezone.now()
    if grant:
        # The user must confirm the exact image they were shown; a replaced image needs a new consent.
        if str(data.get("signature_id") or "") != str(row.id):
            raise ValidationError(
                {"signature_id": "تصویر امضا تغییر کرده است؛ تصویر جدید را ببینید و دوباره تأیید کنید."}
            )
        if data.get("confirm") is not True:
            raise ValidationError({"confirm": "برای اعطای اجازه، تأیید صریح لازم است."})
        if row.has_consent:
            return row
        row.consent_at, row.consent_revoked_at = now, None
        event = "signature.consent_granted"
    else:
        if not row.has_consent:
            raise ValidationError("اجازه‌ای برای لغو وجود ندارد.")
        row.consent_revoked_at = now
        event = "signature.consent_revoked"
    row.save(update_fields=["consent_at", "consent_revoked_at", "updated_at"])
    audit(workspace, actor, event, row, before, serialize(row, include_uploader=False))
    return row


def history(workspace, actor, target, request=None):
    if not can_view(actor, target, workspace, request):
        raise PermissionDenied("اجازهٔ مشاهدهٔ سابقهٔ امضای این کاربر را ندارید.")
    rows = (
        EntityEvent.objects.filter(
            workspace=workspace, event_type__in=EVENT_TYPES, metadata__subject_user=str(target.id)
        )
        .select_related("created_by")
        .order_by("-created_at", "-id")[:200]
    )
    return [
        {
            "id": str(row.id),
            "type": row.event_type,
            "at": row.created_at.isoformat(),
            "actor": (
                {"id": str(row.created_by_id), "name": row.created_by.display_name or row.created_by.username}
                if row.created_by_id
                else None
            ),
            "signature_id": row.metadata.get("definition_id"),
            "data": row.metadata.get("request") or {},
        }
        for row in rows
    ]


def overview(workspace):
    """Members with their current signature state (for the management page)."""
    members = (
        User.objects.filter(
            is_active=True,
            is_bot=False,
            member_workspace__workspace=workspace,
            member_workspace__is_active=True,
            member_workspace__deleted_at__isnull=True,
        )
        .distinct()
        .order_by("display_name", "username")
    )
    current_rows = {
        row.user_id: row
        for row in SignatureImage.objects.filter(workspace=workspace, is_current=True).select_related("uploaded_by")
    }
    return [
        {
            "user": {"id": str(user.id), "name": user.display_name or user.username},
            "signature": serialize(current_rows.get(user.id)),
        }
        for user in members
    ]
