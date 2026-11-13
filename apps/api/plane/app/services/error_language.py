"""Localize API error messages without changing field names or machine codes."""

import re

PERSIAN = re.compile(r"[\u0600-\u06ff]")
MESSAGES = {
    "This username is already in use.": "این نام کاربری قبلاً انتخاب شده است",
    "This email is already in use.": "این ایمیل ثبت شده است",
    "Enter a valid email address.": "ایمیل معتبر وارد کنید.",
    "This field is required.": "تکمیل این فیلد الزامی است.",
    "This field may not be blank.": "این فیلد نباید خالی باشد.",
    "This field may not be null.": "تکمیل این فیلد الزامی است.",
    "Authentication credentials were not provided.": "برای ادامه وارد حساب خود شوید.",
    "You do not have permission to perform this action.": "اجازه انجام این عملیات را ندارید.",
    "Not found.": "مورد درخواستی پیدا نشد.",
    "This password is too common.": "این رمز عبور بسیار رایج است؛ رمز دیگری انتخاب کنید.",
    "This password is entirely numeric.": "رمز عبور نباید فقط شامل عدد باشد.",
    "This task is not assigned to you.": "این کار به شما واگذار نشده است.",
    "Select another team member to transfer this task.": "برای انتقال کار، یک عضو دیگر تیم را انتخاب کنید.",
    "The assignee must be an active team member.": "مسئول باید عضو فعال تیم باشد.",
}
FALLBACKS = {
    401: "برای ادامه وارد حساب خود شوید.",
    403: "اجازه انجام این عملیات را ندارید.",
    404: "مورد درخواستی پیدا نشد.",
    405: "این عملیات پشتیبانی نمی‌شود.",
    409: "اطلاعات تکراری است یا با تغییرات دیگری تداخل دارد.",
    429: "تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید.",
}
FIELD_LABELS = {
    "title": "نام",
    "name": "نام",
    "code": "کد",
    "kind": "نوع",
    "options": "گزینه‌ها",
    "lookup": "فهرست انتخابی",
    "relation_entity": "بخش مرتبط",
    "columns": "ستون‌های جدول",
    "table_tabs": "تب‌های جدول",
    "placeholder": "متن نمونه",
    "help_text": "راهنما",
    "config": "تنظیمات",
    "layout": "چیدمان",
    "sections": "بخش‌ها",
    "bindings": "ورودی‌های چیدمان",
    "description": "توضیحات",
    "parent": "والد",
    "category": "دسته",
    "color": "رنگ",
    "icon": "نماد",
    "position": "ترتیب",
    "revision": "نسخه",
    "default": "مقدار پیش‌فرض",
    "required_if": "شرط الزامی بودن",
    "visible_if": "شرط نمایش",
    "formula": "فرمول",
}
PATTERNS = (
    (r'^"?(.*?)"? is not a valid choice\.?$', lambda m: f"مقدار «{m[1]}» جزو گزینه‌های مجاز نیست."),
    (r"no more than (\d+) characters", lambda m: f"حداکثر {m[1]} نویسه مجاز است."),
    (r"at least (\d+) characters", lambda m: f"حداقل {m[1]} نویسه لازم است."),
    (r"less than or equal to (-?\d+(?:\.\d+)?)", lambda m: f"مقدار باید حداکثر {m[1]} باشد."),
    (r"greater than or equal to (-?\d+(?:\.\d+)?)", lambda m: f"مقدار باید حداقل {m[1]} باشد."),
    (r"no more than (\d+) digits", lambda m: f"حداکثر {m[1]} رقم مجاز است."),
    (r"no more than (\d+) decimal places", lambda m: f"حداکثر {m[1]} رقم اعشار مجاز است."),
    (r"no more than (\d+) elements", lambda m: f"حداکثر {m[1]} مورد مجاز است."),
    (r"must make a unique set", lambda m: "این ترکیب قبلاً ثبت شده است؛ مقدار دیگری وارد کنید."),
    (r"with this .+ already exists", lambda m: "این مقدار قبلاً ثبت شده است؛ مقدار دیگری وارد کنید."),
    (r"must be unique", lambda m: "این مقدار قبلاً ثبت شده است؛ مقدار دیگری وارد کنید."),
    (r'Invalid pk "?(.*?)"? - object does not exist', lambda m: "مورد انتخاب‌شده وجود ندارد یا حذف شده است."),
    (r"does not exist", lambda m: "مورد انتخاب‌شده وجود ندارد یا حذف شده است."),
    (r"valid UUID", lambda m: "شناسه ارسال‌شده معتبر نیست."),
    (r"valid integer", lambda m: "یک عدد صحیح وارد کنید."),
    (r"valid number", lambda m: "یک عدد معتبر وارد کنید."),
    (r"valid boolean", lambda m: "مقدار بله/خیر معتبر نیست."),
    (r"Date has wrong format", lambda m: "قالب تاریخ معتبر نیست."),
    (r"Datetime has wrong format", lambda m: "قالب تاریخ و ساعت معتبر نیست."),
    (r"Time has wrong format", lambda m: "قالب ساعت معتبر نیست."),
    (r"valid URL", lambda m: "نشانی اینترنتی معتبر وارد کنید."),
    (r"Expected a list of items", lambda m: "باید فهرستی از مقادیر ارسال شود."),
    (r"Expected a dictionary", lambda m: "ساختار اطلاعات ارسال‌شده معتبر نیست."),
    (r"list may not be empty", lambda m: "حداقل یک مورد را انتخاب کنید."),
    (r"Incorrect type", lambda m: "نوع مقدار ارسال‌شده معتبر نیست."),
    (r"Method \"?(\w+)\"? not allowed", lambda m: "این نوع درخواست برای این بخش پشتیبانی نمی‌شود."),
    (r"Unsupported media type", lambda m: "قالب فایل یا اطلاعات ارسالی پشتیبانی نمی‌شود."),
    (r"JSON parse error|Malformed", lambda m: "اطلاعات ارسالی قابل خواندن نیست؛ صفحه را تازه کنید و دوباره تلاش کنید."),
    (r"Request was throttled.*?(\d+) seconds?", lambda m: f"تعداد درخواست‌ها زیاد است؛ {m[1]} ثانیه دیگر دوباره تلاش کنید."),
    (r"CSRF", lambda m: "نشست امنیتی صفحه منقضی شده است؛ صفحه را تازه کنید و دوباره تلاش کنید."),
    (r"(token|credentials).*(invalid|expired|not provided)", lambda m: "نشست شما پایان یافته است؛ دوباره وارد حساب شوید."),
    (r"file.*(too large|size)", lambda m: "حجم فایل بیش از حد مجاز است."),
)
CODES = {
    "required": "تکمیل این ورودی الزامی است.",
    "blank": "این ورودی نمی‌تواند خالی باشد.",
    "null": "تکمیل این ورودی الزامی است.",
    "unique": "این مقدار قبلاً ثبت شده است؛ مقدار دیگری وارد کنید.",
    "does_not_exist": "مورد انتخاب‌شده وجود ندارد یا حذف شده است.",
    "incorrect_type": "نوع مقدار ارسال‌شده معتبر نیست.",
    "not_a_list": "باید فهرستی از مقادیر ارسال شود.",
    "empty": "حداقل یک مورد را انتخاب کنید.",
    "not_authenticated": "نشست شما پایان یافته است؛ دوباره وارد حساب شوید.",
    "authentication_failed": "نشست شما پایان یافته است؛ دوباره وارد حساب شوید.",
    "permission_denied": "اجازه انجام این عملیات را ندارید.",
    "not_found": "مورد درخواستی پیدا نشد یا حذف شده است.",
    "method_not_allowed": "این نوع درخواست برای این بخش پشتیبانی نمی‌شود.",
    "parse_error": "اطلاعات ارسالی قابل خواندن نیست؛ صفحه را تازه کنید و دوباره تلاش کنید.",
    "unsupported_media_type": "قالب فایل یا اطلاعات ارسالی پشتیبانی نمی‌شود.",
    "throttled": "تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید.",
}
MACHINE_FIELDS = {"code", "error_code", "status_code", "type", "record_url", "rule", "choices", "substitute"}


