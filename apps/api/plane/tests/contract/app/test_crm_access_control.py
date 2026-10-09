from datetime import timedelta

import pytest
from django.core.exceptions import ValidationError
from django.utils import timezone

from plane.app.services.access_control import (
    delegation_context,
    explain_permission,
    get_effective_permissions,
    has_permission,
)
from plane.app.services.permission_registry import bootstrap_workspace_access
from plane.db.models import (
    APIActivityLog,
    OrganizationPermission,
    OrganizationRole,
    OrganizationUnit,
    OrganizationUnitDelegate,
    RolePermission,
    User,
    UserAbsence,
    UserOrganizationRole,
    UserPermissionException,
    Workspace,
    WorkspaceMember,
)

pytestmark = pytest.mark.django_db


def member(workspace, suffix):
    user = User.objects.create_user(
        email=f"access-{suffix}@example.com", username=f"access-{suffix}", password="SafePassword!2026"
    )
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
    return user


def grant_role(workspace, user, codes, name="custom"):
    role = OrganizationRole.objects.create(workspace=workspace, name=name)
    for permission in OrganizationPermission.objects.filter(workspace=workspace, code__in=codes):
        RolePermission.objects.create(role=role, permission=permission)
    UserOrganizationRole.objects.create(workspace=workspace, user=user, role=role)
    return role


def exception(workspace, user, code, effect, **kwargs):
    return UserPermissionException.objects.create(
        workspace=workspace,
        user=user,
        permission=OrganizationPermission.objects.get(workspace=workspace, code=code),
        effect=effect,
        **kwargs,
    )


def absence(workspace, user, **kwargs):
    now = timezone.now()
    return UserAbsence.objects.create(
        workspace=workspace, user=user, starts_at=now - timedelta(hours=1), ends_at=now + timedelta(hours=1), **kwargs
    )


def test_role_union_inactive_and_no_access(workspace):
    user = member(workspace, "union")
    first = grant_role(workspace, user, ["Referral.Create"], "first")
    grant_role(workspace, user, ["Referral.Approve"], "second")
    assert {"Referral.Create", "Referral.Approve"}.issubset(get_effective_permissions(user, workspace)["permissions"])
    assert not has_permission(user, workspace, "Referral.Delete")
    first.is_active = False
    first.save()
    assert not has_permission(user, workspace, "Referral.Create")


def test_user_deny_wins_over_role_and_allow(workspace):
    user = member(workspace, "deny")
    grant_role(workspace, user, ["Referral.Delete"])
    exception(workspace, user, "Referral.Delete", "ALLOW")
    exception(workspace, user, "Referral.Delete", "DENY")
    assert explain_permission(user, workspace, "Referral.Delete")["source"] == "user_deny"
    assert not has_permission(user, workspace, "Referral.Delete")


@pytest.mark.parametrize("offset", [-2, 2])
def test_future_and_expired_exceptions_ignored(workspace, offset):
    user = member(workspace, f"period-{offset}")
    now = timezone.now()
    exception(
        workspace,
        user,
        "Referral.External.Send",
        "ALLOW",
        starts_at=now + timedelta(days=offset),
        ends_at=now + timedelta(days=offset, hours=1),
    )
    assert not has_permission(user, workspace, "Referral.External.Send")


def test_allow_without_role_and_priority(workspace):
    user = member(workspace, "allow")
    exception(workspace, user, "Referral.External.Send", "ALLOW")
    assert explain_permission(user, workspace, "Referral.External.Send")["source"] == "user_allow"


