"""Definition APIs for Ticket 6; all changes have an actor and an audit snapshot."""

from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from plane.db.models import (
    EntityUniqueRule,
    Workspace,
    SurfaceConfiguration,
    EntityType,
    EntityRelation,
    FieldDefinition,
    EntityRecord,
)
from plane.app.services.entity_uniqueness import duplicates, maintain_rule_index
from plane.app.services.entity_records import emit_definition
from plane.app.services.entity_views import make_query, personal_view_limit
from .entity import EngineAPIView
from plane.app.services.entity_numbering import (
    rule_payload,
    validate_settings,
    preview_backfill,
    create_numbering,
)
from plane.app.services.entity_relations import (
    CARDINALITY,
    relation_payload,
    attach_field,
    sync_projection,
)
from uuid import uuid4
from django.db.models import Q


def unique_payload(rule):
    return {
        "id": str(rule.id),
        "title": rule.title,
        "fields": rule.fields,
        "mode": rule.mode,
        "is_active": rule.is_active,
        "existing_policy": rule.existing_policy,
    }


class EngineUniqueRulesEndpoint(EngineAPIView):
    def scope(self, request, slug, code):
        entity = self.entity(slug, code)
        self.require(request, entity.workspace, "UniqueRule.Manage")
        return entity

    def get(self, request, slug, code):
        entity = self.scope(request, slug, code)
        return Response(
            {"results": [unique_payload(rule) for rule in entity.unique_rules.all()]}
        )

    @transaction.atomic
    def post(self, request, slug, code, identifier=None):
        entity = self.scope(request, slug, code)
        Workspace.objects.select_for_update().get(id=entity.workspace_id)
        rule = (
            get_object_or_404(entity.unique_rules.select_for_update(), id=identifier)
            if identifier
            else None
        )
        before = unique_payload(rule) if rule else None
        fields = request.data.get("fields", rule.fields if rule else [])
        if (
            not isinstance(fields, list)
            or not 1 <= len(fields) <= 20
            or any(not isinstance(field, str) or "." in field for field in fields)
            or len(set(fields)) != len(fields)
        ):
            raise ValidationError(
                "گروه یکتا باید یک تا بیست ستون مستقل از همین موجودیت داشته باشد."
            )
        query = make_query(entity, request.user, {}, request)
        for code in fields:
            query.describe(code)
        title = request.data.get("title", rule.title if rule else "قاعده یکتایی")
        mode = request.data.get("mode", rule.mode if rule else "block")
        policy = request.data.get(
            "existing_policy", rule.existing_policy if rule else "resolve"
        )
        active = request.data.get("is_active", rule.is_active if rule else True)
        if (
            not isinstance(title, str)
            or not title.strip()
            or len(title) > 255
            or mode not in {"block", "warn"}
            or policy not in {"resolve", "new_only"}
            or not isinstance(active, bool)
        ):
            raise ValidationError("نام، روش اجرا یا سیاست رکوردهای موجود معتبر نیست.")
        conflicts = duplicates(entity, fields, query.fields) if active else []
        if conflicts and policy == "resolve":
            return Response(
                {
                    "detail": "رکوردهای تکراری موجود را ابتدا رفع کنید یا اعمال فقط برای رکوردهای جدید را انتخاب کنید.",
                    "duplicates": conflicts,
                    "choices": ["resolve", "new_only"],
                },
                status=409,
            )
        if not rule:
            rule = EntityUniqueRule(entity=entity, created_by=request.user)
        elif fields != rule.fields:
            maintain_rule_index(rule, query.fields, remove=True)
        rule.title, rule.fields, rule.mode, rule.existing_policy, rule.is_active = (
            title.strip(),
            fields,
            mode,
            policy,
            active,
        )
        rule.save()
        if not before or before["fields"] != fields:
            maintain_rule_index(rule, query.fields)
        emit_definition(
            entity.workspace,
            request.user,
            (
                "definition.unique_rule.updated"
                if before
                else "definition.unique_rule.created"
            ),
            rule,
            before,
            unique_payload(rule),
        )
        return Response(unique_payload(rule), status=200 if before else 201)

    def patch(self, request, slug, code, identifier):
        return self.post(request, slug, code, identifier)

    @transaction.atomic
    def delete(self, request, slug, code, identifier):
        entity = self.scope(request, slug, code)
        Workspace.objects.select_for_update().get(id=entity.workspace_id)
        rule = get_object_or_404(entity.unique_rules.select_for_update(), id=identifier)
        maintain_rule_index(rule, {}, remove=True)
        emit_definition(
            entity.workspace,
            request.user,
            "definition.unique_rule.deleted",
            rule,
            unique_payload(rule),
        )
        rule.delete()
        return Response(status=204)


