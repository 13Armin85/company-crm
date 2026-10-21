"""Portable schema configuration and three opt-in templates; never exports records."""

from copy import deepcopy

from django.db import transaction
from django.db.models import Q
from rest_framework.exceptions import ValidationError

from plane.db.models import (
    EntityType,
    FieldDefinition,
    FormLayout,
    FormVersion,
    LookupCategory,
    LookupValue,
    OrganizationRole,
    OrganizationUnit,
    User,
    EntityRecord,
    SurfaceConfiguration,
)
from plane.app.serializers.entity import (
    EntityTypeSerializer,
    FieldDefinitionSerializer,
    LookupCategorySerializer,
    LookupValueSerializer,
)
from .entity_schema import validate_layout, bindings
from .entity_records import emit, emit_definition


def portable_value(value, field, workspace, importing=False):
    if value is None or isinstance(value, dict) and "dynamic" in value:
        return value
    if isinstance(value, list):
        return [portable_value(item, field, workspace, importing) for item in value]
    if importing:
        if not isinstance(value, dict) or "__ref__" not in value:
            return value
        kind, key = value["__ref__"], value.get("key")
        if kind == "lookup":
            row = LookupValue.objects.filter(
                category__workspace=workspace,
                category__code=value.get("category"),
                code=key,
            ).first()
        elif kind == "role":
            row = OrganizationRole.objects.filter(workspace=workspace, name=key).first()
        elif kind == "unit":
            rows = OrganizationUnit.objects.filter(workspace=workspace, title=key)
            row = rows.first() if rows.count() == 1 else None
        elif kind == "user":
            row = User.objects.filter(
                email=key,
                member_workspace__workspace=workspace,
                member_workspace__is_active=True,
            ).first()
        elif kind == "record":
            row = EntityRecord.objects.filter(
                entity__workspace=workspace,
                entity__code=value.get("entity"),
                number=key,
            ).first()
            if row:
                return str(row.source_id or row.id)
        elif kind == "file" and field.kind == "file":
            from .entity_files import import_default_file

            return import_default_file(value, field, workspace)
        else:
            raise ValidationError("نوع مرجع قابل انتقال پشتیبانی نمی‌شود.")
        if not row:
            raise ValidationError(
                f"مرجع «{key}» در محیط مقصد وجود ندارد؛ ابتدا وابستگی را آماده کنید."
            )
        return str(row.id)
    if field.lookup_id and not field.config.get("lookup_codes") and value != "":
        row = LookupValue.objects.filter(category=field.lookup, id=value).first()
        if row:
            return {"__ref__": "lookup", "category": field.lookup.code, "key": row.code}
    models = {
        "role": (OrganizationRole, "name"),
        "unit": (OrganizationUnit, "title"),
        "user": (User, "email"),
    }
    if field.kind in models and value != "":
        model, name = models[field.kind]
        row = model.objects.filter(id=value).first()
        if row:
            return {"__ref__": field.kind, "key": getattr(row, name)}
    if field.kind == "relation" and value != "":
        row = (
            EntityRecord.objects.filter(entity=field.relation_entity)
            .filter(Q(id=value) | Q(source_id=value))
            .first()
        )
        if row:
            return {
                "__ref__": "record",
                "entity": field.relation_entity.code,
                "key": row.number,
            }
        raise ValidationError(
            "رکورد مرجع پیش‌فرض ارتباط باید پیش از انتقال پیکربندی به موتور متصل شده باشد."
        )
    if field.kind == "file" and value != "":
        from .entity_files import export_default_file

        return export_default_file(value, field, workspace)
    return value


def portable_rules(value, fields, workspace, importing=False):
    if not value:
        return value
    rule = deepcopy(value)
    if "rules" in rule:
        rule["rules"] = [
            portable_rules(child, fields, workspace, importing)
            for child in rule["rules"]
        ]
    elif rule.get("field") in fields and "value" in rule:
        rule["value"] = portable_value(
            rule["value"], fields[rule["field"]], workspace, importing
        )
    return rule


def portable_field_config(config, field, fields, workspace, importing=False):
    result = deepcopy(config)
    if "default" in result:
        result["default"] = portable_value(
            result["default"], field, workspace, importing
        )
    for key in ("required_if", "visible_if"):
        if result.get(key):
            result[key] = portable_rules(result[key], fields, workspace, importing)
    return result


