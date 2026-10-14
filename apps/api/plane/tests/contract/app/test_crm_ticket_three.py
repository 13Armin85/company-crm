from datetime import timedelta
import importlib

import pytest
from django.db import connection
from django.test import Client
from django.utils import timezone
from rest_framework.test import APIClient

from plane.app.services.access_control import get_effective_permissions
from plane.db.models import (
    OrganizationPermission,
    OrganizationRole,
    OrganizationUnit,
    OrganizationUnitMember,
    RolePermission,
    User,
    UserOrganizationRole,
    UserPermissionException,
    WorkspaceMember,
    TicketRoutingRule,
    Workspace,
)
from .test_crm_access_control import member, grant_role, exception

pytestmark = pytest.mark.django_db


def test_role_provenance_survives_direct_allow_and_deny(workspace):
    user = member(workspace, "ticket-three-provenance")
    first = grant_role(workspace, user, ["User.View", "Role.View"], "first")
    second = grant_role(workspace, user, ["User.View"], "second")
    exception(workspace, user, "User.View", "DENY")
    exception(workspace, user, "User.View", "ALLOW")
    exception(workspace, user, "User.Create", "ALLOW")
    result = get_effective_permissions(user, workspace)
    grants = {row["code"]: row for row in result["role_grants"]}
    assert set(grants["User.View"]["role_ids"]) == {str(first.id), str(second.id)}
    assert "User.Create" not in grants
    assert "User.View" not in result["permissions"]
    first.is_active = False
    first.save()
    grants = {row["code"]: row for row in get_effective_permissions(user, workspace)["role_grants"]}
    assert grants["User.View"]["role_ids"] == [str(second.id)]
    assert "Role.View" not in grants


@pytest.mark.parametrize("endpoint", ["membership", "members"])
def test_deleted_members_are_hidden_and_readd_cannot_restore_grants(session_client, workspace, endpoint):
    user = member(workspace, f"ticket-three-{endpoint}")
    grant_role(workspace, user, ["Role.Delete"], "removed custom role")
    exception(workspace, user, "User.Create", "ALLOW")
    unit = OrganizationUnit.objects.create(workspace=workspace, title="removed unit")
    OrganizationUnitMember.objects.create(unit=unit, user=user)
    membership = WorkspaceMember.objects.get(workspace=workspace, member=user)
    path = f"organization/users/{user.id}/membership/" if endpoint == "membership" else f"members/{membership.id}/"
    assert session_client.delete(f"/api/workspaces/{workspace.slug}/{path}").status_code == 204
    membership.refresh_from_db()
    assert membership.deleted_at is not None
    assert not WorkspaceMember.objects.filter(id=membership.id).exists()
    for suffix in ("", "effective-permissions/", "exceptions/"):
        assert (
            session_client.get(f"/api/workspaces/{workspace.slug}/organization/users/{user.id}/{suffix}").status_code
            == 404
        )
    assert str(user.id) not in [
        str(row["member"]["id"]) for row in session_client.get(f"/api/workspaces/{workspace.slug}/members/").data
    ]
    response = session_client.post(f"/api/workspaces/{workspace.slug}/members/", {"email": user.email}, format="json")
    assert response.status_code == 201
    assert str(response.data["id"]) != str(membership.id)
    assert not OrganizationUnitMember.objects.filter(user=user, unit=unit).exists()
    assert "Role.Delete" not in get_effective_permissions(user, workspace)["permissions"]
    assert "User.Create" not in get_effective_permissions(user, workspace)["permissions"]


