from django.db import migrations

DEFINITIONS = {
    "View.Personal.Create": ("ساخت جدول شخصی", ["View.Create.Personal"]),
    "View.Personal.Share": ("اشتراک‌گذاری جدول شخصی", ["View.Create.Shared"]),
    "View.Official.Manage": ("مدیریت جدول رسمی", ["View.Manage.All"]),
    "FormDesigner.View": ("مشاهده فرم‌ساز", ["FormLayout.Edit", "FormLayout.Publish"]),
    "FormDesigner.Publish": (
        "ویرایش و انتشار فرم",
        ["FormLayout.Edit", "FormLayout.Publish"],
    ),
    "UniqueRule.Manage": ("مدیریت قاعده یکتایی", []),
    "NumberingRule.Manage": ("مدیریت شماره‌گذاری خودکار", []),
    "Relation.View": ("مشاهده ارتباط‌ها", []),
    "Relation.Create": ("ایجاد ارتباط", []),
    "Relation.Edit": ("ویرایش ارتباط", []),
    "Relation.Delete": ("حذف ارتباط", []),
}


def seed(apps, schema_editor):
    alias = schema_editor.connection.alias
    Workspace = apps.get_model("db", "Workspace")
    Permission = apps.get_model("db", "OrganizationPermission")
    Grant = apps.get_model("db", "RolePermission")
    Role = apps.get_model("db", "OrganizationRole")
    Exception = apps.get_model("db", "UserPermissionException")
    for workspace in Workspace.objects.using(alias).all():
        for code, (name, old_codes) in DEFINITIONS.items():
            permission, _ = Permission.objects.using(alias).get_or_create(
                workspace_id=workspace.id,
                code=code,
                defaults={
                    "name": name,
                    "description": name,
                    "category": code.split(".")[0],
                    "is_active": True,
                },
            )
            if old_codes:
                for grant in Grant.objects.using(alias).filter(
                    permission__workspace_id=workspace.id,
                    permission__code__in=old_codes,
                    deleted_at__isnull=True,
                ):
                    Grant.objects.using(alias).get_or_create(
                        role_id=grant.role_id, permission_id=permission.id
                    )
                for exception in Exception.objects.using(alias).filter(
                    workspace_id=workspace.id,
                    permission__code__in=old_codes,
                    deleted_at__isnull=True,
                ):
                    Exception.objects.using(alias).get_or_create(
                        workspace_id=workspace.id,
                        user_id=exception.user_id,
                        permission_id=permission.id,
                        effect=exception.effect,
                        starts_at=exception.starts_at,
                        ends_at=exception.ends_at,
                        is_active=exception.is_active,
                    )
            else:
                for role in Role.objects.using(alias).filter(
                    workspace_id=workspace.id,
                    system_key="admin",
                    deleted_at__isnull=True,
                ):
                    Grant.objects.using(alias).get_or_create(
                        role_id=role.id, permission_id=permission.id
                    )


class Migration(migrations.Migration):
    dependencies = [("db", "0140_entity_unique_rules")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
