"""One record contract for configured entities and adapters to existing Plane models."""

import json
from datetime import datetime
from uuid import UUID

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import ValidationError, PermissionDenied

from .entity_identifiers import format_record_number

from plane.db.models import (
    EntityRecord,
    EntityEvent,
    EntityType,
    FieldDefinition,
    FormLayout,
    LookupValue,
    Project,
    ProjectMember,
    Issue,
    State,
    WorkspaceTask,
    UserAbsence,
    User,
    OrganizationRole,
    OrganizationUnit,
    FileAsset,
    SystemIdentifierCounter,
    APIActivityLog,
    Workspace,
)
from .access_control import has_permission, can_manage_absence
from .project_visibility import visible_projects
from .task_visibility import visible_issues
from .task_policy import validate_other_assignees, validate_creation_assignees
from .entity_schema import schema_fields, role_ids, can_field
from .entity_rules import empty, normalize, condition, compute, formula_fields
from .entity_directory import native_value

ADAPTERS = {
    "ticket": Issue,
    "task": WorkspaceTask,
    "project": Project,
    "leave": UserAbsence,
    "user": User,
    "unit": OrganizationUnit,
}


def base_native_rows(entity, include_deleted=False):
    if entity.adapter in {"user", "unit"}:
        from .entity_directory import directory_rows

        return directory_rows(entity)
    model = ADAPTERS[entity.adapter]
    return (model.all_objects if include_deleted else model.objects).filter(
        workspace=entity.workspace
    )


def json_value(value):
    return json.loads(json.dumps(value, cls=DjangoJSONEncoder))


def permission(entity, user, action, request=None):
    code = entity.record_permissions.get(action)
    return bool(code and has_permission(user, entity.workspace, code, request=request))


def require_action(entity, user, action, request=None):
    if not permission(entity, user, action, request):
        raise PermissionDenied("مجوز انجام این عملیات روی رکورد را ندارید.")


def field_edit_action(entity, field):
    source = field.get("binding", {}).get("source")
    if entity.adapter in {"task", "ticket"}:
        if source in {"status", "state_id", "work_status"}:
            return "status"
        if source in {"assignee_id", "assignee_ids"}:
            return "assign"
    return "edit"


def edit_grants(entity, user, request=None):
    return {
        "edit": permission(entity, user, "edit", request),
        "assign": entity.adapter in {"task", "ticket"}
        and has_permission(user, entity.workspace, "Issue.Assign", request=request),
        "status": entity.adapter in {"task", "ticket"}
        and has_permission(
            user, entity.workspace, "Issue.Status.Edit", request=request
        ),
    }


def record_edit_actions(entity, user, native=None, request=None):
    grants = edit_grants(entity, user, request)
    if native is not None and entity.adapter == "leave":
        grants["edit"] = grants["edit"] and can_manage_absence(
            user, native.user, entity.workspace, "Absence.Edit", request=request
        )
    if grants["edit"] or native is None or entity.adapter not in {"task", "ticket"}:
        return grants
    assigned = (
        native.assignee_id == user.id
        if entity.adapter == "task"
        else native.issue_assignee.filter(
            assignee=user, deleted_at__isnull=True
        ).exists()
    )
    manager = False
    if entity.adapter == "ticket" and grants["assign"]:
        from .project_assignment import is_project_assignment_manager

        manager = is_project_assignment_manager(
            user, entity.workspace.slug, native.project_id
        )
    return {
        "edit": False,
        "assign": grants["assign"] and (assigned or manager),
        "status": grants["status"] and assigned,
    }


def native_queryset(entity, user, request=None):
    rows = base_native_rows(entity)
    if entity.adapter in {"user", "unit"}:
        return rows
    if entity.adapter == "project":
        return visible_projects(rows, user, entity.workspace.slug)
    if entity.adapter == "ticket":
        return visible_issues(rows, user, entity.workspace.slug, request=request)
    if not permission(entity, user, "view_all", request):
        if entity.adapter == "task":
            rows = rows.filter(Q(assignee=user) | Q(created_by=user))
        else:
            manageable = [
                u.id
                for u in User.objects.filter(
                    member_workspace__workspace=entity.workspace,
                    member_workspace__is_active=True,
                    member_workspace__deleted_at__isnull=True,
                )
                if u.id == user.id
                or can_manage_absence(
                    user, u, entity.workspace, "Absence.View", request=request
                )
            ]
            rows = rows.filter(user_id__in=manageable)
    return rows


def record_queryset(entity, user, request=None):
    rows = EntityRecord.objects.filter(entity=entity, workspace=entity.workspace)
    if entity.adapter:
        return rows.filter(
            source_id__in=native_queryset(entity, user, request).values("id")
        )
    if not permission(entity, user, "view_all", request):
        rows = rows.filter(created_by=user)
    return rows


def get_record(entity, user, identifier, request=None, lock=False):
    require_action(entity, user, "view", request)
    if entity.adapter:
        native = get_object_or_404(
            native_queryset(entity, user, request), id=identifier
        )
        row = EntityRecord.objects.filter(entity=entity, source_id=native.id).first()
    else:
        rows = record_queryset(entity, user, request)
        if lock:
            rows = rows.select_for_update()
        row = get_object_or_404(rows, id=identifier)
        native = None
    return row, native


