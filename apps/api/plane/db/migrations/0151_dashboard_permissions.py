"""Register ticket seven permission codes in existing workspaces."""

from django.db import migrations


PERMISSIONS = {
    "Dashboard.Personal.Manage": "ساخت و ویرایش داشبورد شخصی",
    "Dashboard.Default.Manage": "مدیریت داشبورد پیش‌فرض نقش‌ها",
    "Dashboard.Share": "اشتراک‌گذاری تب داشبورد",
    "Dashboard.Team.View": "مشاهده تب تیم من",
    "Dashboard.Team.Rules": "مدیریت قواعد رنگ‌بندی کارت‌ها",
    "Dashboard.Team.Assign": "ارجاع از روی کارت تیم",
    "Dashboard.Team.Remind": "ارسال یادآور به اعضای تیم",
}


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
                defaults={"name": title, "description": title, "category": "Dashboard", "is_active": True},
            )
            keys = ["admin"] if code != "Dashboard.Personal.Manage" else ["admin", "member"]
            for role in Role.objects.using(alias).filter(workspace_id=workspace.id, system_key__in=keys):
                Grant.objects.using(alias).get_or_create(role_id=role.id, permission_id=permission.id)


class Migration(migrations.Migration):
    dependencies = [("db", "0150_dashboardconfiguration_dashboardteamsettings")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
