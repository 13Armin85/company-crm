"""Adapt existing user/unit operations without duplicating their access policies."""

from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError

from .entity_identifiers import format_record_number

from plane.db.models import (
    User,
    OrganizationUnit,
    WorkspaceMember,
    UserOrganizationRole,
)


class NativePayloadRequest:
    def __init__(self, request, data):
        self.original = request
        self.data = data

    def __getattr__(self, name):
        return getattr(self.original, name)


def directory_rows(entity):
    if entity.adapter == "user":
        return User.objects.filter(
            member_workspace__workspace=entity.workspace,
            member_workspace__deleted_at__isnull=True,
        ).distinct()
    return OrganizationUnit.objects.filter(workspace=entity.workspace)


def native_value(entity, native, source):
    if entity.adapter == "ticket" and source == "work_status":
        from .unified_work import work_status

        return work_status(native)
    if entity.adapter == "user" and source == "password":
        return None
    if entity.adapter == "user" and source == "role_ids":
        return list(
            map(
                str,
                UserOrganizationRole.objects.filter(
                    workspace=entity.workspace,
                    user=native,
                    is_active=True,
                    role__is_active=True,
                ).values_list("role_id", flat=True),
            )
        )
    return getattr(native, source)


def ensure_directory_record(entity, native, subtype=None):
    from django.db import transaction
    from plane.db.models import (
        EntityRecord,
        SystemIdentifierCounter,
        FormLayout,
        Workspace,
    )

    with transaction.atomic():
        Workspace.objects.select_for_update().get(id=entity.workspace_id)
        row = EntityRecord.objects.filter(entity=entity, source_id=native.id).first()
        if row:
            return row
        counter = SystemIdentifierCounter.locked(f"entity:{entity.id}", "default")
        form = FormLayout.objects.filter(entity=entity).first()
        row = EntityRecord.objects.create(
            entity=entity,
            workspace=entity.workspace,
            source_id=native.id,
            subtype=subtype,
            number=format_record_number(entity, counter.advance()),
            data={},
            form_version=form.published if form else None,
        )
        from .entity_numbering import assign_numbers

        assign_numbers(row)
        from .entity_schema import schema_fields
        from plane.db.models import FieldDefinition
        from django.utils import timezone

        _, fields = schema_fields(entity)
        FieldDefinition.objects.filter(
            workspace=entity.workspace, code__in=fields, used_at__isnull=True
        ).update(used_at=timezone.now())
        return row


def delete_directory(entity, native, request):
    if entity.adapter == "user":
        from .access_mutations import remove_workspace_user

        remove_workspace_user(entity.workspace, native)
    else:
        from plane.app.views.workspace.organization import (
            OrganizationUnitDetailEndpoint,
        )

        response = OrganizationUnitDetailEndpoint().delete(
            request, slug=entity.workspace.slug, unit_id=native.id
        )
        if response.status_code >= 400:
            raise ValidationError(response.data)


def check_directory_deletion(workspace, adapter, identifier, actor=None, request=None):
    from plane.db.models import EntityType
    from .entity_relations import before_delete

    entity = EntityType.objects.filter(
        workspace=workspace, adapter=adapter, parent__isnull=True
    ).first()
    if entity:
        before_delete(entity, identifier, actor, request, apply=True)


def save_directory(entity, actor, data, native, request):
    if request is None:
        raise ValidationError(
            "ثبت اطلاعات کاربر و واحد باید از مسیر احراز هویت‌شده سامانه انجام شود."
        )
    proxy = NativePayloadRequest(request, data)
    proxy._engine_directory_bridge = True
    if entity.adapter == "user":
        from plane.app.views.workspace.member import WorkSpaceMemberViewSet
        from plane.app.views.workspace.organization import (
            OrganizationUserProfileEndpoint,
        )

        if native:
            # Password changes have their own permission and endpoint.
            data.pop("password", None)
            response = OrganizationUserProfileEndpoint().patch(
                proxy, slug=entity.workspace.slug, user_id=native.id
            )
            identifier = native.id
        else:
            response = WorkSpaceMemberViewSet().create(
                proxy, slug=entity.workspace.slug
            )
            member = response.data.get("member") if response.status_code < 400 else None
            identifier = member.get("id") if isinstance(member, dict) else None
            if not identifier and response.status_code < 400:
                identifier = (
                    User.objects.filter(email__iexact=data.get("email", ""))
                    .values_list("id", flat=True)
                    .first()
                )
        model = User
    else:
        from plane.app.views.workspace.organization import (
            OrganizationUnitListEndpoint,
            OrganizationUnitDetailEndpoint,
        )

        response = (
            OrganizationUnitDetailEndpoint().patch(
                proxy, slug=entity.workspace.slug, unit_id=native.id
            )
            if native
            else OrganizationUnitListEndpoint().post(proxy, slug=entity.workspace.slug)
        )
        identifier = native.id if native else response.data.get("id")
        model = OrganizationUnit
    if response.status_code >= 400:
        from rest_framework.exceptions import APIException

        error = APIException(response.data)
        error.status_code = response.status_code
        raise error
    return get_object_or_404(model, id=identifier)