def all_values(entity, row=None, native=None, subtype=None):
    _, fields = schema_fields(entity, subtype or (row.subtype if row else None))
    values = dict(row.data) if row else {}
    if native:
        for code, field in fields.items():
            source = field["binding"].get("source")
            if source:
                values[code] = (
                    list(
                        map(
                            str,
                            native.issue_assignee.filter(
                                deleted_at__isnull=True
                            ).values_list("assignee_id", flat=True),
                        )
                    )
                    if source == "assignee_ids"
                    else json_value(native_value(entity, native, source))
                )
    return values


def record_payload(entity, user, row=None, native=None, request=None):
    subtype = row.subtype if row else None
    values = all_values(entity, row, native)
    _, fields = schema_fields(entity, subtype)
    values = compute(fields, values, strict=False)
    from .entity_lookups import lookup_allowed

    fields = {
        code: field
        for code, field in fields.items()
        if lookup_allowed(entity, user, field, request)
    }
    lookup_fields = [
        code for code, field in fields.items() if field["config"].get("relation_lookup")
    ]
    if row and lookup_fields:
        from .entity_query import EntityQuery

        query = EntityQuery(entity, user, request, subtype)
        query.rows = query.rows.filter(id=row.id)
        query.prepare(
            {
                "version": 1,
                "columns": [{"field": code, "width": 180} for code in lookup_fields],
            }
        )
        records = query.execute(1, 1)["results"]
        if records:
            values.update(records[0]["values"])
    roles = role_ids(user, entity.workspace)
    actions = record_edit_actions(entity, user, native, request)
    readable = {
        code
        for code, f in fields.items()
        if can_field(f, roles)
        and not f["config"].get("hidden")
        and not f["config"].get("secret")
        and condition(f["config"].get("visible_if"), values, fields)
    }
    permitted = {}
    for code, field in fields.items():
        config = field["config"]
        if (
            code not in readable
            or config.get("hidden")
            or not condition(config.get("visible_if"), values, fields)
        ):
            continue
        if config.get("formula") and not formula_fields(config["formula"]).issubset(
            readable
        ):
            continue
        if field["binding"].get("stage") and field["binding"]["stage"] != str(
            values.get("task_status") or values.get("ticket_state") or ""
        ):
            continue
        value = values.get(code)
        if field["kind"] == "relation" and value:
            target = EntityType.objects.filter(
                workspace=entity.workspace, code=field["relation_entity"]
            ).first()
            identifiers = value if isinstance(value, list) else [value]
            allowed = set()
            if target and permission(target, user, "view", request):
                targets = (
                    native_queryset(target, user, request)
                    if target.adapter
                    else record_queryset(target, user, request)
                )
                allowed = set(
                    map(
                        str,
                        targets.filter(id__in=identifiers).values_list("id", flat=True),
                    )
                )
            value = (
                [item for item in identifiers if item in allowed]
                if isinstance(value, list)
                else value if value in allowed else None
            )
        permitted[code] = value
    identifier = str(native.id if native else row.id)
    title = permitted.get(entity.title_field)
    if not isinstance(title, str) or not title:
        title = "رکورد"
    number = (
        row.number
        if row
        else (
            native.identifier
            if entity.adapter == "project"
            else str(getattr(native, "sequence_id", ""))
        )
    )
    return {
        "id": identifier,
        "entity": entity.code,
        "subtype": subtype.code if subtype else None,
        "title": title,
        "number": number,
        "values": permitted,
        "revision": row.revision if row else 0,
        "is_active": row.is_active if row else True,
        "created_at": json_value((native or row).created_at),
        "updated_at": json_value((native or row).updated_at),
        "can_edit": any(
            code in permitted
            and can_field(field, roles, edit=True)
            and not field["config"].get("readonly")
            and field["config"].get("editable_after_create") is not False
            and field["kind"] != "computed"
            and actions[field_edit_action(entity, field)]
            for code, field in fields.items()
        ),
        "can_deactivate": actions["edit"],
        "can_delete": permission(entity, user, "delete", request),
        "native_url": (
            f"/projects/{identifier}" if entity.adapter == "project" else None
        ),
    }


def emit(
    entity,
    actor,
    event_type,
    record_id=None,
    field="",
    before=None,
    after=None,
    metadata=None,
):
    """Persist event and its audit receipt in the caller's transaction; no external side effects."""
    event = EntityEvent(
        workspace=entity.workspace,
        entity=entity,
        record_id=record_id,
        event_type=event_type,
        field=field,
        before=json_value(before),
        after=json_value(after),
        metadata=metadata or {},
        created_by_id=actor.id,
    )
    event.save(created_by_id=actor.id)
    APIActivityLog.objects.create(
        token_identifier=f"crm:{entity.workspace_id}:{actor.id}",
        path="/engine/",
        method="EVENT",
        response_code=200,
        body=json.dumps(
            {
                "action": event_type,
                "event_id": str(event.id),
                "entity": entity.code,
                "object_id": str(record_id or entity.id),
            }
        ),
        created_by_id=actor.id,
    )
    return event