class EngineSettingsEndpoint(EngineAPIView):
    def get(self, request, slug):
        workspace = self.workspace(slug)
        self.require(request, workspace, "View.Official.Manage")
        return Response({"personal_view_limit": personal_view_limit(workspace)})

    @transaction.atomic
    def put(self, request, slug):
        workspace = self.workspace(slug)
        self.require(request, workspace, "View.Official.Manage")
        Workspace.objects.select_for_update().get(id=workspace.id)
        limit = request.data.get("personal_view_limit")
        if type(limit) is not int or not 1 <= limit <= 1000:
            raise ValidationError("سقف جدول شخصی باید عددی بین یک و هزار باشد.")
        before = {"personal_view_limit": personal_view_limit(workspace)}
        row, _ = SurfaceConfiguration.objects.update_or_create(
            workspace=workspace,
            code="engine-settings",
            defaults={"definition": {"personal_view_limit": limit}},
        )
        emit_definition(
            workspace,
            request.user,
            "definition.engine_settings.updated",
            row,
            before,
            row.definition,
        )
        return Response(row.definition)


class EngineNumberingEndpoint(EngineAPIView):
    def scope(self, request, slug, code):
        entity = self.entity(slug, code)
        self.require(request, entity.workspace, "NumberingRule.Manage")
        return entity

    def get(self, request, slug, code):
        entity = self.scope(request, slug, code)
        return Response(
            {
                "results": [
                    rule_payload(rule)
                    for rule in entity.numbering_rules.select_related("field")
                ]
            }
        )

    @transaction.atomic
    def post(self, request, slug, code):
        entity = self.scope(request, slug, code)
        data = {key: value for key, value in request.data.items() if key != "action"}
        if request.data.get("action") == "preview":
            return Response(preview_backfill(entity, data))
        rule = create_numbering(entity, request.user, data)
        return Response(rule_payload(rule), status=201)

    @transaction.atomic
    def patch(self, request, slug, code, identifier):
        entity = self.scope(request, slug, code)
        Workspace.objects.select_for_update().get(id=entity.workspace_id)
        rule = get_object_or_404(
            entity.numbering_rules.select_for_update(), id=identifier
        )
        before = rule_payload(rule)
        for key, value in validate_settings(entity, request.data, rule).items():
            setattr(rule, key, value)
        rule.save()
        emit_definition(
            entity.workspace,
            request.user,
            "definition.numbering.updated",
            rule,
            before,
            rule_payload(rule),
        )
        return Response(rule_payload(rule))


