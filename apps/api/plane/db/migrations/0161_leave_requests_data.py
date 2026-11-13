"""Ticket 6 data: permission codes, the leave-request workflow record type, and no leave category.

- registers LeaveRequest.* / LeaveTemplate.Manage / Signature.Manage (members get LeaveRequest.Create);
- creates the ``leave_request`` entity type (the record designers choose for the approval route);
- the leave category is owned by another system: the old ``leave_type`` field is unbound from the
  leave form through a new published form version (older versions stay as history) and the field
  and its ``leave-type`` list are deactivated, not deleted.
"""

from copy import deepcopy

from django.db import migrations

PERMISSIONS = {
    "LeaveRequest.Create": "ثبت درخواست مرخصی برای خود",
    "LeaveRequest.ViewAll": "مشاهده همه درخواست‌های مرخصی",
    "LeaveTemplate.Manage": "مدیریت قالب Word درخواست مرخصی",
    "Signature.Manage": "بارگذاری و مدیریت تصویر امضای کاربران",
}
MEMBER = {"LeaveRequest.Create"}


def strip_leave_type(value):
    """Copy of a layout without any binding of the ``leave_type`` field; (layout, changed)."""
    changed = False

    def walk(node):
        nonlocal changed
        if isinstance(node, dict):
            result = {}
            for key, item in node.items():
                if key == "bindings" and isinstance(item, list):
                    kept = [b for b in item if not (isinstance(b, dict) and b.get("field") == "leave_type")]
                    changed = changed or len(kept) != len(item)
                    result[key] = [walk(b) for b in kept]
                else:
                    result[key] = walk(item)
            return result
        if isinstance(node, list):
            return [walk(item) for item in node]
        return node

    return walk(deepcopy(value)), changed


def forwards(apps, schema_editor):
    alias = schema_editor.connection.alias
    Workspace = apps.get_model("db", "Workspace")
    Permission = apps.get_model("db", "OrganizationPermission")
    Grant = apps.get_model("db", "RolePermission")
    Role = apps.get_model("db", "OrganizationRole")
    EntityType = apps.get_model("db", "EntityType")
    FieldDefinition = apps.get_model("db", "FieldDefinition")
    LookupCategory = apps.get_model("db", "LookupCategory")
    FormLayout = apps.get_model("db", "FormLayout")
    FormVersion = apps.get_model("db", "FormVersion")
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
        EntityType.objects.using(alias).get_or_create(
            workspace_id=workspace.id,
            code="leave_request",
            defaults={
                "title": "درخواست مرخصی (فرم و امضا)",
                "adapter": "leave_request",
                "icon": "calendar-off",
                "numbering": {"prefix": "LRQ", "padding": 5},
                "title_field": "number",
                "record_permissions": {
                    "view": "LeaveRequest.Create",
                    "view_all": "LeaveRequest.ViewAll",
                    "create": "LeaveRequest.Create",
                    "edit": "LeaveRequest.Create",
                    "delete": "LeaveRequest.ViewAll",
                },
            },
        )
        for layout in FormLayout.objects.using(alias).filter(entity__workspace_id=workspace.id):
            draft, draft_changed = strip_leave_type(layout.draft or {})
            published = FormVersion.objects.using(alias).filter(id=layout.published_id).first()
            schema, schema_changed = strip_leave_type(published.schema if published else {})
            if schema_changed:
                last = FormVersion.objects.using(alias).filter(layout_id=layout.id).order_by("-number").first()
                version = FormVersion.objects.using(alias).create(
                    layout_id=layout.id,
                    number=(last.number if last else 0) + 1,
                    schema=schema,
                    change_note="حذف «نوع مرخصی»: دستهٔ مرخصی در نرم‌افزار دیگری تعیین می‌شود (تیکت ۶).",
                )
                layout.published_id = version.id
            if draft_changed or schema_changed:
                layout.draft = draft
                layout.revision = (layout.revision or 0) + 1
                layout.save()
        FieldDefinition.objects.using(alias).filter(workspace_id=workspace.id, code="leave_type").update(
            is_active=False
        )
        LookupCategory.objects.using(alias).filter(workspace_id=workspace.id, code="leave-type").update(is_active=False)


class Migration(migrations.Migration):
    dependencies = [("db", "0160_leave_requests")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
