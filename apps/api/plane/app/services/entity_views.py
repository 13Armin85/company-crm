"""Saved IssueView adapters, official presentation and repeatable access checks."""

import re
from copy import deepcopy
from uuid import UUID

from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError, PermissionDenied

from plane.db.models import (
    EntityType,
    IssueView,
    OrganizationRole,
    OrganizationUnit,
    OrganizationUnitMember,
    User,
    Workspace,
)
from .access_control import has_permission
from .entity_query import EntityQuery
from .entity_schema import role_ids
from .entity_records import emit_definition
from .entity_rules import condition_fields


SYSTEM_VIEWS = [
    ("mine", "تیکت‌های من"),
    ("referred", "ارجاع‌شده به من"),
    ("overdue", "سررسید گذشته"),
    ("unassigned", "بدون مسئول"),
]


def require(user, workspace, code, request=None):
    if not has_permission(user, workspace, code, request=request):
        raise PermissionDenied("مجوز انجام این عملیات را ندارید.")


def visible_views(entity, user, request=None):
    roles = role_ids(user, entity.workspace)
    units = set(
        map(
            str,
            OrganizationUnitMember.objects.filter(
                user=user, unit__workspace=entity.workspace, is_active=True, unit__is_active=True
            ).values_list("unit_id", flat=True),
        )
    )
    manager = has_permission(user, entity.workspace, "View.Manage.All", request=request)
    result = []
    for view in (
        IssueView.objects.filter(engine_entity=entity).select_related("engine_entity__workspace").order_by("name", "id")
    ):
        if view.owned_by_id == user.id or view.engine_visibility == "official":
            result.append(view)
        elif view.engine_visibility == "shared":
            recipients = view.engine_recipients
            if (
                manager
                or str(user.id) in recipients.get("users", [])
                or roles.intersection(recipients.get("roles", []))
                or units.intersection(recipients.get("units", []))
            ):
                result.append(view)
    return result


def accessible_view(entity, user, identifier, request=None):
    return next((v for v in visible_views(entity, user, request) if str(v.id) == str(identifier)), None)


def can_edit_view(view, user, request=None):
    if view.engine_visibility == "official":
        return has_permission(user, view.workspace, "View.Manage.All", request=request)
    if view.engine_visibility == "personal":
        return view.owned_by_id == user.id and has_permission(
            user, view.workspace, "View.Create.Personal", request=request
        )
    return (
        view.owned_by_id == user.id and has_permission(user, view.workspace, "View.Create.Shared", request=request)
    ) or has_permission(user, view.workspace, "View.Manage.All", request=request)


def redact_definition(entity, user, definition, request=None):
    definition = deepcopy(definition)
    if definition:
        cache = getattr(request, "_crm_view_queries", {}) if request else {}
        key = (str(entity.id), definition.get("subtype"))
        if key not in cache:
            cache[key] = make_query(entity, user, definition, request)
        if request:
            request._crm_view_queries = cache
        query = cache[key]
        for index, column in enumerate(definition.get("columns", [])):
            if not query.path_allowed(column.get("field"), "table_visible"):
                column["field"] = f"$unavailable{index}"
        for sort in definition.get("sort", []):
            if not query.path_allowed(sort.get("field")):
                sort["field"] = "$unavailable"

        def redact(node):
            if not isinstance(node, dict):
                return node
            if "rules" in node:
                return {**node, "rules": [redact(rule) for rule in node["rules"]]}

            return (
                node
                if query.path_allowed(node.get("field"), "filterable")
                else {"field": "$unavailable", "op": "eq", "value": None}
            )

        if definition.get("filter"):
            definition["filter"] = redact(definition["filter"])
        if definition.get("group") and not query.path_allowed(definition["group"], "filterable"):
            definition["group"] = "$unavailable"
        for key in ["kanban_field", "calendar_field"]:
            path = definition.get("settings", {}).get(key)
            if path and not query.path_allowed(path):
                definition["settings"][key] = "$unavailable"
                definition["settings"].pop("kanban_columns", None)
    return definition


def view_payload(view, user, request=None):
    definition = redact_definition(view.engine_entity, user, view.engine_definition, request)
    return {
        "id": str(view.id),
        "name": view.name,
        "definition": definition,
        "visibility": view.engine_visibility,
        "recipients": view.engine_recipients,
        "default_roles": view.engine_default_roles,
        "revision": view.engine_revision,
        "owner": str(view.owned_by_id),
        "can_edit": can_edit_view(view, user, request),
    }


