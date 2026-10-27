"""Bidirectional relation metadata and atomic cardinality enforcement.

Indexed edges are authoritative. Record JSON contains a transactionally maintained
projection, so tables, filters, lookups and exports use the same SQL query layer.
"""

from copy import deepcopy
from uuid import uuid4

from django.db import transaction
from django.db.models import Q, Max
from django.utils import timezone
from rest_framework.exceptions import ValidationError, PermissionDenied

from plane.db.models import (
    EntityRelation,
    EntityRelationLink,
    EntityRecord,
    FieldDefinition,
    FormLayout,
    FormVersion,
)
from .access_control import has_permission
from .entity_records import emit_definition, require_action, get_record

CARDINALITY = {
    "one_to_one": (False, False),
    "one_to_many": (True, False),
    "many_to_one": (False, True),
    "many_to_many": (True, True),
}


def relation_payload(relation):
    return {
        "id": str(relation.id),
        "left_entity": relation.left_entity.code,
        "right_entity": relation.right_entity.code,
        "left_title": relation.left_field.title,
        "right_title": relation.right_field.title,
        "left_field": relation.left_field.code,
        "right_field": relation.right_field.code,
        "kind": relation.kind,
        "left_required": relation.left_required,
        "right_required": relation.right_required,
        "on_delete": relation.on_delete,
        "link_count": relation.links.count(),
    }


def attach_field(entity, field, actor):
    form = (
        FormLayout.objects.select_for_update(of=("self",))
        .filter(entity=entity)
        .select_related("published")
        .first()
    )
    if not form or not form.published_id:
        raise ValidationError("ابتدا فرم هر دو موجودیت را منتشر کنید.")

    def attach(layout):
        result = deepcopy(layout)
        result.setdefault("sections", []).append(
            {
                "id": f"relation-{field.id}",
                "title": field.title,
                "columns": 1,
                "bindings": [{"field": field.code}],
            }
        )
        return result

    before = form.published.schema
    published = attach(before)
    form.draft = attach(form.draft)
    number = (form.versions.aggregate(last=Max("number"))["last"] or 0) + 1
    form.published = FormVersion.objects.create(
        layout=form, number=number, schema=published, change_note="افزودن ارتباط"
    )
    form.revision += 1
    form.save()
    emit_definition(
        entity.workspace, actor, "definition.form_published", form, before, published
    )


def side(relation, field):
    return "left" if field["code"] == relation.left_field.code else "right"


def sync_projection(relation, direction, identifiers):
    entity = getattr(relation, f"{direction}_entity")
    field = getattr(relation, f"{direction}_field")
    opposite = "right" if direction == "left" else "left"
    multiple = CARDINALITY[relation.kind][0 if direction == "left" else 1]
    # Only the changed endpoints are touched; reading a table never walks records.
    for identifier in set(identifiers):
        linked = list(
            map(
                str,
                relation.links.filter(**{f"{direction}_id": identifier})
                .order_by(f"{opposite}_id")
                .values_list(f"{opposite}_id", flat=True),
            )
        )
        rows = EntityRecord.objects.filter(
            entity=entity, **{"source_id" if entity.adapter else "id": identifier}
        )
        for row in rows:
            row.data = {
                **row.data,
                field.code: linked if multiple else (linked[0] if linked else None),
            }
            row.revision += 1
            row.save(update_fields=["data", "revision", "updated_at"])


