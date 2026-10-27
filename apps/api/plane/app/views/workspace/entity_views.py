"""Generic view APIs. Every mutation reuses the original record policy/validator."""

from copy import deepcopy
from datetime import timedelta
from uuid import UUID

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.http import FileResponse
from django.http import Http404
from django.utils import timezone
from rest_framework.exceptions import ValidationError, PermissionDenied, APIException
from rest_framework.response import Response

from plane.db.models import EntityViewExport, User, OrganizationRole, OrganizationUnit
from plane.app.services.access_control import has_permission
from django.db.models import Q
from plane.app.services.entity_query import EntityQuery, default_definition
from plane.app.services.entity_views import (
    SYSTEM_VIEWS,
    visible_views,
    default_view,
    official_view,
    personal_view_limit,
    set_default_view,
    view_payload,
    save_view,
    accessible_view,
    can_edit_view,
    presentation,
    save_presentation,
    make_query,
    require,
)
from plane.app.services.entity_records import (
    save_record,
    delete_record,
    emit_definition,
    get_record,
    record_payload,
)
from plane.app.services.entity_schema import present_schema, role_ids
from .entity import EngineAPIView, page


def resolve_definition(entity, request, payload):
    identifier = payload.get("view_id")
    system = ""
    if identifier and str(identifier).startswith("system:"):
        system = identifier.split(":", 1)[1]
    elif identifier:
        view = accessible_view(entity, request.user, identifier, request)
        if not view:
            raise PermissionDenied(
                "نما خصوصی است یا برای شما به اشتراک گذاشته نشده است."
            )
        definition = deepcopy(view.engine_definition)
        if payload.get("definition") is not None:
            definition = payload["definition"]
        definition = deepcopy(definition)
        if not isinstance(definition, dict):
            raise ValidationError("تعریف جدول باید یک شیء معتبر باشد.")
        # A stored field can become forbidden after publication. Do not broaden
        # its filter silently; show an empty result with a recoverable warning.
        from plane.app.services.entity_rules import condition_fields

        policy = make_query(entity, request.user, definition, request)
        stored = view.engine_definition or {}
        if definition.get("filter") and any(
            not policy.path_allowed(path, "filterable")
            for path in condition_fields(stored.get("filter"))
        ):
            definition["filter"] = None
            request._engine_empty_saved_filter = True
        if any(
            not policy.path_allowed(sort.get("field"))
            for sort in stored.get("sort", [])
        ):
            definition["sort"] = [
                sort
                for sort in definition.get("sort", [])
                if policy.path_allowed(sort.get("field"))
            ]
        if stored.get("group") and not policy.path_allowed(
            stored["group"], "filterable"
        ):
            definition["group"] = None
        return definition, system
    definition = payload.get("definition")
    if definition is None:
        default = default_view(entity, request.user, request)
        definition = (
            default.engine_definition
            if default
            else default_definition(
                entity, EntityQuery(entity, request.user, request).fields
            )
        )
    return definition, system


