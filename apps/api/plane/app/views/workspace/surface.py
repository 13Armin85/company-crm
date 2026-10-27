from pathlib import PurePath
from copy import deepcopy
from uuid import UUID, uuid4
import logging

from django.db import transaction
from django.db.models import Q
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError, PermissionDenied
from rest_framework.response import Response

from plane.app.views.workspace.entity import EngineAPIView, conflict, page
from plane.app.services.surface_config import (
    SURFACES,
    DESIGNABLE_SURFACES,
    member_workspace,
    allowed,
    configuration,
    surface_schema,
    validate_definition,
    read_values,
    extra_fields,
)
from plane.app.services.access_control import has_permission
from plane.app.services.surface_designer import new_field_data, persian_errors
from plane.app.serializers.entity import FieldDefinitionSerializer
from plane.app.services.entity_schema import can_field, role_ids, present_schema
from plane.app.services.entity_schema import validate_layout
from plane.app.services.entity_records import (
    emit_definition,
    native_queryset,
    record_queryset,
    require_action,
    record_payload,
)
from plane.app.services.entity_files import validate_file
from plane.db.models import (
    SurfaceConfiguration,
    Workspace,
    LookupValue,
    User,
    OrganizationRole,
    OrganizationUnit,
    EntityType,
    FileAsset,
    FieldDefinition,
    LookupCategory,
    FormLayout,
    FormVersion,
)


class SurfaceEndpoint(EngineAPIView):
    def handle_exception(self, exc):
        try:
            response = super().handle_exception(exc)
        except Exception:
            reference = uuid4().hex[:8]
            logging.getLogger(__name__).exception(
                "Surface configuration failed; reference=%s", reference
            )
            return Response(
                {
                    "detail": f"خطای غیرمنتظره رخ داد و عملیات انجام نشد. دوباره تلاش کنید؛ کد پیگیری: {reference}"
                },
                status=500,
            )
        if response.status_code >= 400:
            response.data = persian_errors(response.data, response.status_code)
        return response

    def context(self, request, slug, code):
        if code not in SURFACES:
            from django.http import Http404

            raise Http404()
        workspace = member_workspace(request, slug)
        allowed(request, workspace, code)
        return workspace

    def get(self, request, slug, code=None):
        if code is None:
            workspace = member_workspace(request, slug)
            self.require(request, workspace, "FormDesigner.View")
            return Response(
                {
                    "results": [
                        surface_schema(workspace, key, request.user) for key in SURFACES if key in DESIGNABLE_SURFACES
                    ]
                }
            )
        workspace = self.context(request, slug, code)
        return Response(surface_schema(workspace, code, request.user))

    @transaction.atomic
    def put(self, request, slug, code):
        if code not in DESIGNABLE_SURFACES:
            raise ValidationError("فرم‌ساز فقط برای ایجاد و ویرایش موجودیت‌هاست؛ طراحی صفحه‌های ثابت مجاز نیست.")
        workspace = self.context(request, slug, code)
        allowed(request, workspace, code, manage=True)
        self.require(request, workspace, "FormDesigner.Publish")
        if not isinstance(request.data, dict):
            raise ValidationError(
                "اطلاعات تنظیمات باید به‌صورت یک فرم معتبر ارسال شود."
            )
        Workspace.objects.select_for_update().get(id=workspace.id)
        row, previous = configuration(workspace, code)
        revision = row.revision if row else 0
        if (
            type(request.data.get("revision")) is not int
            or request.data["revision"] != revision
        ):
            conflict(
                "تنظیمات توسط کاربر دیگری تغییر کرده است؛ نسخه جدید را دریافت کنید."
            )
        if "form" in request.data:
            if not SURFACES[code].get("engine") or not isinstance(
                request.data["form"], dict
            ):
                raise ValidationError("تنظیمات فرم این صفحه معتبر نیست.")
            entity = get_object_or_404(
                EntityType.objects.select_for_update(),
                workspace=workspace,
                code=code,
                parent__isnull=True,
            )
            form = FormLayout.objects.select_for_update().filter(entity=entity).first()
            change = request.data["form"]
            if type(change.get("revision")) is not int or change["revision"] != (
                form.revision if form else 0
            ):
                conflict("فرم توسط مدیر دیگری تغییر کرده است؛ دوباره بارگذاری کنید.")
            layout = validate_layout(entity, change.get("layout"))
            if not form:
                form = FormLayout.objects.create(entity=entity, draft=layout)
            version = FormVersion.objects.create(
                layout=form,
                number=(
                    form.versions.order_by("-number")
                    .values_list("number", flat=True)
                    .first()
                    or 0
                )
                + 1,
                schema=deepcopy(layout),
                created_by=request.user,
            )
            before = form.published.schema if form.published_id else None
            form.published, form.draft, form.revision = (
                version,
                deepcopy(layout),
                form.revision + 1,
            )
            form.save()
            emit_definition(
                workspace,
                request.user,
                "definition.form_published",
                form,
                before,
                layout,
            )
        definition = validate_definition(
            workspace, code, request.data.get("definition")
        )
        if row:
            row.definition, row.revision = definition, revision + 1
            row.save(update_fields=["definition", "revision", "updated_at"])
        else:
            row = SurfaceConfiguration.objects.create(
                workspace=workspace, code=code, definition=definition
            )
        emit_definition(
            workspace,
            request.user,
            "surface.configuration.published",
            row,
            previous,
            definition,
        )
        return Response(surface_schema(workspace, code, request.user))


