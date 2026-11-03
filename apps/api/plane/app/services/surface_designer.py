"""Server-owned capabilities, input limits and Persian errors for the page designer."""

from rest_framework.exceptions import ValidationError

from .access_control import has_permission
from .entity_rules import FIELD_KINDS
from .entity_schema import MANDATORY_SOURCES

MAX_TABLE_TABS = 20
MAX_TAB_TITLE = 80
MAX_FIELD_TITLE = 255
MAX_OPTIONS = 100
CREATABLE_KINDS = {key: title for key, title in FIELD_KINDS.items() if key not in {"computed", "relation"}}
LOCK_REASON = "این ورودی برای ثبت اطلاعات ضروری است؛ نمی‌توان آن را حذف، پنهان یا اختیاری کرد."


def designer_schema(workspace, code, user, engine_fields):
    publish = has_permission(user, workspace, "FormDesigner.Publish")
    create = has_permission(user, workspace, "Field.Create")
    return {
        "can_publish": publish,
        "can_create_field": publish and create,
        "publish_reason": "" if publish else "مجوز ذخیره و انتشار تنظیمات فرم را ندارید؛ از مدیر سامانه دسترسی بگیرید.",
        "create_field_reason": (
            "" if publish and create else "برای افزودن فیلد، مجوز ساخت فیلد و انتشار تنظیمات لازم است."
        ),
        "field_types": [{"id": key, "title": title} for key, title in CREATABLE_KINDS.items()],
        "locked_fields": {
            field["code"]: LOCK_REASON
            for field in engine_fields
            if field.get("binding", {}).get("source") in MANDATORY_SOURCES.get(code, set())
            and field.get("options_surface", code) == code
        },
        "limits": {
            "table_tabs": MAX_TABLE_TABS,
            "tab_title": MAX_TAB_TITLE,
            "field_title": MAX_FIELD_TITLE,
            "options": MAX_OPTIONS,
        },
    }


def new_field_data(payload):
    if not isinstance(payload, dict):
        raise ValidationError({"detail": "اطلاعات فیلد باید به‌صورت یک فرم معتبر ارسال شود."})
    errors = {}
    title = payload.get("title")
    kind = payload.get("kind", "short_text")
    if not isinstance(title, str) or not title.strip():
        errors["title"] = "نام فیلد را وارد کنید."
    elif len(title.strip()) > MAX_FIELD_TITLE:
        errors["title"] = "نام فیلد حداکثر ۲۵۵ نویسه است."
    if not isinstance(kind, str) or kind not in CREATABLE_KINDS:
        errors["kind"] = "نوع فیلد را از گزینه‌های مجاز انتخاب کنید."
    for key, label, limit in (("help_text", "راهنمای فیلد", 2000), ("placeholder", "متن نمونه", 255)):
        if key in payload and (not isinstance(payload[key], str) or len(payload[key]) > limit):
            errors[key] = f"{label} باید متن و حداکثر {limit} نویسه باشد."
    if isinstance(kind, str) and kind in {"select", "multi_select"}:
        options = payload.get("options")
        if not isinstance(options, list) or not 1 <= len(options) <= MAX_OPTIONS:
            errors["options"] = "بین یک تا صد گزینه وارد کنید؛ هر گزینه در یک خط."
        elif any(not isinstance(value, str) or not value.strip() or len(value.strip()) > 255 for value in options):
            errors["options"] = "هر گزینه باید متن غیرخالی و حداکثر ۲۵۵ نویسه باشد."
        elif len({value.strip() for value in options}) != len(options):
            errors["options"] = "گزینه‌های تکراری را حذف کنید؛ عنوان هر گزینه باید متفاوت باشد."
    if errors:
        raise ValidationError(errors)
    return {key: payload[key] for key in ("help_text", "placeholder") if key in payload} | {
        "title": title.strip(),
        "kind": kind,
    }


DEFAULT_LABEL = "تنظیمات"
FALLBACK = "عملیات انجام نشد؛ دوباره تلاش کنید."


def persian_errors(data, status):
    from plane.app.services.error_language import FIELD_LABELS, translate_message

    labels = {
        **FIELD_LABELS,
        "title": "نام فیلد",
        "kind": "نوع فیلد",
        "options": "گزینه‌ها",
        "columns": "ستون‌های جدول",
        "table_tabs": "تب‌های جدول",
        "placeholder": "متن نمونه",
        "help_text": "راهنمای فیلد",
    }
    defaults = {
        400: "اطلاعات تنظیمات معتبر نیست؛ موارد مشخص‌شده را اصلاح کنید.",
        401: "نشست شما پایان یافته است؛ دوباره وارد حساب شوید.",
        403: "اجازه انجام این تغییر را ندارید؛ دسترسی خود را از مدیر سامانه پیگیری کنید.",
        404: "صفحه یا تنظیمات درخواستی پیدا نشد؛ فهرست صفحه‌ها را دوباره دریافت کنید.",
        409: "تنظیمات توسط کاربر دیگری تغییر کرده است؛ نسخه جدید را دریافت کنید.",
        429: "تعداد درخواست‌ها زیاد است؛ کمی صبر کنید و دوباره تلاش کنید.",
    }
    details = []

    def visit(value, path=""):
        if isinstance(value, dict):
            for key, item in value.items():
                visit(item, f"{path}.{key}" if path else key)
        elif isinstance(value, (list, tuple)):
            for index, item in enumerate(value):
                visit(item, path if isinstance(item, str) else f"{path}.{index}")
        else:
            message = str(value)
            if not any("\u0600" <= char <= "\u06ff" for char in message):
                message = {
                    "required": "این ورودی را تکمیل کنید.",
                    "blank": "این ورودی نمی‌تواند خالی باشد.",
                    "null": "برای این ورودی مقدار وارد کنید.",
                    "max_length": "طول مقدار واردشده بیش از حد مجاز است.",
                    "invalid": "مقدار این ورودی معتبر نیست.",
                }.get(getattr(value, "code", "")) or translate_message(value) or defaults.get(status, FALLBACK)
            # The most specific known segment names the input, e.g. "form.sections.0.title" -> title.
            parts = [part for part in path.split(".") if part and not part.isdigit()]
            label = next((labels[part] for part in reversed(parts) if part in labels), DEFAULT_LABEL)
            details.append({"path": path, "label": label, "message": message})

    visit(data)
    first = details[0] if details else None
    return {
        "detail": (
            f"{first['label']}: {first['message']}"
            if first and first["label"] != DEFAULT_LABEL and not first["message"].startswith(first["label"])
            else first["message"]
            if first
            else defaults.get(status, FALLBACK)
        ),
        "errors": details,
    }