def validate_recipients(workspace, data):
    if not isinstance(data, dict) or set(data) - {"roles", "units", "users"}:
        raise ValidationError("گیرندگان نما معتبر نیستند.")
    scopes = {
        "roles": OrganizationRole.objects.filter(workspace=workspace, is_active=True),
        "units": OrganizationUnit.objects.filter(workspace=workspace, is_active=True),
        "users": User.objects.filter(
            member_workspace__workspace=workspace,
            member_workspace__is_active=True,
            member_workspace__deleted_at__isnull=True,
        ),
    }
    for key, values in data.items():
        if not isinstance(values, list) or len(values) > 500:
            raise ValidationError("گیرندگان باید یک فهرست با حداکثر ۵۰۰ عضو باشند.")
        try:
            identifiers = {UUID(str(v)) for v in values}
        except (TypeError, ValueError):
            raise ValidationError("شناسه گیرنده معتبر نیست.")
        if scopes[key].filter(id__in=identifiers).distinct().count() != len(identifiers):
            raise ValidationError("همه گیرندگان باید فعال و متعلق به همین فضای کاری باشند.")
    return data


@transaction.atomic
def save_view(entity, user, data, request=None, instance=None):
    Workspace.objects.select_for_update().get(id=entity.workspace_id)
    if instance:
        instance = IssueView.objects.select_for_update().get(id=instance.id, engine_entity=entity)
        if not can_edit_view(instance, user, request):
            raise PermissionDenied()
        if data.get("revision") != instance.engine_revision:
            from plane.app.views.workspace.entity import conflict

            conflict("نما توسط شخص دیگری تغییر کرده است؛ دوباره بارگذاری کنید.")
    visibility = data.get("visibility", instance.engine_visibility if instance else "personal")
    if visibility not in {"personal", "shared", "official"}:
        raise ValidationError("نوع دسترسی نما معتبر نیست.")
    require(
        user,
        entity.workspace,
        {"personal": "View.Create.Personal", "shared": "View.Create.Shared", "official": "View.Manage.All"}[visibility],
        request,
    )
    if instance and instance.engine_visibility != visibility:
        # Keep ownership/private boundaries explicit; use copy to change visibility.
        raise ValidationError("برای تغییر نوع دسترسی، یک کپی از نما بسازید.")
    name = data.get("name", instance.name if instance else "")
    if not isinstance(name, str) or not name.strip() or len(name) > 255:
        raise ValidationError("عنوان نما باید بین یک تا ۲۵۵ نویسه باشد.")
    definition = data.get("definition", instance.engine_definition if instance else {})
    query = make_query(entity, user, definition, request)
    definition = query.validate(definition)
    # Official rules are managed separately; a personal/shared JSON cannot replace them.
    if "rules" in definition:
        raise ValidationError("قواعد رسمی از بخش رنگ‌بندی مدیریت می‌شوند.")
    recipients = validate_recipients(
        entity.workspace, data.get("recipients", instance.engine_recipients if instance else {})
    )
    defaults = data.get("default_roles", instance.engine_default_roles if instance else [])
    validate_recipients(entity.workspace, {"roles": defaults})
    if defaults and visibility != "official":
        raise ValidationError("پیش‌فرض نقش فقط برای نمای رسمی قابل تعیین است.")
    before = view_payload(instance, user, request) if instance else None
    if instance is None:
        instance = IssueView(workspace=entity.workspace, engine_entity=entity, owned_by=user, query={}, access=0)
    instance.name, instance.engine_definition, instance.engine_visibility = name.strip(), definition, visibility
    instance.engine_recipients, instance.engine_default_roles = recipients, defaults
    instance.engine_revision += 1 if before else 0
    instance.save(created_by_id=user.id if not before else None)
    if defaults:
        for other in IssueView.objects.filter(engine_entity=entity, engine_visibility="official").exclude(
            id=instance.id
        ):
            remaining = [r for r in other.engine_default_roles if r not in defaults]
            if remaining != other.engine_default_roles:
                other.engine_default_roles = remaining
                other.engine_revision += 1
                other.save()
                emit_definition(
                    entity.workspace, user, "view.default_changed", other, after={"default_roles": remaining}
                )
    emit_definition(
        entity.workspace,
        user,
        "view.updated" if before else "view.created",
        instance,
        before,
        view_payload(instance, user, request),
    )
    return instance


def make_query(entity, user, definition, request=None):
    subtype_code = definition.get("subtype") if isinstance(definition, dict) else None
    subtype = get_object_or_404(entity.subtypes, code=subtype_code) if subtype_code else None
    return EntityQuery(entity, user, request, subtype)