def persian_errors(value, status_code=400, field=None):
    # "code" is both a machine code ({"code": "unique"}) and a field name ({"code": ["..."]}).
    if field in MACHINE_FIELDS and (field != "code" or not isinstance(value, (list, tuple))):
        return value
    if field and re.fullmatch(r"_unique\d+", field):
        return value
    # Machine field keys: "fields" (engine) and "missing" (ticket 8: columns a saved report lost).
    if field in ("fields", "missing") and isinstance(value, list) and all(isinstance(item, str) and re.fullmatch(r"[a-zA-Z0-9_-]+", item) for item in value):
        return value
    if isinstance(value, dict):
        if set(value) == {"path", "label", "message"}:
            return {
                "path": value["path"],
                "label": persian_errors(value["label"], status_code),
                "message": persian_errors(value["message"], status_code),
            }
        return {key: persian_errors(item, status_code, key) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        # Items of a field error list are messages, even when the field is called "code".
        item_field = None if field == "code" else field
        return [persian_errors(item, status_code, item_field) for item in value]
    if not isinstance(value, str) or not value or PERSIAN.search(value):
        return value
    if value in MESSAGES:
        return MESSAGES[value]
    if (field == "email" or "email" in value.lower()) and any(
        word in value.lower() for word in ("already", "unique", "exists")
    ):
        return "این ایمیل ثبت شده است"
    if "password is too short" in value.lower():
        return "رمز عبور بسیار کوتاه است؛ حداقل ۸ نویسه وارد کنید."
    if "password is too similar" in value.lower():
        return "رمز عبور بیش از حد به اطلاعات حساب شبیه است؛ رمز دیگری انتخاب کنید."
    specific = translate_message(value)
    if specific:
        return specific
    fallback = (
        "مشکلی در سرور پیش آمد؛ دوباره تلاش کنید."
        if status_code >= 500
        else "اطلاعات واردشده معتبر نیست؛ آن را بررسی کنید."
    )
    return FALLBACKS.get(status_code, fallback)


PERSIAN_DIGITS = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")


def translate_message(value):
    """Return a specific Persian reason for a known English validation message, if any."""
    for pattern, render in PATTERNS:
        match = re.search(pattern, value, re.IGNORECASE)
        if match:
            return render(match).translate(PERSIAN_DIGITS)
    code = getattr(value, "code", None)
    if code in CODES:
        return CODES[code]
    if code in {"max_length", "min_length", "max_value", "min_value", "invalid_choice"}:
        return "مقدار واردشده خارج از محدوده مجاز است."
    return None


def database_error_message(error):
    """Explain an IntegrityError by its PostgreSQL state instead of a generic failure."""
    cause = getattr(error, "__cause__", None)
    state = getattr(cause, "sqlstate", None) or getattr(cause, "pgcode", None)
    diag = getattr(cause, "diag", None)
    column = getattr(diag, "column_name", None)
    label = FIELD_LABELS.get(column or "", "")
    suffix = f" ({label})" if label else ""
    return {
        "23505": f"این مقدار قبلاً ثبت شده است و تکراری است{suffix}؛ مقدار دیگری وارد کنید.",
        "23503": f"مورد مرتبط انتخاب‌شده وجود ندارد یا حذف شده است{suffix}.",
        "23502": f"یک ورودی الزامی خالی مانده است{suffix}.",
        "23514": f"مقدار واردشده با قواعد ثبت سازگار نیست{suffix}.",
    }.get(state, "اطلاعات با داده‌های ثبت‌شده سازگار نیست؛ موارد تکراری یا حذف‌شده را بررسی کنید.")


def validation_error_message(error):
    """Join the messages of a Django ValidationError into one specific Persian sentence."""
    messages = getattr(error, "messages", None) or [str(error)]
    localized = [persian_errors(str(message)) for message in messages if str(message).strip()]
    return " ".join(dict.fromkeys(localized)) or "اطلاعات واردشده معتبر نیست؛ آن را بررسی کنید."
