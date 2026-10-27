"""Immutable numbered columns, with PostgreSQL row locks and permanent allocation."""

from copy import deepcopy

from django.core import signing
from django.db import transaction
from django.db.models import Max
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from plane.db.models import (
    EntityRecord,
    EntityNumberingRule,
    EntityNumberValue,
    SystemIdentifierCounter,
    FieldDefinition,
    FormLayout,
    FormVersion,
    Workspace,
)
from .entity_records import emit_definition


def counter_key(rule, subtype=None):
    return f"numbering:{rule.id}:" + (
        str(subtype.id) if subtype and not rule.shared_sequence else "shared"
    )


def render_number(rule, sequence, subtype=None):
    prefix = (
        rule.subtype_prefixes.get(subtype.code, rule.prefix) if subtype else rule.prefix
    )
    return prefix + str(sequence).zfill(rule.padding)


def assign_numbers(row):
    for rule in EntityNumberingRule.objects.filter(entity=row.entity).select_related(
        "field"
    ):
        if EntityNumberValue.objects.filter(rule=rule, record=row).exists():
            continue
        counter = SystemIdentifierCounter.locked(
            counter_key(rule, row.subtype), "default"
        )
        sequence = counter.advance(rule.start - 1)
        value = render_number(rule, sequence, row.subtype)
        EntityNumberValue.objects.create(rule=rule, record=row, value=value)
        row.data = {**row.data, rule.field.code: value}
    row.save(update_fields=["data", "updated_at"])


def rule_payload(rule):
    value = (
        SystemIdentifierCounter.objects.filter(key=counter_key(rule))
        .values_list("value", flat=True)
        .first()
        or 0
    )
    return {
        "id": str(rule.id),
        "field": rule.field.code,
        "title": rule.field.title,
        "prefix": rule.prefix,
        "start": rule.start,
        "padding": rule.padding,
        "subtype_prefixes": rule.subtype_prefixes,
        "shared_sequence": rule.shared_sequence,
        "next": render_number(rule, max(value + 1, rule.start)),
    }


def validate_settings(entity, data, rule=None):
    defaults = (
        rule_payload(rule)
        if rule
        else {
            "prefix": "",
            "start": 1,
            "padding": 0,
            "subtype_prefixes": {},
            "shared_sequence": True,
        }
    )
    result = {
        key: data.get(key, defaults[key])
        for key in ["prefix", "start", "padding", "subtype_prefixes", "shared_sequence"]
    }
    if (
        not isinstance(result["prefix"], str)
        or len(result["prefix"]) > 60
        or type(result["start"]) is not int
        or not 1 <= result["start"] <= 10**18
        or type(result["padding"]) is not int
        or not 0 <= result["padding"] <= 18
        or type(result["shared_sequence"]) is not bool
    ):
        raise ValidationError("پیشوند، شروع توالی یا تعداد رقم معتبر نیست.")
    prefixes = result["subtype_prefixes"]
    if (
        not isinstance(prefixes, dict)
        or set(prefixes) - set(entity.subtypes.values_list("code", flat=True))
        or any(
            not isinstance(value, str) or len(value) > 60 for value in prefixes.values()
        )
    ):
        raise ValidationError(
            "پیشوندهای زیرنوع باید به زیرنوع‌های همین موجودیت تعلق داشته باشند."
        )
    if not result["shared_sequence"]:
        rendered = [
            result["prefix"],
            *[
                prefixes.get(code, result["prefix"])
                for code in entity.subtypes.values_list("code", flat=True)
            ],
        ]
        if len(set(rendered)) != len(rendered):
            raise ValidationError(
                "در توالی جدا، پیشوند هر زیرنوع باید یکتا باشد تا شماره تکراری ساخته نشود."
            )
    if rule:
        if result["shared_sequence"] != rule.shared_sequence and rule.values.exists():
            raise ValidationError("روش اشتراک توالی پس از شماره‌دهی قابل تغییر نیست.")
        last = (
            SystemIdentifierCounter.objects.filter(
                key__startswith=f"numbering:{rule.id}:"
            ).aggregate(last=Max("value"))["last"]
            or 0
        )
        if result["start"] != rule.start and result["start"] <= last:
            raise ValidationError(
                f"شروع توالی باید بزرگ‌تر از آخرین شماره استفاده‌شده ({last}) باشد."
            )
    return result


