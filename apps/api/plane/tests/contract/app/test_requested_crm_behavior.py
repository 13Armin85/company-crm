import pytest
from django.utils import timezone

from plane.app.services.access_control import has_permission
from plane.app.services.permission_registry import PERMISSION_REGISTRY
from plane.app.services.user_identity import reserve_username
from plane.db.models import Issue, IssueAssignee, Project, ProjectMember, State, User, WorkspaceMember, WorkspaceTask

pytestmark = pytest.mark.django_db


def member(workspace, name):
    user = User.objects.create_user(email=f"{name}@example.com", username=name, password="SafePassword!2026")
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
    return user


def test_members_see_received_and_sent_tasks_but_cannot_update_recipient_status(session_client, workspace):
    sender = member(workspace, "sender")
    recipient = member(workspace, "recipient")
    outsider = member(workspace, "outsider")
    hidden = WorkspaceTask.objects.create(workspace=workspace, name="Hidden", assignee=outsider)
    session_client.force_authenticate(sender)
    response = session_client.post(f"/api/workspaces/{workspace.slug}/tasks/", {
        "name": "Sent task", "assignee_id": str(recipient.id),
    }, format="json")
    assert response.status_code == 201, response.data
    task_id = response.data["id"]
    assert str(response.data["created_by_detail"]["id"]) == str(sender.id)
    visible = session_client.get(f"/api/workspaces/{workspace.slug}/tasks/").data
    assert {row["id"] for row in visible} == {task_id}
    assert str(hidden.id) not in {row["id"] for row in visible}
    denied = session_client.patch(f"/api/workspaces/{workspace.slug}/tasks/{task_id}/", {"status": "done"}, format="json")
    assert denied.status_code == 403
    assert denied.data["error"] == "این کار به شما واگذار نشده است."
    session_client.force_authenticate(recipient)
    assert {row["id"] for row in session_client.get(f"/api/workspaces/{workspace.slug}/tasks/").data} == {task_id}


def test_project_task_visibility_and_administrator_access_without_project_membership(session_client, workspace, create_user):
    sender = member(workspace, "project-sender")
    recipient = member(workspace, "project-recipient")
    project = Project.objects.create(workspace=workspace, name="Project", identifier="PRJ")
    ProjectMember.objects.create(project=project, member=sender, role=15)
    todo = State.objects.create(workspace=workspace, project=project, name="Todo", group="unstarted", color="#999999")
    done = State.objects.create(workspace=workspace, project=project, name="Done", group="completed", color="#00aa00")
    sent = Issue.objects.create(project=project, name="Sent", state=todo, created_by_id=sender.id)
    Issue.objects.filter(pk=sent.id).update(created_by=sender)
    IssueAssignee.objects.create(project=project, issue=sent, assignee=recipient)
    hidden = Issue.objects.create(project=project, name="Hidden", state=todo)
    session_client.force_authenticate(sender)
    response = session_client.get(f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/")
    rows = response.data.get("results", []) if isinstance(response.data, dict) else response.data
    assert {str(row["id"]) for row in rows} == {str(sent.id)}
    from plane.api.views.issue import IssueListCreateAPIEndpoint
    from rest_framework.test import APIRequestFactory, force_authenticate
    request = APIRequestFactory().get(f"/api/v1/workspaces/{workspace.slug}/projects/{project.id}/issues/")
    force_authenticate(request, user=sender)
    external = IssueListCreateAPIEndpoint.as_view()(request, slug=workspace.slug, project_id=project.id)
    assert external.status_code == 200
    assert {str(row["id"]) for row in external.data["results"]} == {str(sent.id)}
    session_client.force_authenticate(create_user)
    assert all(has_permission(create_user, workspace, code) for code in PERMISSION_REGISTRY)
    states = session_client.get(f"/api/workspaces/{workspace.slug}/projects/{project.id}/states/")
    assert states.status_code == 200
    assert len(states.data) == 2
    updated = session_client.patch(f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/{hidden.id}/", {"state_id": str(done.id)}, format="json")
    assert updated.status_code == 204, updated.data


def test_deleted_users_login_name_can_be_reused_without_deleting_history(workspace):
    from django.db import transaction
    user = member(workspace, "reusable")
    task = WorkspaceTask.objects.create(workspace=workspace, name="History", assignee=user)
    WorkspaceMember.all_objects.filter(member=user).update(is_active=False, deleted_at=timezone.now())
    with transaction.atomic():
        reserve_username("REUSABLE")
    user.refresh_from_db()
    assert user.username != "reusable"
    assert not user.is_active
    replacement = User.objects.create_user(email="replacement@example.com", username="reusable", password="SafePassword!2026")
    assert replacement.id != user.id
    task.refresh_from_db()
    assert task.assignee_id == user.id


def test_active_username_cannot_be_reused(workspace):
    from django.core.exceptions import ValidationError
    from django.db import transaction
    user = member(workspace, "reserved")
    with pytest.raises(ValidationError), transaction.atomic():
        reserve_username("reserved")
    user.refresh_from_db()
    assert user.username == "reserved"


def test_builtin_administrator_retains_all_permissions_despite_legacy_denials(workspace, create_user):
    from plane.db.models import OrganizationPermission, UserPermissionException
    permission = OrganizationPermission.objects.get(workspace=workspace, code="Issue.Status.Edit")
    UserPermissionException.objects.create(workspace=workspace, user=create_user, permission=permission, effect="DENY")
    assert all(has_permission(create_user, workspace, code) for code in PERMISSION_REGISTRY)