def emit_definition(workspace, actor, event_type, row, before=None, after=None):
    event = EntityEvent(
        workspace=workspace,
        event_type=event_type,
        before=json_value(before),
        after=json_value(after),
        metadata={
            "definition_type": row._meta.model_name,
            "definition_id": str(row.id),
        },
    )
    event.save(created_by_id=actor.id)
    APIActivityLog.objects.create(
        token_identifier=f"crm:{workspace.id}:{actor.id}",
        path="/engine/",
        method="EVENT",
        response_code=200,
        body=json.dumps(
            {"action": event_type, "event_id": str(event.id), "object_id": str(row.id)}
        ),
        created_by_id=actor.id,
    )
    return event


def default_value(field, user):
    config = field["config"]
    dynamic = config.get("default_dynamic")
    if isinstance(config.get("default"), dict) and "dynamic" in config["default"]:
        dynamic = config["default"]["dynamic"]
    if dynamic == "today":
        if field["kind"] == "datetime":
            return (
                timezone.localtime()
                .replace(hour=0, minute=0, second=0, microsecond=0)
                .isoformat()
            )
        if field["kind"] == "date_range":
            return {
                "start": timezone.localdate().isoformat(),
                "end": timezone.localdate().isoformat(),
            }
        return timezone.localdate().isoformat()
    if dynamic == "now":
        return timezone.now().isoformat()
    if dynamic == "current_user":
        return [str(user.id)] if config.get("multiple") else str(user.id)
    if "default" in config:
        return config["default"]
    if field.get("lookup"):
        option = LookupValue.objects.filter(
            category__workspace=user._engine_workspace,
            category__code=field["lookup"],
            is_default=True,
            is_active=True,
        ).first()
        if option:
            return option.code if config.get("lookup_codes") else str(option.id)
    return None


def validate_reference(
    entity, user, field, value, values, old_value=None, request=None
):
    if empty(value):
        return
    if value == old_value and not field["config"].get("depends_on"):
        return  # Preserve historical references without granting permission to select them anew.
    kind, config = field["kind"], field["config"]
    many = isinstance(value, list)
    identifiers = value if many else [value]
    if kind in {"select", "multi_select"}:
        if config.get("provider") in {"project_states", "work_states"}:
            project = values.get(config.get("depends_on", "project"))
            if not project and config.get("provider") == "work_states":
                if not LookupValue.objects.filter(
                    category__workspace=entity.workspace,
                    category__code="task-status",
                    code=value,
                    is_active=True,
                ).exists():
                    raise ValidationError(
                        "وضعیت انتخاب‌شده در فهرست وضعیت کارها فعال نیست."
                    )
                return
            projects = visible_projects(
                Project.objects.filter(workspace=entity.workspace),
                user,
                entity.workspace.slug,
            )
            if (
                not projects.filter(id=project).exists()
                or not State.objects.filter(project_id=project, id=value).exists()
            ):
                raise ValidationError("وضعیت باید متعلق به پروژه مجاز انتخاب‌شده باشد.")
            return
        options = LookupValue.objects.filter(
            category__workspace=entity.workspace, category__code=field["lookup"]
        )
        options = (
            options.filter(code__in=identifiers)
            if config.get("lookup_codes")
            else options.filter(id__in=identifiers)
        )
        options = list(options.select_related("category"))
        if len(options) != len(identifiers):
            raise ValidationError("مقدار انتخابی در این لیست وجود ندارد.")
        old = old_value if isinstance(old_value, list) else [old_value]
        for option in options:
            key = option.code if config.get("lookup_codes") else str(option.id)
            if (
                not option.is_active or not option.category.is_active
            ) and key not in old:
                raise ValidationError("مقدار غیرفعال برای انتخاب جدید مجاز نیست.")
            if config.get("depends_on"):
                parent = values.get(config["depends_on"])
                parent_field = FieldDefinition.objects.filter(
                    workspace=entity.workspace, code=config["depends_on"]
                ).first()
                if parent_field and parent_field.config.get("lookup_codes"):
                    parent = (
                        LookupValue.objects.filter(
                            category_id=parent_field.lookup_id, code=parent
                        )
                        .values_list("id", flat=True)
                        .first()
                    )
                if option.parent_id and str(option.parent_id) != str(parent):
                    raise ValidationError("مقدار انتخابی با والد این لیست سازگار نیست.")
    elif kind in {"user", "unit", "role", "relation", "file"}:
        try:
            for identifier in identifiers:
                UUID(str(identifier))
        except (TypeError, ValueError):
            raise ValidationError("شناسه انتخاب معتبر نیست.")
        if kind == "relation":
            target = get_object_or_404(
                EntityType,
                workspace=entity.workspace,
                code=field["relation_entity"],
                parent__isnull=True,
            )
            require_action(target, user, "view", request)
            rows = (
                native_queryset(target, user, request)
                if target.adapter
                else record_queryset(target, user, request)
            )
        elif kind == "user":
            rows = User.objects.filter(
                is_active=True,
                member_workspace__workspace=entity.workspace,
                member_workspace__is_active=True,
                member_workspace__deleted_at__isnull=True,
            )
        elif kind == "unit":
            rows = OrganizationUnit.objects.filter(
                workspace=entity.workspace, is_active=True
            )
        elif kind == "role":
            rows = OrganizationRole.objects.filter(
                workspace=entity.workspace, is_active=True
            )
        else:
            defaults = (
                config.get("default") if isinstance(config.get("default"), list) else []
            )
            normal = FileAsset.objects.filter(
                workspace=entity.workspace,
                is_uploaded=True,
                entity_type="CRM_FIELD",
                attributes__field=field["code"],
                attributes__entity=entity.code,
            )
            normal = normal.filter(
                Q(user=user, entity_identifier="")
                | Q(entity_identifier=str(getattr(request, "_engine_record_id", "")))
            )
            rows = FileAsset.objects.filter(
                Q(id__in=normal.values("id"))
                | Q(
                    workspace=entity.workspace,
                    entity_type="CRM_FIELD_DEFAULT",
                    attributes__field=field["code"],
                    id__in=defaults,
                    is_uploaded=True,
                )
            )
        if rows.filter(id__in=identifiers).distinct().count() != len(identifiers):
            raise ValidationError(
                "انتخاب متعلق به این فضای کاری یا دامنه مجاز شما نیست."
            )
        if kind == "file":
            from .entity_files import validate_file

            for asset in rows.filter(id__in=identifiers):
                validate_file(
                    config, asset.attributes.get("name", asset.asset.name), asset.size
                )


