"""Separate retiring an input from removing its historical values."""

from django.db.models import Q
from rest_framework.exceptions import ValidationError

from plane.db.models import EntityRecord, EntityType, FormLayout, SurfaceValues
from .entity_schema import bindings, schema_fields, MANDATORY_SOURCES
from copy import deepcopy


def assert_can_hide(field):
    for form in FormLayout.objects.filter(
        entity__workspace=field.workspace
    ).select_related("entity", "published"):
        root = form.entity.parent or form.entity
        for layout in [form.draft, form.published.schema if form.published_id else {}]:
            for binding in bindings(layout):
                if binding["field"] == field.code and (
                    binding.get("source") in MANDATORY_SOURCES.get(root.adapter, set())
                    or root.title_field == field.code
                ):
                    raise ValidationError("فیلد هسته‌ای قفل است و از فرم مخفی نمی‌شود.")


def populated_count(field):
    """Count stored values, including inactive/soft-deleted records, using SQL."""

    def populated(rows, path):
        return (
            rows.filter(**{f"{path}__isnull": False})
            .exclude(Q(**{path: None}) | Q(**{path: ""}) | Q(**{path: []}))
            .count()
        )

    count = populated(
        EntityRecord.all_objects.filter(workspace=field.workspace),
        f"data__{field.code}",
    )
    count += populated(
        SurfaceValues.all_objects.filter(workspace=field.workspace),
        f"values__{field.code}",
    )
    from .entity_records import base_native_rows

    for entity in EntityType.objects.filter(
        workspace=field.workspace, parent__isnull=True
    ).exclude(adapter=""):
        _, fields = schema_fields(entity)
        source = fields.get(field.code, {}).get("binding", {}).get("source")
        if source:
            if entity.adapter == "user" and source == "role_ids":
                from plane.db.models import UserOrganizationRole

                count += (
                    UserOrganizationRole.all_objects.filter(workspace=field.workspace)
                    .values("user_id")
                    .distinct()
                    .count()
                )
                continue
            rows = base_native_rows(entity, include_deleted=True)
            count += rows.filter(**{f"{source}__isnull": False}).count()
    return count


def detach_empty_field(field, actor):
    from plane.db.models import FieldDefinition, FormVersion, SurfaceConfiguration
    from .entity_records import emit_definition
    from .entity_rules import formula_fields, condition_fields

    code = field.code
    for definition in FieldDefinition.objects.filter(workspace=field.workspace).exclude(
        id=field.id
    ):
        config = definition.config
        dependencies = condition_fields(config.get("visible_if")) | condition_fields(
            config.get("required_if")
        )
        if config.get("formula"):
            dependencies |= formula_fields(config["formula"])
        if config.get("depends_on") == code or code in dependencies:
            raise ValidationError(
                "ابتدا وابستگی این فیلد را از شرط‌ها و فرمول‌های فیلدهای دیگر بردارید."
            )
    for form in FormLayout.objects.filter(
        entity__workspace=field.workspace
    ).select_related("published"):

        def detach(layout):
            result = deepcopy(layout)
            for section in result.get("sections", []):
                for binding in section.get("bindings", []):
                    if binding["field"] != code and code in condition_fields(
                        binding.get("visible_if")
                    ) | condition_fields(binding.get("required_if")):
                        raise ValidationError(
                            "ابتدا وابستگی این فیلد را از شرط‌های فرم بردارید."
                        )
                section["bindings"] = [
                    binding
                    for binding in section.get("bindings", [])
                    if binding["field"] != code
                ]
            return result

        before = form.published.schema if form.published_id else None
        draft = detach(form.draft)
        published = detach(before) if before else None
        if draft != form.draft or published != before:
            form.draft = draft
            if published != before:
                number = (
                    form.versions.order_by("-number")
                    .values_list("number", flat=True)
                    .first()
                    or 0
                ) + 1
                form.published = FormVersion.objects.create(
                    layout=form,
                    number=number,
                    schema=published,
                    change_note="حذف فیلد بدون داده",
                )
            form.revision += 1
            form.save()
            emit_definition(
                field.workspace,
                actor,
                "definition.form_published",
                form,
                before,
                published,
            )
    for row in SurfaceConfiguration.objects.filter(workspace=field.workspace):
        before = deepcopy(row.definition)
        if not {"fields", "columns", "table_tabs"}.intersection(before):
            continue
        result = deepcopy(before)
        result["fields"] = [
            binding
            for binding in result.get("fields", [])
            if binding.get("field") != code
        ]
        for definition in [result, *result.get("table_tabs", [])]:
            if "columns" in definition:
                definition["columns"] = [
                    column
                    for column in definition["columns"]
                    if column not in {f"field:{code}", f"engine:{code}"}
                ]
        if result != before:
            row.definition, row.revision = result, row.revision + 1
            row.save()
            emit_definition(
                field.workspace,
                actor,
                "surface.configuration.published",
                row,
                before,
                result,
            )
