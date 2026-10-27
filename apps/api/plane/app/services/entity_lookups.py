"""Permission checks for live lookup columns, independent of query compilation."""

from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError, PermissionDenied

from plane.db.models import EntityType
from .entity_schema import schema_fields, can_field, role_ids
from .entity_records import require_action


def lookup_target(entity, user, path, request=None):
    if not isinstance(path, str) or not 2 <= len(path.split(".")) <= 4:
        raise ValidationError(
            "مسیر خواندن از ارتباط باید یک تا سه سطح ارتباط داشته باشد."
        )
    parts = path.split(".")
    for index, code in enumerate(parts):
        require_action(entity, user, "view", request)
        _, fields = schema_fields(entity)
        field = fields.get(code)
        if (
            not field
            or not field["is_active"]
            or field["config"].get("hidden")
            or not can_field(field, role_ids(user, entity.workspace))
        ):
            raise PermissionDenied("مجوز مشاهده فیلد مقصد ارتباط را ندارید.")
        if index == len(parts) - 1:
            if field["config"].get("relation_lookup"):
                raise ValidationError(
                    "فیلد مبدأ باید یک فیلد مستقیم باشد؛ مسیر رابطه را به فیلد اصلی ادامه دهید."
                )
            return field
        if field["kind"] != "relation":
            raise ValidationError("ادامه مسیر فقط از فیلد ارتباطی مجاز است.")
        entity = get_object_or_404(
            EntityType, workspace=entity.workspace, code=field["relation_entity"]
        )


def lookup_allowed(entity, user, field, request=None):
    lookup = field["config"].get("relation_lookup")
    if not lookup:
        return True
    try:
        lookup_target(entity, user, lookup["path"], request)
        return True
    except (ValidationError, PermissionDenied):
        return False
