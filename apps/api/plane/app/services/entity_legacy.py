"""Apply the same published field policies to existing native record endpoints.

This adapter keeps old clients usable, including a custom_fields write envelope,
without creating another validation or custom-value implementation.
"""

import re

from django.db import transaction, ProgrammingError
from django.utils import timezone
from rest_framework.exceptions import ValidationError, PermissionDenied


def native_route(path, method=None):
    match = re.fullmatch(r"/api/(?:v1/)?workspaces/([^/]+)/(.*)", path)
    if not match:
        return None
    slug, tail = match.groups()
    membership = re.fullmatch(r"members/(?:([a-f0-9-]+)/)?", tail)
    if membership:
        return slug, "user", membership[1], None
    for pattern, adapter in (
        (r"projects/([a-f0-9-]+)/issues/(?:([a-f0-9-]+)/)?", "ticket"),
        (r"tasks/(?:([a-f0-9-]+)/)?", "ticket"),
        (r"organization/absences/(?:([a-f0-9-]+)/)?", "leave"),
        (r"projects/(?:([a-f0-9-]+)/|details/)?", "project"),
        (r"issues/", "ticket"),
        (r"organization/units/(?:([a-f0-9-]+)/)?", "unit"),
        (r"organization/users/([a-f0-9-]+)/", "user"),
    ):
        matched = re.fullmatch(pattern, tail)
        if matched:
            groups = matched.groups()
            return (
                slug,
                adapter,
                groups[-1] if groups else None,
                groups[0] if adapter == "ticket" and len(groups) == 2 else None,
            )
    return None


def native_entity(route):
    from plane.db.models import EntityType
    from .entity_schema import schema_request_cache

    cache = schema_request_cache.get()
    key = ("native-entity", route[0], route[1])
    if cache is not None and key in cache:
        return cache[key]
    try:
        with transaction.atomic():
            result = (
                EntityType.objects.select_related("workspace")
                .filter(workspace__slug=route[0], adapter=route[1], parent__isnull=True)
                .first()
            )
        if cache is not None:
            cache[key] = result
        return result
    except ProgrammingError as exc:
        # Source is bind-mounted during development, before the one-time migration.
        if getattr(exc.__cause__, "sqlstate", None) == "42P01":
            return None
        raise


