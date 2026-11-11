"""Register workflow permission codes in existing workspaces (additive only)."""

from django.db import migrations

PERMISSIONS = {
    "Workflow.View": "مشاهده گردش‌کار",
    "Workflow.Design": "طراحی و ویرایش پیش‌نویس گردش‌کار",
    "Workflow.Publish": "انتشار نسخه گردش‌کار",
    "Workflow.Reassign": "ارجاع مدیریتی مرحله گردش‌کار",
    "Workflow.Migrate": "انتقال فرایند فعال به نسخه دیگر",
    "Workflow.ViewAll": "مشاهده همه فرایندهای گردش‌کار",
}
MEMBER = {"Workflow.View"}


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
                defaults={"name": title, "description": title, "category": "Workflow", "is_active": True},
            )
            keys = ["admin", "member"] if code in MEMBER else ["admin"]
            for role in Role.objects.using(alias).filter(workspace_id=workspace.id, system_key__in=keys):
                Grant.objects.using(alias).get_or_create(role_id=role.id, permission_id=permission.id)


class Migration(migrations.Migration):
    dependencies = [("db", "0156_workflow_engine")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