class EngineViewSchemaEndpoint(EngineAPIView):
    def get(self, request, slug, code):
        entity = self.entity(slug, code)
        if request.query_params.get("recipients"):
            if not any(
                has_permission(
                    request.user, entity.workspace, permission, request=request
                )
                for permission in ["View.Personal.Share", "View.Official.Manage"]
            ):
                raise PermissionDenied()
            kind = request.query_params["recipients"]
            scopes = {
                "roles": OrganizationRole.objects.filter(
                    workspace=entity.workspace, is_active=True
                ),
                "units": OrganizationUnit.objects.filter(
                    workspace=entity.workspace, is_active=True
                ),
                "users": User.objects.filter(
                    member_workspace__workspace=entity.workspace,
                    member_workspace__is_active=True,
                    member_workspace__deleted_at__isnull=True,
                ),
            }
            if kind not in scopes:
                raise ValidationError("نوع گیرنده معتبر نیست.")
            rows = scopes[kind]
            search = request.query_params.get("search", "")[:200]
            name = (
                "display_name"
                if kind == "users"
                else "title" if kind == "units" else "name"
            )
            rows = (
                rows.filter(**{f"{name}__icontains": search})
                .distinct()
                .order_by(name, "id")
            )
            selected = request.query_params.get("selected", "")
            if selected:
                rows = rows.filter(id__in=selected.split(",")[:200])
            offset, size = page(request)
            return Response(
                {
                    "results": [
                        {"id": str(row.id), "title": getattr(row, name)}
                        for row in rows[offset * size : (offset + 1) * size]
                    ],
                    "count": rows.count(),
                }
            )
        query = make_query(
            entity,
            request.user,
            {"subtype": request.query_params.get("subtype")},
            request,
        )
        prefix = request.query_params.get("path", "")
        path_titles = []
        if prefix:
            for head in prefix.split("."):
                field = query.describe(head)
                if field["kind"] != "relation":
                    raise ValidationError("مسیر باید به یک Relation برسد.")
                query = query.child(field)
                path_titles.append(field["title"])
        fields = []
        for key, f in query.fields.items():
            fields.append(
                {
                    "code": f"{prefix}.{key}" if prefix else key,
                    "field_code": key,
                    "options_entity": query.entity.code,
                    "options_subtype": query.subtype.code if query.subtype else None,
                    "time_zone": str(query.time_zone),
                    "title": " ← ".join([*path_titles, f["title"]]),
                    "kind": f["kind"],
                    "lookup": f["lookup"],
                    "relation_entity": f["relation_entity"],
                    "operators": query.describe(key)["operators"],
                    "config": {
                        k: v
                        for k, v in f["config"].items()
                        if k
                        in {"multiple", "unit", "provider", "lookup_codes", "readonly"}
                    },
                    "filterable": f["filterable"],
                    "table_visible": f["table_visible"],
                    "searchable": f["searchable"],
                    "show_in_summary": f["show_in_summary"],
                }
            )
        return Response(
            {
                "fields": fields,
                "definition": default_definition(entity, query.fields),
                "presentation": presentation(entity, request.user, request),
            }
        )


class EngineViewQueryEndpoint(EngineAPIView):
    def post(self, request, slug, code):
        entity = self.entity(slug, code)
        definition, system = resolve_definition(entity, request, request.data)
        query = make_query(entity, request.user, definition, request)
        try:
            current_page = max(1, int(request.data.get("page", 1)))
            size = min(200, max(1, int(request.data.get("page_size", 50))))
        except (TypeError, ValueError):
            raise ValidationError("اندازه یا شماره صفحه معتبر نیست.")
        query.prepare(definition, request.data.get("search", ""), system)
        if getattr(request, "_engine_empty_saved_filter", False):
            query.rows = query.rows.none()
            query.warnings.append(
                "فیلتر ذخیره‌شده به فیلدی خارج از دسترسی وابسته است؛ فیلتر را پاک کنید یا به جدول رسمی بازگردید."
            )
        result = query.execute(current_page, size)
        from plane.app.services.entity_view_export import value_labels, kanban_choices

        label_rows = result["results"]
        if definition.get("group"):
            label_rows = label_rows + [
                {"values": {definition["group"]: group["value"]}}
                for group in result["groups"]
            ]
        result["labels"] = value_labels(query, label_rows)
        axis = definition.get("settings", {}).get("kanban_field")
        if axis and definition.get("type") == "kanban":
            result["labels"].setdefault(axis, {}).update(kanban_choices(query))
        return Response(result)


