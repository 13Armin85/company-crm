"""Validated, workspace-scoped definition APIs. Runtime schemas use entity_schema."""

import re

from rest_framework import serializers

from plane.db.models import EntityType, LookupCategory, LookupValue, FieldDefinition
from plane.app.services.entity_schema import validate_field_config, DISPLAY_SETTINGS
from plane.app.services.permission_registry import PERMISSION_REGISTRY


class ScopedDefinitionSerializer(serializers.ModelSerializer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        workspace = self.context["workspace"]
        for key in ("parent", "category", "lookup", "relation_entity"):
            if key in self.fields and hasattr(self.fields[key], "queryset"):
                field = self.fields[key]
                scope = (
                    {"category__workspace": workspace}
                    if field.queryset.model is LookupValue
                    else {"workspace": workspace}
                )
                field.queryset = field.queryset.filter(**scope)

    def validate_code(self, value):
        from django.db.models import JSONField

        if self.Meta.model is FieldDefinition and ("__" in value or value in JSONField().get_lookups()):
            raise serializers.ValidationError("این کد فیلد رزرو شده است؛ کد دیگری بدون دو زیرخط پیاپی انتخاب کنید.")
        if not re.fullmatch(r"[a-z][a-z0-9_-]{0,79}", value):
            raise serializers.ValidationError(
                "کد باید با حرف کوچک انگلیسی شروع شود و فقط حرف، عدد، خط تیره یا زیرخط داشته باشد."
            )
        if self.instance and value != self.instance.code:
            raise serializers.ValidationError("کد پایدار پس از ایجاد قابل تغییر نیست.")
        return value


class EntityTypeSerializer(ScopedDefinitionSerializer):
    def create(self, validated_data):
        row = super().create(validated_data)
        from plane.app.services.entity_issue_types import native_type_for_subtype

        native_type_for_subtype(row)
        return row

    def update(self, instance, validated_data):
        row = super().update(instance, validated_data)
        from plane.app.services.entity_issue_types import native_type_for_subtype

        native = native_type_for_subtype(row)
        if native:
            native.name, native.description, native.is_active = row.title, row.description, row.is_active
            native.save()
        return row

    class Meta:
        model = EntityType
        fields = (
            "id",
            "code",
            "title",
            "icon",
            "description",
            "is_active",
            "parent",
            "adapter",
            "title_field",
            "numbering",
            "record_permissions",
        )
        read_only_fields = ("id", "adapter")

    def validate(self, attrs):
        parent = attrs.get("parent", self.instance.parent if self.instance else None)
        if parent and (parent.parent_id or self.instance and parent.id == self.instance.id):
            raise serializers.ValidationError("زیرنوع باید مستقیماً به یک موجودیت اصلی متصل باشد.")
        if self.instance and "parent" in attrs and attrs["parent"] != self.instance.parent:
            raise serializers.ValidationError("موجودیت مادر پس از ایجاد قابل تغییر نیست.")
        permissions = attrs.get("record_permissions", {})
        if not isinstance(permissions, dict) or any(
            key not in {"view", "view_all", "create", "edit", "delete"} or value not in PERMISSION_REGISTRY
            for key, value in permissions.items()
        ):
            raise serializers.ValidationError("کدهای دسترسی رکورد باید از کاتالوگ مجوزهای موجود انتخاب شوند.")
        if (
            self.instance
            and self.instance.adapter
            and "record_permissions" in attrs
            and attrs["record_permissions"] != self.instance.record_permissions
        ):
            raise serializers.ValidationError("سیاست دسترسی مدل سیستمی از سیاست اصلی پروژه پیروی می‌کند.")
        numbering = attrs.get("numbering", {})
        if (
            not isinstance(numbering, dict)
            or not isinstance(numbering.get("prefix", ""), str)
            or len(numbering.get("prefix", "")) > 60
        ):
            raise serializers.ValidationError("پیشوند شماره‌گذاری حداکثر شصت نویسه است.")
        if not isinstance(numbering.get("padding", 5), int) or not 1 <= numbering.get("padding", 5) <= 12:
            raise serializers.ValidationError("تعداد رقم شماره‌گذاری باید بین یک و دوازده باشد.")
        return attrs


class LookupCategorySerializer(ScopedDefinitionSerializer):
    class Meta:
        model = LookupCategory
        fields = ("id", "code", "title", "description", "is_active", "is_system")
        read_only_fields = ("id", "is_system")


class LookupValueSerializer(ScopedDefinitionSerializer):
    class Meta:
        model = LookupValue
        fields = ("id", "category", "code", "title", "color", "icon", "position", "is_default", "is_active", "parent")
        read_only_fields = ("id",)
        validators = []  # One-default replacement happens under a category lock in the endpoint.

    def validate_color(self, value):
        if not re.fullmatch(r"#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?", value):
            raise serializers.ValidationError("رنگ باید در قالب HEX باشد.")
        return value

    def validate(self, attrs):
        if self.instance and "category" in attrs and attrs["category"] != self.instance.category:
            raise serializers.ValidationError("لیست پایه مقدار پس از ایجاد قابل تغییر نیست.")
        category = attrs.get("category", self.instance.category if self.instance else None)
        if (
            category
            and category.code in {"priority", "task-status"}
            and len(attrs.get("code", self.instance.code if self.instance else "")) > 20
        ):
            raise serializers.ValidationError("کد گزینه متصل به مدل سیستمی حداکثر بیست نویسه است.")
        parent = attrs.get("parent", self.instance.parent if self.instance else None)
        seen = {self.instance.id} if self.instance else set()
        while parent:
            if parent.id in seen:
                raise serializers.ValidationError("حلقه والد/فرزند مجاز نیست.")
            seen.add(parent.id)
            parent = parent.parent
        if (
            attrs.get("is_default")
            and attrs.get("is_active", self.instance.is_active if self.instance else True) is False
        ):
            raise serializers.ValidationError("مقدار غیرفعال نمی‌تواند پیش‌فرض باشد.")
        if attrs.get("is_active") is False:
            attrs["is_default"] = False
        return attrs


class FieldDefinitionSerializer(ScopedDefinitionSerializer):
    class Meta:
        model = FieldDefinition
        fields = (
            "id",
            "code",
            "title",
            "kind",
            "help_text",
            "placeholder",
            "config",
            "lookup",
            "relation_entity",
            "is_active",
            "show_in_summary",
            "searchable",
            "filterable",
            "table_visible",
            "used_at",
        )
        read_only_fields = ("id", "used_at")

    def validate(self, attrs):
        if self.instance and self.instance.used_at:
            changed = {key for key, value in attrs.items() if value != getattr(self.instance, key)}
            if changed - DISPLAY_SETTINGS:
                raise serializers.ValidationError(
                    "این فیلد استفاده شده است؛ فقط عنوان، تنظیمات نمایشی و وضعیت فعالیت قابل تغییر هستند."
                )
        kind = attrs.get("kind", self.instance.kind if self.instance else None)
        config = attrs.get("config", self.instance.config if self.instance else {})
        validate_field_config(kind, config)
        if (
            "config" in attrs
            and config.get("default") is not None
            and not config.get("default_dynamic")
            and not (isinstance(config["default"], dict) and "dynamic" in config["default"])
        ):
            from plane.app.services.entity_rules import normalize

            attrs["config"] = {**config, "default": normalize({"kind": kind, "config": config}, config["default"])}
        lookup = attrs.get("lookup", self.instance.lookup if self.instance else None)
        relation = attrs.get("relation_entity", self.instance.relation_entity if self.instance else None)
        if kind in {"select", "multi_select"} and not lookup and config.get("provider") != "project_states":
            raise serializers.ValidationError("فیلد انتخابی باید به لیست پایه متصل باشد.")
        if kind == "relation" and not relation:
            raise serializers.ValidationError("موجودیت مقصد ارتباط را انتخاب کنید.")
        if relation and relation.parent_id:
            raise serializers.ValidationError("مقصد ارتباط باید یک موجودیت اصلی باشد.")
        return attrs
