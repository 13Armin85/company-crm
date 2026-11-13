"""Ticket 7 — customer-portal workspace settings and the customer-visible status.

Single source of truth for what a customer may see as the status of a request
(decision 7.6): the company defines an allowed label list; every internal state is
mapped onto that list here, and nothing else in the portal ever reads a ``State`` name
or a ``task-status`` title. An unmapped state falls back to ``default_label`` so an
internal name can never leak.

Settings live in the existing per-workspace ``SurfaceConfiguration`` table (code
``customer-portal``), the same place ``engine-settings`` lives; every change is an
``EntityEvent`` (``portal.settings_changed``).
"""

import re
import uuid
from copy import deepcopy

from django.conf import settings as django_settings
from django.db import transaction
from rest_framework.exceptions import ValidationError

from plane.db.models import SurfaceConfiguration

from .ticket_core import DONE, IN_PROGRESS, TODO, category_of

CODE = "customer-portal"
STAGES = ("pending", "accepted", "awaiting_customer", "rejected")
STAGE_TITLES = {
    "pending": "در انتظار تریاژ",
    "accepted": "پذیرفته‌شده",
    "awaiting_customer": "در انتظار تکمیل اطلاعات مشتری",
    "rejected": "ردشده",
}
# Extensions the server can verify by content (see portal_files.sniff); a company may narrow it.
SUPPORTED_EXTENSIONS = ("pdf", "png", "jpg", "jpeg", "gif", "webp", "txt", "docx", "xlsx")
DEFAULTS = {
    "labels": [
        {"code": "submitted", "title": "ثبت‌شده"},
        {"code": "reviewing", "title": "در حال بررسی"},
        {"code": "awaiting_customer", "title": "در انتظار پاسخ شما"},
        {"code": "in_progress", "title": "در حال انجام"},
        {"code": "done", "title": "انجام‌شده"},
        {"code": "rejected", "title": "ردشده"},
    ],
    "status_map": {
        f"category:{TODO}": "reviewing",
        f"category:{IN_PROGRESS}": "in_progress",
        f"category:{DONE}": "done",
    },
    "stage_labels": {"pending": "submitted", "awaiting_customer": "awaiting_customer", "rejected": "rejected"},
    "default_label": "reviewing",
    "staff_name": "team",
    "team_name": "تیم پشتیبانی",
    "feedback_edit_hours": 72,
    "files": {"max_count": 5, "max_size": 5 * 1024 * 1024, "extensions": list(SUPPORTED_EXTENSIONS)},
    "session": {"idle_minutes": 30, "absolute_hours": 12},
    "lockout": {"attempts": 5, "minutes": 15},
    "notify_channels": {"email": False, "sms": False},
}
SLUG = re.compile(r"^[a-z][a-z0-9_]{1,39}$")


def _int(value, label, low, high):
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise ValidationError({label: "عدد معتبر وارد کنید."})
    if not low <= number <= high:
        raise ValidationError({label: f"مقدار باید بین {low} و {high} باشد."})
    return number


def _text(value, label, limit):
    value = value.strip() if isinstance(value, str) else ""
    if not value:
        raise ValidationError({label: "این مقدار نباید خالی باشد."})
    if len(value) > limit:
        raise ValidationError({label: f"حداکثر {limit} نویسه مجاز است."})
    return value


def _map_key(key):
    kind, _, value = str(key).partition(":")
    if kind == "category" and value in (TODO, IN_PROGRESS, DONE):
        return key
    if kind == "state":
        try:
            return f"state:{uuid.UUID(value)}"
        except ValueError:
            pass
    if kind == "status" and re.match(r"^[a-z0-9_-]{1,80}$", value or ""):
        return key
    raise ValidationError({"status_map": f"کلید نگاشت «{key}» معتبر نیست."})