def validate_values(
    entity,
    user,
    submitted,
    old=None,
    subtype=None,
    creating=True,
    request=None,
    stage="",
):
    if not isinstance(submitted, dict) or len(submitted) > 300:
        raise ValidationError("مقادیر فرم باید یک شیء با حداکثر سیصد فیلد باشند.")
    _, fields = schema_fields(entity, subtype)
    unknown = set(submitted) - set(fields)
    if unknown:
        raise ValidationError(
            {code: "این فیلد به فرم منتشرشده متصل نیست." for code in unknown}
        )
    roles, values, old = role_ids(user, entity.workspace), dict(old or {}), old or {}
    user._engine_workspace = entity.workspace
    if creating:
        for code, field in fields.items():
            if (
                field["is_active"]
                and not field["hidden_from_form"]
                and code not in submitted
                and field["kind"] != "computed"
            ):
                default = default_value(field, user)
                default_field = (
                    {**field, "kind": "multi_select"}
                    if field["kind"] in {"user", "unit", "role"}
                    and field["config"].get("multiple")
                    else field
                )
                values[code] = normalize(default_field, default)
    for code, value in submitted.items():
        field, config = fields[code], fields[code]["config"]
        if not creating and config.get("secret"):
            raise PermissionDenied(
                {code: "برای تغییر رمز عبور از عملیات اختصاصی تغییر رمز استفاده کنید."}
            )
        if field["hidden_from_form"]:
            raise PermissionDenied(
                {code: "این فیلد از فرم مخفی شده و مقدار جدید نمی‌پذیرد."}
            )
        if (
            not can_field(field, roles, edit=True)
            or config.get("readonly")
            or field["kind"] == "computed"
        ):
            raise PermissionDenied({code: "اجازه ویرایش این فیلد را ندارید."})
        if not field["is_active"] and value != old.get(code):
            raise ValidationError({code: "فیلد غیرفعال قابل تغییر نیست."})
        if (
            not creating
            and config.get("editable_after_create") is False
            and value != old.get(code)
        ):
            raise ValidationError({code: "این فیلد پس از ثبت قابل ویرایش نیست."})
        try:
            normalized_field = field
            if field["kind"] in {"user", "unit", "role"} and config.get("multiple"):
                normalized_field = {**field, "kind": "multi_select"}
            values[code] = normalize(normalized_field, value)
        except ValidationError as exc:
            raise ValidationError({code: exc.detail})
    if creating and entity.adapter == "ticket":
        project_code = next(
            (
                key
                for key, field in fields.items()
                if field["binding"].get("source") == "project_id"
            ),
            None,
        )
        try:
            project_id = UUID(str(values.get(project_code))) if project_code else None
        except (ValueError, TypeError):
            project_id = None
        project = (
            Project.objects.filter(workspace=entity.workspace, id=project_id).first()
            if project_id
            else None
        )
        if project:
            for code, field in fields.items():
                if field["binding"].get("source") in {
                    "state_id",
                    "work_status",
                } and empty(values.get(code)):
                    state = (
                        State.objects.filter(project=project, default=True).first()
                        or State.objects.filter(project=project).first()
                    )
                    values[code] = str(state.id) if state else None
                if (
                    field["binding"].get("source") == "assignee_ids"
                    and empty(values.get(code))
                    and project.default_assignee_id
                    and not (request and request.data.get("routing_rule_id"))
                    and ProjectMember.objects.filter(
                        project=project,
                        member_id=project.default_assignee_id,
                        is_active=True,
                        role__gte=15,
                    ).exists()
                ):
                    values[code] = [str(project.default_assignee_id)]
        else:
            for code, field in fields.items():
                if field["binding"].get("source") == "work_status" and empty(
                    values.get(code)
                ):
                    state = (
                        LookupValue.objects.filter(
                            category__workspace=entity.workspace,
                            category__code="task-status",
                            is_active=True,
                        )
                        .order_by("-is_default", "position", "id")
                        .first()
                    )
                    values[code] = state.code if state else None
    values = compute(fields, values)
    for code, field in fields.items():
        config, value = field["config"], values.get(code)
        current_stage = stage or str(
            values.get("task_status") or values.get("ticket_state") or ""
        )
        hidden = (
            config.get("hidden", False)
            or config.get("secret")
            and (
                not creating
                or bool(request and getattr(request, "_engine_invite_existing", False))
            )
            or field["hidden_from_form"]
            or not condition(config.get("visible_if"), values, fields)
            or field["binding"].get("stage")
            and field["binding"]["stage"] != current_stage
        )
        if code in submitted and hidden and values.get(code) != old.get(code):
            raise PermissionDenied(
                {code: "این فیلد در وضعیت فعلی فرم قابل ویرایش نیست."}
            )
        if not field["is_active"]:
            continue
        required = config.get("required", False) or bool(
            config.get("required_if")
            and condition(config["required_if"], values, fields)
        )
        if required and not hidden and empty(value):
            if can_field(field, roles):
                raise ValidationError({code: "تکمیل این فیلد الزامی است."})
            raise ValidationError(
                "یک فیلد الزامی خارج از دسترسی شماست؛ تنظیمات فرم باید توسط مدیر اصلاح شود."
            )
        if not empty(value):
            try:
                validate_reference(
                    entity, user, field, value, values, old.get(code), request
                )
            except (ValueError, DjangoValidationError):
                raise ValidationError({code: "شناسه یا مقدار انتخابی معتبر نیست."})
            except ValidationError as exc:
                raise ValidationError({code: exc.detail})
    from .entity_uniqueness import check_unique

    warnings = check_unique(entity, user, values, old, fields, creating, request)
    from .entity_relations import validate_relation_values

    validate_relation_values(entity, user, values, old, fields, creating, request)
    if request is not None:
        request._engine_unique_warnings = warnings
    return values, fields


