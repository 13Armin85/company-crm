"""Bidirectional relation metadata and atomic cardinality enforcement.

Indexed edges are authoritative. Record JSON contains a transactionally maintained
projection, so tables, filters, lookups and exports use the same SQL query layer.

A link may carry ``data`` described by ``EntityRelation.link_fields`` (the same
field-dict shape as FieldDefinition; values are normalized with the engine's
``normalize``). Clients send it as ``relation_data = {field_code: [{id, data}]}``
next to ``values``; ``values`` keeps the plain list of related ids.
"""

import hashlib
import json
import re
from copy import deepcopy
from uuid import UUID

from django.db.models import Count, Max, Q
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from plane.db.models import (
    EntityRecord,
    EntityRelation,
    EntityRelationLink,
    FormLayout,
    FormVersion,
    LookupValue,
)
from .access_control import has_permission
from .entity_records import emit_definition
from .entity_rules import empty, normalize

CARDINALITY = {
    "one_to_one": (False, False),
    "one_to_many": (True, False),
    "many_to_one": (False, True),
    "many_to_many": (True, True),
}
ON_DELETE = ("block", "detach", "soft_deactivate")
LINK_FIELD_KINDS = {"integer", "decimal", "short_text", "select"}
CYCLE_LIMIT = 5000


