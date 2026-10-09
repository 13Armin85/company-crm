"""Transactional CRM mutations, compatibility synchronization and safe auditing."""

import json
from contextlib import contextmanager
from uuid import UUID

from django.core.exceptions import ValidationError
from django.db import transaction
from rest_framework.exceptions import PermissionDenied

from plane.db.models import (
    APIActivityLog,
    Workspace,
    WorkspaceMember,
    OrganizationRole,
    UserOrganizationRole,
    OrganizationUnitMember,
    OrganizationUnitDelegate,
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
        raise ValidationError({field: "Expected a list of identifiers."})
    try:
        result = [UUID(str(value)) for value in values]
    except (TypeError, ValueError, AttributeError) as exc:
        raise ValidationError({field: "Invalid identifier."}) from exc
    if len(result) != len(set(result)):
        raise ValidationError({field: "Duplicate identifiers are not allowed."})
    return result


def sync_user_roles(workspace, user, role_ids):
    role_ids = normalize_ids(role_ids, "role_ids")
    roles = list(OrganizationRole.objects.filter(workspace=workspace, id__in=role_ids, is_active=True))
    if len(roles) != len(set(role_ids)):
        raise ValidationError({"role_ids": "One or more roles are invalid or inactive."})
    if not WorkspaceMember.objects.filter(
        workspace=workspace, member=user, is_active=True, member__is_active=True
    ).exists():
        raise ValidationError({"role_ids": "Role editing is disabled for inactive users."})
    UserOrganizationRole.objects.filter(workspace=workspace, user=user).exclude(role_id__in=role_ids).update(
        is_active=False
    )
    for role in roles:
        UserOrganizationRole.objects.update_or_create(
            workspace=workspace, user=user, role=role, defaults={"is_active": True}
        )
    sync_plane_membership(workspace, user)


def remove_workspace_user(workspace, user):
    WorkspaceMember.objects.filter(workspace=workspace, member=user).update(is_active=False)
    ProjectMember.objects.filter(workspace=workspace, member=user).update(is_active=False)
    UserOrganizationRole.objects.filter(workspace=workspace, user=user).update(is_active=False)
    OrganizationUnitMember.objects.filter(unit__workspace=workspace, user=user).update(is_active=False)
    OrganizationUnitDelegate.objects.filter(unit__workspace=workspace, user=user).update(is_active=False)
    UserPermissionException.objects.filter(workspace=workspace, user=user).update(is_active=False)
