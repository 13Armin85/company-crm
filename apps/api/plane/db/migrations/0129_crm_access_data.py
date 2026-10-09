"""Preserve historical thresholds, seed the catalog, map memberships, then remove thresholds."""

import json
from django.db import migrations

CATALOG = {
    "Absence.Create": {
        "category": "Absence",
        "description": "مجوز ایجاد در بخش عدم حضور",
        "is_active": True,
        "is_delegatable": True,
        "name": "عدم حضور: ایجاد",
    },
    "Absence.Edit": {
        "category": "Absence",
        "description": "مجوز ویرایش در بخش عدم حضور",
        "is_active": True,
        "is_delegatable": True,
        "name": "عدم حضور: ویرایش",
    },
    "Absence.End": {
        "category": "Absence",
        "description": "مجوز پایان در بخش عدم حضور",
        "is_active": True,
        "is_delegatable": True,
        "name": "عدم حضور: پایان",
    },
    "Absence.ManageAll": {
        "category": "Absence",
        "description": "مجوز مدیریت همه در بخش عدم حضور",
        "is_active": True,
        "is_delegatable": False,
        "name": "عدم حضور: مدیریت همه",
    },
    "Absence.View": {
        "category": "Absence",
        "description": "مجوز مشاهده در بخش عدم حضور",
        "is_active": True,
        "is_delegatable": True,
        "name": "عدم حضور: مشاهده",
    },
    "Access.EffectivePermission.View": {
        "category": "Access",
        "description": "مجوز مشاهده دسترسی مؤثر در بخش دسترسی کاربران",
        "is_active": True,
        "is_delegatable": False,
        "name": "دسترسی کاربران: مشاهده دسترسی مؤثر",
    },
    "Access.UserException.Manage": {
        "category": "Access",
        "description": "مجوز مدیریت استثناها در بخش دسترسی کاربران",
        "is_active": True,
        "is_delegatable": False,
        "name": "دسترسی کاربران: مدیریت استثناها",
    },
    "Access.UserException.View": {
        "category": "Access",
        "description": "مجوز مشاهده استثناها در بخش دسترسی کاربران",
        "is_active": True,
        "is_delegatable": False,
        "name": "دسترسی کاربران: مشاهده استثناها",
    },
    "Issue.Assign": {
        "category": "Issue",
        "description": "مجوز انتقال در بخش کارها",
        "is_active": True,
        "is_delegatable": True,
        "name": "کارها: انتقال",
    },
    "Issue.Create": {
        "category": "Issue",
        "description": "مجوز ایجاد در بخش کارها",
        "is_active": True,
        "is_delegatable": True,
        "name": "کارها: ایجاد",
    },
    "Issue.Delete": {
        "category": "Issue",
        "description": "مجوز حذف در بخش کارها",
        "is_active": True,
        "is_delegatable": False,
        "name": "کارها: حذف",
    },
    "Issue.Edit": {
        "category": "Issue",
        "description": "مجوز ویرایش در بخش کارها",
        "is_active": True,
        "is_delegatable": True,
        "name": "کارها: ویرایش",
    },
    "Issue.Status.Edit": {
        "category": "Issue",
        "description": "مجوز تغییر وضعیت در بخش کارها",
        "is_active": True,
        "is_delegatable": True,
        "name": "کارها: تغییر وضعیت",
    },
    "Issue.View": {
        "category": "Issue",
        "description": "مجوز مشاهده در بخش کارها",
        "is_active": True,
        "is_delegatable": True,
        "name": "کارها: مشاهده",
    },
    "Issue.ViewAll": {
        "category": "Issue",
        "description": "مجوز مشاهده همه در بخش کارها",
        "is_active": True,
        "is_delegatable": False,
        "name": "کارها: مشاهده همه",
    },
    "OrganizationUnit.Create": {
        "category": "OrganizationUnit",
        "description": "مجوز ایجاد در بخش ساختار سازمانی",
        "is_active": True,
        "is_delegatable": False,
        "name": "ساختار سازمانی: ایجاد",
    },
    "OrganizationUnit.Delegate.Manage": {
        "category": "OrganizationUnit",
        "description": "مجوز مدیریت جانشینان در بخش ساختار سازمانی",
        "is_active": True,
        "is_delegatable": False,
        "name": "ساختار سازمانی: مدیریت جانشینان",
    },
    "OrganizationUnit.Disable": {
        "category": "OrganizationUnit",
        "description": "مجوز غیرفعال کردن در بخش ساختار سازمانی",
        "is_active": True,
        "is_delegatable": False,
        "name": "ساختار سازمانی: غیرفعال کردن",
    },
    "OrganizationUnit.Edit": {
        "category": "OrganizationUnit",
        "description": "مجوز ویرایش در بخش ساختار سازمانی",
        "is_active": True,
        "is_delegatable": False,
        "name": "ساختار سازمانی: ویرایش",
    },
    "OrganizationUnit.Manager.Assign": {
        "category": "OrganizationUnit",
        "description": "مجوز تعیین مدیر در بخش ساختار سازمانی",
        "is_active": True,
        "is_delegatable": False,
        "name": "ساختار سازمانی: تعیین مدیر",
    },
    "OrganizationUnit.Member.Manage": {
        "category": "OrganizationUnit",
        "description": "مجوز مدیریت اعضا در بخش ساختار سازمانی",
        "is_active": True,
        "is_delegatable": False,
        "name": "ساختار سازمانی: مدیریت اعضا",
    },
    "OrganizationUnit.View": {
        "category": "OrganizationUnit",
        "description": "مجوز مشاهده در بخش ساختار سازمانی",
        "is_active": True,
        "is_delegatable": True,
        "name": "ساختار سازمانی: مشاهده",
    },
    "Permission.View": {
        "category": "Permission",
        "description": "مجوز مشاهده در بخش فهرست مجوزها",
        "is_active": True,
        "is_delegatable": False,
        "name": "فهرست مجوزها: مشاهده",
    },
    "Project.Create": {
        "category": "Project",
        "description": "مجوز ایجاد در بخش پروژه\u200cها",
        "is_active": True,
        "is_delegatable": False,
        "name": "پروژه\u200cها: ایجاد",
    },
    "Project.Delete": {
        "category": "Project",
        "description": "مجوز حذف در بخش پروژه\u200cها",
        "is_active": True,
        "is_delegatable": False,
        "name": "پروژه\u200cها: حذف",
    },
    "Project.Edit": {
        "category": "Project",
        "description": "مجوز ویرایش در بخش پروژه\u200cها",
        "is_active": True,
        "is_delegatable": False,
        "name": "پروژه\u200cها: ویرایش",
    },
    "Project.Member.Manage": {
        "category": "Project",
        "description": "مجوز مدیریت اعضا در بخش پروژه\u200cها",
        "is_active": True,
        "is_delegatable": False,
        "name": "پروژه\u200cها: مدیریت اعضا",
    },
    "Project.View": {
        "category": "Project",
        "description": "مجوز مشاهده در بخش پروژه\u200cها",
        "is_active": True,
        "is_delegatable": True,
        "name": "پروژه\u200cها: مشاهده",
    },
    "Project.ViewAll": {
        "category": "Project",
        "description": "مجوز مشاهده همه در بخش پروژه\u200cها",
        "is_active": True,
        "is_delegatable": False,
        "name": "پروژه\u200cها: مشاهده همه",
    },
    "Referral.Approve": {
        "category": "Referral",
        "description": "مجوز تأیید در بخش ارجاع",
        "is_active": True,
        "is_delegatable": True,
        "name": "ارجاع: تأیید",
    },
    "Referral.Create": {
        "category": "Referral",
        "description": "مجوز ایجاد در بخش ارجاع",
        "is_active": True,
        "is_delegatable": True,
        "name": "ارجاع: ایجاد",
    },
    "Referral.Delete": {
        "category": "Referral",
        "description": "مجوز حذف در بخش ارجاع",
        "is_active": True,
        "is_delegatable": True,
        "name": "ارجاع: حذف",
    },
    "Referral.External.Send": {
        "category": "Referral",
        "description": "مجوز ارسال بیرونی در بخش ارجاع",
        "is_active": True,
        "is_delegatable": True,
        "name": "ارجاع: ارسال بیرونی",
    },
    "Referral.View": {
        "category": "Referral",
        "description": "مجوز مشاهده در بخش ارجاع",
        "is_active": True,
        "is_delegatable": True,
        "name": "ارجاع: مشاهده",
    },
    "Role.Create": {
        "category": "Role",
        "description": "مجوز ایجاد در بخش نقش\u200cها",
        "is_active": True,
        "is_delegatable": False,
        "name": "نقش\u200cها: ایجاد",
    },
    "Role.Disable": {
        "category": "Role",
        "description": "مجوز غیرفعال کردن در بخش نقش\u200cها",
        "is_active": True,
        "is_delegatable": False,
        "name": "نقش\u200cها: غیرفعال کردن",
    },
    "Role.Edit": {
        "category": "Role",
        "description": "مجوز ویرایش در بخش نقش\u200cها",
        "is_active": True,
        "is_delegatable": False,
        "name": "نقش\u200cها: ویرایش",
    },
    "Role.Permission.Assign": {
        "category": "Role",
        "description": "مجوز تخصیص مجوز در بخش نقش\u200cها",
        "is_active": True,
        "is_delegatable": False,
        "name": "نقش\u200cها: تخصیص مجوز",
    },
    "Role.View": {
        "category": "Role",
        "description": "مجوز مشاهده در بخش نقش\u200cها",
        "is_active": True,
        "is_delegatable": False,
        "name": "نقش\u200cها: مشاهده",
    },
    "Routing.Manage": {
        "category": "Routing",
        "description": "مجوز مدیریت در بخش مسیریابی",
        "is_active": True,
        "is_delegatable": False,
        "name": "مسیریابی: مدیریت",
    },
    "Routing.Queue.Claim": {
        "category": "Routing",
        "description": "مجوز دریافت از صف در بخش مسیریابی",
        "is_active": True,
        "is_delegatable": True,
        "name": "مسیریابی: دریافت از صف",
    },
    "Routing.Queue.View": {
        "category": "Routing",
        "description": "مجوز مشاهده صف در بخش مسیریابی",
        "is_active": True,
        "is_delegatable": True,
        "name": "مسیریابی: مشاهده صف",
    },
    "Routing.Queue.ViewAll": {
        "category": "Routing",
        "description": "مجوز مشاهده همه صف\u200cها در بخش مسیریابی",
        "is_active": True,
        "is_delegatable": False,
        "name": "مسیریابی: مشاهده همه صف\u200cها",
    },
    "Routing.Route": {
        "category": "Routing",
        "description": "مجوز ارجاع در بخش مسیریابی",
        "is_active": True,
        "is_delegatable": True,
        "name": "مسیریابی: ارجاع",
    },
    "Routing.View": {
        "category": "Routing",
        "description": "مجوز مشاهده در بخش مسیریابی",
        "is_active": True,
        "is_delegatable": True,
        "name": "مسیریابی: مشاهده",
    },
    "User.ChangePassword": {
        "category": "User",
        "description": "مجوز تغییر رمز عبور در بخش کاربران",
        "is_active": True,
        "is_delegatable": False,
        "name": "کاربران: تغییر رمز عبور",
    },
    "User.Create": {
        "category": "User",
        "description": "مجوز ایجاد در بخش کاربران",
        "is_active": True,
        "is_delegatable": False,
        "name": "کاربران: ایجاد",
    },
    "User.Delete": {
        "category": "User",
        "description": "مجوز حذف در بخش کاربران",
        "is_active": True,
        "is_delegatable": False,
        "name": "کاربران: حذف",
    },
    "User.Edit": {
        "category": "User",
        "description": "مجوز ویرایش در بخش کاربران",
        "is_active": True,
        "is_delegatable": False,
        "name": "کاربران: ویرایش",
    },
    "User.Role.Assign": {
        "category": "User",
        "description": "مجوز تخصیص نقش در بخش کاربران",
        "is_active": True,
        "is_delegatable": False,
        "name": "کاربران: تخصیص نقش",
    },
    "User.View": {
        "category": "User",
        "description": "مجوز مشاهده در بخش کاربران",
        "is_active": True,
        "is_delegatable": True,
        "name": "کاربران: مشاهده",
    },
    "Workspace.Edit": {
        "category": "Workspace",
        "description": "مجوز ویرایش در بخش شرکت",
        "is_active": True,
        "is_delegatable": False,
        "name": "شرکت: ویرایش",
    },
}
MEMBER_CODES = [
    "Issue.Assign",
    "Issue.Status.Edit",
    "Issue.View",
    "Project.View",
    "Referral.View",
    "Routing.Queue.Claim",
    "Routing.Queue.View",
]
LEGACY_PERMISSION_MAP = {
    "ticket-view": ("Issue.View",),
    "ticket-assign": ("Issue.Assign", "Routing.Route"),
    "ticket-resolve": ("Issue.Status.Edit",),
    "ticket-approve": ("Referral.Approve",),
}