class EngineRelationDefinitionsEndpoint(EngineAPIView):
    def get(self, request, slug):
        workspace = self.workspace(slug)
        self.require(request, workspace, "Relation.View")
        rows = EntityRelation.objects.filter(
            left_entity__workspace=workspace
        ).select_related("left_entity", "right_entity", "left_field", "right_field")
        return Response({"results": [relation_payload(row) for row in rows]})

    @transaction.atomic
    def post(self, request, slug, identifier=None):
        workspace = self.workspace(slug)
        self.require(
            request, workspace, "Relation.Edit" if identifier else "Relation.Create"
        )
        Workspace.objects.select_for_update().get(id=workspace.id)
        relation = (
            get_object_or_404(
                EntityRelation.objects.select_for_update(),
                id=identifier,
                left_entity__workspace=workspace,
            )
            if identifier
            else None
        )
        before = relation_payload(relation) if relation else None
        kind = request.data.get("kind", relation.kind if relation else "")
        on_delete = request.data.get(
            "on_delete", relation.on_delete if relation else "block"
        )
        required = {
            side: request.data.get(
                f"{side}_required",
                getattr(relation, f"{side}_required") if relation else False,
            )
            for side in ("left", "right")
        }
        if (
            kind not in CARDINALITY
            or on_delete not in {"block", "detach"}
            or any(type(value) is not bool for value in required.values())
        ):
            raise ValidationError("نوع، رفتار حذف یا وضعیت اجباری ارتباط معتبر نیست.")
        if (
            relation
            and relation.links.exists()
            and any(
                old and not new
                for old, new in zip(CARDINALITY[relation.kind], CARDINALITY[kind])
            )
        ):
            raise ValidationError("ارتباط دارای داده فقط به نوع آزادتر قابل تغییر است.")
        entities, titles = {}, {}
        for side in ("left", "right"):
            entities[side] = (
                getattr(relation, f"{side}_entity")
                if relation
                else get_object_or_404(
                    EntityType,
                    workspace=workspace,
                    code=request.data.get(f"{side}_entity"),
                    parent__isnull=True,
                )
            )
            titles[side] = request.data.get(
                f"{side}_title",
                getattr(relation, f"{side}_field").title if relation else "",
            )
            if (
                not isinstance(titles[side], str)
                or not titles[side].strip()
                or len(titles[side]) > 255
            ):
                raise ValidationError("نام هر دو سمت ارتباط الزامی است.")
        if not relation:
            relation = EntityRelation(
                id=uuid4(),
                left_entity=entities["left"],
                right_entity=entities["right"],
                kind=kind,
            )
        for index, side in enumerate(("left", "right")):
            target = entities["right" if side == "left" else "left"]
            field = getattr(relation, f"{side}_field", None) if before else None
            config = {
                "multiple": CARDINALITY[kind][index],
                "required": required[side],
                "relation_id": str(relation.id),
                "relation_side": side,
            }
            if field:
                field.title, field.config = titles[side].strip(), {
                    **field.config,
                    **config,
                }
                field.save()
            else:
                field = FieldDefinition.objects.create(
                    workspace=workspace,
                    code=f"rel_{relation.id.hex}_{side}",
                    title=titles[side].strip(),
                    kind="relation",
                    relation_entity=target,
                    config=config,
                )
                setattr(relation, f"{side}_field", field)
                attach_field(entities[side], field, request.user)
        relation.kind, relation.on_delete = kind, on_delete
        relation.left_required, relation.right_required = (
            required["left"],
            required["right"],
        )
        relation.save()
        if before and before["kind"] != kind:
            sync_projection(
                relation, "left", relation.links.values_list("left_id", flat=True)
            )
            sync_projection(
                relation, "right", relation.links.values_list("right_id", flat=True)
            )
        emit_definition(
            workspace,
            request.user,
            "definition.relation.updated" if before else "definition.relation.created",
            relation,
            before,
            relation_payload(relation),
        )
        return Response(relation_payload(relation), status=200 if before else 201)

    def patch(self, request, slug, identifier):
        return self.post(request, slug, identifier)

    @transaction.atomic
    def delete(self, request, slug, identifier):
        workspace = self.workspace(slug)
        self.require(request, workspace, "Relation.Delete")
        Workspace.objects.select_for_update().get(id=workspace.id)
        relation = get_object_or_404(
            EntityRelation.objects.select_for_update(),
            id=identifier,
            left_entity__workspace=workspace,
        )
        before = relation_payload(relation)
        if request.query_params.get("confirm") != "true":
            return Response(
                {
                    "detail": "حذف این ارتباط و جدا کردن پیوندها را تأیید کنید.",
                    "link_count": before["link_count"],
                },
                status=409,
            )
        identifiers = {
            side: list(relation.links.values_list(f"{side}_id", flat=True))
            for side in ("left", "right")
        }
        relation.links.all().delete()
        for side in ("left", "right"):
            sync_projection(relation, side, identifiers[side])
            field = getattr(relation, f"{side}_field")
            field.config = {
                key: value
                for key, value in field.config.items()
                if key not in {"relation_id", "required"}
            }
            field.is_active = False
            field.save()
        emit_definition(
            workspace, request.user, "definition.relation.deleted", relation, before
        )
        relation.delete()
        return Response(status=204)


class EngineLookupColumnEndpoint(EngineAPIView):
    @transaction.atomic
    def post(self, request, slug, code):
        entity = self.entity(slug, code)
        self.require(request, entity.workspace, "Relation.Edit")
        Workspace.objects.select_for_update().get(id=entity.workspace_id)
        from plane.app.services.entity_lookups import lookup_target

        path = request.data.get("path")
        target = lookup_target(entity, request.user, path, request)
        aggregation = request.data.get("aggregation", "single")
        if aggregation not in {"single", "count", "sum", "avg", "min", "max", "list"}:
            raise ValidationError("نوع تجمیع معتبر نیست.")
        if aggregation in {"sum", "avg"} and target["kind"] not in {
            "integer",
            "decimal",
            "money",
            "percent",
            "rating",
            "computed",
        }:
            raise ValidationError("جمع و میانگین فقط برای فیلد عددی قابل استفاده‌اند.")
        title = request.data.get("title")
        if not isinstance(title, str) or not title.strip() or len(title) > 255:
            raise ValidationError("عنوان فیلد خواندنی را وارد کنید.")
        config = {
            "readonly": True,
            "relation_lookup": {"path": path, "aggregation": aggregation},
        }
        kind = (
            "integer"
            if aggregation == "count"
            else (
                "decimal"
                if aggregation in {"sum", "avg"}
                else "short_text" if aggregation == "list" else target["kind"]
            )
        )
        if aggregation == "list":
            config["multiple"] = True
        field = FieldDefinition.objects.create(
            workspace=entity.workspace,
            code=f"lookup_{uuid4().hex}",
            title=title.strip(),
            kind=kind,
            config=config,
            lookup_id=(
                FieldDefinition.objects.filter(id=target["id"])
                .values_list("lookup_id", flat=True)
                .first()
                if kind in {"select", "multi_select"}
                else None
            ),
            relation_entity=(
                EntityType.objects.filter(
                    workspace=entity.workspace, code=target.get("relation_entity")
                ).first()
                if kind == "relation"
                else None
            ),
        )
        attach_field(entity, field, request.user)
        emit_definition(
            entity.workspace,
            request.user,
            "definition.lookup_column.created",
            field,
            after={"field": field.code, "title": field.title, "config": config},
        )
        return Response({"field": field.code, "title": field.title}, status=201)