def fa_number(value):
    return str(value).translate(str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹"))


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
        "allow_duplicates": relation.allow_duplicates,
        "hierarchical": relation.hierarchical,
        "link_fields": relation.link_fields or [],
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


def other(direction):
    return "right" if direction == "left" else "left"


# ---------------------------------------------------------------- link data


def normalize_link_fields(workspace, raw):
    """Validate the definition of the fields stored on each link."""
    if raw is None:
        return []
    if not isinstance(raw, list) or len(raw) > 20:
        raise ValidationError("فیلدهای ارتباط باید فهرستی با حداکثر بیست فیلد باشد.")
    result, seen = [], set()
    for item in raw:
        if not isinstance(item, dict):
            raise ValidationError("تعریف فیلد ارتباط معتبر نیست.")
        code, title, kind = item.get("code"), item.get("title"), item.get("kind")
        if not isinstance(code, str) or not re.fullmatch(r"[a-z][a-z0-9_]{0,59}", code):
            raise ValidationError(
                "کد فیلد ارتباط باید با حرف انگلیسی کوچک شروع شود و فقط حرف، عدد و _ داشته باشد."
            )
        if code in seen:
            raise ValidationError("کد فیلدهای ارتباط نباید تکراری باشد.")
        seen.add(code)
        if not isinstance(title, str) or not title.strip() or len(title) > 255:
            raise ValidationError("عنوان هر فیلد ارتباط الزامی است.")
        if kind not in LINK_FIELD_KINDS:
            raise ValidationError(
                "نوع فیلد ارتباط فقط عدد صحیح، عدد اعشاری، متن کوتاه یا فهرست انتخابی است."
            )
        config = item.get("config") or {}
        required = bool(config.get("required", item.get("required", False)))
        clean = {"required": required}
        for key in ("min", "max"):
            if key in config and kind in {"integer", "decimal"}:
                if isinstance(config[key], bool) or not isinstance(
                    config[key], (int, float)
                ):
                    raise ValidationError("حداقل و حداکثر فیلد عددی باید عدد باشد.")
                clean[key] = config[key]
        lookup = item.get("lookup")
        if kind == "select":
            from plane.db.models import LookupCategory

            if not LookupCategory.objects.filter(
                workspace=workspace, code=lookup, is_active=True
            ).exists():
                raise ValidationError("برای فیلد انتخابی ارتباط، یک فهرست فعال انتخاب کنید.")
        else:
            lookup = None
        result.append(
            {
                "code": code,
                "title": title.strip(),
                "kind": kind,
                "lookup": lookup,
                "config": clean,
            }
        )
    return result


def normalize_link_data(relation, data):
    fields = relation.link_fields or []
    if data in (None, ""):
        data = {}
    if not isinstance(data, dict):
        raise ValidationError("داده ارتباط باید یک شیء باشد.")
    known = {field["code"]: field for field in fields}
    unknown = set(data) - set(known)
    if unknown:
        raise ValidationError("فیلد ناشناخته در داده ارتباط: " + "، ".join(sorted(unknown)))
    result = {}
    for code, field in known.items():
        value = data.get(code)
        if empty(value):
            if field["config"].get("required"):
                raise ValidationError(f"«{field['title']}» در ارتباط الزامی است.")
            continue
        if field["kind"] == "select":
            try:
                UUID(str(value))
            except ValueError:
                value = None
            if not isinstance(value, str) or not LookupValue.objects.filter(
                category__workspace=relation.left_entity.workspace,
                category__code=field["lookup"],
                is_active=True,
                id=value,
            ).exists():
                raise ValidationError(f"گزینه انتخاب‌شده برای «{field['title']}» معتبر نیست.")
            result[code] = value
            continue
        try:
            result[code] = normalize(
                {"kind": field["kind"], "config": field["config"]}, value
            )
        except ValidationError:
            raise ValidationError(f"مقدار «{field['title']}» معتبر نیست.")
    return result


def link_key(relation, data):
    if not relation.allow_duplicates or not data:
        return ""
    text = json.dumps(data, sort_keys=True, ensure_ascii=True, separators=(",", ":"))
    return hashlib.sha256(text.encode()).hexdigest()


def link_entries(relation, direction, identifier):
    opposite = other(direction)
    return [
        {"id": str(target), "data": data or {}}
        for target, data in relation.links.filter(**{f"{direction}_id": identifier})
        .order_by("created_at", "id")
        .values_list(f"{opposite}_id", "data")
    ]


def submitted_entries(request, code):
    """Entries for one field from ``relation_data`` or None when not submitted."""
    supplied = getattr(request, "_engine_relation_data", None)
    if supplied is None and request is not None:
        data = getattr(request, "data", None)
        supplied = data.get("relation_data") if hasattr(data, "get") else None
    if not isinstance(supplied, dict) or code not in supplied:
        return None
    raw = supplied[code]
    if not isinstance(raw, list) or len(raw) > 200:
        raise ValidationError({code: "داده ارتباط باید فهرستی با حداکثر دویست مورد باشد."})
    entries = []
    for item in raw:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str):
            raise ValidationError({code: "هر مورد داده ارتباط باید شناسه رکورد داشته باشد."})
        entries.append({"id": item["id"], "data": item.get("data") or {}})
    return entries


# ------------------------------------------------------------- projection