class EngineViewOptionsEndpoint(EngineAPIView):
    def get(self, request, slug, code, field_path):
        from plane.db.models import LookupValue, State, Project
        from plane.app.services.project_visibility import visible_projects

        entity = self.entity(slug, code)
        query = make_query(
            entity,
            request.user,
            {"subtype": request.query_params.get("subtype")},
            request,
        )
        field = query.describe(field_path)
        for head in field_path.split(".")[:-1]:
            query = query.child(query.fields[head])
        search, (offset, size) = request.query_params.get("search", "")[:200], page(
            request
        )
        selected = (
            request.query_params.get("selected", "").split(",")
            if request.query_params.get("resolve") == "true"
            else []
        )
        config = field["config"]
        if selected and not config.get("lookup_codes"):
            try:
                [UUID(value) for value in selected]
            except (TypeError, ValueError):
                raise ValidationError("شناسه انتخاب معتبر نیست.")
        if field.get("lookup"):
            rows = LookupValue.objects.filter(
                category__workspace=entity.workspace,
                category__code=field["lookup"],
                title__icontains=search,
            )
            rows = (
                rows.filter(
                    **(
                        {"code__in": selected}
                        if config.get("lookup_codes")
                        else {"id__in": selected}
                    )
                )
                if selected
                else rows.filter(is_active=True)
            )
            count = rows.count()
            result = [
                {
                    "id": r.code if config.get("lookup_codes") else str(r.id),
                    "title": r.title,
                    "color": r.color,
                }
                for r in rows[offset * size : (offset + 1) * size]
            ]
        elif config.get("provider") == "project_states":
            allowed = visible_projects(
                Project.objects.filter(workspace=entity.workspace), request.user, slug
            )
            rows = State.objects.filter(
                workspace=entity.workspace,
                project_id__in=allowed.values("id"),
                name__icontains=search,
            ).order_by("name", "id")
            if selected:
                rows = rows.filter(id__in=selected)
            count = rows.count()
            result = [
                {"id": str(r.id), "title": r.name, "color": r.color}
                for r in rows[offset * size : (offset + 1) * size]
            ]
        elif field["kind"] == "relation":
            child = query.child(field)
            alias = (
                child.scalar(child.entity.title_field)
                if child.path_allowed(child.entity.title_field)
                else "number"
            )
            rows = child.rows.filter(**{f"{alias}__icontains": search})
            if selected:
                rows = rows.filter(Q(source_id__in=selected) | Q(id__in=selected))
            count = rows.count()
            result = [
                {"id": str(r["source_id"] or r["id"]), "title": r[alias] or "رکورد"}
                for r in rows.order_by("number", "id").values("id", "source_id", alias)[
                    offset * size : (offset + 1) * size
                ]
            ]
        else:
            scopes = {
                "user": User.objects.filter(
                    member_workspace__workspace=entity.workspace,
                    member_workspace__is_active=True,
                    member_workspace__deleted_at__isnull=True,
                ),
                "unit": OrganizationUnit.objects.filter(
                    workspace=entity.workspace, is_active=True
                ),
                "role": OrganizationRole.objects.filter(
                    workspace=entity.workspace, is_active=True
                ),
            }
            if field["kind"] not in scopes:
                return Response({"results": [], "count": 0})
            name = {"user": "display_name", "unit": "title", "role": "name"}[
                field["kind"]
            ]
            rows = (
                scopes[field["kind"]]
                .filter(**{f"{name}__icontains": search})
                .distinct()
                .order_by(name, "id")
            )
            if selected:
                rows = rows.filter(id__in=selected)
            count = rows.count()
            result = [
                {"id": str(r.id), "title": getattr(r, name)}
                for r in rows[offset * size : (offset + 1) * size]
            ]
        return Response({"results": result, "count": count})


class EngineSavedViewsEndpoint(EngineAPIView):
    def get(self, request, slug, code):
        entity = self.entity(slug, code)
        EntityQuery(entity, request.user, request)
        default = default_view(entity, request.user, request)
        official = official_view(entity, request.user, request)
        return Response(
            {
                "results": [
                    view_payload(v, request.user, request)
                    for v in visible_views(entity, request.user, request)
                ],
                "default_id": str(default.id) if default else None,
                "official_id": str(official.id) if official else None,
                "personal_view_limit": personal_view_limit(entity.workspace),
                "system": (
                    [
                        {"id": f"system:{key}", "name": title}
                        for key, title in SYSTEM_VIEWS
                    ]
                    if entity.adapter == "ticket"
                    else []
                ),
            }
        )

    def post(self, request, slug, code):
        entity = self.entity(slug, code)
        data = dict(request.data)
        if data.get("copy_from"):
            original = accessible_view(entity, request.user, data["copy_from"], request)
            if not original:
                raise PermissionDenied()
            data.setdefault("definition", deepcopy(original.engine_definition))
            data.setdefault("name", original.name + " (کپی)")
        return Response(
            view_payload(
                save_view(entity, request.user, data, request), request.user, request
            ),
            status=201,
        )

    def patch(self, request, slug, code, identifier):
        entity = self.entity(slug, code)
        if set(request.data) == {"is_default"}:
            if not isinstance(request.data["is_default"], bool):
                raise ValidationError("پیش‌فرض بودن باید بله یا خیر باشد.")
            view = set_default_view(
                entity,
                request.user,
                identifier if request.data["is_default"] else None,
                request,
            )
            return Response({"default_id": str(view.id) if view else None})
        view = accessible_view(entity, request.user, identifier, request)
        if not view:
            raise PermissionDenied()
        return Response(
            view_payload(
                save_view(entity, request.user, request.data, request, view),
                request.user,
                request,
            )
        )

    @transaction.atomic
    def delete(self, request, slug, code, identifier):
        entity = self.entity(slug, code)
        view = accessible_view(entity, request.user, identifier, request)
        if not view or not can_edit_view(view, request.user, request):
            raise PermissionDenied()
        before = view_payload(view, request.user, request)
        view.deleted_at = timezone.now()
        view.save()
        emit_definition(entity.workspace, request.user, "view.deleted", view, before)
        return Response(status=204)


