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
MACHINE_FIELDS = {"code", "error_code", "status_code", "type", "record_url", "rule", "choices", "substitute"}


def persian_errors(value, status_code=400, field=None):
    if field in MACHINE_FIELDS:
        return value
    if field and re.fullmatch(r"_unique\d+", field):
        return value
    if field == "fields" and isinstance(value, list) and all(isinstance(item, str) and re.fullmatch(r"[a-zA-Z0-9_-]+", item) for item in value):
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
        return [persian_errors(item, status_code, field) for item in value]
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
    fallback = (
        "مشکلی در سرور پیش آمد؛ دوباره تلاش کنید."
        if status_code >= 500
        else "اطلاعات واردشده معتبر نیست؛ آن را بررسی کنید."
    )
    return FALLBACKS.get(status_code, fallback)