class EngineRelatedRecordsEndpoint(EngineAPIView):
    def scope(self, request, slug, code, identifier, field_code):
        entity = self.entity(slug, code)
        self.require(request, entity.workspace, "Relation.View")
        from plane.app.services.entity_records import get_record, record_payload

        row, native = get_record(entity, request.user, identifier, request)
        query = make_query(
            entity,
            request.user,
            {"subtype": row.subtype.code if row and row.subtype else None},
            request,
        )
        field = query.describe(field_code)
        if field["kind"] != "relation":
            raise ValidationError("فیلد باید از نوع ارتباط باشد.")
        return entity, row, native, query, field

    def get(self, request, slug, code, identifier, field_code):
        entity, row, native, query, field = self.scope(
            request, slug, code, identifier, field_code
        )
        from plane.app.services.entity_query import default_definition
        from plane.app.services.entity_view_export import value_labels

        if not row:
            return Response(
                {
                    "results": [],
                    "count": 0,
                    "entity": field["relation_entity"],
                    "labels": {},
                    "fields": [],
                }
            )
        query.rows = query.rows.filter(id=row.id)
        child = query.child(field)
        from plane.app.services.entity_records import all_values

        values = all_values(entity, row, native).get(field_code)
        ids = values if isinstance(values, list) else [values] if values else []
        child.rows = child.rows.filter(
            **{"source_id__in" if child.entity.adapter else "id__in": ids}
        )
        definition = default_definition(child.entity, child.fields)
        child.prepare(definition)
        from .entity import page

        offset, size = page(request)
        result = child.execute(offset + 1, min(size, 30))
        result["labels"] = value_labels(child, result["results"])
        result["entity"] = child.entity.code
        result["fields"] = [
            {"code": f["code"], "title": f["title"], "kind": f["kind"]}
            for f in child.fields.values()
        ]
        return Response(result)

    @transaction.atomic
    def post(self, request, slug, code, identifier, field_code):
        entity, row, native, query, field = self.scope(
            request, slug, code, identifier, field_code
        )
        from plane.app.services.entity_records import all_values, save_record

        action = request.data.get("action")
        targets = request.data.get("targets", [request.data.get("target")])
        if (
            action not in {"attach", "detach"}
            or not isinstance(targets, list)
            or not 1 <= len(targets) <= 100
            or any(not isinstance(target, str) or not target for target in targets)
        ):
            raise ValidationError("رکورد و عملیات اتصال یا جدا کردن را مشخص کنید.")
        if not field["config"].get("multiple") and len(targets) > 1:
            raise ValidationError("در این سمت ارتباط فقط یک رکورد قابل انتخاب است.")
        old = all_values(entity, row, native).get(field_code)
        ids = list(old) if isinstance(old, list) else [old] if old else []
        if action == "attach":
            ids = list(dict.fromkeys([*ids, *targets]))
        else:
            ids = [item for item in ids if item not in targets]
        value = ids if field["config"].get("multiple") else (ids[-1] if ids else None)
        result = save_record(
            entity,
            request.user,
            {"revision": request.data.get("revision"), "values": {field_code: value}},
            request,
            identifier,
        )
        return Response(result)


class EngineFieldUsageEndpoint(EngineAPIView):
    def get(self, request, slug, identifier):
        workspace = self.workspace(slug)
        self.require(request, workspace, "Field.View")
        field = get_object_or_404(FieldDefinition, workspace=workspace, id=identifier)
        from plane.app.services.field_lifecycle import populated_count, assert_can_hide

        count = populated_count(field)
        locked = False
        try:
            assert_can_hide(field)
        except ValidationError:
            locked = True
        bound = (
            hasattr(field, "entitynumberingrule")
            or hasattr(field, "forward_relation")
            or hasattr(field, "reverse_relation")
        )
        return Response(
            {
                "count": count,
                "can_hide": not locked,
                "can_delete": not locked and not bound and count == 0,
                "message": (
                    f"این فیلد در {count} رکورد داده دارد؛ به‌جای حذف، آن را از فرم مخفی کنید"
                    if count
                    else (
                        "فیلد هسته‌ای یا وابسته قفل است."
                        if locked or bound
                        else "این فیلد بدون داده قابل حذف است."
                    )
                ),
            }
        )