def test_delegation_priority_expiry_and_exception_rules(workspace):
    manager = member(workspace, "manager")
    first = member(workspace, "first")
    second = member(workspace, "second")
    grant_role(workspace, manager, ["Referral.External.Send", "User.Delete"])
    exception(workspace, manager, "Referral.Approve", "ALLOW")
    exception(workspace, manager, "Referral.External.Send", "DENY")
    unit = OrganizationUnit.objects.create(workspace=workspace, title="Delegated", manager=manager)
    OrganizationUnitDelegate.objects.create(unit=unit, user=first, priority=1)
    OrganizationUnitDelegate.objects.create(unit=unit, user=second, priority=2)
    manager_absence = absence(workspace, manager)
    assert delegation_context(workspace)[unit.id]["user_id"] == first.id
    assert has_permission(first, workspace, "Referral.External.Send")
    assert not has_permission(first, workspace, "User.Delete")
    assert not has_permission(first, workspace, "Referral.Approve")
    assert explain_permission(first, workspace, "Referral.External.Send")["source"] == "delegation"
    first_absence = absence(workspace, first)
    assert delegation_context(workspace)[unit.id]["user_id"] == second.id
    assert not has_permission(first, workspace, "Referral.External.Send")
    first_absence.status = "ended"
    first_absence.save()
    OrganizationUnitDelegate.objects.filter(unit=unit, user=first).update(is_active=False)
    assert delegation_context(workspace)[unit.id]["user_id"] == second.id
    OrganizationUnitDelegate.objects.filter(unit=unit, user=first).update(is_active=True)
    WorkspaceMember.objects.filter(workspace=workspace, member=first).update(is_active=False)
    assert delegation_context(workspace)[unit.id]["user_id"] == second.id
    exception(workspace, second, "Referral.External.Send", "DENY")
    assert not has_permission(second, workspace, "Referral.External.Send")
    UserPermissionException.objects.filter(user=second).update(is_active=False)
    exception(workspace, second, "Referral.External.Send", "ALLOW")
    assert explain_permission(second, workspace, "Referral.External.Send")["source"] == "user_allow"
    manager_absence.status = "ended"
    manager_absence.save()
    assert unit.id not in delegation_context(workspace)
    first_absence.status = "ended"
    first_absence.save()
    assert not has_permission(first, workspace, "Referral.External.Send")


def test_absence_time_boundaries(workspace):
    manager = member(workspace, "boundary-manager")
    delegate = member(workspace, "boundary-delegate")
    grant_role(workspace, manager, ["Referral.External.Send"])
    unit = OrganizationUnit.objects.create(workspace=workspace, title="Boundary", manager=manager)
    OrganizationUnitDelegate.objects.create(unit=unit, user=delegate)
    row = absence(workspace, manager)
    assert has_permission(delegate, workspace, "Referral.External.Send")
    assert (
        "Referral.External.Send" not in get_effective_permissions(delegate, workspace, now=row.ends_at)["permissions"]
    )
    assert (
        "Referral.External.Send"
        not in get_effective_permissions(delegate, workspace, now=row.starts_at - timedelta(seconds=1))["permissions"]
    )


def test_workspace_isolation_and_inactive_membership(workspace, create_user):
    user = member(workspace, "isolated")
    exception(workspace, user, "User.Delete", "ALLOW")
    other = Workspace.objects.create(name="Other", slug="other-access", owner=create_user)
    WorkspaceMember.objects.create(workspace=other, member=user)
    assert has_permission(user, workspace, "User.Delete")
    assert not has_permission(user, other, "User.Delete")
    WorkspaceMember.objects.filter(workspace=workspace, member=user).update(is_active=False)
    assert get_effective_permissions(user, workspace)["permissions"] == []


def test_catalog_sync_idempotent_and_unknown_codes_do_not_grant(workspace, create_user):
    before = OrganizationPermission.objects.filter(workspace=workspace).count()
    bootstrap_workspace_access(workspace)
    bootstrap_workspace_access(workspace)
    assert OrganizationPermission.objects.filter(workspace=workspace).count() == before
    unknown = OrganizationPermission.objects.create(workspace=workspace, code="Unknown.Unsafe", name="Unknown")
    role = OrganizationRole.objects.get(workspace=workspace, system_key="admin")
    role.permissions.add(unknown)
    assert not has_permission(create_user, workspace, "Unknown.Unsafe")


def test_api_requires_permissions_and_catalog_is_read_only(session_client, api_client, workspace):
    user = member(workspace, "forbidden")
    session_client.force_authenticate(user=user)
    assert (
        session_client.post(
            f"/api/workspaces/{workspace.slug}/organization/roles/", {"name": "Forbidden"}, format="json"
        ).status_code
        == 403
    )
    from rest_framework.test import APIClient

    assert APIClient().get(f"/api/workspaces/{workspace.slug}/access/me/").status_code in (401, 403)


def test_admin_cannot_mutate_catalog(session_client, workspace):
    permission = OrganizationPermission.objects.filter(workspace=workspace).first()
    base = f"/api/workspaces/{workspace.slug}/organization/permissions/"
    assert session_client.post(base, {"code": "Made.Up", "name": "Custom"}, format="json").status_code == 405
    assert session_client.patch(f"{base}{permission.id}/", {"name": "Renamed"}, format="json").status_code == 405
    assert session_client.delete(f"{base}{permission.id}/").status_code == 405


