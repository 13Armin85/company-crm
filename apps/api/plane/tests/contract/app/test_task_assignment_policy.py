from datetime import datetime, timezone as dt_timezone

import pytest
from django.utils import timezone

from plane.db.models import Issue, IssueActivity, IssueAssignee, Notification, Project, ProjectMember, State, User, WorkspaceMember, WorkspaceTask

pytestmark = pytest.mark.django_db


def member(workspace, name):
    user = User.objects.create_user(email=f"{name}@policy.example.com", username=name, password="SafePassword!2026")
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
    return user


def project_team(workspace, *users):
    project = Project.objects.create(workspace=workspace, name="Policy project", identifier="POL")
    for user in users:
        ProjectMember.objects.create(project=project, member=user, role=15)
    state = State.objects.create(project=project, name="Todo", group="unstarted", color="#999999", default=True)
    return project, state


def authored_task(workspace, author, assignee, name="Received task"):
    task = WorkspaceTask(workspace=workspace, name=name, assignee=assignee)
    task.save(created_by_id=author.id)
    return task


def test_member_cannot_create_task_for_self_but_can_send_to_teammate(session_client, workspace):
    actor = member(workspace, "policy-sender")
    recipient = member(workspace, "policy-recipient")
    session_client.force_authenticate(actor)
    path = f"/api/workspaces/{workspace.slug}/tasks/"
    rejected = session_client.post(path, {"name": "Self task", "assignee_id": str(actor.id)}, format="json")
    assert rejected.status_code == 400
    assert not WorkspaceTask.objects.exists()
    accepted = session_client.post(path, {
        "name": "Delegated task", "assignee_id": str(recipient.id), "created_by": str(recipient.id),
    }, format="json")
    assert accepted.status_code == 201, accepted.data
    assert WorkspaceTask.objects.get(pk=accepted.data["id"]).created_by_id == actor.id


def test_administrator_may_still_assign_to_self(session_client, workspace, create_user):
    response = session_client.post(f"/api/workspaces/{workspace.slug}/tasks/", {
        "name": "Admin task", "assignee_id": str(create_user.id),
    }, format="json")
    assert response.status_code == 201, response.data


def test_self_transfer_is_rejected_without_modifying_received_task(session_client, workspace, create_user):
    actor = member(workspace, "policy-owner")
    task = authored_task(workspace, create_user, actor)
    session_client.force_authenticate(actor)
    response = session_client.patch(f"/api/workspaces/{workspace.slug}/tasks/{task.id}/", {
        "assignee_id": str(actor.id),
    }, format="json")
    assert response.status_code == 400
    task.refresh_from_db()
    assert task.assignee_id == actor.id


def test_project_creation_requires_another_active_assignee_and_records_sender(session_client, workspace, mocker):
    mocker.patch("plane.app.views.issue.base.issue_activity.delay")
    mocker.patch("plane.app.views.issue.base.model_activity.delay")
    actor = member(workspace, "policy-project-sender")
    recipient = member(workspace, "policy-project-recipient")
    project, _ = project_team(workspace, actor, recipient)
    project.default_assignee = actor
    project.save(update_fields=["default_assignee"])
    session_client.force_authenticate(actor)
    path = f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/"
    for body in (
        {"name": "No recipient"},
        {"name": "Self", "assignee_ids": [str(actor.id)]},
        {"name": "Ignored alias", "assignees": [str(recipient.id)]},
    ):
        assert session_client.post(path, body, format="json").status_code == 400
    assert not Issue.objects.exists()
    response = session_client.post(path, {"name": "For someone else", "assignee_ids": [str(recipient.id)]}, format="json")
    assert response.status_code == 201, response.data
    assert Issue.objects.get(pk=response.data["id"]).created_by_id == actor.id


def test_history_keeps_transferred_tasks_independent_of_inbox_state(session_client, workspace, create_user):
    actor = member(workspace, "history-former-owner")
    recipient = member(workspace, "history-next-owner")
    task = authored_task(workspace, create_user, actor)
    unrelated = authored_task(workspace, create_user, recipient, "Private task")
    session_client.force_authenticate(actor)
    transferred = session_client.patch(f"/api/workspaces/{workspace.slug}/tasks/{task.id}/", {
        "assignee_id": str(recipient.id),
    }, format="json")
    assert transferred.status_code == 200, transferred.data
    Notification.objects.filter(receiver=actor).update(read_at=timezone.now(), archived_at=timezone.now(), deleted_at=timezone.now())
    assert session_client.get(f"/api/workspaces/{workspace.slug}/tasks/").data == []
    response = session_client.get(f"/api/workspaces/{workspace.slug}/tasks/history/")
    assert response.status_code == 200, response.data
    rows = response.json()["workspace_tasks"]
    assert {row["id"] for row in rows} == {str(task.id)}
    assert rows[0]["was_assigned_to_me"] is True
    assert rows[0]["assignee_id"] == str(recipient.id)
    assert unrelated.id != task.id


