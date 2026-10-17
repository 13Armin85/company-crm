import pytest
from django.utils import timezone
from rest_framework.test import APIRequestFactory, force_authenticate

from plane.api.views.project import ProjectListCreateAPIEndpoint, ProjectListLiteAPIEndpoint, ProjectDetailAPIEndpoint
from plane.db.models import (
    Issue, IssueAssignee, OrganizationPermission, Project, ProjectMember, State,
    User, UserPermissionException, WorkspaceMember,
)

pytestmark = pytest.mark.django_db


def ordinary_member(workspace):
    user = User.objects.create_user(email="project-member@policy.example.com", username="visibility-member", password="SafePass!2026")
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
    permission = OrganizationPermission.objects.get(workspace=workspace, code="Project.ViewAll")
    UserPermissionException.objects.create(workspace=workspace, user=user, permission=permission, effect="ALLOW")
    return user


def public_get(view, user, workspace, **kwargs):
    request = APIRequestFactory().get("/api/verification/?per_page=100")
    force_authenticate(request, user)
    return view.as_view()(request, slug=workspace.slug, **kwargs)


def identifiers(response):
    assert response.status_code == 200, response.data
    data = response.data
    return {str(row["id"]) for row in (data["results"] if isinstance(data, dict) else data)}


def test_view_all_grant_never_replaces_membership_in_project_lists(session_client, workspace):
    user = ordinary_member(workspace)
    own = Project.objects.create(workspace=workspace, name="Assigned", identifier="OWN")
    public = Project.objects.create(workspace=workspace, name="Public hidden", identifier="PUB", network=2)
    private = Project.objects.create(workspace=workspace, name="Private hidden", identifier="PRV", network=0)
    ProjectMember.objects.create(project=own, member=user, role=15)
    session_client.force_authenticate(user)
    for path in ("projects/", "projects/details/", "projects/details/?per_page=100&cursor=0:0:0"):
        assert identifiers(session_client.get(f"/api/workspaces/{workspace.slug}/{path}")) == {str(own.id)}
    for view in (ProjectListCreateAPIEndpoint, ProjectListLiteAPIEndpoint):
        assert identifiers(public_get(view, user, workspace)) == {str(own.id)}
    for project in (public, private):
        assert public_get(ProjectDetailAPIEndpoint, user, workspace, pk=project.id).status_code == 403


def test_inactive_and_soft_deleted_memberships_do_not_reveal_projects(session_client, workspace, create_user):
    user = ordinary_member(workspace)
    inactive = Project.objects.create(workspace=workspace, name="Inactive", identifier="INA", network=2)
    deleted = Project.objects.create(workspace=workspace, name="Removed", identifier="DEL", network=2)
    ProjectMember.objects.create(project=inactive, member=user, role=15, is_active=False)
    membership = ProjectMember.objects.create(project=deleted, member=user, role=15)
    ProjectMember.all_objects.filter(pk=membership.id).update(deleted_at=timezone.now())
    for project in (inactive, deleted):
        ProjectMember.objects.create(project=project, member=create_user, role=20)
    session_client.force_authenticate(user)
    assert identifiers(session_client.get(f"/api/workspaces/{workspace.slug}/projects/details/")) == set()
    assert identifiers(public_get(ProjectListLiteAPIEndpoint, user, workspace)) == set()
    for project in (inactive, deleted):
        assert session_client.get(f"/api/workspaces/{workspace.slug}/projects/{project.id}/").status_code == 403


def test_project_appears_only_after_admin_adds_member_and_disappears_after_removal(session_client, workspace, mocker):
    mocker.patch("plane.app.views.project.member.project_add_user_email.delay")
    mocker.patch("plane.app.views.project.base.recent_visited_task.delay")
    user = ordinary_member(workspace)
    project = Project.objects.create(workspace=workspace, name="Admin assigned", identifier="ADM", network=2)
    paths = [f"/api/workspaces/{workspace.slug}/projects/{project.id}/{suffix}" for suffix in ("", "issues/", "states/", "members/")]
    session_client.force_authenticate(user)
    for path in paths:
        assert session_client.get(path).status_code == 403
    session_client.force_authenticate(None)
    from plane.db.models import UserOrganizationRole
    administrator = UserOrganizationRole.objects.filter(workspace=workspace, role__system_key="admin", is_active=True).first().user
    session_client.force_authenticate(administrator)
    response = session_client.post(paths[-1], {"members": [{"member_id": str(user.id), "role": 15}]}, format="json")
    assert response.status_code == 201, response.data
    session_client.force_authenticate(user)
    assert identifiers(session_client.get(f"/api/workspaces/{workspace.slug}/projects/details/")) == {str(project.id)}
    assert session_client.get(paths[0]).status_code == 200
    membership = ProjectMember.objects.get(project=project, member=user)
    session_client.force_authenticate(administrator)
    assert session_client.delete(f"{paths[-1]}{membership.id}/").status_code == 204
    session_client.force_authenticate(user)
    assert identifiers(session_client.get(f"/api/workspaces/{workspace.slug}/projects/details/")) == set()
    for path in paths:
        assert session_client.get(path).status_code == 403