def sync_projection(relation, direction, identifiers):
    entity = getattr(relation, f"{direction}_entity")
    field = getattr(relation, f"{direction}_field")
    opposite = other(direction)
    multiple = CARDINALITY[relation.kind][0 if direction == "left" else 1]
    # Only the changed endpoints are touched; reading a table never walks records.
    for identifier in set(identifiers):
        linked = list(
            dict.fromkeys(
                map(
                    str,
                    relation.links.filter(**{f"{direction}_id": identifier})
                    .order_by(f"{opposite}_id")
                    .values_list(f"{opposite}_id", flat=True),
                )
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


# ------------------------------------------------------------- validation


def reaches(relation, start, goal, skip_left=None):
    """True when ``goal`` is reachable from ``start`` following left -> right edges."""
    seen, frontier = {str(start)}, [str(start)]
    while frontier and len(seen) < CYCLE_LIMIT:
        links = relation.links.filter(left_id__in=frontier)
        if skip_left:
            links = links.exclude(left_id=skip_left)
        frontier = []
        for target in map(str, links.values_list("right_id", flat=True)):
            if target == str(goal):
                return True
            if target not in seen:
                seen.add(target)
                frontier.append(target)
    return False


def validate_relation_values(
    entity, actor, values, old, fields, creating, request=None
):
    for code, field in fields.items():
        relation_id = field["config"].get("relation_id")
        if not relation_id:
            continue
        entries = submitted_entries(request, code)
        if values.get(code) == old.get(code) and entries is None:
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
            .select_related("left_field", "right_field", "left_entity", "right_entity")
            .get(id=relation_id)
        )
        direction = side(relation, field)
        opposite = other(direction)
        multiple = CARDINALITY[relation.kind][0 if direction == "left" else 1]
        reverse_multiple = CARDINALITY[relation.kind][1 if direction == "left" else 0]
        raw = values.get(code)
        identifiers = [
            str(item) for item in (raw if isinstance(raw, list) else [raw] if raw else [])
        ]
        if entries is not None:
            if {entry["id"] for entry in entries} != set(identifiers):
                raise ValidationError(
                    {code: "داده ارتباط باید دقیقاً برای رکوردهای انتخاب‌شده ارسال شود."}
                )
            keys = []
            for entry in entries:
                try:
                    entry["data"] = normalize_link_data(relation, entry["data"])
                except ValidationError as exc:
                    raise ValidationError({code: exc.detail})
                keys.append((entry["id"], json.dumps(entry["data"], sort_keys=True)))
            if len(keys) != len(set(keys)) or (
                not relation.allow_duplicates and len(entries) != len(set(identifiers))
            ):
                raise ValidationError(
                    {
                        code: "اتصال تکراری به یک رکورد فقط وقتی مجاز است که «امکان تکرار» روشن باشد و داده ارتباط متفاوت باشد."
                    }
                )
        if not multiple and len(identifiers) > 1:
            raise ValidationError({code: "این سمت ارتباط فقط یک رکورد می‌پذیرد."})
        current = getattr(request, "_engine_record_id", None)
        if entries is None and any(
            item["config"].get("required") for item in relation.link_fields or []
        ):
            linked = (
                set(
                    map(
                        str,
                        relation.links.filter(**{f"{direction}_id": current}).values_list(
                            f"{opposite}_id", flat=True
                        ),
                    )
                )
                if current
                else set()
            )
            if set(identifiers) - linked:
                raise ValidationError(
                    {code: "برای رکوردهای تازه‌وصل‌شده، فیلدهای اجباری ارتباط را تکمیل کنید."}
                )
        self_relation = relation.left_entity_id == relation.right_entity_id
        if self_relation and current and current in identifiers:
            raise ValidationError({code: "رکورد نمی‌تواند به خودش وصل شود."})
        if self_relation and relation.hierarchical and current:
            for target in identifiers:
                cyclic = (
                    reaches(relation, target, current, skip_left=current)
                    if direction == "left"
                    else reaches(relation, current, target)
                )
                if cyclic:
                    raise ValidationError(
                        {code: "این اتصال در ارتباط سلسله‌مراتبی چرخه ایجاد می‌کند."}
                    )
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
        if request is not None and entries is not None:
            store = getattr(request, "_engine_relation_clean", {})
            store[code] = entries
            request._engine_relation_clean = store


def save_relation_links(entity, record, actor, values, fields, request=None):
    identifier = record.source_id or record.id
    cleaned = getattr(request, "_engine_relation_clean", {}) if request else {}
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
        opposite = other(direction)
        raw = values.get(code)
        targets = [
            str(value)
            for value in (raw if isinstance(raw, list) else [raw] if raw else [])
        ]
        entries = cleaned.get(code)
        current = list(relation.links.filter(**{f"{direction}_id": identifier}))
        before = [
            {"id": str(getattr(link, f"{opposite}_id")), "data": link.data}
            for link in current
        ]
        if entries is None:
            # Ids only: keep the data of links that stay, new links start empty.
            kept = {str(getattr(link, f"{opposite}_id")) for link in current}
            entries = [
                {"id": str(getattr(link, f"{opposite}_id")), "data": link.data}
                for link in current
                if str(getattr(link, f"{opposite}_id")) in targets
            ] + [{"id": target, "data": {}} for target in targets if target not in kept]
        remaining = list(current)
        missing = []
        for entry in entries:
            match = next(
                (
                    link
                    for link in remaining
                    if str(getattr(link, f"{opposite}_id")) == entry["id"]
                    and link.data == entry["data"]
                ),
                None,
            )
            if match:
                remaining.remove(match)
            else:
                missing.append(entry)
        changed = set()
        for entry in list(missing):
            # Without duplicates a pair has one link: change its data in place.
            match = next(
                (
                    link
                    for link in remaining
                    if str(getattr(link, f"{opposite}_id")) == entry["id"]
                ),
                None,
            )
            if match and not relation.allow_duplicates:
                match.data = entry["data"]
                match.data_key = link_key(relation, entry["data"])
                match.save(update_fields=["data", "data_key", "updated_at"])
                remaining.remove(match)
                missing.remove(entry)
                changed.add(entry["id"])
        if remaining:
            EntityRelationLink.objects.filter(id__in=[link.id for link in remaining]).update(
                deleted_at=timezone.now()
            )
        for entry in missing:
            EntityRelationLink.objects.create(
                relation=relation,
                **{f"{direction}_id": identifier, f"{opposite}_id": entry["id"]},
                data=entry["data"],
                data_key=link_key(relation, entry["data"]),
                created_by=actor,
            )
        touched = (
            {str(getattr(link, f"{opposite}_id")) for link in remaining}
            | {entry["id"] for entry in missing}
            | changed
        )
        if not touched:
            continue
        sync_projection(relation, opposite, touched)
        emit_definition(
            entity.workspace,
            actor,
            "record.relation_changed",
            record,
            {code: before},
            {code: entries},
        )


# ----------------------------------------------------------------- delete


def before_delete(
    entity, identifier, actor, request=None, apply=False, preview=False, mode="delete"
):
    """Apply (or describe) each relation's delete rule for one record.

    Returns one impact per relation side with links. Unless ``preview`` is set a
    blocking rule raises. ``soft_deactivate`` keeps every link; the caller turns
    the delete into a deactivation instead.
    """
    impacts = []
    for relation in EntityRelation.objects.filter(
        Q(left_entity=entity) | Q(right_entity=entity)
    ).select_related("left_entity", "right_entity", "left_field", "right_field"):
        for direction in [
            key
            for key in ("left", "right")
            if getattr(relation, f"{key}_entity_id") == entity.id
        ]:
            links = relation.links.filter(**{f"{direction}_id": identifier})
            count = links.count()
            if not count:
                continue
            opposite = other(direction)
            behavior = relation.on_delete
            blocked = behavior == "block" or (
                behavior == "soft_deactivate" and bool(entity.adapter) and mode == "delete"
            )
            target_entity = getattr(relation, f"{opposite}_entity")
            impacts.append(
                {
                    "relation_id": str(relation.id),
                    "relation_title": getattr(relation, f"{direction}_field").title,
                    "opposite_entity": target_entity.code,
                    "opposite_entity_title": target_entity.title,
                    "link_count": count,
                    "behavior": behavior,
                    "blocked": blocked,
                }
            )
            if preview:
                continue
            if blocked:
                raise ValidationError(
                    "این رکورد ارتباط فعال دارد؛ طبق قانون ارتباط، حذف یا غیرفعال کردن آن مسدود است."
                    if behavior == "block"
                    else "رکورد جدول سیستمی قابل غیرفعال‌سازی نرم نیست؛ طبق قانون ارتباط، حذف آن مسدود است."
                )
            if apply and behavior == "detach":
                targets = list(links.values_list(f"{opposite}_id", flat=True))
                links.update(deleted_at=timezone.now())
                sync_projection(relation, opposite, targets)
    return impacts


# ------------------------------------------------------ definition changes


def records_without_links(relation, direction):
    entity = getattr(relation, f"{direction}_entity")
    linked = relation.links.values(f"{direction}_id")
    if entity.adapter:
        from .entity_records import base_native_rows

        return base_native_rows(entity).exclude(id__in=linked).count()
    return (
        EntityRecord.objects.filter(entity=entity, is_active=True)
        .exclude(id__in=linked)
        .count()
    )


def has_cycle(relation):
    edges = {}
    for left, right in relation.links.values_list("left_id", "right_id"):
        edges.setdefault(str(left), set()).add(str(right))
    state = {}
    for start in edges:
        if start in state:
            continue
        stack = [(start, iter(edges.get(start, ())))]
        state[start] = 1
        while stack:
            node, children = stack[-1]
            child = next(children, None)
            if child is None:
                state[node] = 2
                stack.pop()
            elif state.get(child) == 1:
                return True
            elif child not in state:
                state[child] = 1
                stack.append((child, iter(edges.get(child, ()))))
    return False


def definition_conflict(relation, kind, required, allow_duplicates, hierarchical, link_fields):
    """A Persian message naming the number of rows the new definition would break."""
    if not relation or not relation.pk:
        return None
    links = relation.links.all()
    for index, direction in enumerate(("left", "right")):
        if CARDINALITY[relation.kind][index] and not CARDINALITY[kind][index]:
            count = (
                links.values(f"{direction}_id")
                .annotate(total=Count(f"{other(direction)}_id", distinct=True))
                .filter(total__gt=1)
                .count()
            )
            if count:
                return (
                    f"تغییر نوع ارتباط ممکن نیست: {fa_number(count)} رکورد بیش از یک پیوند دارند "
                    "و با نوع جدید ناسازگارند. ابتدا پیوندهای اضافه را جدا کنید."
                )
    for direction in ("left", "right"):
        if required[direction] and not getattr(relation, f"{direction}_required"):
            count = records_without_links(relation, direction)
            if count:
                return (
                    f"اجباری کردن این سمت ممکن نیست: {fa_number(count)} رکورد هنوز پیوندی ندارند."
                )
    if relation.allow_duplicates and not allow_duplicates:
        count = (
            links.values("left_id", "right_id")
            .annotate(total=Count("id"))
            .filter(total__gt=1)
            .count()
        )
        if count:
            return f"خاموش کردن امکان تکرار ممکن نیست: {fa_number(count)} جفت رکورد بیش از یک پیوند دارند."
    old = {field["code"]: field for field in relation.link_fields or []}
    new = {field["code"]: field for field in link_fields}
    for code, field in old.items():
        changed = code not in new or new[code]["kind"] != field["kind"] or (
            new[code].get("lookup") != field.get("lookup")
        )
        if changed:
            count = links.filter(data__has_key=code).exclude(**{f"data__{code}": None}).count()
            if count:
                return (
                    f"حذف یا تغییر نوع فیلد ارتباط «{field['title']}» ممکن نیست: "
                    f"{fa_number(count)} پیوند برای آن داده دارند."
                )
    for code, field in new.items():
        if field["config"].get("required") and not (
            old.get(code, {}).get("config", {}).get("required")
        ):
            count = links.exclude(data__has_key=code).count() + links.filter(
                **{f"data__{code}": None}
            ).count()
            if count:
                return (
                    f"اجباری کردن فیلد ارتباط «{field['title']}» ممکن نیست: "
                    f"{fa_number(count)} پیوند مقدار ندارند."
                )
    if hierarchical and not relation.hierarchical and has_cycle(relation):
        return "سلسله‌مراتبی کردن ارتباط ممکن نیست: پیوندهای فعلی چرخه دارند."
    return None


def recompute_keys(relation):
    for link in relation.links.all():
        key = link_key(relation, link.data)
        if link.data_key != key:
            link.data_key = key
            link.save(update_fields=["data_key", "updated_at"])