def test_password_is_separate_hashed_and_audited(session_client, workspace, mocker):
    from contextlib import contextmanager
    from plane.app.views.workspace import organization

    user = member(workspace, "password")
    base = f"/api/workspaces/{workspace.slug}/organization/users/{user.id}/"
    assert session_client.patch(base, {"password": "SafeChangedPassword!2026"}, format="json").status_code == 400
    assert (
        session_client.post(
            f"{base}password/",
            {"new_password": "SafeChangedPassword!2026", "confirm_password": "Different"},
            format="json",
        ).status_code
        == 400
    )
    response = session_client.post(
        f"{base}password/",
        {"new_password": "SafeChangedPassword!2026", "confirm_password": "SafeChangedPassword!2026"},
        format="json",
    )
    assert response.status_code == 200
    user.refresh_from_db()
    assert user.check_password("SafeChangedPassword!2026")
    response = session_client.post(
        f"{base}password/", {"new_password": "short", "confirm_password": "short"}, format="json"
    )
    assert response.status_code == 400
    assert not APIActivityLog.objects.filter(body__contains="SafeChangedPassword").exists()
    original_transaction = organization.access_transaction

    @contextmanager
    def concurrent_reset(target_workspace):
        updated = User.objects.get(id=user.id)
        updated.set_password("ConcurrentSafePassword!2026")
        updated.save(update_fields=["password"])
        with original_transaction(target_workspace):
            yield

    mocker.patch.object(organization, "access_transaction", concurrent_reset)
    assert session_client.patch(base, {"first_name": "Updated"}, format="json").status_code == 200
    user.refresh_from_db()
    assert user.first_name == "Updated"
    assert user.check_password("ConcurrentSafePassword!2026")


def test_last_admin_cannot_be_removed_disabled_or_denied(session_client, workspace, create_user):
    base = f"/api/workspaces/{workspace.slug}/organization/"
    role = OrganizationRole.objects.get(workspace=workspace, system_key="admin")
    permission = OrganizationPermission.objects.get(workspace=workspace, code="User.View")
    assert session_client.delete(f"{base}users/{create_user.id}/membership/").status_code == 400
    assert session_client.delete(f"{base}roles/{role.id}/").status_code == 400
    assert (
        session_client.post(
            f"{base}users/{create_user.id}/exceptions/",
            {"permission": str(permission.id), "effect": "DENY"},
            format="json",
        ).status_code
        == 400
    )
    assert session_client.patch(f"{base}roles/{role.id}/", {"permission_ids": []}, format="json").status_code == 400
    assert WorkspaceMember.objects.get(workspace=workspace, member=create_user).is_active
    assert has_permission(create_user, workspace, "User.View")
    now = timezone.now()
    assert (
        session_client.post(
            f"{base}users/{create_user.id}/exceptions/",
            {
                "permission": str(permission.id),
                "effect": "DENY",
                "starts_at": (now + timedelta(days=1)).isoformat(),
                "ends_at": (now + timedelta(days=2)).isoformat(),
            },
            format="json",
        ).status_code
        == 400
    )


def test_exception_api_and_delegate_api_accept_valid_changes(session_client, workspace):
    user = member(workspace, "exception-api")
    permission = OrganizationPermission.objects.get(workspace=workspace, code="User.Edit")
    path = f"/api/workspaces/{workspace.slug}/organization/users/{user.id}/exceptions/"
    response = session_client.post(path, {"permission": str(permission.id), "effect": "ALLOW"}, format="json")
    assert response.status_code == 201, response.data
    assert has_permission(user, workspace, "User.Edit")
    assert session_client.patch(f"{path}{response.data['id']}/", {"effect": "DENY"}, format="json").status_code == 200
    assert not has_permission(user, workspace, "User.Edit")
    unit = OrganizationUnit.objects.create(workspace=workspace, title="Delegate API")
    response = session_client.put(
        f"/api/workspaces/{workspace.slug}/organization/units/{unit.id}/delegates/",
        {"user_ids": [str(user.id)]},
        format="json",
    )
    assert response.status_code == 200, response.data
    assert response.data["delegates"][0]["user_id"] == user.id