def prepare_native_request(request):
    route = native_route(request.path, request.method)
    if not route:
        return
    entity = native_entity(route)
    if not entity:
        return
    from plane.db.models import EntityRecord, Workspace, EntityType, FieldDefinition
    from .entity_records import ADAPTERS, all_values, validate_values, base_native_rows
    from .entity_schema import schema_fields, role_ids, can_field

    if request.method in {"GET", "HEAD"}:
        _, fields = schema_fields(entity)
        roles = role_ids(request.user, entity.workspace)
        denied = {
            f["binding"].get("source")
            for f in fields.values()
            if not can_field(f, roles)
            or f["config"].get("hidden")
            or f["config"].get("visible_if")
        }
        denied.discard(None)
        if denied:
            query = request.query_params
            if (
                query.get("search")
                or any(query.get(key) for key in denied)
                or any(
                    any(source in str(query.get(key, "")) for source in denied)
                    for key in ("order_by", "group_by", "filters", "filter")
                )
            ):
                raise PermissionDenied(
                    "جستجو یا فیلتر روی فیلدی که مجوز مشاهده آن را ندارید مجاز نیست."
                )
        return
    if request.method not in {"POST", "PATCH", "PUT", "DELETE"}:
        return
    Workspace.objects.select_for_update().get(id=entity.workspace_id)
    entity = EntityType.objects.select_for_update().get(id=entity.id)
    identifier = route[2]
    membership_route = entity.adapter == "user" and "/members/" in request.path
    if membership_route and identifier:
        from plane.db.models import WorkspaceMember

        identifier = (
            WorkspaceMember.objects.filter(workspace=entity.workspace, id=identifier)
            .values_list("member_id", flat=True)
            .first()
        )
        if identifier is None:
            return  # Preserve the native missing-membership response.
    native = (
        base_native_rows(entity).filter(id=identifier).first() if identifier else None
    )
    if identifier and native is None:
        return  # Let the native endpoint preserve its existing missing-record response.
    sidecar = (
        EntityRecord.objects.filter(entity=entity, source_id=native.id)
        .select_related("subtype")
        .first()
        if native
        else None
    )
    subtype = sidecar.subtype if sidecar else None
    if entity.adapter == "ticket":
        from plane.db.models import IssueType
        from .entity_issue_types import sync_native_subtype

        supplied_type = (
            request.data.get("type", request.data.get("type_id"))
            if request.method not in {"GET", "HEAD"}
            else None
        )
        if supplied_type:
            from django.shortcuts import get_object_or_404
            from uuid import UUID

            try:
                supplied_type = UUID(str(supplied_type))
            except (ValueError, TypeError):
                raise ValidationError("شناسه نوع تیکت معتبر نیست.")

            subtype = sync_native_subtype(
                get_object_or_404(
                    IssueType,
                    workspace=entity.workspace,
                    id=supplied_type,
                    is_active=True,
                )
            )
        elif native and native.type_id and not subtype:
            subtype = sync_native_subtype(native.type)
    old = all_values(entity, sidecar, native, subtype)
    if request.method == "DELETE":
        from .entity_relations import before_delete

        before_delete(entity, native.id, request.user, request)
        from .entity_records import references_to

        if (
            native
            and next(references_to(entity, native.id), None)
            and request.query_params.get("confirm_relations") != "true"
        ):
            from rest_framework.exceptions import APIException

            exc = APIException(
                "این رکورد ارتباط فعال دارد؛ حذف به تأیید صریح نیاز دارد."
            )
            exc.status_code = 409
            raise exc
        request._engine_native_change = (
            entity,
            sidecar,
            native,
            old,
            {},
            None,
            subtype,
        )
        return
    _, fields = schema_fields(entity, subtype)
    list(
        FieldDefinition.objects.select_for_update()
        .filter(workspace=entity.workspace, code__in=fields)
        .order_by("code")
    )
    custom = request.data.get("custom_fields", {})
    if not isinstance(custom, dict):
        raise ValidationError(
            {"custom_fields": "مقادیر فیلدهای سفارشی باید یک شیء باشند."}
        )
    submitted = dict(custom)
    existing_identity = None
    if membership_route and request.method == "POST":
        from plane.db.models import User, OrganizationRole

        existing_identity = User.objects.filter(
            email__iexact=str(request.data.get("email", "")).strip()
        ).first()
        request._engine_invite_existing = bool(existing_identity)
    if membership_route and (request.method == "POST" or "role" in request.data):
        from plane.db.models import OrganizationRole

        default_role = OrganizationRole.objects.filter(
            workspace=entity.workspace,
            system_key=(
                "admin" if str(request.data.get("role", "15")) == "20" else "member"
            ),
        ).first()
    for code, field in fields.items():
        source = field["binding"].get("source")
        aliases = [source] if source else []
        if source == "work_status":
            aliases = ["state_id", "status"]
        if source and source.endswith("_id"):
            aliases.append(source[:-3])
        for alias in aliases:
            if alias in request.data:
                submitted[code] = request.data[alias]
                break
        if source == "assignee_ids" and "assignee_id" in request.data:
            submitted[code] = (
                [request.data["assignee_id"]] if request.data["assignee_id"] else []
            )
        if (
            membership_route
            and source == "role_ids"
            and source not in request.data
            and (request.method == "POST" or "role" in request.data)
        ):
            submitted[code] = [str(default_role.id)] if default_role else []
        if membership_route and request.method == "POST":
            if source == "display_name" and not submitted.get(code):
                submitted[code] = (
                    existing_identity.display_name if existing_identity else ""
                ) or str(request.data.get("email", "")).split("@")[0]
            elif source == "username" and source not in request.data:
                from uuid import uuid4

                submitted[code] = (
                    existing_identity.username
                    if existing_identity
                    else f"u-{uuid4().hex[:24]}"
                )
            elif source == "password" and existing_identity:
                submitted.pop(code, None)
        if source == "project_id" and route[3] and not native:
            submitted[code] = route[3]
    request._engine_record_id = str(native.id) if native else ""
    request._engine_sidecar_id = sidecar.id if sidecar else None
    values, fields = validate_values(
        entity, request.user, submitted, old, subtype, native is None, request
    )
    if native is None:
        for code, field in fields.items():
            source = field["binding"].get("source")
            if (
                source
                and source not in request.data
                and values.get(code) is not None
                and not source.endswith("_id")
                and not (membership_route and source == "role_ids")
            ):
                if hasattr(request.data, "_mutable"):
                    request.data._mutable = True
                destination = (
                    (
                        "state_id"
                        if route[3]
                        or request.data.get("project_id")
                        or native
                        and native.project_id
                        else "status"
                    )
                    if source == "work_status"
                    else source
                )
                request.data[destination] = values[code]
    request._engine_native_change = (
        entity,
        sidecar,
        native,
        old,
        values,
        fields,
        subtype,
    )


