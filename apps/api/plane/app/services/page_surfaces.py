"""Presentation settings for business pages whose data is owned by a dedicated service."""


def page_surfaces(native):
    def spec(title, path, permission, columns=(), fields=()):
        return {
            "title": title,
            "path": path,
            "permission": permission,
            "columns": list(columns),
            "native": list(fields),
            "presentation_only": True,
        }

    result = {
        "leave-requests": spec(
            "درخواست‌های مرخصی",
            "/leave-requests",
            "Workflow.View",
            ["شماره", "درخواست‌دهنده", "شیوه", "بازه", "مدت", "وضعیت", "اکنون نزد"],
            [
                native("start_date", "تاریخ شروع", "date", True, True, aliases=("شروع",)),
                native("end_date", "تاریخ پایان", "date", True, True, aliases=("پایان",)),
                native("start_time", "ساعت شروع", required=True, locked=True),
                native("end_time", "ساعت پایان", required=True, locked=True),
                native("reason", "دلیل مرخصی (اختیاری)", "long_text", aliases=("دلیل",)),
                native("substitute", "جانشین پیشنهادی (اختیاری)", "user"),
            ],
        ),
        "daily-team": spec(
            "جدول گزارش روزانهٔ تیم",
            "/daily-report/team",
            "DailyReport.Team.View",
            ["فرد", "وضعیت", "مرخصی", "نیاز به کمک", "مانع", "انجام‌شده"],
        ),
        "daily-report-form": spec(
            "فرم گزارش روزانه",
            "/daily-report",
            "DailyReport.Submit",
            fields=[
                native("text", "شرح گزارش", "long_text", True, True),
                native("effort", "تخمین تلاش (نه ساعت کاری)", "number"),
            ],
        ),
        "leave-templates": spec(
            "قالب‌های Word مرخصی",
            "/leave-templates",
            "LeaveTemplate.Manage",
            fields=[
                native("title", "عنوان"),
                native("note", "یادداشت"),
                native("expires", "تاریخ انقضا (اختیاری)", "date"),
            ],
        ),
        "signatures": spec(
            "تصویر امضای کاربران", "/signatures", "Signature.Manage", ["کاربر", "وضعیت تصویر", "اجازهٔ کاربر", "اقدام"]
        ),
        "leave-versions": spec(
            "نسخه‌های درخواست مرخصی", "/leave-requests", "Workflow.View", ["نسخه", "بازه", "مدت", "امضا", "قالب", "سند"]
        ),
        "leave-placeholders": spec(
            "راهنمای جایگاه‌های Word مرخصی", "/leave-templates", "LeaveTemplate.Manage", ["جایگاه", "معنا", "الزامی"]
        ),
        "work-schedule-table": spec(
            "جدول برنامهٔ هفتگی",
            "/calendar",
            "Issue.View",
            ["روز", "روز کاری", "شروع", "پایان", "استراحت‌ها", "شیوهٔ کار"],
        ),
        "portal-status-labels": spec(
            "جدول برچسب‌های وضعیت مشتری",
            "/portal-settings?section=settings",
            "Portal.Settings.Manage",
            ["کد", "عنوان برای مشتری", "عملیات"],
        ),
        "portal-requests": spec(
            "درخواست‌های مشتریان",
            "/portal-settings",
            "Portal.Reply",
            ["شماره", "موضوع درخواست", "مشتری", "ثبت‌کننده", "مرحلهٔ رسیدگی", "وضعیت مشتری", "تاریخ ثبت", "عملیات"],
        ),
        "portal-accounts": spec(
            "حساب‌های درگاه مشتری",
            "/portal-settings?section=accounts",
            "Portal.Account.Manage",
            ["نام", "نام کاربری", "مشتری", "وضعیت", "آخرین ورود", "اقدام"],
            [
                native("customer", "مشتری", required=True, locked=True),
                native("contact", "مخاطب (اختیاری)"),
                native("display_name", "نام نمایشی", required=True, locked=True),
                native("username", "نام کاربری", required=True, locked=True),
                native("email", "ایمیل (اختیاری)", "email"),
            ],
        ),
        "portal-customer-request": spec(
            "فرم ثبت درخواست مشتری",
            "/portal/new",
            "Portal.Settings.Manage",
            fields=[
                native("subject", "موضوع", required=True, locked=True),
                native("description", "شرح درخواست", "long_text", True, True),
            ],
        ),
        "work-event-form": spec(
            "فرم جلسه و مأموریت",
            "/calendar",
            "Issue.View",
            fields=[
                native("kind", "نوع", required=True, locked=True),
                native("title", "عنوان", required=True, locked=True),
                native("start", "شروع", "datetime", True, True),
                native("end", "پایان", "datetime", True, True),
                native("people", "افراد مرتبط", "user", locked=True),
                native("description", "توضیح (فقط برای افراد مرتبط و مدیران مجاز)", "long_text"),
                native("private_note", "یادداشت محرمانه", "long_text"),
            ],
        ),
        "work-schedule-form": spec(
            "فرم برنامهٔ هفتگی",
            "/calendar",
            "Issue.View",
            fields=[
                native("effective_from", "معتبر از تاریخ", "date", True, True),
                native("effective_to", "معتبر تا تاریخ (اختیاری)", "date"),
                native("reason", "دلیل یا توضیح تغییر", "long_text", True, True),
            ],
        ),
        "work-exception-form": spec(
            "فرم استثنای تقویم کاری",
            "/calendar",
            "Issue.View",
            fields=[
                native("from", "از تاریخ", "date", True, True),
                native("to", "تا تاریخ (اختیاری)", "date"),
                native("start", "شروع", required=True, locked=True),
                native("end", "پایان", required=True, locked=True),
                native("reason", "دلیل یا توضیح", "long_text", True, True),
            ],
        ),
        "daily-reminder-form": spec(
            "فرم یادآوری گزارش روزانه",
            "/daily-report/settings",
            "DailyReport.Submit",
            fields=[
                native("time", "ساعت یادآوری", required=True, locked=True),
            ],
        ),
        "portal-settings-form": spec(
            "فرم تنظیمات درگاه مشتری",
            "/portal-settings?section=settings",
            "Portal.Settings.Manage",
            fields=[
                native("team_name", "نام تیم", required=True, locked=True),
                *[
                    native(code, title, required=True, locked=True)
                    for code, title in (
                        ("default_label", "برچسب پیش‌فرض (وضعیت نگاشت‌نشده)"),
                        ("staff_name", "نام پاسخ‌دهنده برای مشتری"),
                        ("feedback_edit", "مهلت ویرایش بازخورد (ساعت)"),
                        ("idle", "بی‌کاری تا پایان نشست (دقیقه)"),
                        ("absolute", "بیشینهٔ عمر نشست (ساعت)"),
                        ("files", "حداکثر فایل در هر پیام"),
                    )
                ],
            ],
        ),
    }
    result["portal-requests"]["read_permissions"] = [
        "Portal.Account.Manage",
        "Portal.Settings.Manage",
        "Portal.Request.Triage",
        "Portal.Feedback.View",
        "Quote.Manage",
    ]
    result["daily-team"]["read_permissions"] = ["Report.ViewAll"]
    result["leave-requests"]["read_permissions"] = ["LeaveRequest.Create", "LeaveRequest.ViewAll"]
    result["leave-versions"]["read_permissions"] = ["LeaveRequest.Create", "LeaveRequest.ViewAll"]
    result["portal-status-labels"]["read_permissions"] = ["Portal.Account.Manage"]
    from .report_sources import SOURCES

    for source in SOURCES.values():
        entry = spec(source.title, f"/reports/source/{source.code}", "Report.View", [f.label for f in source.fields])
        entry["default_columns"] = [source.field(key).label for key in source.default["columns"]]
        entry["report_source"] = source.code
        entry["read_permissions"] = ["Report.ViewAll"]
        result[f"report-{source.code}"] = entry
    return result