def portable_layout(layout, workspace, importing=False):
    result = deepcopy(layout)
    fields = {
        f.code: f
        for f in FieldDefinition.objects.filter(workspace=workspace).select_related(
            "lookup", "relation_entity"
        )
    }
    for binding in bindings(result):
        if binding.get("field") in fields:
            converted = portable_field_config(
                binding, fields[binding["field"]], fields, workspace, importing
            )
            binding.update(converted)
        for key in ("view_roles", "edit_roles"):
            if binding.get(key) is None:
                continue
            roles = OrganizationRole.objects.filter(workspace=workspace)
            if importing:
                rows = {r.name: str(r.id) for r in roles.filter(name__in=binding[key])}
            else:
                rows = {str(r.id): r.name for r in roles.filter(id__in=binding[key])}
            if set(binding[key]) - rows.keys():
                raise ValidationError(
                    "نقش مرجع پیکربندی در محیط مقصد وجود ندارد؛ ابتدا نقش هم‌نام ایجاد کنید."
                )
            binding[key] = [rows[value] for value in binding[key]]
    return result


def export_config(workspace):
    entities = []
    for row in EntityType.objects.filter(workspace=workspace).select_related("parent"):
        data = dict(EntityTypeSerializer(row, context={"workspace": workspace}).data)
        data.pop("id")
        data["parent"] = row.parent.code if row.parent_id else None
        entities.append(data)
    categories = []
    for row in LookupCategory.objects.filter(workspace=workspace):
        data = dict(
            LookupCategorySerializer(row, context={"workspace": workspace}).data
        )
        data.pop("id")
        categories.append(data)
    values = []
    for row in LookupValue.objects.filter(category__workspace=workspace).select_related(
        "category", "parent", "parent__category"
    ):
        data = dict(LookupValueSerializer(row, context={"workspace": workspace}).data)
        data.pop("id")
        data["category"] = row.category.code
        data["parent"] = (
            [row.parent.category.code, row.parent.code] if row.parent_id else None
        )
        values.append(data)
    fields = []
    field_map = {
        f.code: f
        for f in FieldDefinition.objects.filter(workspace=workspace).select_related(
            "lookup", "relation_entity"
        )
    }
    for row in field_map.values():
        data = dict(
            FieldDefinitionSerializer(row, context={"workspace": workspace}).data
        )
        for key in ("id", "used_at"):
            data.pop(key)
        data["lookup"] = row.lookup.code if row.lookup_id else None
        data["relation_entity"] = (
            row.relation_entity.code if row.relation_entity_id else None
        )
        data["config"] = portable_field_config(
            data["config"], row, field_map, workspace
        )
        fields.append(data)
    forms = [
        {
            "entity": row.entity.code,
            "draft": portable_layout(row.draft, workspace),
            "published": (
                portable_layout(row.published.schema, workspace)
                if row.published_id
                else None
            ),
        }
        for row in FormLayout.objects.filter(
            entity__workspace=workspace
        ).select_related("entity", "published")
    ]
    return {
        "format": "crm-engine",
        "version": 1,
        "entities": entities,
        "lookups": categories,
        "values": values,
        "fields": fields,
        "forms": forms,
        "surfaces": [
            {"code": row.code, "definition": deepcopy(row.definition)}
            for row in SurfaceConfiguration.objects.filter(workspace=workspace)
        ],
    }


