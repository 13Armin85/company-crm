"""Register the ticket-7 portal permission codes in existing workspaces (additive only)."""

from django.db import migrations

PERMISSIONS = {
    "Portal.Account.Manage": ("مدیریت حساب‌های درگاه مشتری", "Portal"),
    "Portal.Settings.Manage": ("مدیریت تنظیمات درگاه مشتری", "Portal"),
    "Portal.Request.Triage": ("تریاژ درخواست‌های درگاه (تأیید، رد، درخواست تکمیل)", "Portal"),
    "Portal.Reply": ("پاسخ قابل‌مشاهده برای مشتری", "Portal"),
    "Quote.Manage": ("ساخت، ارسال و نسخه‌گذاری برآورد هزینه", "Quote"),
    "Portal.Feedback.View": ("مشاهدهٔ بازخورد و امتیاز مشتری", "Portal"),
}


def seed(apps, schema_editor):
    alias = schema_editor.connection.alias
    Workspace = apps.get_model("db", "Workspace")
    Permission = apps.get_model("db", "OrganizationPermission")
    Grant = apps.get_model("db", "RolePermission")
    Role = apps.get_model("db", "OrganizationRole")
    for workspace in Workspace.objects.using(alias).all():
        for code, (title, category) in PERMISSIONS.items():
            permission, _ = Permission.objects.using(alias).get_or_create(
                workspace_id=workspace.id,
                code=code,
                defaults={"name": title, "description": title, "category": category, "is_active": True},
            )
            for role in Role.objects.using(alias).filter(workspace_id=workspace.id, system_key="admin"):
                Grant.objects.using(alias).get_or_create(role_id=role.id, permission_id=permission.id)


class Migration(migrations.Migration):
    dependencies = [("db", "0162_customer_portal")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