def migrate_access(apps, schema_editor):
    alias = schema_editor.connection.alias
    Permission = apps.get_model("db", "OrganizationPermission")
    Role = apps.get_model("db", "OrganizationRole")
    RolePermission = apps.get_model("db", "RolePermission")
    Assignment = apps.get_model("db", "UserOrganizationRole")
    Membership = apps.get_model("db", "WorkspaceMember")
    Log = apps.get_model("db", "APIActivityLog")
    for model_name, field in (
        ("OrganizationRole", "level"),
        ("TicketRoutingRule", "required_level"),
        ("TicketRoleQueueEntry", "required_level"),
        ("OrganizationPermission", "is_active"),
    ):
        for row in apps.get_model("db", model_name).objects.using(alias).all().iterator():
            Log.objects.using(alias).get_or_create(
                token_identifier=f"crm-migration:{model_name}:{row.pk}",
                defaults={
                    "path": "/crm/migrations/0129/",
                    "method": "MIGRATE",
                    "response_code": 200,
                    "body": json.dumps(
                        {"model": model_name, "id": str(row.pk), "field": field, "value": getattr(row, field)}
                    ),
                },
            )
    for workspace in apps.get_model("db", "Workspace").objects.using(alias).all().iterator():
        for code, defaults in CATALOG.items():
            Permission.objects.using(alias).update_or_create(
                workspace=workspace, code=code, deleted_at=None, defaults=defaults
            )
        for legacy in Permission.objects.using(alias).filter(
            workspace=workspace, code__in=LEGACY_PERMISSION_MAP, is_active=True, deleted_at=None
        ):
            for original in RolePermission.objects.using(alias).filter(
                permission=legacy, role__workspace=workspace, deleted_at=None
            ):
                for code in LEGACY_PERMISSION_MAP[legacy.code]:
                    mapped = Permission.objects.using(alias).get(workspace=workspace, code=code, deleted_at=None)
                    link, created = RolePermission.objects.using(alias).get_or_create(
                        role_id=original.role_id, permission=mapped, deleted_at=None
                    )
                    if created:
                        Log.objects.using(alias).get_or_create(
                            token_identifier=f"crm-migration:RolePermission:{link.pk}",
                            defaults={
                                "path": "/crm/migrations/0129/",
                                "method": "MIGRATE",
                                "response_code": 200,
                                "body": json.dumps(
                                    {"model": "RolePermission", "id": str(link.pk), "created_by_migration": True}
                                ),
                            },
                        )
        Permission.objects.using(alias).filter(workspace=workspace).exclude(code__in=CATALOG).update(is_active=False)
        defaults_by_key = {}
        for key, name, codes in (
            ("admin", "\u0645\u062f\u06cc\u0631", CATALOG),
            ("member", "\u0639\u0636\u0648", MEMBER_CODES),
        ):
            role = Role.objects.using(alias).filter(workspace=workspace, system_key=key, deleted_at=None).first()
            if role is None:
                default_name = name
                suffix = 1
                while (
                    Role.objects.using(alias).filter(workspace=workspace, name=default_name, deleted_at=None).exists()
                ):
                    default_name = f"{name} (default {suffix})"
                    suffix += 1
                role = Role.objects.using(alias).create(
                    workspace=workspace, name=default_name, system_key=key, is_active=True
                )
            else:
                role.is_active = True
                role.save(using=alias, update_fields=["is_active"])
            defaults_by_key[key] = role
            for permission in Permission.objects.using(alias).filter(
                workspace=workspace, code__in=codes, deleted_at=None
            ):
                RolePermission.objects.using(alias).get_or_create(role=role, permission=permission, deleted_at=None)
        for membership in Membership.objects.using(alias).filter(workspace=workspace, deleted_at=None).iterator():
            Assignment.objects.using(alias).update_or_create(
                workspace=workspace,
                user_id=membership.member_id,
                role=defaults_by_key["admin" if membership.role == 20 else "member"],
                deleted_at=None,
                defaults={"is_active": membership.is_active},
            )