def backfill_fingerprint(entity, data):
    records = EntityRecord.objects.filter(entity=entity)
    latest = records.aggregate(last=Max("updated_at"))["last"]
    return {
        "entity": str(entity.id),
        "count": records.count(),
        "last": latest.isoformat() if latest else None,
        "settings": data,
    }


def preview_backfill(entity, data):
    from types import SimpleNamespace

    settings = validate_settings(entity, data)
    rule = SimpleNamespace(**settings)
    rows = (
        EntityRecord.objects.filter(entity=entity)
        .select_related("subtype")
        .order_by("created_at", "id")
    )
    counters = {}
    sample = []
    for row in rows[:20]:
        key = str(row.subtype_id) if not settings["shared_sequence"] else "shared"
        counters[key] = counters.get(key, settings["start"] - 1) + 1
        sample.append(
            {
                "id": str(row.source_id or row.id),
                "number": render_number(rule, counters[key], row.subtype),
            }
        )
    fingerprint = backfill_fingerprint(entity, data)
    return {
        "count": fingerprint["count"],
        "sample": sample,
        "confirmation_token": signing.dumps(fingerprint, salt="crm-numbering-backfill"),
    }


@transaction.atomic
def create_numbering(entity, actor, data):
    Workspace.objects.select_for_update().get(id=entity.workspace_id)
    settings = validate_settings(entity, data)
    title, code = data.get("title"), data.get("field")
    import re

    if (
        not isinstance(title, str)
        or not title.strip()
        or len(title) > 255
        or not isinstance(code, str)
        or not re.fullmatch(r"[a-z][a-z0-9_-]{0,79}", code)
    ):
        raise ValidationError("عنوان و کد انگلیسی ستون شماره‌گذاری را وارد کنید.")
    if FieldDefinition.objects.filter(workspace=entity.workspace, code=code).exists():
        raise ValidationError("کد این فیلد قبلاً استفاده شده است.")
    if EntityRecord.objects.filter(entity=entity).exists():
        try:
            signed = signing.loads(
                data.get("confirmation_token", ""),
                salt="crm-numbering-backfill",
                max_age=900,
            )
        except (signing.BadSignature, TypeError):
            raise ValidationError(
                "ابتدا پیش‌نمایش شماره‌دهی رکوردهای قدیمی را بررسی و تأیید کنید."
            )
        comparable = {
            key: value
            for key, value in data.items()
            if key not in {"confirmation_token", "action"}
        }
        if signed != backfill_fingerprint(entity, comparable):
            raise ValidationError(
                "داده‌ها یا تنظیمات پس از پیش‌نمایش تغییر کرده‌اند؛ پیش‌نمایش را تازه کنید."
            )
    form = (
        FormLayout.objects.select_for_update(of=("self",))
        .filter(entity=entity)
        .select_related("published")
        .first()
    )
    if not form or not form.published_id:
        raise ValidationError("ابتدا فرم موجودیت را منتشر کنید.")
    field = FieldDefinition.objects.create(
        workspace=entity.workspace,
        code=code,
        title=title.strip(),
        kind="short_text",
        config={"readonly": True, "auto_number": True},
        show_in_summary=True,
    )
    rule = EntityNumberingRule.objects.create(entity=entity, field=field, **settings)
    before = deepcopy(form.published.schema)

    def attach(layout):
        layout = deepcopy(layout)
        layout.setdefault("sections", []).append(
            {
                "id": f"numbering-{rule.id}",
                "title": title.strip(),
                "columns": 1,
                "bindings": [{"field": code}],
            }
        )
        return layout

    published = attach(form.published.schema)
    form.draft = attach(form.draft)
    version = (form.versions.aggregate(last=Max("number"))["last"] or 0) + 1
    form.published = FormVersion.objects.create(
        layout=form,
        number=version,
        schema=published,
        change_note="افزودن ستون شماره‌گذاری",
    )
    form.revision += 1
    form.save()
    for row in (
        EntityRecord.objects.filter(entity=entity)
        .select_related("subtype")
        .order_by("created_at", "id")
        .iterator(chunk_size=500)
    ):
        assign_numbers(row)
    emit_definition(
        entity.workspace,
        actor,
        "definition.numbering.created",
        rule,
        after=rule_payload(rule),
    )
    emit_definition(
        entity.workspace, actor, "definition.form_published", form, before, published
    )
    return rule
