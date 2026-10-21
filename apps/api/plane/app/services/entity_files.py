"""Shared validation and portable, immutable default attachments."""

import base64
import hashlib
from pathlib import PurePath

from django.conf import settings
from django.core.files.base import ContentFile
from rest_framework.exceptions import ValidationError

from plane.db.models import FileAsset


def validate_file(config, name, size):
    if size > min(config.get("max_file_size", 5 * 1024 * 1024), settings.FILE_SIZE_LIMIT):
        raise ValidationError("حجم فایل بیش از حد مجاز است.")
    if config.get("extensions") and PurePath(name).suffix.lower().lstrip(".") not in config["extensions"]:
        raise ValidationError("نوع فایل مجاز نیست.")


def default_asset(workspace, user, code, config, content, name, content_type="application/octet-stream"):
    validate_file(config, name, len(content))
    digest = hashlib.sha256(content).hexdigest()
    existing = FileAsset.objects.filter(
        workspace=workspace,
        entity_type="CRM_FIELD_DEFAULT",
        attributes__field=code,
        attributes__sha256=digest,
        attributes__name=PurePath(name).name,
    ).first()
    if existing:
        return existing
    return FileAsset.objects.create(
        workspace=workspace,
        user=user,
        entity_type="CRM_FIELD_DEFAULT",
        entity_identifier="",
        asset=ContentFile(content, name=PurePath(name).name),
        size=len(content),
        is_uploaded=True,
        attributes={"field": code, "name": PurePath(name).name, "sha256": digest, "content_type": content_type},
    )


def export_default_file(value, field, workspace):
    asset = FileAsset.objects.filter(
        workspace=workspace, entity_type="CRM_FIELD_DEFAULT", attributes__field=field.code, id=value
    ).first()
    if not asset:
        raise ValidationError("فایل پیش‌فرض باید از پیوست‌های پیش‌فرض همین فیلد باشد.")
    try:
        with asset.asset.open("rb") as stream:
            content = stream.read(min(settings.FILE_SIZE_LIMIT, field.config.get("max_file_size", 5 * 1024 * 1024)) + 1)
        validate_file(field.config, asset.attributes["name"], len(content))
    except OSError as exc:
        raise ValidationError("فایل پیش‌فرض در ذخیره‌سازی در دسترس نیست.") from exc
    return {
        "__ref__": "file",
        "key": hashlib.sha256(content).hexdigest(),
        "name": asset.attributes["name"],
        "content_type": asset.attributes.get("content_type", "application/octet-stream"),
        "content": base64.b64encode(content).decode("ascii"),
    }


def import_default_file(value, field, workspace):
    try:
        content = base64.b64decode(value["content"], validate=True)
        if hashlib.sha256(content).hexdigest() != value["key"]:
            raise ValueError()
        return str(
            default_asset(
                workspace,
                workspace.owner,
                field.code,
                field.config,
                content,
                value["name"],
                value.get("content_type", "application/octet-stream"),
            ).id
        )
    except (KeyError, ValueError, TypeError) as exc:
        raise ValidationError("محتوای فایل پیش‌فرض در پیکربندی معتبر نیست.") from exc