def save_native(
    entity,
    user,
    values,
    fields,
    native=None,
    request=None,
    subtype=None,
    routing_rule=None,
):
    adapter = entity.adapter
    data = {
        field["binding"]["source"]: values.get(code)
        for code, field in fields.items()
        if field["binding"].get("source")
    }
    if adapter in {"user", "unit"}:
        from .entity_directory import save_directory

        if native and request:
            submitted = request.data.get("values", {})
            data = {
                field["binding"]["source"]: values.get(code)
                for code, field in fields.items()
                if code in submitted and field["binding"].get("source")
            }
        return save_directory(entity, user, data, native, request)
    from django.db import models

    for name, value in list(data.items()):
        model_field = next(
            (item for item in ADAPTERS[adapter]._meta.fields if item.attname == name),
            None,
        )
        if value is None and model_field is not None and not model_field.null:
            if (
                isinstance(model_field, (models.CharField, models.TextField))
                and model_field.blank
            ):
                data[name] = ""
            elif model_field.has_default():
                data[name] = model_field.get_default()
    creating = native is None
    if adapter == "ticket":
        data["assignee_ids"] = data.get("assignee_ids") or []
        if "work_status" in data:
            selected_status = data.pop("work_status")
            if data.get("project_id") or native and native.project_id:
                data["state_id"] = selected_status
            else:
                data["status"] = selected_status or "todo"
    if adapter in {"ticket", "task"}:
        recipients = data.get(
            "assignee_ids", [data.get("assignee_id")] if data.get("assignee_id") else []
        )
        previous_recipients = (
            list(
                map(
                    str,
                    native.issue_assignee.filter(deleted_at__isnull=True).values_list(
                        "assignee_id", flat=True
                    ),
                )
            )
            if native and adapter == "ticket"
            else [str(native.assignee_id)] if native else []
        )
        if creating or sorted(recipients) != sorted(previous_recipients):
            validate_other_assignees(user, entity.workspace.slug, recipients)
            if not creating and not has_permission(
                user, entity.workspace, "Issue.Assign", request=request
            ):
                raise PermissionDenied("مجوز تغییر مسئول را ندارید.")
            if not creating and adapter == "ticket" and native.project_id:
                from .project_assignment import validate_project_transfer

                validate_project_transfer(
                    entity.workspace.slug, native.project_id, recipients
                )
        status_key = (
            "state_id"
            if adapter == "ticket"
            and (data.get("project_id") or native and native.project_id)
            else "status"
        )
        if (
            not creating
            and str(data.get(status_key) or "")
            != str(getattr(native, status_key) or "")
            and not has_permission(
                user, entity.workspace, "Issue.Status.Edit", request=request
            )
        ):
            raise PermissionDenied("مجوز تغییر وضعیت را ندارید.")
        if creating:
            validate_creation_assignees(
                user,
                entity.workspace.slug,
                {
                    **data,
                    **(
                        {"routing_rule_id": str(routing_rule.id)}
                        if routing_rule
                        else {}
                    ),
                },
                project_id=data.get("project_id"),
                assignee_field="assignee_ids" if adapter == "ticket" else "assignee_id",
                allow_routing=routing_rule is not None,
            )
    if adapter == "project":
        from plane.app.serializers.project import ProjectSerializer
        from plane.db.models import State, DEFAULT_STATES

        serializer = ProjectSerializer(
            native,
            data=data,
            partial=not creating,
            context={"workspace_id": entity.workspace_id},
        )
        serializer.is_valid(raise_exception=True)
        native = serializer.save()
        if creating:
            ProjectMember.objects.create(
                project=native, workspace=entity.workspace, member=user, role=20
            )
            if native.project_lead_id and native.project_lead_id != user.id:
                ProjectMember.objects.get_or_create(
                    project=native,
                    workspace=entity.workspace,
                    member_id=native.project_lead_id,
                    defaults={"role": 20},
                )
            State.objects.bulk_create(
                [
                    State(project=native, workspace=entity.workspace, **state)
                    for state in DEFAULT_STATES
                ]
            )
    elif adapter == "ticket":
        from plane.app.serializers.issue import (
            IssueCreateSerializer,
            IssueDetailSerializer,
        )
        from .entity_issue_types import native_type_for_subtype
        from .crm_notifications import task_snapshot

        previous_task = task_snapshot(native) if native and not native.project_id else None

        if subtype:
            data["type"] = str(native_type_for_subtype(subtype).id)
        previous_json = (
            json.dumps(IssueDetailSerializer(native).data, cls=DjangoJSONEncoder)
            if native
            else None
        )

        project_id = data.pop("project_id", None) or (
            native.project_id if native else None
        )
        project = (
            get_object_or_404(
                visible_projects(
                    Project.objects.filter(workspace=entity.workspace),
                    user,
                    entity.workspace.slug,
                ),
                id=project_id,
            )
            if project_id
            else None
        )
        if native and str(native.project_id) != str(project_id):
            raise ValidationError("انتقال تیکت به پروژه دیگر از این فرم مجاز نیست.")
        assignees = data.get("assignee_ids") or []
        if (
            project
            and len(assignees)
            != ProjectMember.objects.filter(
                project=project, member_id__in=assignees, is_active=True, role__gte=15
            ).count()
        ):
            raise ValidationError("مسئولان باید عضو فعال پروژه انتخاب‌شده باشند.")
        serializer = IssueCreateSerializer(
            native,
            data=data,
            partial=not creating,
            context={
                "project_id": project.id if project else None,
                "workspace_id": entity.workspace_id,
                "default_assignee_id": (
                    None if routing_rule or not project else project.default_assignee_id
                ),
                "actor_id": user.id,
            },
        )
        # Metadata owns configurable priority choices; validate_values already checked this lookup.
        if "priority" in serializer.fields:
            from rest_framework import serializers

            serializer.fields["priority"] = serializers.CharField(
                required=False, max_length=30
            )
        serializer.is_valid(raise_exception=True)
        native = serializer.save()
        if not native.project_id:
            from .crm_notifications import notify_workspace_task

            notify_workspace_task(native, user.id, previous_task)
            return native
        if routing_rule:
            from .ticket_routing import TicketRoutingService

            TicketRoutingService.route(native, routing_rule, actor_id=user.id)
        from plane.bgtasks.issue_activities_task import issue_activity
        from plane.utils.host import base_host

        requested_json = json.dumps(data, cls=DjangoJSONEncoder)
        transaction.on_commit(
            lambda: issue_activity.delay(
                type="issue.activity.created" if creating else "issue.activity.updated",
                requested_data=requested_json,
                actor_id=str(user.id),
                issue_id=str(native.id),
                project_id=str(native.project_id),
                current_instance=previous_json,
                epoch=int(timezone.now().timestamp()),
                notification=True,
                origin=base_host(request=request, is_app=True) if request else "",
            ),
            robust=True,
        )
    elif adapter == "task":
        from plane.app.serializers.workspace_task import WorkspaceTaskSerializer
        from plane.app.services.crm_notifications import (
            notify_workspace_task,
            task_snapshot,
        )

        previous = task_snapshot(native) if native else None
        serializer = WorkspaceTaskSerializer(
            native,
            data=data,
            partial=not creating,
            context={"workspace_id": entity.workspace_id},
        )
        from rest_framework import serializers

        for name in ("priority", "status"):
            serializer.fields[name] = serializers.CharField(
                required=False, max_length=20
            )
        serializer.is_valid(raise_exception=True)
        native = (
            serializer.save(workspace=entity.workspace, created_by_id=user.id)
            if creating
            else serializer.save()
        )
        notify_workspace_task(native, user.id, previous)
    else:
        data = {**data, "reason": data.get("reason") or ""}
        if native and str(native.user_id) != str(data.get("user_id")):
            raise ValidationError("کاربر درخواست مرخصی قابل تغییر نیست.")
        native = native or UserAbsence(workspace=entity.workspace)
        for name, value in data.items():
            if name in {"starts_at", "ends_at"} and isinstance(value, str):
                value = datetime.fromisoformat(value)
            setattr(native, name, value)
        if not can_manage_absence(
            user,
            native.user,
            entity.workspace,
            "Absence.Create" if creating else "Absence.Edit",
            request=request,
        ):
            raise PermissionDenied(
                "فقط مدیر بالادستی یا مدیر دارای مجوز می‌تواند این مرخصی را تغییر دهد."
            )
        try:
            native.full_clean(exclude=["created_by", "updated_by"])
        except DjangoValidationError as exc:
            raise ValidationError(
                getattr(exc, "message_dict", {"detail": exc.messages})
            ) from exc
        native.save(created_by_id=user.id)
    return native


