"""Batch synchronization preserves permission identity and deliberate role grants."""

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from plane.app.services.permission_registry import (
    PERMISSION_REGISTRY,
    bootstrap_workspace_access,
    sync_permission_catalog,
)
from plane.db.models import OrganizationPermission, OrganizationRole, RolePermission

pytestmark = [pytest.mark.django_db, pytest.mark.contract]


def test_idempotent_catalog_sync_has_bounded_queries(workspace):
    before = dict(OrganizationPermission.objects.filter(workspace=workspace).values_list("code", "id"))
    with CaptureQueriesContext(connection) as queries:
        sync_permission_catalog(workspace)
    assert len(queries) <= 6, len(queries)
    assert dict(OrganizationPermission.objects.filter(workspace=workspace).values_list("code", "id")) == before


def test_sync_updates_definitions_without_replacing_ids_or_role_grants(workspace):
    permission = OrganizationPermission.objects.get(workspace=workspace, code="Issue.View")
    role = OrganizationRole.objects.create(workspace=workspace, name="Custom")
    grant = RolePermission.objects.create(role=role, permission=permission)
    OrganizationPermission.objects.filter(pk=permission.pk).update(name="Old", is_active=False)
    unknown = OrganizationPermission.objects.create(workspace=workspace, code="Unknown.View", name="Unknown")
    with CaptureQueriesContext(connection) as queries:
        sync_permission_catalog(workspace)
    permission.refresh_from_db()
    unknown.refresh_from_db()
    assert len(queries) <= 8, len(queries)
    assert permission.name == PERMISSION_REGISTRY["Issue.View"]["name"]
    assert permission.is_active is True
    assert unknown.is_active is False
    assert RolePermission.objects.get(pk=grant.pk).permission_id == permission.pk
    assert set(role.permissions.values_list("code", flat=True)) == {"Issue.View"}


def test_bootstrap_preserves_explicitly_removed_system_role_grants(workspace):
    role = OrganizationRole.objects.get(workspace=workspace, system_key="member")
    RolePermission.objects.filter(role=role, permission__code="Issue.View").delete(soft=False)
    bootstrap_workspace_access(workspace)
    assert not RolePermission.objects.filter(role=role, permission__code="Issue.View").exists()


def test_soft_deleted_catalog_history_is_not_reactivated(workspace):
    old = OrganizationPermission.objects.get(workspace=workspace, code="Issue.View")
    OrganizationPermission.objects.filter(pk=old.pk).update(deleted_at=timezone.now())
    sync_permission_catalog(workspace)
    active = OrganizationPermission.objects.get(workspace=workspace, code="Issue.View")
    assert active.pk != old.pk
    assert OrganizationPermission.all_objects.get(pk=old.pk).deleted_at is not None