def test_atomic_creation_with_multiple_roles_and_units(session_client, workspace):
    roles = [OrganizationRole.objects.create(workspace=workspace, name=f"creation-role-{index}") for index in range(2)]
    units = [OrganizationUnit.objects.create(workspace=workspace, title=f"creation-unit-{index}") for index in range(2)]
    body = {
        "email": "ticket-three-create@example.com",
        "username": "ticket-three-create",
        "password": "SafePassword!2026",
        "role_ids": [str(row.id) for row in roles],
        "unit_ids": [str(row.id) for row in units],
    }
    response = session_client.post(f"/api/workspaces/{workspace.slug}/members/", body, format="json")
    assert response.status_code == 201
    user = User.objects.get(email=body["email"])
    assert set(
        UserOrganizationRole.objects.filter(workspace=workspace, user=user, is_active=True).values_list(
            "role_id", flat=True
        )
    ) == {row.id for row in roles}
    assert set(OrganizationUnitMember.objects.filter(user=user, is_active=True).values_list("unit_id", flat=True)) == {
        row.id for row in units
    }
    units[0].is_active = False
    units[0].save()
    body.update(email="ticket-three-rollback@example.com", username="ticket-three-rollback")
    assert session_client.post(f"/api/workspaces/{workspace.slug}/members/", body, format="json").status_code == 400
    assert not User.objects.filter(email=body["email"]).exists()


def test_creation_does_not_activate_existing_inactive_global_account(session_client, workspace):
    user = User.objects.create(
        email="inactive-global-three@example.com", username="inactive-global-three", is_active=False
    )
    assert (
        session_client.post(
            f"/api/workspaces/{workspace.slug}/members/", {"email": user.email}, format="json"
        ).status_code
        == 400
    )
    user.refresh_from_db()
    assert not user.is_active
    assert not WorkspaceMember.objects.filter(workspace=workspace, member=user).exists()


def test_creation_unit_assignment_requires_its_own_permission(workspace):
    actor = member(workspace, "ticket-three-creator")
    grant_role(workspace, actor, ["User.Create"], "limited creator")
    client = APIClient()
    client.force_authenticate(actor)
    unit = OrganizationUnit.objects.create(workspace=workspace, title="protected assignment")
    response = client.post(
        f"/api/workspaces/{workspace.slug}/members/",
        {
            "email": "forbidden-three@example.com",
            "username": "forbidden-three",
            "password": "SafePassword!2026",
            "unit_ids": [str(unit.id)],
        },
        format="json",
    )
    assert response.status_code == 403
    assert not User.objects.filter(email="forbidden-three@example.com").exists()


def test_role_delete_revokes_only_that_role_and_preserves_name_reuse(session_client, workspace):
    user = member(workspace, "ticket-three-delete-role")
    role = grant_role(workspace, user, ["User.View"], "reusable deleted role")
    other = grant_role(workspace, user, ["Role.View"], "remaining role")
    exception(workspace, user, "User.Create", "ALLOW")
    path = f"/api/workspaces/{workspace.slug}/organization/roles/{role.id}/"
    assert session_client.get(path).status_code == 200
    assert session_client.delete(path).status_code == 204
    role.refresh_from_db()
    assert role.deleted_at is not None
    assert session_client.get(path).status_code == 404
    permissions = get_effective_permissions(user, workspace)["permissions"]
    assert "User.View" not in permissions
    assert {"Role.View", "User.Create"}.issubset(permissions)
    assert UserOrganizationRole.objects.filter(role=other, user=user, is_active=True).exists()
    assert (
        session_client.post(
            f"/api/workspaces/{workspace.slug}/organization/roles/", {"name": role.name}, format="json"
        ).status_code
        == 201
    )


def test_delete_dependencies_and_system_roles_are_protected(session_client, workspace):
    parent = OrganizationUnit.objects.create(workspace=workspace, title="parent")
    child = OrganizationUnit.objects.create(workspace=workspace, parent=parent, title="child")
    role = OrganizationRole.objects.create(workspace=workspace, name="routing dependency")
    rule = TicketRoutingRule.objects.create(workspace=workspace, name="active route", unit=child, required_role=role)
    prefix = f"/api/workspaces/{workspace.slug}/organization/"
    for path in (f"units/{parent.id}/", f"units/{child.id}/", f"roles/{role.id}/"):
        assert session_client.delete(prefix + path).status_code == 400
    admin = OrganizationRole.objects.get(workspace=workspace, system_key="admin")
    assert session_client.delete(prefix + f"roles/{admin.id}/").status_code == 400
    rule.is_active = False
    rule.save()
    assert session_client.delete(prefix + f"units/{child.id}/").status_code == 204
    assert session_client.delete(prefix + f"units/{parent.id}/").status_code == 204


