"""Ticket 7 — files of portal requests and messages on the existing ``FileAsset`` table.

Decision 7.9: size and extension go through the shared ``entity_files.validate_file``;
on top of it the real type is read from the content (magic numbers / zip manifest), the
name is reduced to a safe base name (anything with a path part is refused) and the count
per message is capped. A file belongs to exactly one comment: it is visible in the portal
only when that comment is ``EXTERNAL`` (an internal note's file never is).
Files are never exposed through a storage URL: both sides download through
permission-checked endpoints that stream the bytes.
"""

import hashlib
import io
import re
import unicodedata
import zipfile
from pathlib import PurePosixPath

from django.core.files.base import ContentFile
from django.http import FileResponse
from rest_framework.exceptions import ValidationError

from plane.db.models import PORTAL_ATTACHMENT, FileAsset

from .entity_files import validate_file

MIME = {
    "pdf": "application/pdf",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "webp": "image/webp",
    "txt": "text/plain",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
UNSAFE = re.compile(r"[\x00-\x1f\x7f<>:\"|?*]")


def sniff(content):
    """The extension the bytes really are, or None. Never trusts the name or the client MIME."""
    head = content[:16]
    if head.startswith(b"%PDF-"):
        return "pdf"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if head.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if head[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "webp"
    if head.startswith(b"PK\x03\x04"):
        try:
            names = set(zipfile.ZipFile(io.BytesIO(content)).namelist())
        except zipfile.BadZipFile:
            return None
        if "[Content_Types].xml" in names:
            if any(n.startswith("word/") for n in names):
                return "docx"
            if any(n.startswith("xl/") for n in names):
                return "xlsx"
        return None
    if b"\x00" in content[:4096]:
        return None
    try:
        content[:65536].decode("utf-8")
    except UnicodeDecodeError:
        return None
    return "txt"


def safe_name(name):
    """A plain base name or 400 — a name with a path, traversal or control characters is refused."""
    raw = name if isinstance(name, str) else ""
    if not raw or "/" in raw or "\\" in raw or ".." in raw or UNSAFE.search(raw):
        raise ValidationError({"files": "نام فایل مجاز نیست؛ نام نباید مسیر یا نویسهٔ ویژه داشته باشد."})
    clean = unicodedata.normalize("NFC", raw).strip().strip(".")
    if not clean or len(clean) > 150 or not PurePosixPath(clean).suffix:
        raise ValidationError({"files": "نام فایل مجاز نیست."})
    return clean


def validate_upload(upload, config):
    """(name, extension, content) after every check of decision 7.9."""
    name = safe_name(getattr(upload, "name", ""))
    extension = PurePosixPath(name).suffix.lower().lstrip(".")
    files = config["files"]
    validate_file({"max_file_size": files["max_size"], "extensions": files["extensions"]}, name, upload.size)
    content = upload.read(files["max_size"] + 1)
    if len(content) > files["max_size"]:
        raise ValidationError("حجم فایل بیش از حد مجاز است.")
    real = sniff(content)
    if real is None or (real != extension and {real, extension} != {"jpg", "jpeg"}):
        raise ValidationError({"files": f"محتوای فایل «{name}» با نوع آن هم‌خوان نیست."})
    return name, extension, content


def validate_uploads(uploads, config):
    if len(uploads) > config["files"]["max_count"]:
        raise ValidationError({"files": f"حداکثر {config['files']['max_count']} فایل در هر پیام مجاز است."})
    return [validate_upload(upload, config) for upload in uploads]


def store(comment, checked, *, user=None):
    rows = []
    for name, extension, content in checked:
        rows.append(
            FileAsset.objects.create(
                workspace_id=comment.workspace_id,
                project_id=comment.project_id,
                issue_id=comment.issue_id,
                comment=comment,
                user=user,
                entity_type=PORTAL_ATTACHMENT,
                entity_identifier=str(comment.issue_id),
                asset=ContentFile(content, name=f"{hashlib.sha256(content).hexdigest()[:24]}.{extension}"),
                size=len(content),
                is_uploaded=True,
                attributes={
                    "name": name,
                    "content_type": MIME[extension],
                    "sha256": hashlib.sha256(content).hexdigest(),
                },
            )
        )
    return rows


def file_payload(asset, *, portal):
    return {
        "id": str(asset.id),
        "name": asset.attributes.get("name", "file"),
        "size": int(asset.size or 0),
        "content_type": asset.attributes.get("content_type", "application/octet-stream"),
        "url": (f"/api/portal/v1/files/{asset.id}/" if portal else None),
    }


def download(asset):
    response = FileResponse(
        asset.asset.open("rb"),
        as_attachment=True,
        filename=asset.attributes.get("name", "file"),
        content_type=asset.attributes.get("content_type", "application/octet-stream"),
    )
    response["X-Content-Type-Options"] = "nosniff"
    response["Cache-Control"] = "private, no-store"
    return response
