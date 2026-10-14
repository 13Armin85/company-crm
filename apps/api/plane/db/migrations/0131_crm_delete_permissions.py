from django.db import migrations


def add_delete_permissions(apps, schema_editor):
    Permission = apps.get_model("db", "OrganizationPermission")
    Role = apps.get_model("db", "OrganizationRole")
    Grant = apps.get_model("db", "RolePermission")
    Workspace = apps.get_model("db", "Workspace")
    alias = schema_editor.connection.alias
    for workspace in Workspace.objects.using(alias).filter(deleted_at__isnull=True).iterator():
        for code, title, category in (
            ("Role.Delete", "نقش‌ها: حذف", "Role"),
            ("OrganizationUnit.Delete", "ساختار سازمانی: حذف", "OrganizationUnit"),
        ):
            # Grant only when first creating the catalog entry. Reruns must not
            # restore a grant deliberately removed after this migration.
            permission, created = Permission.objects.using(alias).get_or_create(
                workspace_id=workspace.id,
                code=code,
                deleted_at__isnull=True,
                defaults={
                    "name": title,
                    "description": title,
                    "category": category,
                    "is_active": True,
                    "is_delegatable": False,
                },
            )
            if created:
                for role in Role.objects.using(alias).filter(
                    workspace_id=workspace.id, system_key="admin", is_active=True, deleted_at__isnull=True
                ):
                    Grant.objects.using(alias).get_or_create(
                        role_id=role.id, permission_id=permission.id, deleted_at__isnull=True
                    )


class Migration(migrations.Migration):
    dependencies = [("db", "0130_crm_exception_constraints")]
    operations = [migrations.RunPython(add_delete_permissions, migrations.RunPython.noop)]