def finish_native_change(request, response):
    context = getattr(request, "_engine_native_change", None)
    if not context or response.status_code >= 400:
        return
    from plane.db.models import (
        EntityRecord,
        FieldDefinition,
        FormLayout,
        SystemIdentifierCounter,
        FileAsset,
    )
    from .entity_records import ADAPTERS, all_values, emit, base_native_rows

    entity, sidecar, previous, old, values, fields, subtype = context
    if request.method == "DELETE":
        from .entity_relations import before_delete

        before_delete(entity, previous.id, request.user, request, apply=True)
        if sidecar:
            sidecar.deleted_at = timezone.now()
            sidecar.save()
        emit(entity, request.user, "record.deleted", previous.id, before=old)
        return
    identifier = (
        previous.id
        if previous
        else (
            response.data.get("id")
            if isinstance(getattr(response, "data", None), dict)
            else None
        )
    )
    if entity.adapter == "user" and not previous and isinstance(response.data, dict):
        member = response.data.get("member")
        if isinstance(member, dict):
            identifier = member.get("id")
    if not identifier:
        return
    native = base_native_rows(entity).filter(id=identifier).first()
    if not native:
        return
    if sidecar is None:
        sidecar = EntityRecord.objects.filter(
            entity=entity, source_id=native.id
        ).first()
    custom = {
        key: value
        for key, value in values.items()
        if not fields.get(key, {}).get("binding", {}).get("source")
        and fields.get(key, {}).get("kind") != "computed"
        and not fields.get(key, {}).get("config", {}).get("auto_number")
    }
    if not sidecar:
        counter = SystemIdentifierCounter.locked(f"entity:{entity.id}", "default")
        form = FormLayout.objects.filter(entity=entity).first()
        from .entity_identifiers import format_record_number

        sequence = counter.advance()
        sidecar = EntityRecord(
            entity=entity,
            workspace=entity.workspace,
            source_id=native.id,
            subtype=subtype,
            number=format_record_number(entity, sequence),
            data=custom,
            form_version=form.published if form else None,
        )
        sidecar.save(created_by_id=request.user.id)
        from .entity_numbering import assign_numbers

        assign_numbers(sidecar)
    else:
        sidecar.data = {**sidecar.data, **custom}
        sidecar.subtype = subtype
        sidecar.revision += 1
        sidecar.save()
    if entity.adapter == "unit":
        sidecar.is_active = native.is_active
        sidecar.save(update_fields=["is_active", "updated_at"])
    elif entity.adapter == "user":
        from plane.db.models import WorkspaceMember

        sidecar.is_active = WorkspaceMember.objects.filter(
            workspace=entity.workspace, member=native, is_active=True
        ).exists()
        sidecar.save(update_fields=["is_active", "updated_at"])
    FieldDefinition.objects.filter(
        workspace=entity.workspace, code__in=fields, used_at__isnull=True
    ).update(used_at=timezone.now())
    actual = all_values(entity, sidecar, native)
    from .entity_relations import save_relation_links

    save_relation_links(entity, sidecar, request.user, actual, fields, request)
    for code, field in fields.items():
        if field["kind"] == "file" and actual.get(code):
            FileAsset.objects.filter(
                workspace=entity.workspace, id__in=actual[code], entity_type="CRM_FIELD"
            ).update(entity_identifier=str(native.id))
    emit(
        entity,
        request.user,
        "record.updated" if previous else "record.created",
        native.id,
        before=old if previous else None,
        after=actual,
    )
    if getattr(request, "_engine_unique_warnings", None) and isinstance(
        response.data, dict
    ):
        response.data["warnings"] = request._engine_unique_warnings
    for code, value in actual.items():
        if value != old.get(code):
            emit(
                entity,
                request.user,
                (
                    "record.status_changed"
                    if fields.get(code, {}).get("binding", {}).get("source")
                    in {"state_id", "status", "work_status"}
                    else "record.field_changed"
                ),
                native.id,
                code,
                old.get(code),
                value,
            )