@transaction.atomic
def import_config(workspace, user, config):
    if (
        not isinstance(config, dict)
        or config.get("format") != "crm-engine"
        or config.get("version") != 1
    ):
        raise ValidationError("قالب یا نسخه پیکربندی پشتیبانی نمی‌شود.")
    for key in ("entities", "lookups", "values", "fields", "forms", "surfaces"):
        if (
            not isinstance(config.get(key, []), list)
            or len(config.get(key, [])) > 10000
        ):
            raise ValidationError("ساختار یا اندازه پیکربندی معتبر نیست.")
        seen = set()
        for row in config.get(key, []):
            if not isinstance(row, dict) or not isinstance(
                row.get("entity" if key == "forms" else "code"), str
            ):
                raise ValidationError({key: "هر تعریف باید شیء دارای کد پایدار باشد."})
            if key == "values" and not isinstance(row.get("category"), str):
                raise ValidationError("هر مقدار باید کد دسته لیست پایه را داشته باشد.")
            if key == "fields" and not isinstance(row.get("kind"), str):
                raise ValidationError("نوع فیلد در پیکربندی الزامی است.")
            if key == "forms" and not isinstance(row.get("draft"), dict):
                raise ValidationError("چیدمان پیش‌نویس در پیکربندی فرم الزامی است.")
            identifier = (
                (row.get("category"), row.get("code"))
                if key == "values"
                else row.get("entity" if key == "forms" else "code")
            )
            if identifier in seen:
                raise ValidationError({key: "کد تکراری در پیکربندی پذیرفته نیست."})
            seen.add(identifier)
    # Serialize imports with record writes and definition edits in this workspace.
    from plane.db.models import Workspace

    Workspace.objects.select_for_update().get(id=workspace.id)
    counts = {}

    def upsert(model, serializer_type, rows, scope):
        count = 0
        for raw in rows:
            item = dict(raw)
            item.pop("adapter", None)
            item.pop("is_system", None)
            row = model.objects.filter(**scope, code=item["code"]).first()
            before = (
                dict(serializer_type(row, context={"workspace": workspace}).data)
                if row
                else None
            )
            serializer = serializer_type(
                row, data=item, partial=bool(row), context={"workspace": workspace}
            )
            serializer.is_valid(raise_exception=True)
            saved = serializer.save(**scope)
            if before != dict(serializer.data):
                emit_definition(
                    workspace,
                    user,
                    "definition.config_imported",
                    saved,
                    before,
                    dict(serializer.data),
                )
            count += 1
        return count

    counts["lookups"] = upsert(
        LookupCategory,
        LookupCategorySerializer,
        config.get("lookups", []),
        {"workspace": workspace},
    )
    source_entities = config.get("entities", [])
    for subtype in (False, True):
        rows = []
        for raw in source_entities:
            if bool(raw.get("parent")) != subtype:
                continue
            item = dict(raw)
            if item.get("parent"):
                parent = EntityType.objects.filter(
                    workspace=workspace, code=item["parent"], parent__isnull=True
                ).first()
                if not parent:
                    raise ValidationError("موجودیت مادر در پیکربندی وجود ندارد.")
                item["parent"] = str(parent.id)
            rows.append(item)
        upsert(EntityType, EntityTypeSerializer, rows, {"workspace": workspace})
    counts["entities"] = len(source_entities)
    old_values = {}
    for index, raw in enumerate(config.get("values", []), 1):
        item = dict(raw)
        source_row = item.pop("_source_row", index)
        category = LookupCategory.objects.filter(
            workspace=workspace, code=item["category"]
        ).first()
        if not category:
            raise ValidationError("دسته لیست پایه وجود ندارد.")
        item["category"], item["parent"] = str(category.id), None
        row = LookupValue.objects.filter(category=category, code=item["code"]).first()
        old_values[(category.code, item["code"])] = (
            dict(LookupValueSerializer(row, context={"workspace": workspace}).data)
            if row
            else None
        )
        if item.get("is_default"):
            LookupValue.objects.filter(category=category, is_default=True).exclude(
                pk=row.pk if row else None
            ).update(is_default=False)
        serializer = LookupValueSerializer(
            row, data=item, partial=bool(row), context={"workspace": workspace}
        )
        if not serializer.is_valid():
            raise ValidationError({"rows": {str(source_row): serializer.errors}})
        serializer.save()
    for raw in config.get("values", []):
        if raw.get("parent"):
            parent = LookupValue.objects.filter(
                category__workspace=workspace,
                category__code=raw["parent"][0],
                code=raw["parent"][1],
            ).first()
            if not parent:
                raise ValidationError("مقدار والد در پیکربندی وجود ندارد.")
            row = LookupValue.objects.get(
                category__workspace=workspace,
                category__code=raw["category"],
                code=raw["code"],
            )
            serializer = LookupValueSerializer(
                row,
                data={"parent": str(parent.id)},
                partial=True,
                context={"workspace": workspace},
            )
            serializer.is_valid(raise_exception=True)
            serializer.save()
    for raw in config.get("values", []):
        row = LookupValue.objects.get(
            category__workspace=workspace,
            category__code=raw["category"],
            code=raw["code"],
        )
        after = dict(LookupValueSerializer(row, context={"workspace": workspace}).data)
        before = old_values[(raw["category"], raw["code"])]
        if before != after:
            emit_definition(
                workspace, user, "definition.config_imported", row, before, after
            )
    rows = []
    for raw in config.get("fields", []):
        item = dict(raw)
        for key, model in (("lookup", LookupCategory), ("relation_entity", EntityType)):
            if item.get(key):
                reference = model.objects.filter(
                    workspace=workspace, code=item[key]
                ).first()
                if not reference:
                    raise ValidationError("مرجع فیلد در پیکربندی وجود ندارد.")
                item[key] = str(reference.id)
        rows.append(item)
    staged_fields = {
        f.code: f
        for f in FieldDefinition.objects.filter(workspace=workspace).select_related(
            "lookup", "relation_entity"
        )
    }
    for item in rows:
        staged_fields[item["code"]] = FieldDefinition(
            workspace=workspace,
            code=item["code"],
            kind=item["kind"],
            config=item.get("config", {}),
            lookup_id=item.get("lookup"),
            relation_entity_id=item.get("relation_entity"),
        )
    for item in rows:
        item["config"] = portable_field_config(
            item.get("config", {}),
            staged_fields[item["code"]],
            staged_fields,
            workspace,
            importing=True,
        )
    counts["fields"] = upsert(
        FieldDefinition, FieldDefinitionSerializer, rows, {"workspace": workspace}
    )
    # Validate/publish root schemas before dependent subtype schemas, regardless of JSON order.
    parent_codes = set(
        EntityType.objects.filter(
            workspace=workspace, parent__isnull=False
        ).values_list("code", flat=True)
    )
    for raw in sorted(
        config.get("forms", []), key=lambda item: item.get("entity") in parent_codes
    ):
        entity = EntityType.objects.filter(
            workspace=workspace, code=raw["entity"]
        ).first()
        if not entity:
            raise ValidationError("موجودیت فرم در پیکربندی وجود ندارد.")
        draft = portable_layout(raw["draft"], workspace, importing=True)
        validate_layout(entity, draft)
        form, _ = FormLayout.objects.select_for_update().get_or_create(entity=entity)
        form.draft, form.revision = draft, form.revision + 1
        if raw.get("published") is not None:
            published = portable_layout(raw["published"], workspace, importing=True)
            validate_layout(entity, published)
            if not form.published_id or form.published.schema != published:
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
                    change_note="ورود پیکربندی",
                    created_by_id=user.id,
                )
        form.save()
        emit(
            entity,
            user,
            "definition.config_imported",
            metadata={"revision": form.revision},
        )
    counts["values"], counts["forms"] = len(config.get("values", [])), len(
        config.get("forms", [])
    )
    from .surface_config import SURFACES, validate_definition

    for raw in config.get("surfaces", []):
        if raw["code"] not in SURFACES:
            raise ValidationError("صفحه تنظیمات واردشده در این نسخه وجود ندارد.")
        definition = validate_definition(workspace, raw["code"], raw.get("definition"))
        row = SurfaceConfiguration.objects.filter(
            workspace=workspace, code=raw["code"]
        ).first()
        before = deepcopy(row.definition) if row else None
        row, _ = SurfaceConfiguration.objects.update_or_create(
            workspace=workspace,
            code=raw["code"],
            defaults={
                "definition": definition,
                "revision": row.revision + 1 if row else 1,
            },
        )
        emit_definition(
            workspace, user, "surface.configuration.imported", row, before, definition
        )
    counts["surfaces"] = len(config.get("surfaces", []))
    return counts