def test_granular_role_permissions_do_not_require_identity_edit(session_client, workspace):
    actor = member(workspace, "role-actor")
    target = member(workspace, "role-target")
    target.first_name = "Original"
    target.display_name = "Preserved identity"
    target.save()
    # Role-only edits must also work when an old account needs identity repair.
    User.objects.filter(id=target.id).update(email="legacy-without-domain")
    assigner = grant_role(workspace, actor, ["User.Role.Assign"], name="Role assigner")
    selected = OrganizationRole.objects.get(workspace=workspace, system_key="member")
    session_client.force_authenticate(user=actor)
    path = f"/api/workspaces/{workspace.slug}/organization/users/{target.id}/"
    assert session_client.patch(path, {"role_ids": [str(selected.id)]}, format="json").status_code == 200
    assert session_client.patch(path, {"display_name": "Unauthorized"}, format="json").status_code == 403
    assert assigner.is_active
    target.refresh_from_db()
    assert target.display_name == "Preserved identity"


def test_invalid_role_selection_returns_validation_errors(session_client, workspace):
    path = f"/api/workspaces/{workspace.slug}/organization/roles/"
    response = session_client.post(path, {"name": "Invalid role", "permission_ids": ["not-a-uuid"]}, format="json")
    assert response.status_code == 400
    user = member(workspace, "invalid-selection")
    response = session_client.patch(
        f"/api/workspaces/{workspace.slug}/organization/users/{user.id}/", {"role_ids": [["invalid"]]}, format="json"
    )
    assert response.status_code == 400


def test_user_removal_preserves_history_and_other_workspaces(session_client, workspace, create_user):
    user = member(workspace, "remove")
    other = Workspace.objects.create(name="Second", slug="second-access", owner=create_user)
    WorkspaceMember.objects.create(workspace=other, member=user)
    response = session_client.delete(f"/api/workspaces/{workspace.slug}/organization/users/{user.id}/membership/")
    assert response.status_code == 204
    user.refresh_from_db()
    assert user.username == "access-remove"
    assert user.is_active
    assert WorkspaceMember.objects.get(workspace=other, member=user).is_active
    assert not UserOrganizationRole.objects.filter(workspace=workspace, user=user, is_active=True).exists()


def test_inactive_user_role_assignment_rejected(session_client, workspace):
    from plane.db.models import Project, ProjectMember

    user = member(workspace, "inactive")
    project = Project.objects.create(workspace=workspace, name="Inactive membership", identifier="IMB")
    project_member = ProjectMember.objects.create(workspace=workspace, project=project, member=user)
    assert (
        session_client.patch(
            f"/api/workspaces/{workspace.slug}/organization/users/{user.id}/", {"is_active": False}, format="json"
        ).status_code
        == 200
    )
    project_member.refresh_from_db()
    assert not project_member.is_active
    role = OrganizationRole.objects.get(workspace=workspace, system_key="member")
    assert (
        session_client.patch(
            f"/api/workspaces/{workspace.slug}/organization/users/{user.id}/",
            {"role_ids": [str(role.id)]},
            format="json",
        ).status_code
        == 400
    )


def test_absence_hierarchy_overlap_and_delegate_validation(session_client, workspace):
    manager = member(workspace, "ancestor")
    target = member(workspace, "subordinate")
    outsider = member(workspace, "outside")
    grant_role(workspace, manager, ["Absence.Create", "Absence.View", "Absence.Edit", "Absence.End"])
    parent = OrganizationUnit.objects.create(workspace=workspace, title="Parent", manager=manager)
    child = OrganizationUnit.objects.create(workspace=workspace, title="Child", parent=parent, manager=target)
    session_client.force_authenticate(user=manager)
    now = timezone.now()
    body = {"user": str(target.id), "starts_at": now.isoformat(), "ends_at": (now + timedelta(hours=1)).isoformat()}
    base = f"/api/workspaces/{workspace.slug}/organization/absences/"
    response = session_client.post(base, body, format="json")
    assert response.status_code == 201, response.data
    assert session_client.post(base, body, format="json").status_code == 400
    overview = session_client.get(base).json()
    assert str(target.id) in overview["manageable_user_ids"]
    assert str(outsider.id) not in overview["manageable_user_ids"]
    assert overview["absences"][0]["can_edit"]
    assert session_client.post(base, {**body, "user": str(outsider.id)}, format="json").status_code == 403
    row = OrganizationUnitDelegate(unit=child, user=target)
    with pytest.raises(ValidationError):
        row.full_clean()


