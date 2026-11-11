"""Register the ticket-5 permission code in existing workspaces (additive only)."""

from django.db import migrations

PERMISSIONS = {"Ticket.TargetSet": "تعیین و تغییر مدت هدف تیکت"}


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
                defaults={"name": title, "description": title, "category": "Ticket", "is_active": True},
            )
            for role in Role.objects.using(alias).filter(workspace_id=workspace.id, system_key="admin"):
                Grant.objects.using(alias).get_or_create(role_id=role.id, permission_id=permission.id)


class Migration(migrations.Migration):
    dependencies = [("db", "0158_ticket_five_core")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