class EnginePresentationEndpoint(EngineAPIView):
    def get(self, request, slug, code):
        return Response(presentation(self.entity(slug, code), request.user, request))

    def put(self, request, slug, code):
        return Response(
            save_presentation(
                self.entity(slug, code), request.user, request.data, request
            )
        )


class EngineSummaryEndpoint(EngineAPIView):
    def get(self, request, slug, code, identifier):
        entity = self.entity(slug, code)
        row, native = get_record(entity, request.user, identifier, request)
        record = record_payload(entity, request.user, row, native, request)
        query = make_query(
            entity, request.user, {"subtype": record["subtype"]}, request
        )
        roles, fields = role_ids(request.user, entity.workspace), query.fields
        configured = entity.view_settings.get("summary")
        view_id = request.query_params.get("view_id")
        if view_id:
            view = accessible_view(entity, request.user, view_id, request)
            if not view:
                raise PermissionDenied("جدول شخصی در دسترس نیست.")
            if "summary" in view.engine_definition:
                configured = [
                    {"field": path} for path in view.engine_definition["summary"]
                ]
        items = (
            configured
            if configured
            else [
                {"field": key}
                for key, field in fields.items()
                if field.get("show_in_summary")
                or key
                in {
                    entity.title_field,
                    "task_status",
                    "ticket_state",
                    "assignee",
                    "ticket_assignees",
                    "due_date",
                }
            ]
        )
        if row:
            paths = [
                item["field"] for item in items if query.path_allowed(item["field"])
            ]
            if paths:
                definition = {
                    "version": 1,
                    "type": "table",
                    "columns": [{"field": path, "width": 180} for path in paths],
                }
                query.rows = query.rows.filter(id=row.id)
                query.prepare(definition)
                rows = query.execute(1, 1)["results"]
                if rows:
                    record["values"].update(rows[0]["values"])
        result = []
        for item in items:
            code = item["field"]
            if (
                code not in record["values"]
                or not query.path_allowed(code)
                or item.get("subtype")
                and item["subtype"] != record["subtype"]
                or item.get("roles")
                and not roles.intersection(item["roles"])
            ):
                continue
            field = query.describe(code)
            result.append(
                {
                    "field": code,
                    "code": code,
                    "field_code": code,
                    "options_entity": entity.code,
                    "title": field["title"],
                    "kind": field["kind"],
                    "config": {
                        k: v
                        for k, v in field["config"].items()
                        if k
                        in {"multiple", "unit", "lookup_codes", "provider", "readonly"}
                    },
                    "lookup": field.get("lookup"),
                    "relation_entity": field.get("relation_entity"),
                    "value": record["values"][code],
                }
            )
        from plane.app.services.entity_view_export import value_labels

        labels = value_labels(
            query, [{"values": {item["field"]: item["value"] for item in result}}]
        )
        return Response({"fields": result, "labels": labels, "record": record})