def test_history_includes_old_completed_and_archived_project_work(session_client, workspace, create_user):
    actor = member(workspace, "history-project-owner")
    recipient = member(workspace, "history-project-next")
    project, state = project_team(workspace, actor, recipient)
    issue = Issue(project=project, name="Old transferred task", state=state)
    issue.save(created_by_id=create_user.id)
    IssueAssignee.objects.create(project=project, issue=issue, assignee=actor).delete()
    IssueAssignee.objects.create(project=project, issue=issue, assignee=recipient)
    old_date = datetime(2011, 1, 1, tzinfo=dt_timezone.utc)
    Issue.objects.filter(pk=issue.id).update(created_at=old_date, archived_at=timezone.now())
    Project.objects.filter(pk=project.id).update(archived_at=timezone.now())
    task = authored_task(workspace, create_user, actor, "Old completed task")
    WorkspaceTask.objects.filter(pk=task.id).update(created_at=old_date, status="done", completed_at=old_date)
    session_client.force_authenticate(actor)
    response = session_client.get(f"/api/workspaces/{workspace.slug}/tasks/history/")
    assert response.status_code == 200, response.data
    data = response.json()
    assert data["project_issues"][0]["id"] == str(issue.id)
    assert data["project_issues"][0]["archived"] is True
    assert data["project_issues"][0]["assignee_details"][0]["id"] == str(recipient.id)
    assert data["workspace_tasks"][0]["id"] == str(task.id)


def test_public_api_rejects_direct_self_assignment(session_client, workspace):
    from rest_framework.test import APIRequestFactory, force_authenticate
    from plane.api.views.issue import IssueListCreateAPIEndpoint, IssueDetailAPIEndpoint
    actor = member(workspace, "public-self-owner")
    project, state = project_team(workspace, actor)
    project.default_assignee = actor
    project.save(update_fields=["default_assignee"])
    request = APIRequestFactory().post("/api/test/", {"name": "Self", "assignees": [str(actor.id)]}, format="json")
    force_authenticate(request, actor)
    response = IssueListCreateAPIEndpoint.as_view()(request, slug=workspace.slug, project_id=project.id)
    assert response.status_code == 400, response.data
    request = APIRequestFactory().post("/api/test/", {"name": "Fake routing", "routing_rule_id": "ignored"}, format="json")
    force_authenticate(request, actor)
    response = IssueListCreateAPIEndpoint.as_view()(request, slug=workspace.slug, project_id=project.id)
    assert response.status_code == 400, response.data
    issue = Issue.objects.create(project=project, name="Received", state=state)
    IssueAssignee.objects.create(project=project, issue=issue, assignee=actor)
    request = APIRequestFactory().patch("/api/test/", {"assignees": [str(actor.id)]}, format="json")
    force_authenticate(request, actor)
    response = IssueDetailAPIEndpoint.as_view()(request, slug=workspace.slug, project_id=project.id, pk=issue.id)
    assert response.status_code == 400, response.data


def test_routing_cannot_assign_self_or_fall_back_to_self(session_client, workspace, mocker):
    from plane.db.models import OrganizationRole, OrganizationUnit, TicketRoutingRule, TicketRoleQueueEntry, UserOrganizationRole

    mocker.patch("plane.app.views.issue.base.issue_activity.delay")
    mocker.patch("plane.app.views.issue.base.model_activity.delay")
    actor = member(workspace, "routing-self-owner")
    recipient = member(workspace, "routing-other-owner")
    project, _ = project_team(workspace, actor, recipient)
    project.default_assignee = actor
    project.save(update_fields=["default_assignee"])
    role = OrganizationRole.objects.create(workspace=workspace, name="Routing policy manager")
    UserOrganizationRole.objects.create(workspace=workspace, user=actor, role=role)
    UserOrganizationRole.objects.create(workspace=workspace, user=recipient, role=role)
    unit = OrganizationUnit.objects.create(workspace=workspace, title="Policy unit", manager=actor)
    rule = TicketRoutingRule.objects.create(workspace=workspace, name="Policy routing", unit=unit, required_role=role)
    session_client.force_authenticate(actor)
    path = f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/"
    body = {"name": "Routed task", "routing_rule_id": str(rule.id)}
    assert session_client.post(path, body, format="json").status_code == 400
    assert not Issue.objects.exists()
    unit.manager = recipient
    unit.save(update_fields=["manager"])
    accepted = session_client.post(path, body, format="json")
    assert accepted.status_code == 201, accepted.data
    assert list(IssueAssignee.objects.values_list("assignee_id", flat=True)) == [recipient.id]
    unit.manager = None
    unit.save(update_fields=["manager"])
    queued = session_client.post(path, body, format="json")
    assert queued.status_code == 201, queued.data
    assert not IssueAssignee.objects.filter(issue_id=queued.data["id"]).exists()
    entry = TicketRoleQueueEntry.objects.get(issue_id=queued.data["id"])
    claim = session_client.post(f"/api/workspaces/{workspace.slug}/organization/role-queue/{entry.id}/claim/", {}, format="json")
    assert claim.status_code == 400, claim.data