class SurfaceFieldEndpoint(SurfaceEndpoint):
    @transaction.atomic
    def post(self, request, slug, code):
        if code not in DESIGNABLE_SURFACES:
            raise ValidationError("صفحه‌های ثابت سیستم در دامنه فرم‌ساز نیستند.")
        workspace = self.context(request, slug, code)
        allowed(request, workspace, code, manage=True)
        self.require(request, workspace, "Field.Create")
        data = new_field_data(request.data)
        kind = data["kind"]
        identifier = f"page-{uuid4().hex}"
        data.update(code=identifier, kind=kind, config={})
        if kind in {"select", "multi_select"}:
            options = request.data.get("options")
            category = LookupCategory.objects.create(
                workspace=workspace,
                code=identifier,
                title=str(data.get("title", ""))[:255],
            )
            LookupValue.objects.bulk_create(
                [
                    LookupValue(
                        category=category,
                        code=f"option-{index + 1}",
                        title=title.strip(),
                        position=index,
                    )
                    for index, title in enumerate(options)
                ]
            )
            data["lookup"] = str(category.id)
        serializer = FieldDefinitionSerializer(
            data=data, context={"workspace": workspace}
        )
        serializer.is_valid(raise_exception=True)
        row = serializer.save(workspace=workspace, created_by=request.user)
        emit_definition(
            workspace,
            request.user,
            "definition.field_created",
            row,
            None,
            serializer.data,
        )
        return Response(serializer.data, status=201)


class SurfaceValuesEndpoint(SurfaceEndpoint):
    def get(self, request, slug, code):
        workspace = self.context(request, slug, code)
        raw = request.query_params.get("ids", "").split(",")
        try:
            if len(raw) > 100:
                raise ValueError()
            identifiers = [UUID(value) for value in raw if value]
        except (ValueError, TypeError) as exc:
            raise ValidationError("حداکثر صد شناسه معتبر ارسال کنید.") from exc
        return Response({"values": read_values(request, workspace, code, identifiers)})