def test_administrator_can_see_private_projects_without_membership(session_client, workspace, create_user, mocker):
    mocker.patch("plane.app.views.project.base.recent_visited_task.delay")
    project = Project.objects.create(workspace=workspace, name="Admin visibility", identifier="ALL", network=0)
    assert not ProjectMember.objects.filter(project=project, member=create_user).exists()
    assert str(project.id) in identifiers(session_client.get(f"/api/workspaces/{workspace.slug}/projects/details/"))
    assert str(project.id) in identifiers(public_get(ProjectListCreateAPIEndpoint, create_user, workspace))
    assert str(project.id) in identifiers(public_get(ProjectListLiteAPIEndpoint, create_user, workspace))
    assert session_client.get(f"/api/workspaces/{workspace.slug}/projects/{project.id}/").status_code == 200
    assert public_get(ProjectDetailAPIEndpoint, create_user, workspace, pk=project.id).status_code == 200


def test_ordinary_user_cannot_self_join_public_project(session_client, workspace):
    user = ordinary_member(workspace)
    project = Project.objects.create(workspace=workspace, name="Cannot self join", identifier="JOIN", network=2)
    session_client.force_authenticate(user)
    response = session_client.post(f"/api/users/me/workspaces/{workspace.slug}/projects/invitations/", {"project_ids": [str(project.id)]}, format="json")
    assert response.status_code == 403, response.data
    assert not ProjectMember.objects.filter(project=project, member=user).exists()


def test_membership_directory_and_personal_history_do_not_leak_hidden_project(session_client, workspace, create_user):
    user = ordinary_member(workspace)
    project = Project.objects.create(workspace=workspace, name="Hidden history project", identifier="HID", network=2)
    ProjectMember.objects.create(project=project, member=create_user, role=20)
    state = State.objects.create(project=project, name="Todo", group="unstarted", color="#999999")
    issue = Issue(project=project, name="Previously assigned", state=state)
    issue.save(created_by_id=create_user.id)
    IssueAssignee.objects.create(project=project, issue=issue, assignee=user)
    session_client.force_authenticate(user)
    assert session_client.get(f"/api/workspaces/{workspace.slug}/project-members/").data == {}
    response = session_client.get(f"/api/workspaces/{workspace.slug}/tasks/history/")
    assert response.status_code == 200, response.data
    assert response.data["project_issues"] == []


def test_legacy_numeric_admin_value_does_not_bypass_project_membership(workspace):
    from plane.app.permissions import ROLE, allow_permission
    from rest_framework.response import Response

    user = ordinary_member(workspace)
    WorkspaceMember.objects.filter(workspace=workspace, member=user).update(role=20)
    project = Project.objects.create(workspace=workspace, name="Legacy hidden", identifier="LEG")

    class Probe:
        @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
        def get(self, request, slug, project_id):
            return Response({"allowed": True})

    request = APIRequestFactory().get("/api/verification/")
    request.user = user
    assert Probe().get(request, slug=workspace.slug, project_id=project.id).status_code == 403


def test_role_queue_does_not_reveal_or_assign_hidden_project(session_client, workspace, create_user):
    from plane.db.models import OrganizationRole, OrganizationUnit, TicketRoleQueueEntry, TicketRoutingRule, UserOrganizationRole

    user = ordinary_member(workspace)
    permission = OrganizationPermission.objects.get(workspace=workspace, code="Routing.Queue.ViewAll")
    UserPermissionException.objects.create(workspace=workspace, user=user, permission=permission, effect="ALLOW")
    project = Project.objects.create(workspace=workspace, name="Hidden queue project", identifier="QUE")
    state = State.objects.create(project=project, name="Todo", group="unstarted", color="#999999")
    issue = Issue(project=project, name="Hidden queued work", state=state)
    issue.save(created_by_id=create_user.id)
    role = OrganizationRole.objects.create(workspace=workspace, name="Queue visibility role")
    UserOrganizationRole.objects.create(workspace=workspace, user=user, role=role)
    unit = OrganizationUnit.objects.create(workspace=workspace, title="Queue unit")
    rule = TicketRoutingRule.objects.create(workspace=workspace, name="Queue rule", unit=unit, required_role=role)
    entry = TicketRoleQueueEntry.objects.create(issue=issue, rule=rule, required_role=role)
    session_client.force_authenticate(user)
    path = f"/api/workspaces/{workspace.slug}/organization/role-queue/"
    assert session_client.get(path).data == []
    assert session_client.post(f"{path}{entry.id}/claim/", {}, format="json").status_code == 404
    assert not IssueAssignee.objects.filter(issue=issue, assignee=user).exists()
    ProjectMember.objects.create(project=project, member=user, role=15)
    response = session_client.get(path)
    assert response.status_code == 200, response.data
    assert [row["id"] for row in response.data] == [str(entry.id)]
    assert session_client.post(f"{path}{entry.id}/claim/", {}, format="json").status_code == 200