@transaction.atomic
def save_record(entity, user, payload, request=None, identifier=None):
    Workspace.objects.select_for_update().get(id=entity.workspace_id)
    entity = EntityType.objects.select_for_update().get(id=entity.id)
    creating = identifier is None
    if creating:
        require_action(entity, user, "create", request)
    if not entity.is_active:
        raise ValidationError("موجودیت غیرفعال قابل ثبت یا ویرایش نیست.")
    if not FormLayout.objects.filter(entity=entity, published__isnull=False).exists():
        raise ValidationError("ابتدا فرم این موجودیت را طراحی و منتشر کنید.")
    row, native = (
        (None, None)
        if creating
        else get_record(entity, user, identifier, request, lock=True)
    )
    if native:
        native = ADAPTERS[entity.adapter].objects.select_for_update().get(id=native.id)
    if not creating and payload.get("revision") != (row.revision if row else 0):
        from rest_framework.exceptions import APIException

        exc = APIException(
            "این رکورد توسط شخص دیگری تغییر کرده است؛ دوباره بارگذاری کنید."
        )
        exc.status_code = 409
        raise exc
    subtype = row.subtype if row else None
    if not creating:
        submitted = payload.get("values", {})
        if not isinstance(submitted, dict):
            raise ValidationError("مقادیر فرم باید یک شیء باشند.")
        _, policy_fields = schema_fields(entity, subtype)
        actions = record_edit_actions(entity, user, native, request)
        if not any(actions.values()) or any(
            not actions[field_edit_action(entity, policy_fields.get(code, {}))]
            for code in submitted
        ):
            raise PermissionDenied(
                "مجوز ویرایش این فیلدها یا واگذاری/تغییر وضعیت این رکورد را ندارید."
            )
    if creating and payload.get("subtype"):
        subtype = get_object_or_404(
            EntityType,
            workspace=entity.workspace,
            parent=entity,
            code=payload["subtype"],
            is_active=True,
        )
        if not FormLayout.objects.filter(
            entity=subtype, published__isnull=False
        ).exists():
            raise ValidationError("ابتدا فرم این زیرنوع را منتشر کنید.")
    if request:
        request._engine_record_id = str(identifier or "")
        request._engine_sidecar_id = row.id if row else None
    _, locked_fields = schema_fields(entity, subtype)
    list(
        FieldDefinition.objects.select_for_update()
        .filter(workspace=entity.workspace, code__in=locked_fields)
        .order_by("code")
    )
    old = all_values(entity, row, native, subtype)
    values, fields = validate_values(
        entity, user, payload.get("values", {}), old, subtype, creating, request
    )
    routing_rule = None
    if payload.get("routing_rule_id"):
        if not creating or entity.adapter != "ticket":
            raise ValidationError("قاعده ارجاع فقط هنگام ایجاد تیکت قابل انتخاب است.")
        from plane.db.models import TicketRoutingRule

        routing_rule = get_object_or_404(
            TicketRoutingRule,
            workspace=entity.workspace,
            id=payload["routing_rule_id"],
            is_active=True,
            unit__is_active=True,
            required_role__is_active=True,
        )
    if entity.adapter:
        try:
            native = save_native(
                entity, user, values, fields, native, request, subtype, routing_rule
            )
        except ValidationError as exc:
            if isinstance(exc.detail, dict):
                names = {
                    field["binding"].get("source"): code
                    for code, field in fields.items()
                    if field["binding"].get("source")
                }
                raise ValidationError(
                    {
                        names.get(key, key): message
                        for key, message in exc.detail.items()
                    }
                )
            raise
        for code, field in fields.items():
            source = field["binding"].get("source")
            if source:
                values[code] = (
                    list(
                        map(
                            str,
                            native.issue_assignee.filter(
                                deleted_at__isnull=True
                            ).values_list("assignee_id", flat=True),
                        )
                    )
                    if source == "assignee_ids"
                    else json_value(native_value(entity, native, source))
                )
    custom = {
        code: value
        for code, value in values.items()
        if not fields.get(code, {}).get("binding", {}).get("source")
        and fields.get(code, {}).get("kind") != "computed"
        and not fields.get(code, {}).get("config", {}).get("auto_number")
    }
    if row is None and native is not None and entity.adapter:
        row = EntityRecord.objects.filter(entity=entity, source_id=native.id).first()
    # Keep deactivated/unbound historical values, which are intentionally not in the current schema.
    custom = {**(row.data if row else {}), **custom}
    if row is None:
        counter = SystemIdentifierCounter.locked(f"entity:{entity.id}", "default")
        sequence = counter.advance()
        from .entity_identifiers import format_record_number

        number = format_record_number(entity, sequence)
        form = FormLayout.objects.filter(entity=subtype or entity).first()
        row = EntityRecord.objects.create(
            entity=entity,
            workspace=entity.workspace,
            subtype=subtype,
            source_id=native.id if native else None,
            number=number,
            data=custom,
            form_version=form.published if form else None,
            created_by_id=user.id,
        )
    else:
        row.data, row.revision = custom, row.revision + 1
        if creating and subtype:
            row.subtype = subtype
        row.save()
    if creating:
        from .entity_numbering import assign_numbers

        assign_numbers(row)
        values.update(row.data)
    from .entity_relations import save_relation_links

    save_relation_links(entity, row, user, values, fields, request)
    FieldDefinition.objects.filter(
        workspace=entity.workspace, code__in=fields, used_at__isnull=True
    ).update(used_at=timezone.now())
    public_id = native.id if native else row.id
    for code, field in fields.items():
        if field["kind"] == "file" and values.get(code):
            FileAsset.objects.filter(
                workspace=entity.workspace, id__in=values[code], entity_type="CRM_FIELD"
            ).update(entity_identifier=str(public_id))
    emit(
        entity,
        user,
        "record.created" if creating else "record.updated",
        public_id,
        before=None if creating else old,
        after=values,
    )
    for code, value in values.items():
        if old.get(code) != value:
            emit(
                entity,
                user,
                (
                    "record.status_changed"
                    if fields.get(code, {}).get("binding", {}).get("source")
                    in {"state_id", "status"}
                    else "record.field_changed"
                ),
                public_id,
                code,
                old.get(code),
                value,
            )
    result = record_payload(entity, user, row, native, request)
    result["warnings"] = getattr(request, "_engine_unique_warnings", [])
    return result