def validate_relation_values(
    entity, actor, values, old, fields, creating, request=None
):
    for code, field in fields.items():
        relation_id = field["config"].get("relation_id")
        if not relation_id or values.get(code) == old.get(code):
            continue
        if not has_permission(
            actor,
            entity.workspace,
            "Relation.Create" if creating else "Relation.Edit",
            request=request,
        ):
            raise PermissionDenied(
                {code: "مجوز اتصال یا جدا کردن رکورد مرتبط را ندارید."}
            )
        relation = (
            EntityRelation.objects.select_for_update()
            .select_related("left_field", "right_field")
            .get(id=relation_id)
        )
        direction = side(relation, field)
        opposite = "right" if direction == "left" else "left"
        multiple = CARDINALITY[relation.kind][0 if direction == "left" else 1]
        reverse_multiple = CARDINALITY[relation.kind][1 if direction == "left" else 0]
        raw = values.get(code)
        identifiers = raw if isinstance(raw, list) else [raw] if raw else []
        if not multiple and len(identifiers) > 1:
            raise ValidationError({code: "این سمت ارتباط فقط یک رکورد می‌پذیرد."})
        current = getattr(request, "_engine_record_id", None)
        if not reverse_multiple:
            links = relation.links.filter(**{f"{opposite}_id__in": identifiers})
            if current:
                links = links.exclude(**{f"{direction}_id": current})
            if links.exists():
                raise ValidationError(
                    {
                        code: "قانون تعداد ارتباط اجازه اتصال دو رکورد به یک مقصد را نمی‌دهد."
                    }
                )
        if current and getattr(relation, f"{opposite}_required"):
            removed = relation.links.filter(**{f"{direction}_id": current}).exclude(
                **{f"{opposite}_id__in": identifiers}
            )
            for target in removed.values_list(f"{opposite}_id", flat=True):
                if (
                    not relation.links.filter(**{f"{opposite}_id": target})
                    .exclude(**{f"{direction}_id": current})
                    .exists()
                ):
                    raise ValidationError(
                        {
                            code: "این اتصال در سمت مقابل اجباری است و نمی‌توان آخرین پیوند آن را جدا کرد."
                        }
                    )


def save_relation_links(entity, record, actor, values, fields, request=None):
    identifier = record.source_id or record.id
    for code, field in fields.items():
        relation_id = field["config"].get("relation_id")
        if not relation_id:
            continue
        relation = (
            EntityRelation.objects.select_for_update()
            .select_related("left_entity", "right_entity", "left_field", "right_field")
            .get(id=relation_id)
        )
        direction = side(relation, field)
        opposite = "right" if direction == "left" else "left"
        raw = values.get(code)
        targets = {
            str(value)
            for value in (raw if isinstance(raw, list) else [raw] if raw else [])
        }
        existing = set(
            map(
                str,
                relation.links.filter(**{f"{direction}_id": identifier}).values_list(
                    f"{opposite}_id", flat=True
                ),
            )
        )
        if targets == existing:
            continue
        relation.links.filter(
            **{f"{direction}_id": identifier, f"{opposite}_id__in": existing - targets}
        ).update(deleted_at=timezone.now())
        for target in targets - existing:
            EntityRelationLink.objects.create(
                relation=relation,
                **{f"{direction}_id": identifier, f"{opposite}_id": target},
                created_by=actor,
            )
        sync_projection(relation, opposite, targets | existing)
        emit_definition(
            entity.workspace,
            actor,
            "record.relation_changed",
            record,
            {code: sorted(existing)},
            {code: sorted(targets)},
        )


def before_delete(entity, identifier, actor, request=None, apply=False):
    for relation in EntityRelation.objects.filter(
        Q(left_entity=entity) | Q(right_entity=entity)
    ).select_related("left_entity", "right_entity", "left_field", "right_field"):
        for direction in [
            key
            for key in ("left", "right")
            if getattr(relation, f"{key}_entity_id") == entity.id
        ]:
            links = relation.links.filter(**{f"{direction}_id": identifier})
            if not links.exists():
                continue
            if relation.on_delete == "block":
                raise ValidationError(
                    "این رکورد ارتباط فعال دارد؛ طبق قانون ارتباط، حذف یا غیرفعال کردن آن مسدود است."
                )
            if apply:
                opposite = "right" if direction == "left" else "left"
                targets = list(links.values_list(f"{opposite}_id", flat=True))
                links.update(deleted_at=timezone.now())
                sync_projection(relation, opposite, targets)