def test_unit_toggle_preserves_structure_and_members(session_client, workspace):
    parent = OrganizationUnit.objects.create(workspace=workspace, title="toggle parent", is_active=False)
    user = member(workspace, "ticket-three-toggle")
    unit = OrganizationUnit.objects.create(workspace=workspace, title="toggle child", parent=parent, manager=user)
    OrganizationUnitMember.objects.create(unit=unit, user=user)
    path = f"/api/workspaces/{workspace.slug}/organization/units/{unit.id}/"
    for active in (False, True):
        response = session_client.patch(path, {"is_active": active}, format="json")
        assert response.status_code == 200
        assert response.data["parent_id"] == parent.id
        assert response.data["manager_id"] == user.id
        assert response.data["member_ids"] == [user.id]
        assert response.data["is_active"] == active


@pytest.mark.parametrize("kind,code", [("roles", "Role.Disable"), ("units", "OrganizationUnit.Disable")])
def test_disable_permission_cannot_delete(workspace, kind, code):
    actor = member(workspace, f"ticket-three-limited-{kind}")
    grant_role(workspace, actor, [code], "limited status operator")
    client = APIClient()
    client.force_authenticate(actor)
    obj = (
        OrganizationRole.objects.create(workspace=workspace, name="status only")
        if kind == "roles"
        else OrganizationUnit.objects.create(workspace=workspace, title="status only")
    )
    path = f"/api/workspaces/{workspace.slug}/organization/{kind}/{obj.id}/"
    assert client.patch(path, {"is_active": False}, format="json").status_code == 200
    assert client.delete(path).status_code == 403
    obj.refresh_from_db()
    assert obj.deleted_at is None


def test_editing_timed_exception_without_period_preserves_bounds(session_client, workspace):
    user = member(workspace, "ticket-three-period")
    starts = timezone.now() - timedelta(hours=1)
    ends = timezone.now() + timedelta(hours=1)
    row = exception(workspace, user, "User.View", "ALLOW", starts_at=starts, ends_at=ends)
    path = f"/api/workspaces/{workspace.slug}/organization/users/{user.id}/exceptions/{row.id}/"
    assert session_client.patch(path, {"effect": "DENY"}, format="json").status_code == 200
    row.refresh_from_db()
    assert row.starts_at == starts and row.ends_at == ends


@pytest.mark.parametrize(
    "code,read_status,write_status",
    [("Role.View", 200, 403), ("Role.Permission.Assign", 200, 200), ("Permission.View", 403, 403)],
)
def test_role_permission_detail_has_independent_read_and_assign_access(workspace, code, read_status, write_status):
    user = member(workspace, "ticket-three-permission-editor")
    grant_role(workspace, user, [code], "editor access")
    target = OrganizationRole.objects.create(workspace=workspace, name="target role")
    client = APIClient()
    client.force_authenticate(user=user)
    path = f"/api/workspaces/{workspace.slug}/organization/roles/{target.id}/"
    assert client.get(path).status_code == read_status
    assert client.patch(path, {"permission_ids": []}, format="json").status_code == write_status
    assert client.get(f"/api/workspaces/{workspace.slug}/organization/permissions/").status_code == 200