class SurfaceOptionsEndpoint(SurfaceEndpoint):
    def get(self, request, slug, code, field_code):
        workspace = self.context(request, slug, code)
        if SURFACES[code].get("engine"):
            from plane.app.views.workspace.entity import EngineOptionsEndpoint

            return EngineOptionsEndpoint().get(request, slug, code, field_code)
        schema = surface_schema(workspace, code, request.user)
        field = next(
            (f for f in schema["schema"]["fields"] if f["code"] == field_code), None
        )
        if not field:
            raise PermissionDenied()
        config, kind = field["config"], field["kind"]
        query, (offset, size) = request.query_params.get("search", "")[:200], page(
            request
        )
        selected = [
            v for v in request.query_params.get("selected", "").split(",") if v
        ][:100]
        resolving = request.query_params.get("resolve") == "true" and bool(selected)
        if field.get("lookup"):
            rows = LookupValue.objects.filter(
                category__workspace=workspace, category__code=field["lookup"]
            )
            rows = rows.filter(
                Q(is_active=True, category__is_active=True)
                | Q(
                    **{"code__in" if config.get("lookup_codes") else "id__in": selected}
                )
            )
            if resolving:
                rows = rows.filter(
                    **{"code__in" if config.get("lookup_codes") else "id__in": selected}
                )
            elif config.get("depends_on"):
                parent = request.query_params.get("parent")
                parent_field = FieldDefinition.objects.filter(
                    workspace=workspace, code=config["depends_on"]
                ).first()
                if parent and parent_field and parent_field.config.get("lookup_codes"):
                    rows = rows.filter(
                        parent__category_id=parent_field.lookup_id, parent__code=parent
                    )
                else:
                    rows = rows.filter(parent_id=parent) if parent else rows.none()
            rows = rows.filter(title__icontains=query).order_by("position", "id")
            results = [
                {
                    "id": r.code if config.get("lookup_codes") else str(r.id),
                    "title": r.title,
                    "color": r.color,
                    "disabled": not r.is_active,
                }
                for r in rows[offset * size : (offset + 1) * size]
            ]
        elif kind == "relation":
            target = get_object_or_404(
                EntityType,
                workspace=workspace,
                code=field["relation_entity"],
                parent__isnull=True,
            )
            require_action(target, request.user, "view", request)
            rows = (
                native_queryset(target, request.user, request)
                if target.adapter
                else record_queryset(target, request.user, request)
            )
            if resolving:
                rows = rows.filter(id__in=selected)
            title_field = next(
                (
                    f
                    for f in present_schema(target, request.user)["fields"]
                    if f["code"] == target.title_field
                ),
                None,
            )
            if not title_field or title_field["config"].get("visible_if"):
                rows = rows.none()
            title_key = (
                ("reason" if target.adapter == "leave" else "name")
                if target.adapter
                else f"data__{target.title_field}"
            )
            rows = rows.filter(**{f"{title_key}__icontains": query}).order_by("id")
            results = []
            for row in rows[offset * size : (offset + 1) * size]:
                payload = (
                    record_payload(target, request.user, native=row, request=request)
                    if target.adapter
                    else record_payload(target, request.user, row, request=request)
                )
                results.append({"id": payload["id"], "title": payload["title"]})
        else:
            model = {
                "user": User,
                "unit": OrganizationUnit,
                "role": OrganizationRole,
            }.get(kind)
            if not model:
                return Response({"results": [], "count": 0})
            if kind == "user":
                rows = (
                    User.objects.filter(
                        is_active=True,
                        member_workspace__workspace=workspace,
                        member_workspace__is_active=True,
                        member_workspace__deleted_at__isnull=True,
                    )
                    .filter(
                        Q(display_name__icontains=query)
                        | Q(first_name__icontains=query)
                    )
                    .distinct()
                )
            else:
                rows = model.objects.filter(
                    workspace=workspace,
                    is_active=True,
                    **{("name" if kind == "role" else "title") + "__icontains": query},
                )
            if resolving:
                rows = rows.filter(id__in=selected)
            rows = rows.order_by("id")
            results = [
                {
                    "id": str(r.id),
                    "title": (
                        (r.display_name or r.first_name or r.email)
                        if kind == "user"
                        else r.name if kind == "role" else r.title
                    ),
                }
                for r in rows[offset * size : (offset + 1) * size]
            ]
        return Response({"results": results, "count": rows.count()})


class SurfaceFileEndpoint(SurfaceEndpoint):
    def post(self, request, slug, code, field_code):
        workspace = self.context(request, slug, code)
        from plane.app.services.surface_config import WRITE_PERMISSIONS

        permissions = {
            p for codes in WRITE_PERMISSIONS.get(code, {}).values() for p in codes
        }
        if code in WRITE_PERMISSIONS and not any(
            has_permission(request.user, workspace, p, request=request)
            for p in permissions
        ):
            raise PermissionDenied()
        field = next(
            (
                f
                for f in surface_schema(workspace, code, request.user)["schema"][
                    "fields"
                ]
                if f["code"] == field_code and f["kind"] == "file"
            ),
            None,
        )
        if not field or field["config"].get("readonly"):
            raise PermissionDenied()
        upload = request.FILES.get("file")
        if not upload:
            raise ValidationError("یک فایل انتخاب کنید.")
        validate_file(field["config"], upload.name, upload.size)
        asset = FileAsset.objects.create(
            workspace=workspace,
            user=request.user,
            asset=upload,
            entity_type="CRM_FIELD",
            entity_identifier="",
            size=upload.size,
            is_uploaded=True,
            attributes={
                "entity": code,
                "field": field_code,
                "name": PurePath(upload.name).name,
            },
        )
        return Response(
            {"id": str(asset.id), "title": asset.attributes["name"]}, status=201
        )

    def get(self, request, slug, code, field_code, asset_id):
        workspace = self.context(request, slug, code)
        asset = get_object_or_404(
            FileAsset,
            id=asset_id,
            workspace=workspace,
            is_uploaded=True,
            attributes__field=field_code,
            entity_type__in=["CRM_FIELD", "CRM_FIELD_DEFAULT"],
        )
        record = request.query_params.get("record")
        if record:
            try:
                identifier = UUID(record)
            except ValueError as exc:
                raise ValidationError("شناسه رکورد معتبر نیست.") from exc
            permitted = str(asset.id) in read_values(
                request, workspace, code, [identifier]
            ).get(record, {}).get(field_code, [])
        else:
            field = next(
                (
                    f
                    for f in surface_schema(workspace, code, request.user)["schema"][
                        "fields"
                    ]
                    if f["code"] == field_code
                ),
                None,
            )
            permitted = bool(field) and (
                asset.user_id == request.user.id
                and not asset.entity_identifier
                or str(asset.id) in (field["config"].get("default") or [])
            )
        if not permitted:
            raise PermissionDenied()
        return FileResponse(
            asset.asset.open("rb"),
            as_attachment=True,
            filename=asset.attributes.get("name", "file"),
        )