TEMPLATES = {
    "support": {
        "title": "پشتیبانی",
        "entity": "ticket",
        "fields": [
            {
                "code": "support_source",
                "title": "منبع تیکت",
                "kind": "select",
                "lookup": "ticket-source",
            },
            {
                "code": "support_category",
                "title": "دسته‌بندی پشتیبانی",
                "kind": "short_text",
            },
        ],
        "lookups": [{"code": "ticket-source", "title": "منبع تیکت"}],
        "values": [
            {"category": "ticket-source", "code": "phone", "title": "تلفن"},
            {"category": "ticket-source", "code": "email", "title": "ایمیل"},
            {"category": "ticket-source", "code": "portal", "title": "پورتال"},
            {"category": "ticket-source", "code": "onsite", "title": "حضوری"},
        ],
    },
    "sales": {
        "title": "فروش",
        "entity": "ticket",
        "fields": [
            {
                "code": "sales_amount",
                "title": "مبلغ پیشنهادی",
                "kind": "money",
                "config": {"unit": "ریال", "min": 0},
            },
            {"code": "sales_email", "title": "ایمیل پیگیری", "kind": "email"},
            {"code": "sales_followup", "title": "تاریخ پیگیری", "kind": "date"},
        ],
    },
    "hr": {
        "title": "منابع انسانی / مرخصی",
        "entity": "leave",
        "fields": [
            {"code": "hr_notes", "title": "توضیحات تکمیلی", "kind": "long_text"},
            {
                "code": "hr_attachment",
                "title": "مدارک مرخصی",
                "kind": "file",
                "config": {
                    "max_file_size": 5242880,
                    "extensions": ["pdf", "jpg", "png"],
                },
            },
        ],
    },
}


def template_config(workspace, key):
    if key not in TEMPLATES:
        raise ValidationError("قالب انتخاب‌شده وجود ندارد.")
    template = deepcopy(TEMPLATES[key])
    code = f"template-{key}"
    existing = EntityType.objects.filter(workspace=workspace, code=code).first()
    form = FormLayout.objects.filter(entity=existing).first() if existing else None
    layout = (
        deepcopy(form.draft)
        if form
        else {
            "tabs": [],
            "sections": [
                {
                    "id": code,
                    "title": template["title"],
                    "columns": 2,
                    "bindings": [
                        {"field": field["code"]} for field in template["fields"]
                    ],
                }
            ],
        }
    )
    return {
        "format": "crm-engine",
        "version": 1,
        "entities": [
            {"code": code, "title": template["title"], "parent": template["entity"]}
        ],
        "fields": template["fields"],
        "lookups": template.get("lookups", []),
        "values": template.get("values", []),
        "forms": [{"entity": code, "draft": layout, "published": layout}],
    }