class EngineBulkEndpoint(EngineAPIView):
    def post(self, request, slug, code):
        entity = self.entity(slug, code)
        identifiers, operation = request.data.get("ids"), request.data.get("operation")
        if (
            not isinstance(identifiers, list)
            or not 1 <= len(identifiers) <= 200
            or len(set(map(str, identifiers))) != len(identifiers)
        ):
            raise ValidationError("یک تا دویست رکورد غیرتکراری را انتخاب کنید.")
        try:
            [UUID(str(identifier)) for identifier in identifiers]
        except (ValueError, TypeError):
            raise ValidationError("شناسه یکی از رکوردها معتبر نیست.")
        if operation not in {"update", "assign", "delete"}:
            raise ValidationError("عملیات گروهی معتبر نیست.")
        if operation == "assign":
            query = EntityQuery(entity, request.user, request)
            values = request.data.get("values", {})
            if not values or any(
                query.describe(key)["kind"] != "user" for key in values
            ):
                raise ValidationError("برای واگذاری، فیلد انتخاب کاربر را تعیین کنید.")
        results = []
        for identifier in identifiers:
            try:
                with transaction.atomic():
                    row, native = get_record(entity, request.user, identifier, request)
                    if operation == "delete":
                        delete_record(
                            entity,
                            request.user,
                            identifier,
                            request,
                            confirm=request.data.get("confirm_relations") is True,
                        )
                    else:
                        save_record(
                            entity,
                            request.user,
                            {
                                "values": request.data.get("values", {}),
                                "revision": (
                                    request.data.get("revisions", {}).get(
                                        str(identifier), row.revision if row else 0
                                    )
                                ),
                            },
                            request,
                            identifier,
                        )
                results.append({"id": str(identifier), "ok": True})
            except APIException as exc:
                results.append(
                    {
                        "id": str(identifier),
                        "ok": False,
                        "status": exc.status_code,
                        "error": exc.detail,
                    }
                )
            except Http404:
                results.append(
                    {
                        "id": str(identifier),
                        "ok": False,
                        "status": 404,
                        "error": "رکورد در دسترس نیست.",
                    }
                )
        return Response(
            {
                "results": results,
                "transaction": "per_record",
                "success_count": sum(r["ok"] for r in results),
            }
        )


class EngineExportsEndpoint(EngineAPIView):
    def post(self, request, slug, code):
        entity = self.entity(slug, code)
        require(request.user, entity.workspace, "Export.Data", request)
        definition, system = resolve_definition(entity, request, request.data)
        if getattr(request, "_engine_empty_saved_filter", False):
            raise ValidationError(
                "فیلتر جدول به فیلدی خارج از دسترسی وابسته است؛ ابتدا فیلتر را اصلاح کنید."
            )
        query = make_query(entity, request.user, definition, request)
        query.validate(definition)
        query.prepare(definition, request.data.get("search", ""), system)
        format = request.data.get("format")
        if format not in {"xlsx", "csv"}:
            raise ValidationError("قالب خروجی باید Excel یا CSV باشد.")
        job = EntityViewExport.objects.create(
            workspace=entity.workspace,
            entity=entity,
            user=request.user,
            definition={
                "view": definition,
                "search": request.data.get("search", ""),
                "system": system,
            },
            format=format,
            expires_at=timezone.now() + timedelta(hours=24),
        )
        from plane.app.services.entity_view_export import build_entity_export

        transaction.on_commit(lambda: build_entity_export.delay(str(job.id)))
        return Response({"id": str(job.id), "status": job.status}, status=202)

    def get(self, request, slug, code, identifier=None, download=False):
        entity = self.entity(slug, code)
        require(request.user, entity.workspace, "Export.Data", request)
        rows = EntityViewExport.objects.filter(
            entity=entity, workspace=entity.workspace, user=request.user
        )
        if not identifier:
            return Response(
                {
                    "results": [
                        {
                            "id": str(r.id),
                            "status": r.status,
                            "error": r.error,
                            "row_count": r.row_count,
                            "format": r.format,
                            "expires_at": r.expires_at,
                        }
                        for r in rows.order_by("-created_at")[:20]
                    ]
                }
            )
        job = get_object_or_404(rows, id=identifier)
        if download:
            from plane.app.services.entity_view_export import verify_export_access

            verify_export_access(job)
            return FileResponse(
                job.asset.asset.open("rb"),
                as_attachment=True,
                filename=f"{entity.code}.{job.format}",
                content_type=(
                    "text/csv; charset=utf-8"
                    if job.format == "csv"
                    else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                ),
            )
        return Response(
            {
                "id": str(job.id),
                "status": job.status,
                "error": job.error,
                "row_count": job.row_count,
            }
        )