def test_api_key_cannot_bypass_workspace_permission_deny(api_key_client, workspace, create_user):
    exception(workspace, create_user, "Project.Create", "DENY")
    response = api_key_client.post(
        f"/api/v1/workspaces/{workspace.slug}/projects/", {"name": "Denied project", "identifier": "DEN"}, format="json"
    )
    assert response.status_code == 403
    exception(workspace, create_user, "Project.View", "DENY")
    assert api_key_client.get(f"/api/v1/workspaces/{workspace.slug}/projects/").status_code == 403


def test_invitation_cannot_bypass_user_creation_or_role_assignment(session_client, workspace, create_user, mocker):
    from plane.db.models import WorkspaceMemberInvite

    sender = mocker.patch("plane.app.views.workspace.invite.workspace_invitation.delay")
    actor = member(workspace, "inviter")
    grant_role(workspace, actor, ["User.Create", "User.View", "User.Edit"])
    session_client.force_authenticate(user=actor)
    path = f"/api/workspaces/{workspace.slug}/invitations/"
    assert (
        session_client.post(
            path, {"emails": [{"email": "invite-admin@example.com", "role": 20}]}, format="json"
        ).status_code
        == 403
    )
    response = session_client.post(
        path, {"emails": [{"email": "invite-member@example.com", "role": 15}]}, format="json"
    )
    assert response.status_code == 200, response.data
    sender.assert_called_once()
    invitation = WorkspaceMemberInvite.objects.get(workspace=workspace, email="invite-member@example.com")
    assert session_client.patch(f"{path}{invitation.id}/", {"role": 20}, format="json").status_code == 403
    session_client.force_authenticate(user=create_user)
    exception(workspace, create_user, "User.Create", "DENY")
    assert (
        session_client.post(path, {"emails": [{"email": "blocked@example.com", "role": 15}]}, format="json").status_code
        == 403
    )


def test_permission_cache_is_request_scoped_and_new_requests_observe_revocation(
    workspace, create_user, django_assert_num_queries
):
    from types import SimpleNamespace

    request = SimpleNamespace()
    assert has_permission(create_user, workspace.slug, "User.View", request=request)
    with django_assert_num_queries(0):
        assert has_permission(create_user, workspace.slug, "Role.View", request=request)
        assert not has_permission(create_user, workspace.slug, "Unknown.Permission", request=request)
    exception(workspace, create_user, "User.View", "DENY")
    assert not has_permission(create_user, workspace.slug, "User.View", request=SimpleNamespace())


def test_api_issue_field_permissions_and_assignee_scope(api_key_client, workspace, create_user, mocker):
    from plane.db.models import Issue, IssueAssignee, Project, ProjectMember, State
    from plane.api.views.issue import IssueDetailAPIEndpoint
    from rest_framework.test import APIRequestFactory, force_authenticate

    def upsert(body):
        request = APIRequestFactory().put("/api/test-upsert/", body, format="json")
        force_authenticate(request, user=create_user)
        return IssueDetailAPIEndpoint.as_view(http_method_names=["put"])(
            request, slug=workspace.slug, project_id=project.id
        )

    mocker.patch("plane.api.views.issue.issue_activity.delay")
    mocker.patch("plane.api.views.issue.model_activity.delay")
    project = Project.objects.create(workspace=workspace, name="Scoped API", identifier="SAP")
    ProjectMember.objects.create(workspace=workspace, project=project, member=create_user, role=20)
    state = State.objects.create(workspace=workspace, project=project, name="Open", group="unstarted")
    issue = Issue.objects.create(
        workspace=workspace, project=project, name="Owned", state=state, external_id="crm-owned", external_source="crm"
    )
    other = Issue.objects.create(workspace=workspace, project=project, name="Other", state=state)
    IssueAssignee.objects.create(workspace=workspace, project=project, issue=issue, assignee=create_user)
    exception(workspace, create_user, "Issue.Edit", "DENY")
    path = f"/api/v1/workspaces/{workspace.slug}/projects/{project.id}/issues/"
    response = api_key_client.patch(f"{path}{issue.id}/", {"state": str(state.id)}, format="json")
    assert response.status_code == 200, response.data
    assert api_key_client.patch(f"{path}{issue.id}/", {"name": "Blocked"}, format="json").status_code == 403
    assert upsert({"external_id": "crm-owned", "external_source": "crm", "name": "Blocked"}).status_code == 403
    assert api_key_client.patch(f"{path}{other.id}/", {"state": str(state.id)}, format="json").status_code == 403
    exception(workspace, create_user, "Issue.Status.Edit", "DENY")
    assert api_key_client.patch(f"{path}{issue.id}/", {"state": str(state.id)}, format="json").status_code == 403
    UserPermissionException.objects.filter(workspace=workspace, user=create_user, permission__code="Issue.Edit").update(
        is_active=False
    )
    assert upsert({"external_id": "crm-owned", "external_source": "crm", "state": str(state.id)}).status_code == 403
    exception(workspace, create_user, "Issue.Assign", "DENY")
    assert api_key_client.patch(f"{path}{issue.id}/", {"assignees": []}, format="json").status_code == 403


