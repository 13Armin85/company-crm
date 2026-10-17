import pytest
from rest_framework.test import APIRequestFactory, force_authenticate

from plane.api.views.issue import IssueDetailAPIEndpoint
from plane.db.models import Issue, IssueAssignee, Project, ProjectMember, State, User, WorkspaceMember

pytestmark = pytest.mark.django_db


def member(workspace, name):
    user = User.objects.create_user(email=f"{name}@transfer.example.com", username=name, password="SafePass!2026")
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
    return user


@pytest.fixture
def transfer_team(workspace, create_user, mocker):
    for module in ("plane.app.views.issue.base", "plane.api.views.issue"):
        mocker.patch(f"{module}.issue_activity.delay")
        mocker.patch(f"{module}.model_activity.delay")
    owner = member(workspace, "project-owner")
    previous = member(workspace, "previous-owner")
    recipient = member(workspace, "next-owner")
    project = Project(workspace=workspace, name="Transfer project", identifier="TRN")
    project.save(created_by_id=owner.id)
    for user in (owner, previous, recipient):
        ProjectMember.objects.create(project=project, member=user, role=15)
    state = State.objects.create(project=project, name="Todo", group="unstarted", color="#999999", default=True)
    issue = Issue(project=project, name="Someone else's work", state=state)
    issue.save(created_by_id=create_user.id)
    IssueAssignee.objects.create(project=project, issue=issue, assignee=previous)
    return owner, previous, recipient, project, issue


def transfer(session_client, workspace, project, issue, actor, body, public):
    if public:
        request = APIRequestFactory().patch("/api/verification/", body, format="json")
        force_authenticate(request, actor)
        return IssueDetailAPIEndpoint.as_view()(request, slug=workspace.slug, project_id=project.id, pk=issue.id)
    session_client.force_authenticate(actor)
    return session_client.patch(f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/{issue.id}/", body, format="json")


@pytest.mark.parametrize("ownership", ["creator", "lead"])
@pytest.mark.parametrize("public", [False, True])
def test_project_owner_can_transfer_others_work_without_changing_their_status(session_client, workspace, create_user, transfer_team, ownership, public):
    owner, previous, recipient, project, issue = transfer_team
    if ownership == "lead":
        Project.objects.filter(pk=project.id).update(created_by=create_user, project_lead=owner)
    field = "assignees" if public else "assignee_ids"
    membership_count = ProjectMember.all_objects.count()
    response = transfer(session_client, workspace, project, issue, owner, {field: [str(recipient.id)]}, public)
    assert response.status_code in (200, 204), response.data
    assert list(IssueAssignee.objects.filter(issue=issue).values_list("assignee_id", flat=True)) == [recipient.id]
    assert ProjectMember.all_objects.count() == membership_count
    issue.refresh_from_db()
    assert issue.created_by_id == create_user.id
    assert issue.state.group == "unstarted"
    state = State.objects.create(project=project, name="Done", group="completed", color="#00aa00")
    response = transfer(session_client, workspace, project, issue, owner, {"state" if public else "state_id": str(state.id)}, public)
    assert response.status_code == 403, response.data
    issue.refresh_from_db()
    assert issue.state.group == "unstarted"


def test_project_owner_can_list_others_tasks(session_client, workspace, transfer_team):
    owner, _, _, project, issue = transfer_team
    session_client.force_authenticate(owner)
    response = session_client.get(f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/")
    assert response.status_code == 200, response.data
    rows = response.data["results"] if isinstance(response.data, dict) else response.data
    assert str(issue.id) in {str(row["id"]) for row in rows}


def test_ordinary_non_owner_cannot_transfer_another_persons_task(session_client, workspace, transfer_team):
    _, previous, recipient, project, issue = transfer_team
    Issue.objects.filter(pk=issue.id).update(created_by=recipient)
    response = transfer(session_client, workspace, project, issue, recipient, {"assignee_ids": [str(previous.id)]}, False)
    assert response.status_code == 403, response.data
    assert IssueAssignee.objects.filter(issue=issue, assignee=previous).exists()


def test_administrator_can_transfer_without_project_membership(session_client, workspace, create_user, transfer_team):
    _, _, recipient, project, issue = transfer_team
    assert not ProjectMember.objects.filter(project=project, member=create_user).exists()
    response = transfer(session_client, workspace, project, issue, create_user, {"assignee_ids": [str(recipient.id)]}, False)
    assert response.status_code == 204, response.data
    assert IssueAssignee.objects.filter(issue=issue, assignee=recipient).exists()


@pytest.mark.parametrize("recipient_state", ["nonmember", "inactive", "malformed"])
def test_transfer_rejects_invalid_project_recipient_without_changing_assignment(session_client, workspace, transfer_team, recipient_state):
    owner, previous, recipient, project, issue = transfer_team
    if recipient_state == "nonmember":
        ProjectMember.objects.filter(project=project, member=recipient).delete()
    elif recipient_state == "inactive":
        ProjectMember.objects.filter(project=project, member=recipient).update(is_active=False)
    identifier = "invalid-uuid" if recipient_state == "malformed" else str(recipient.id)
    count = ProjectMember.all_objects.count()
    response = transfer(session_client, workspace, project, issue, owner, {"assignee_ids": [identifier]}, False)
    assert response.status_code == 400, response.data
    assert IssueAssignee.objects.filter(issue=issue, assignee=previous).exists()
    assert ProjectMember.all_objects.count() == count


def test_project_owner_cannot_assign_to_self_or_transfer_after_membership_revoked(session_client, workspace, transfer_team):
    owner, previous, recipient, project, issue = transfer_team
    assert transfer(session_client, workspace, project, issue, owner, {"assignee_ids": [str(owner.id)]}, False).status_code == 400
    ProjectMember.objects.filter(project=project, member=owner).update(is_active=False)
    assert transfer(session_client, workspace, project, issue, owner, {"assignee_ids": [str(recipient.id)]}, False).status_code == 403
    assert IssueAssignee.objects.filter(issue=issue, assignee=previous).exists()