def default_view(entity, user, request=None):
    roles = role_ids(user, entity.workspace)
    views = visible_views(entity, user, request)
    candidates = [v for v in views if v.engine_visibility == "official" and roles.intersection(v.engine_default_roles)]
    # Multiple roles: lexicographically smallest stable role UUID, then stable view UUID.
    return (
        min(candidates, key=lambda v: (min(roles.intersection(v.engine_default_roles)), str(v.id)))
        if candidates
        else None
    )


def presentation(entity, user, request=None, settings=None):
    query = EntityQuery(entity, user, request)
    settings = deepcopy(entity.view_settings if settings is None else settings)
    settings["rules"] = [
        r
        for r in settings.get("rules", [])
        if all(query.path_allowed(p) for p in condition_fields(r.get("when")))
        and (r.get("target") == "row" or query.path_allowed(r.get("field")))
    ]
    if "summary" in settings:
        manager = has_permission(user, entity.workspace, "View.Manage.All", request=request)
        settings["summary"] = [
            s
            for s in settings["summary"]
            if summary_allowed(entity, user, s, request)
            and (manager or not s.get("roles") or role_ids(user, entity.workspace).intersection(s["roles"]))
        ]
    return settings


def summary_allowed(entity, user, item, request=None):
    subtype = item.get("subtype")
    if subtype and not entity.subtypes.filter(code=subtype, is_active=True).exists():
        return False
    return make_query(entity, user, {"subtype": subtype}, request).path_allowed(item.get("field"))


@transaction.atomic
def save_presentation(entity, user, data, request=None):
    entity = EntityType.objects.select_for_update().get(id=entity.id)
    before, result = deepcopy(entity.view_settings), deepcopy(entity.view_settings)
    query = EntityQuery(entity, user, request)
    if "rules" in data:
        require(user, entity.workspace, "ConditionalFormat.Edit", request)
        rules = data["rules"]
        if not isinstance(rules, list) or len(rules) > 60:
            raise ValidationError("حداکثر شصت قاعده رنگ مجاز است.")
        for rule in rules:
            if (
                not isinstance(rule, dict)
                or rule.get("target") not in {"row", "cell", "badge"}
                or not isinstance(rule.get("priority", 0), int)
            ):
                raise ValidationError("هدف یا اولویت قاعده معتبر نیست.")
            query.predicate(rule.get("when"))
            if not rule.get("when"):
                raise ValidationError("شرط قاعده را مشخص کنید.")
            if rule["target"] != "row":
                query.describe(rule.get("field"))
            style = rule.get("style")
            if not isinstance(style, dict) or not style or set(style) - {"color", "background", "icon"}:
                raise ValidationError("ظاهر قاعده معتبر نیست.")
            for key, value in style.items():
                if key == "icon":
                    if value not in {"warning", "clock", "check", "flag", "info"}:
                        raise ValidationError("آیکون قاعده معتبر نیست.")
                elif not isinstance(value, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
                    raise ValidationError("رنگ باید کد شش‌رقمی معتبر باشد.")
        # An editor cannot see or overwrite rules containing fields outside their ACL.
        protected = [
            r for r in before.get("rules", []) if r not in presentation(entity, user, request).get("rules", [])
        ]
        result["rules"] = protected + rules
        if len(result["rules"]) > 60:
            raise ValidationError("حداکثر شصت قاعده رنگ مجاز است.")
    if "summary" in data:
        require(user, entity.workspace, "View.Manage.All", request)
        summary = data["summary"]
        if not isinstance(summary, list) or len(summary) > 100:
            raise ValidationError("حداکثر صد تنظیم خلاصه مجاز است.")
        for item in summary:
            if not isinstance(item, dict):
                raise ValidationError("تنظیم خلاصه معتبر نیست.")
            sub = item.get("subtype")
            scoped = make_query(entity, user, {"subtype": sub}, request)
            scoped.describe(item.get("field"))
            validate_recipients(entity.workspace, {"roles": item.get("roles", [])})
        protected = [s for s in before.get("summary", []) if not summary_allowed(entity, user, s, request)]
        result["summary"] = protected + summary
        if len(result["summary"]) > 100:
            raise ValidationError("حداکثر صد تنظیم خلاصه مجاز است.")
    entity.view_settings = result
    entity.save()
    emit_definition(entity.workspace, user, "view.presentation_changed", entity, before, result)
    return presentation(entity, user, request)