def test_role_edit_preserves_existing_inactive_grants_but_cannot_add_new_ones(session_client, workspace):
    role = OrganizationRole.objects.create(workspace=workspace, name="historical grants")
    legacy = OrganizationPermission.objects.create(
        workspace=workspace, code="Legacy.Hidden", name="legacy", is_active=False
    )
    original = RolePermission.objects.create(role=role, permission=legacy)
    active = OrganizationPermission.objects.get(workspace=workspace, code="User.View")
    path = f"/api/workspaces/{workspace.slug}/organization/roles/{role.id}/"
    assert (
        session_client.patch(path, {"permission_ids": [str(legacy.id), str(active.id)]}, format="json").status_code
        == 200
    )
    assert RolePermission.objects.filter(pk=original.pk).exists()
    other = OrganizationPermission.objects.create(
        workspace=workspace, code="Legacy.Forbidden", name="inactive", is_active=False
    )
    assert (
        session_client.patch(path, {"permission_ids": [str(legacy.id), str(other.id)]}, format="json").status_code
        == 400
    )
    assert RolePermission.objects.filter(role=role, permission=active).exists()


def test_delete_permission_migration_is_additive_and_does_not_restore_grants(workspace):
    from django.apps import apps

    migration = importlib.import_module("plane.db.migrations.0131_crm_delete_permissions")
    admin = OrganizationRole.objects.get(workspace=workspace, system_key="admin")
    permission = OrganizationPermission.objects.get(workspace=workspace, code="Role.Delete")
    RolePermission.objects.filter(role=admin, permission=permission).delete(soft=False)
    with connection.schema_editor() as editor:
        migration.add_delete_permissions(apps, editor)
    assert not RolePermission.objects.filter(role=admin, permission=permission).exists()


def test_delete_permission_migration_first_run_preserves_existing_grants(workspace):
    from django.apps import apps

    migration = importlib.import_module("plane.db.migrations.0131_crm_delete_permissions")
    admin = OrganizationRole.objects.get(workspace=workspace, system_key="admin")
    user = member(workspace, "ticket-three-existing-grants")
    role = grant_role(workspace, user, ["User.View"], "existing custom grants")
    original = list(RolePermission.objects.filter(role=role).values_list("id", flat=True))
    OrganizationPermission.objects.filter(
        workspace=workspace, code__in=["Role.Delete", "OrganizationUnit.Delete"]
    ).delete(soft=False)
    with connection.schema_editor() as editor:
        migration.add_delete_permissions(apps, editor)
        migration.add_delete_permissions(apps, editor)
    for code in ("Role.Delete", "OrganizationUnit.Delete"):
        assert RolePermission.objects.filter(role=admin, permission__code=code).count() == 1
        assert not RolePermission.objects.filter(role=role, permission__code=code).exists()
    assert list(RolePermission.objects.filter(role=role).values_list("id", flat=True)) == original


def test_create_user_rejects_units_from_another_workspace_atomically(session_client, workspace, create_user):
    other = Workspace.objects.create(name="Other ticket-three company", slug="other-ticket-three", owner=create_user)
    unit = OrganizationUnit.objects.create(workspace=other, title="foreign unit")
    body = {
        "email": "ticket-three-foreign-unit@example.com",
        "username": "ticket-three-foreign-unit",
        "password": "SafePassword!2026",
        "unit_ids": [str(unit.id)],
    }
    assert session_client.post(f"/api/workspaces/{workspace.slug}/members/", body, format="json").status_code == 400
    assert not User.objects.filter(email=body["email"]).exists()


@pytest.mark.parametrize("metadata_failure", [False, True])
def test_sign_out_invalidates_real_session_cookie(create_user, metadata_failure, mocker):
    client = Client()
    client.force_login(create_user)
    assert client.get("/api/users/me/").status_code == 200
    old_cookie = client.cookies["session-id"].value
    if metadata_failure:
        mocker.patch(
            "plane.authentication.views.app.signout.User.objects.filter",
            side_effect=RuntimeError("metadata unavailable"),
        )
    assert client.post("/auth/sign-out/", {}).status_code == 302
    assert "_auth_user_id" not in client.session
    # A different tab retaining the old cookie cannot restore the server session.
    other = Client()
    other.cookies["session-id"] = old_cookie
    assert other.get("/api/users/me/").status_code == 401
