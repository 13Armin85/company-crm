from django.db import migrations, models


def seed(apps, schema_editor):
    Permission = apps.get_model("db", "OrganizationPermission")
    Role = apps.get_model("db", "OrganizationRole")
    RolePermission = apps.get_model("db", "RolePermission")
    Workspace = apps.get_model("db", "Workspace")
    definitions = {
        "View.Create.Personal": ("نماها: ساخت نمای شخصی", "View"),
        "View.Create.Shared": ("نماها: ساخت نمای اشتراکی", "View"),
        "View.Manage.All": ("نماها: مدیریت همه نماها", "View"),
        "ConditionalFormat.Edit": ("ویرایش رنگ‌بندی شرطی", "ConditionalFormat"),
        "Export.Data": ("خروجی گرفتن از داده", "Export"),
    }
    for workspace in Workspace.objects.using(schema_editor.connection.alias).all():
        for code, (name, category) in definitions.items():
            permission, _ = Permission.objects.using(schema_editor.connection.alias).get_or_create(
                workspace_id=workspace.id,
                code=code,
                defaults={"name": name, "category": category, "is_active": True, "is_delegatable": False},
            )
            keys = ["admin", "member"] if code == "View.Create.Personal" else ["admin"]
            for role in Role.objects.using(schema_editor.connection.alias).filter(
                workspace_id=workspace.id, system_key__in=keys, deleted_at__isnull=True
            ):
                RolePermission.objects.using(schema_editor.connection.alias).get_or_create(
                    role_id=role.id, permission_id=permission.id
                )


class Migration(migrations.Migration):
    dependencies = [("db", "0136_entity_views")]
    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunSQL(
                    "ALTER TABLE crm_entity_view_exports ADD COLUMN IF NOT EXISTS fingerprint "
                    "varchar(64) NOT NULL DEFAULT ''; "
                    "ALTER TABLE crm_entity_view_exports ALTER COLUMN fingerprint DROP DEFAULT;",
                    reverse_sql="ALTER TABLE crm_entity_view_exports DROP COLUMN IF EXISTS fingerprint;",
                )
            ],
            state_operations=[
                migrations.AddField(
                    model_name="entityviewexport", name="fingerprint", field=models.CharField(max_length=64, blank=True)
                )
            ],
        ),
        migrations.RunPython(seed, migrations.RunPython.noop),
    ]
