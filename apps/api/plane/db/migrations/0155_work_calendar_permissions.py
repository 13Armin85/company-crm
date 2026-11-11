"""Register work-calendar permission codes in existing workspaces (additive only)."""

from django.db import migrations

PERMISSIONS = {
    "WorkSchedule.ViewOwn": "مشاهده برنامه کاری خود",
    "WorkSchedule.EditOwn": "ویرایش برنامه کاری خود",
    "WorkSchedule.ViewTeam": "مشاهده برنامه کاری زیرمجموعه مستقیم",
    "WorkSchedule.EditTeam": "ویرایش برنامه کاری زیرمجموعه مستقیم",
    "WorkSchedule.ViewHierarchy": "مشاهده برنامه کاری زیرمجموعه‌های غیرمستقیم",
    "WorkSchedule.EditPast": "ثبت تغییر برنامه کاری با تاریخ گذشته",
    "WorkSchedule.ManageDefaults": "مدیریت برنامه کاری پیش‌فرض شرکت و واحدها",
    "WorkEvent.Create": "ایجاد جلسه، مأموریت و رویداد کاری",
    "WorkEvent.Manage": "مدیریت رویدادهای کاری زیرمجموعه",
}
MEMBER = {"WorkSchedule.ViewOwn", "WorkEvent.Create"}


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
    dependencies = [("db", "0154_work_calendar")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