def test_enterprise_demo_seed_uses_registered_permissions_and_remains_repeatable(workspace, settings, monkeypatch):
    from django.core.management import call_command
    from plane.app.services.permission_registry import PERMISSION_REGISTRY
    from plane.db.models import Issue, TicketRoutingRule

    settings.DEBUG = True
    monkeypatch.setenv("DEV_BOOTSTRAP", "1")
    workspace.slug = "dev-workspace"
    workspace.save(update_fields=["slug"])
    call_command("seed_enterprise_demo")
    models = (OrganizationRole, UserOrganizationRole, RolePermission, Issue, TicketRoutingRule)
    counts = [model.objects.count() for model in models]
    call_command("seed_enterprise_demo")
    assert [model.objects.count() for model in models] == counts
    assert set(
        OrganizationPermission.objects.filter(workspace=workspace, is_active=True).values_list("code", flat=True)
    ) == set(PERMISSION_REGISTRY)
    assert TicketRoutingRule.objects.filter(workspace=workspace).count() == 3


def test_custom_permissions_manage_projects_without_numeric_admin(session_client, workspace, mocker):
    from plane.db.models import Project, ProjectMember, APIToken
    from rest_framework.test import APIClient

    mocker.patch("plane.api.views.project.model_activity.delay")
    actor = member(workspace, "custom-project-manager")
    target = member(workspace, "custom-project-target")
    grant_role(workspace, actor, ["Project.Create", "Project.Edit", "Project.Member.Manage", "User.View"])
    project = Project.objects.create(workspace=workspace, name="Custom managed", identifier="CMP")
    ProjectMember.objects.create(workspace=workspace, project=project, member=actor, role=15)
    target_membership = ProjectMember.objects.create(workspace=workspace, project=project, member=target, role=15)
    token = APIToken.objects.create(user=actor, label="Custom manager", token="custom-manager-token")
    client = APIClient()
    client.credentials(HTTP_X_API_KEY=token.token)
    base = f"/api/v1/workspaces/{workspace.slug}/projects/"
    response = client.patch(f"{base}{project.id}/", {"name": "Updated by custom role"}, format="json")
    assert response.status_code == 200, response.data
    assert client.post(base, {"name": "Created by custom role", "identifier": "CPC"}, format="json").status_code == 201
    assert (
        client.patch(f"{base}{project.id}/members/{target_membership.id}/", {"role": 20}, format="json").status_code
        == 200
    )
    target_membership.refresh_from_db()
    assert target_membership.role == 15
    session_client.force_authenticate(user=actor)
    response = session_client.patch(
        f"/api/workspaces/{workspace.slug}/projects/{project.id}/members/{target_membership.id}/",
        {"is_active": False},
        format="json",
    )
    assert response.status_code == 200, response.data
    target_membership.refresh_from_db()
    assert not target_membership.is_active
    assert WorkspaceMember.objects.get(workspace=workspace, member=actor).role == 15


def test_legacy_account_deactivation_preserves_last_crm_admin(session_client, workspace, create_user, mocker):
    from plane.db.models import Profile

    mocker.patch("plane.app.views.user.base.user_deactivation_email.delay")
    assert session_client.delete("/api/users/me/").status_code == 400
    create_user.refresh_from_db()
    assert create_user.is_active
    assert WorkspaceMember.objects.get(workspace=workspace, member=create_user).is_active
    ordinary = member(workspace, "self-deactivation")
    Profile.objects.get_or_create(user=ordinary)
    session_client.force_authenticate(user=ordinary)
    response = session_client.delete("/api/users/me/")
    assert response.status_code == 204, response.data
    ordinary.refresh_from_db()
    assert not ordinary.is_active
    assert has_permission(create_user, workspace, "User.Role.Assign")