def restore_thresholds(apps, schema_editor):
    alias = schema_editor.connection.alias
    for log in (
        apps.get_model("db", "APIActivityLog")
        .objects.using(alias)
        .filter(token_identifier__startswith="crm-migration:")
        .iterator()
    ):
        data = json.loads(log.body)
        if data.get("model") == "RolePermission" and data.get("created_by_migration"):
            apps.get_model("db", "RolePermission").objects.using(alias).filter(pk=data["id"]).delete()
            continue
        if data.get("model") not in {
            "OrganizationRole",
            "TicketRoutingRule",
            "TicketRoleQueueEntry",
            "OrganizationPermission",
        }:
            continue
        apps.get_model("db", data["model"]).objects.using(alias).filter(pk=data["id"]).update(
            **{data["field"]: data["value"]}
        )


class Migration(migrations.Migration):
    dependencies = [("db", "0128_crm_access_control")]
    operations = [
        migrations.RunPython(migrate_access, restore_thresholds),
        # Validate deferred foreign keys from new role/link rows before ALTER TABLE.
        # Keep data transfer and schema changes in the same atomic transaction.
        migrations.RunSQL("SET CONSTRAINTS ALL IMMEDIATE", reverse_sql=migrations.RunSQL.noop),
        migrations.RemoveField(model_name="organizationrole", name="level"),
        migrations.RemoveField(model_name="ticketroutingrule", name="required_level"),
        migrations.RemoveField(model_name="ticketrolequeueentry", name="required_level"),
    ]
