"""Normalized, multi-column uniqueness shared by native, import and engine writes.

The workspace/entity locks held by write entrypoints serialize the check and write.
Predicates execute in PostgreSQL, without loading an entity into Python memory.
"""

import re
import json

from django.db import models
from django.db.models import F, OuterRef, Subquery, Count, Q
from django.db.models.fields.json import KeyTextTransform
from django.db.models.functions import Cast, Lower, Trim
from rest_framework.exceptions import ValidationError

from plane.db.models import EntityRecord

FROM_CHARACTERS = "يك۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩"
TO_CHARACTERS = "یک01234567890123456789"


def canonical(value):
    if value is None or value == "" or value == []:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (list, dict)):
        value = json.dumps(value, ensure_ascii=False)
    return (
        re.sub(
            r"\s+",
            " ",
            str(value).translate(str.maketrans(FROM_CHARACTERS, TO_CHARACTERS)),
        )
        .strip()
        .lower()
        or None
    )


def canonical_expression(expression):
    translated = models.Func(
        Cast(expression, models.TextField()),
        models.Value(FROM_CHARACTERS),
        models.Value(TO_CHARACTERS),
        function="translate",
        output_field=models.TextField(),
    )
    collapsed = models.Func(
        translated,
        models.Value(r"\s+"),
        models.Value(" "),
        models.Value("g"),
        function="regexp_replace",
        output_field=models.TextField(),
    )
    return Lower(Trim(collapsed))


def candidates(entity, codes, fields):
    from .entity_records import base_native_rows

    if entity.adapter:
        rows = base_native_rows(entity, include_deleted=True)
        if entity.adapter != "user":
            rows = rows.filter(deleted_at__isnull=True)
    else:
        rows = EntityRecord.all_objects.filter(entity=entity, deleted_at__isnull=True)
    aliases = []
    for index, code in enumerate(codes):
        field = fields.get(code)
        if field is None:
            return rows.none(), []
        source = field.get("binding", {}).get("source")
        if entity.adapter and source:
            if entity.adapter == "ticket" and source == "work_status":
                from .unified_work import work_status_expression

                expression = work_status_expression()
            elif entity.adapter == "user" and source == "role_ids":
                from django.contrib.postgres.expressions import ArraySubquery
                from plane.db.models import UserOrganizationRole
                from .entity_query import ToJSON

                expression = ToJSON(
                    ArraySubquery(
                        UserOrganizationRole.objects.filter(
                            workspace=entity.workspace,
                            user_id=OuterRef("id"),
                            is_active=True,
                        )
                        .order_by("role_id")
                        .values("role_id")
                    )
                )
            else:
                expression = F(source)
        elif entity.adapter:
            expression = Subquery(
                EntityRecord.objects.filter(entity=entity, source_id=OuterRef("id"))
                .annotate(_unique_value=KeyTextTransform(code, "data"))
                .values("_unique_value")[:1]
            )
        else:
            expression = KeyTextTransform(code, "data")
        alias = f"_unique{index}"
        aliases.append(alias)
        rows = rows.annotate(**{alias: canonical_expression(expression)})
    return rows, aliases


def duplicates(entity, codes, fields, limit=100):
    rows, aliases = candidates(entity, codes, fields)
    if not aliases:
        return []
    for alias in aliases:
        rows = rows.exclude(Q(**{f"{alias}__isnull": True}) | Q(**{alias: ""}))
    return list(
        rows.order_by()
        .values(*aliases)
        .annotate(count=Count("id"))
        .filter(count__gt=1)[:limit]
    )


def check_unique(entity, user, values, old, fields, creating, request=None):
    rules = list(entity.unique_rules.filter(is_active=True))
    # Preserve pre-existing single-field rules while using the same normalization.
    from types import SimpleNamespace

    rules += [
        SimpleNamespace(
            id=None,
            title=field["title"],
            fields=[code],
            mode="block",
            existing_policy="resolve",
        )
        for code, field in fields.items()
        if field["config"].get("unique")
    ]
    warnings = []
    for rule in rules:
        if not creating and all(
            canonical(values.get(code)) == canonical(old.get(code))
            for code in rule.fields
        ):
            continue
        keys = [canonical(values.get(code)) for code in rule.fields]
        if any(value is None for value in keys):
            continue
        rows, aliases = candidates(entity, rule.fields, fields)
        if not aliases:
            continue
        rows = rows.filter(**dict(zip(aliases, keys)))
        excluded = getattr(
            request,
            "_engine_record_id" if entity.adapter else "_engine_sidecar_id",
            None,
        )
        if excluded:
            rows = rows.exclude(id=excluded)
        match = rows.order_by("created_at", "id").first()
        if match is None:
            continue
        public_id = str(match.id)
        active = getattr(match, "is_active", True)
        if entity.adapter:
            sidecar = EntityRecord.objects.filter(
                entity=entity, source_id=match.id
            ).first()
            active = sidecar.is_active if sidecar else active
        from .entity_records import get_record
        from django.http import Http404
        from rest_framework.exceptions import PermissionDenied

        try:
            get_record(entity, user, public_id, request)
            url = f"/entities/{entity.code}/{public_id}"
            label = (
                getattr(match, "number", None)
                or getattr(match, "name", None)
                or "موجود"
            )
        except (Http404, PermissionDenied):
            url, label = None, "خارج از دامنه دسترسی شما"
        detail = {
            "rule": str(rule.id) if rule.id else None,
            "fields": rule.fields,
            "message": f"این مقدار قبلاً در رکورد {label} ثبت شده است"
            + (" (غیرفعال)" if not active else ""),
            "record_url": url,
            "inactive": not active,
        }
        if rule.mode == "block":
            raise ValidationError({"duplicates": [detail]})
        warnings.append(detail)
    return warnings


def maintain_rule_index(rule, fields, remove=False):
    """An indexed normalized tuple makes custom-entity duplicate checks bounded."""
    if rule.entity.adapter:
        return
    from django.db import connection

    index = models.Index(
        *[canonical_expression(KeyTextTransform(code, "data")) for code in rule.fields],
        name=f"crm_u_{rule.id.hex[:24]}",
        condition=Q(entity_id=rule.entity_id, deleted_at__isnull=True),
    )
    # A rule may be enabled in the same transaction that imported old records.
    # Flush deferred FK checks before PostgreSQL accepts index DDL on that table.
    with connection.cursor() as cursor:
        cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
    with connection.schema_editor(atomic=False) as editor:
        if remove:
            editor.remove_index(EntityRecord, index)
        else:
            editor.add_index(EntityRecord, index)
    with connection.cursor() as cursor:
        cursor.execute("SET CONSTRAINTS ALL DEFERRED")
