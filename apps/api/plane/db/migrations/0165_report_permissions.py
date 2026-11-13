"""Register the ticket-8 report permission codes in existing workspaces (additive only).

All codes go to the system "admin" role; ``DailyReport.Submit`` and ``Report.View`` (own data only)
also go to the system "member" role, the base role of every employee.
"""

from django.db import migrations

PERMISSIONS = {
    "DailyReport.Submit": "ثبت گزارش روزانهٔ کار خود",
    "DailyReport.Team.View": "مشاهدهٔ وضعیت گزارش روزانهٔ تیم",
    "DailyReport.Reminder.Manage": "مدیریت یادآوری گزارش روزانه (شرکت و واحد)",
    "Report.View": "مشاهدهٔ گزارش‌های پایهٔ خود",
    "Report.Team.View": "مشاهدهٔ گزارش‌های تیم و زیرمجموعه",
    "Report.ViewAll": "مشاهدهٔ گزارش‌های همهٔ افراد شرکت",
    "Report.Build": "ساخت و ذخیرهٔ گزارش",
    "Report.Share": "اشتراک‌گذاری گزارش ذخیره‌شده با نقش یا واحد",
    "Report.Export": "دریافت خروجی CSV/Excel گزارش",
}
MEMBER = {"DailyReport.Submit", "Report.View"}


def seed(apps, schema_editor):
    alias = schema_editor.connection.alias
    Workspace = apps.get_model("db", "Workspace")
    Permission = apps.get_model("db", "OrganizationPermission")
    Grant = apps.get_model("db", "RolePermission")
    Role = apps.get_model("db", "OrganizationRole")
    for workspace in Workspace.objects.using(alias).all():
        for code, title in PERMISSIONS.items():
            permission, _ = Permission.objects.using(alias).get_or_create(
                workspace_id=workspace.id,
                code=code,
                defaults={"name": title, "description": title, "category": code.split(".")[0], "is_active": True},
            )
            keys = ["admin", "member"] if code in MEMBER else ["admin"]
            for role in Role.objects.using(alias).filter(workspace_id=workspace.id, system_key__in=keys):
                Grant.objects.using(alias).get_or_create(role_id=role.id, permission_id=permission.id)


class Migration(migrations.Migration):
    dependencies = [("db", "0164_daily_reports_and_saved_reports")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