def references_to(entity, identifier):
    """Return potential reverse references; callers still apply source record and field access."""
    fields = FieldDefinition.objects.filter(
        workspace=entity.workspace, relation_entity=entity
    )
    for field in fields:
        for source_entity in EntityType.objects.filter(
            workspace=entity.workspace, parent__isnull=True
        ):
            _, definitions = schema_fields(source_entity)
            for subtype in source_entity.subtypes.all():
                _, subtype_fields = schema_fields(source_entity, subtype)
                definitions.update(subtype_fields)
            definition = definitions.get(field.code)
            if not definition:
                continue
            source = definition["binding"].get("source")
            if source and source_entity.adapter:
                kwargs = {source: identifier}
                native_ids = (
                    base_native_rows(source_entity)
                    .filter(**kwargs)
                    .values_list("id", flat=True)
                )
                for native_id in native_ids:
                    yield source_entity, field, str(native_id)
            else:
                for row in EntityRecord.objects.filter(
                    entity=source_entity, is_active=True
                ).filter(
                    Q(**{f"data__{field.code}": str(identifier)})
                    | Q(**{f"data__{field.code}__contains": [str(identifier)]})
                ):
                    yield source_entity, field, str(row.source_id or row.id)


@transaction.atomic
def delete_record(
    entity, user, identifier, request=None, deactivate=None, confirm=False
):
    Workspace.objects.select_for_update().get(id=entity.workspace_id)
    EntityType.objects.select_for_update().get(id=entity.id)
    require_action(
        entity, user, "edit" if deactivate is not None else "delete", request
    )
    row, native = get_record(entity, user, identifier, request, lock=True)
    from .entity_relations import before_delete

    if deactivate is not False:
        before_delete(entity, identifier, user, request, apply=True)
    refs = list(references_to(entity, identifier))
    if refs and not confirm:
        from rest_framework.exceptions import APIException

        exc = APIException(
            {
                "detail": "این رکورد ارتباط فعال دارد. تأیید صریح برای ادامه لازم است.",
                "reference_count": len(refs),
            }
        )
        exc.status_code = 409
        raise exc
    before = all_values(entity, row, native)
    if deactivate is not None:
        if native and entity.adapter in {"user", "unit"}:
            from .entity_directory import save_directory

            save_directory(entity, user, {"is_active": not deactivate}, native, request)
        if not row:
            counter = SystemIdentifierCounter.locked(f"entity:{entity.id}", "default")
            row = EntityRecord.objects.create(
                entity=entity,
                workspace=entity.workspace,
                source_id=native.id,
                number=format_record_number(entity, counter.advance()),
                data={},
                created_by_id=user.id,
            )
        row.is_active, row.revision = not deactivate, row.revision + 1
        row.save()
        emit(
            entity,
            user,
            "record.deactivated" if deactivate else "record.activated",
            UUID(str(identifier)),
        )
    else:
        if native:
            if entity.adapter in {"user", "unit"}:
                from .entity_directory import delete_directory

                delete_directory(entity, native, request)
            elif entity.adapter == "leave":
                if not can_manage_absence(
                    user, native.user, entity.workspace, "Absence.End", request=request
                ):
                    raise PermissionDenied()
                native.status = (
                    "ended" if native.starts_at <= timezone.now() else "cancelled"
                )
                native.save()
            else:
                native.delete()
        if row:
            row.deleted_at = timezone.now()
            row.save()
        emit(entity, user, "record.deleted", UUID(str(identifier)), before=before)
