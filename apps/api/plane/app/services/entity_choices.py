"""Dynamic native select validation, with original choices before engine initialization."""

from crum import get_current_request
from rest_framework import serializers


class ConfiguredChoiceField(serializers.CharField):
    def __init__(self, *args, adapter, original_choices, **kwargs):
        self.adapter = adapter
        self.original_choices = set(original_choices)
        super().__init__(*args, **kwargs)

    def to_internal_value(self, data):
        value = super().to_internal_value(data)
        from plane.db.models import EntityType, Project, LookupValue
        from .entity_legacy import native_route, native_entity
        from .entity_schema import schema_fields

        request = self.context.get("request") or get_current_request()
        route = native_route(request.path) if request else None
        instance = getattr(self.parent, "instance", None)
        workspace_id = getattr(instance, "workspace_id", None) or self.context.get(
            "workspace_id"
        )
        if not workspace_id and self.context.get("project_id"):
            workspace_id = (
                Project.objects.filter(id=self.context["project_id"])
                .values_list("workspace_id", flat=True)
                .first()
            )
        entity = (
            native_entity(route)
            if route and route[1] == self.adapter
            else (
                EntityType.objects.filter(
                    workspace_id=workspace_id, adapter=self.adapter, parent__isnull=True
                ).first()
                if workspace_id
                else None
            )
        )
        if entity:
            _, fields = schema_fields(entity)
            if self.field_name == "status" and self.adapter == "ticket":
                if instance and value == getattr(instance, "status", None):
                    return value
                if LookupValue.objects.filter(
                    category__workspace=entity.workspace,
                    category__code="task-status",
                    code=value,
                    is_active=True,
                    category__is_active=True,
                ).exists():
                    return value
                raise serializers.ValidationError(
                    "وضعیت انتخاب‌شده در فهرست کارها فعال نیست."
                )
            field = next(
                (
                    f
                    for f in fields.values()
                    if f["binding"].get("source") == self.field_name and f.get("lookup")
                ),
                None,
            )
            if field:
                if instance and value == getattr(instance, self.field_name, None):
                    return value
                if LookupValue.objects.filter(
                    category__workspace=entity.workspace,
                    category__code=field["lookup"],
                    category__is_active=True,
                    is_active=True,
                    code=value,
                ).exists():
                    return value
                raise serializers.ValidationError(
                    "مقدار انتخابی در لیست پایه فعال وجود ندارد."
                )
        if value not in self.original_choices:
            raise serializers.ValidationError("مقدار انتخابی معتبر نیست.")
        return value


class EntityChoiceSerializerMixin:
    def get_fields(self):
        fields = super().get_fields()
        adapter = {"Issue": "ticket", "WorkspaceTask": "ticket"}.get(
            getattr(getattr(self.Meta, "model", None), "__name__", "")
        )
        if adapter:
            for name in ("priority", "status"):
                field = fields.get(name)
                if isinstance(field, serializers.ChoiceField) and not field.read_only:
                    fields[name] = ConfiguredChoiceField(
                        adapter=adapter,
                        original_choices=field.choices,
                        required=field.required,
                        allow_null=field.allow_null,
                        allow_blank=getattr(field, "allow_blank", False),
                        max_length=(
                            30 if name == "priority" and adapter == "ticket" else 20
                        ),
                    )
        return fields