def mask_native_response(request, response):
    route = native_route(request.path)
    if response.status_code >= 400 or not hasattr(response, "data"):
        return
    if not route:
        match = re.match(r"/api/(?:v1/)?workspaces/([^/]+)/", request.path)
        if not match or "/engine/" in request.path:
            return
        original = request.path
        try:
            for suffix in ("issues/", "tasks/", "projects/", "organization/absences/"):
                request.path = f"/api/workspaces/{match[1]}/{suffix}"
                mask_native_response(request, response)
        finally:
            request.path = original
        return
    entity = native_entity(route)
    if not entity:
        return
    from .entity_records import ADAPTERS, all_values, base_native_rows
    from .entity_schema import schema_fields, role_ids, can_field
    from .entity_rules import condition

    _, fields = schema_fields(entity)
    roles = role_ids(request.user, entity.workspace)
    guarded = [
        f
        for f in fields.values()
        if f["binding"].get("source")
        and (
            not can_field(f, roles, edit=True)
            or f["config"].get("hidden")
            or f["config"].get("readonly")
            or f["config"].get("editable_after_create") is False
            or f["config"].get("visible_if")
        )
    ]
    if not guarded:
        return
    aliases = {
        "name": {"name", "title"},
        "description_html": {
            "description_html",
            "description_json",
            "description_binary",
            "description_stripped",
            "description",
        },
        "state_id": {
            "state",
            "state_id",
            "state_detail",
            "state__group",
            "completed_at",
        },
        "work_status": {
            "state",
            "state_id",
            "state_detail",
            "state__group",
            "status",
            "completed_at",
        },
        "assignee_ids": {"assignee_ids", "assignees", "assignee_detail"},
        "assignee_id": {"assignee_id", "assignee", "assignee_detail"},
        "user_id": {"user", "user_id", "user_name"},
        "project_id": {"project_id", "project", "project_detail"},
        "project_lead_id": {"project_lead_id", "project_lead"},
    }
    objects = []

    def collect(data):
        if isinstance(data, list):
            for item in data:
                collect(item)
        elif isinstance(data, dict):
            if data.get("id"):
                objects.append(data)
            for value in list(data.values()):
                if isinstance(value, (dict, list)):
                    collect(value)

    collect(response.data)
    from uuid import UUID

    identifiers = []
    for item in objects:
        try:
            identifiers.append(UUID(str(item["id"])))
        except (ValueError, TypeError):
            pass
    natives = {
        str(row.id): row for row in base_native_rows(entity).filter(id__in=identifiers)
    }
    for item in objects:
        native = natives.get(str(item["id"]))
        if not native:
            continue
        values = all_values(entity, native=native)
        for field in guarded:
            if (
                not can_field(field, roles, edit=True)
                or field["config"].get("readonly")
                or field["config"].get("editable_after_create") is False
            ):
                item["engine_readonly_fields"] = list(
                    set(item.get("engine_readonly_fields", []))
                    | {field["binding"]["source"]}
                )
            if (
                not can_field(field, roles)
                or field["config"].get("hidden")
                or not condition(field["config"].get("visible_if"), values, fields)
            ):
                source = field["binding"]["source"]
                item["engine_hidden_fields"] = list(
                    set(item.get("engine_hidden_fields", [])) | {source}
                )
                for key in aliases.get(source, {source}):
                    item.pop(key, None)


def ensure_legacy_export_access(workspace, user):
    """The old fixed-column exporter cannot represent restricted field schemas."""
    from plane.db.models import EntityType
    from .entity_schema import schema_fields, role_ids, can_field
    from .access_control import has_permission

    if not has_permission(user, workspace, "Issue.View"):
        raise PermissionDenied("مجوز مشاهده کارها را ندارید.")
    entity = EntityType.objects.filter(
        workspace=workspace, adapter="ticket", parent__isnull=True
    ).first()
    if entity:
        _, fields = schema_fields(entity)
        roles = role_ids(user, workspace)
        if any(
            field["binding"].get("source")
            and (
                not can_field(field, roles)
                or field["config"].get("hidden")
                or field["config"].get("visible_if")
            )
            for field in fields.values()
        ):
            raise PermissionDenied(
                "خروجی قدیمی با محدودیت دسترسی فیلد سازگار نیست؛ دریافت این خروجی مجاز نیست."
            )


class EntityPolicyMixin:
    def dispatch(self, request, *args, **kwargs):
        from .entity_schema import schema_request_cache

        token = schema_request_cache.set(
            {} if request.method in {"GET", "HEAD"} else None
        )
        try:
            if request.method in {"POST", "PUT", "PATCH", "DELETE"} and native_route(
                request.path, request.method
            ):
                with transaction.atomic():
                    response = super().dispatch(request, *args, **kwargs)
                    if response.status_code >= 400:
                        transaction.set_rollback(True)
                    return response
            return super().dispatch(request, *args, **kwargs)
        finally:
            schema_request_cache.reset(token)

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        prepare_native_request(request)

    def finalize_response(self, request, response, *args, **kwargs):
        finish_native_change(request, response)
        mask_native_response(request, response)
        return super().finalize_response(request, response, *args, **kwargs)
