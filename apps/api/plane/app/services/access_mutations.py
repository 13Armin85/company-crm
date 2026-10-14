"""Transactional CRM mutations, compatibility synchronization and safe auditing."""

import json
from contextlib import contextmanager
from uuid import UUID

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from plane.db.models import (
    APIActivityLog,
    Workspace,
    WorkspaceMember,
    OrganizationRole,
    UserOrganizationRole,
    OrganizationUnitMember,
    OrganizationUnitDelegate,
    OrganizationUnit,
    UserAbsence,
    UserPermissionException,
    ProjectMember,
)
from .access_control import ensure_admin_available, has_permission, sync_plane_membership


@contextmanager
def access_transaction(workspace):
    with transaction.atomic():
        Workspace.objects.select_for_update().get(pk=workspace.pk)
        yield
        ensure_admin_available(workspace)


def audit_access(request, workspace, action, object_id, *, changes=None):
    # Reuse Plane's persistent audit model; never store raw request bodies or secrets.
    APIActivityLog.objects.create(
        token_identifier=f"crm:{workspace.id}:{request.user.id}",
        path=request.path,
        method=request.method,
        response_code=200,
        body=json.dumps({"action": action, "object_id": str(object_id), "changes": changes}, default=str),
        created_by_id=request.user.id,
    )


def require_field_permission(request, workspace, field, code):
    if field in request.data and not has_permission(request.user, workspace, code, request=request):
        raise PermissionDenied(f"Missing permission: {code}")


def normalize_ids(values, field):
    if not isinstance(values, list):
        raise ValidationError({field: "فهرستی از شناسه‌ها ارسال کنید."})
    try:
        result = [UUID(str(value)) for value in values]
    except (TypeError, ValueError, AttributeError) as exc:
        raise ValidationError({field: "شناسه نامعتبر است."}) from exc
    if len(result) != len(set(result)):
        raise ValidationError({field: "شناسه تکراری قابل پذیرش نیست."})
    return result


def sync_user_roles(workspace, user, role_ids):
    role_ids = normalize_ids(role_ids, "role_ids")
    roles = list(OrganizationRole.objects.filter(workspace=workspace, id__in=role_ids, is_active=True))
    if len(roles) != len(set(role_ids)):
        raise ValidationError({"role_ids": "یک یا چند نقش غیرفعال، حذف‌شده یا متعلق به شرکت دیگر است."})
    if not WorkspaceMember.objects.filter(
        workspace=workspace, member=user, is_active=True, member__is_active=True
    ).exists():
        raise ValidationError(
            {"role_ids": "برای تخصیص نقش، ابتدا عضویت کاربر را فعال و ذخیره کنید؛ حساب جهانی نیز باید فعال باشد."}
        )
    UserOrganizationRole.objects.filter(workspace=workspace, user=user).exclude(role_id__in=role_ids).update(
        is_active=False
    )
    for role in roles:
        UserOrganizationRole.objects.update_or_create(
            workspace=workspace, user=user, role=role, defaults={"is_active": True}
        )
    sync_plane_membership(workspace, user)


def remove_workspace_user(workspace, user):
    # Retain identity, authored work and historical references. A new membership
    # must never reactivate any of these revoked workspace-scoped relations.
    now = timezone.now()
    for rows in (
        WorkspaceMember.objects.filter(workspace=workspace, member=user),
        ProjectMember.objects.filter(workspace=workspace, member=user),
        UserOrganizationRole.objects.filter(workspace=workspace, user=user),
        OrganizationUnitMember.objects.filter(unit__workspace=workspace, user=user),
        OrganizationUnitDelegate.objects.filter(unit__workspace=workspace, user=user),
        UserPermissionException.objects.filter(workspace=workspace, user=user),
    ):
        rows.update(is_active=False, deleted_at=now, updated_at=now)
    OrganizationUnit.objects.filter(workspace=workspace, manager=user).update(manager=None, updated_at=now)
    UserAbsence.objects.filter(workspace=workspace, user=user, status="scheduled").update(
        status="cancelled", updated_at=now
    )