def validate(raw):
    """Whole-document validation; a label outside the company's allowed list is refused (400)."""
    if not isinstance(raw, dict):
        raise ValidationError("ساختار تنظیمات درگاه معتبر نیست.")
    unknown = set(raw) - set(DEFAULTS)
    if unknown:
        raise ValidationError(f"کلید ناشناخته در تنظیمات درگاه: {', '.join(sorted(unknown))}")
    data = {**deepcopy(DEFAULTS), **deepcopy(raw)}
    labels, seen = [], set()
    if not isinstance(data["labels"], list) or not 1 <= len(data["labels"]) <= 20:
        raise ValidationError({"labels": "فهرست برچسب‌های مجاز باید بین ۱ تا ۲۰ مورد باشد."})
    for item in data["labels"]:
        if not isinstance(item, dict) or not SLUG.match(str(item.get("code", ""))):
            raise ValidationError({"labels": "کد برچسب باید با حرف لاتین شروع شود و فقط حروف، عدد و _ داشته باشد."})
        if item["code"] in seen:
            raise ValidationError({"labels": f"کد برچسب «{item['code']}» تکراری است."})
        seen.add(item["code"])
        labels.append({"code": item["code"], "title": _text(item.get("title"), "labels", 60)})
    allowed = {item["code"] for item in labels}

    def allowed_label(value, label):
        if value not in allowed:
            raise ValidationError({label: f"برچسب «{value}» در فهرست مجاز شرکت نیست."})
        return value

    if not isinstance(data["status_map"], dict):
        raise ValidationError({"status_map": "نگاشت وضعیت معتبر نیست."})
    status_map = {_map_key(k): allowed_label(v, "status_map") for k, v in data["status_map"].items()}
    if not isinstance(data["stage_labels"], dict) or set(data["stage_labels"]) - set(STAGES):
        raise ValidationError({"stage_labels": "مرحلهٔ تریاژ ناشناخته است."})
    stage_labels = {k: allowed_label(v, "stage_labels") for k, v in data["stage_labels"].items()}
    files = data["files"] if isinstance(data["files"], dict) else {}
    extensions = files.get("extensions", [])
    if not isinstance(extensions, list) or not extensions or set(extensions) - set(SUPPORTED_EXTENSIONS):
        raise ValidationError(
            {"files": "پسوندهای مجاز فقط از این فهرست انتخاب می‌شوند: " + "، ".join(SUPPORTED_EXTENSIONS)}
        )
    session = data["session"] if isinstance(data["session"], dict) else {}
    lockout = data["lockout"] if isinstance(data["lockout"], dict) else {}
    channels = data["notify_channels"] if isinstance(data["notify_channels"], dict) else {}
    if data["staff_name"] not in ("team", "display_name"):
        raise ValidationError({"staff_name": "نحوهٔ نمایش نام پاسخ‌دهنده معتبر نیست."})
    return {
        "labels": labels,
        "status_map": status_map,
        "stage_labels": stage_labels,
        "default_label": allowed_label(data["default_label"], "default_label"),
        "staff_name": data["staff_name"],
        "team_name": _text(data["team_name"], "team_name", 80),
        "feedback_edit_hours": _int(data["feedback_edit_hours"], "feedback_edit_hours", 0, 720),
        "files": {
            "max_count": _int(files.get("max_count"), "files", 1, 10),
            "max_size": _int(files.get("max_size"), "files", 1024, django_settings.FILE_SIZE_LIMIT),
            "extensions": sorted(set(extensions)),
        },
        "session": {
            "idle_minutes": _int(session.get("idle_minutes"), "session", 5, 24 * 60),
            "absolute_hours": _int(session.get("absolute_hours"), "session", 1, 30 * 24),
        },
        "lockout": {
            "attempts": _int(lockout.get("attempts"), "lockout", 3, 20),
            "minutes": _int(lockout.get("minutes"), "lockout", 1, 24 * 60),
        },
        "notify_channels": {"email": channels.get("email") is True, "sms": channels.get("sms") is True},
    }


def load(workspace):
    stored = (
        SurfaceConfiguration.objects.filter(workspace=workspace, code=CODE).values_list("definition", flat=True).first()
    )
    if not stored:
        return deepcopy(DEFAULTS)
    try:
        return validate(stored)
    except ValidationError:
        return deepcopy(DEFAULTS)


def save(workspace, actor, raw):
    from .entity_records import emit_definition

    data = validate(raw)
    with transaction.atomic():
        row = SurfaceConfiguration.objects.select_for_update().filter(workspace=workspace, code=CODE).first()
        before = deepcopy(row.definition) if row else None
        if row is None:
            row = SurfaceConfiguration.objects.create(workspace=workspace, code=CODE, definition=data)
        else:
            row.definition, row.revision = data, row.revision + 1
            row.save()
        emit_definition(workspace, actor, "portal.settings_changed", row, before, data)
    return data


def label_title(config, code):
    return next((item["title"] for item in config["labels"] if item["code"] == code), None)


def customer_status(issue, config):
    """{code, title} the customer sees. Never an internal state or status name."""
    code = None
    stage = issue.portal_stage
    # "pending" only describes an untouched request: once the ticket is closed (e.g. solved in a call)
    # the category decides.
    if stage in config["stage_labels"] and not (stage == "pending" and category_of(issue) == DONE):
        code = config["stage_labels"][stage]
    if code is None:
        keys = []
        if issue.project_id and issue.state_id:
            keys.append(f"state:{issue.state_id}")
        if not issue.project_id:
            keys.append(f"status:{issue.status}")
        keys.append(f"category:{category_of(issue)}")
        code = next((config["status_map"][k] for k in keys if k in config["status_map"]), None)
    title = label_title(config, code) if code else None
    if title is None:
        code = config["default_label"]
        title = label_title(config, code) or "در حال بررسی"
    return {"code": code, "title": title}
