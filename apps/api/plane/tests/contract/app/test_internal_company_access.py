import pytest
from rest_framework import status

from plane.db.models import Issue, IssueAssignee, Project, ProjectMember, State, User, WorkspaceMember


def create_company_member(workspace, suffix: str):
    user = User.objects.create_user(
        email=f"{suffix}@example.com",
        username=f"user-{suffix}",
        password="SafePassword!2026",
    )
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15, is_active=True)
    return user


@pytest.mark.django_db
def test_normal_member_only_lists_assigned_projects(session_client, workspace):
    member = create_company_member(workspace, "assigned")
    assigned = Project.objects.create(name="Assigned", identifier="ASN", workspace=workspace, network=2)
    Project.objects.create(name="Other", identifier="OTH", workspace=workspace, network=2)
    ProjectMember.objects.create(project=assigned, member=member, role=15, is_active=True)
    session_client.force_authenticate(user=member)

    response = session_client.get(f"/api/workspaces/{workspace.slug}/projects/details/")

    assert response.status_code == status.HTTP_200_OK
    assert [item["id"] for item in response.json()] == [str(assigned.id)]


@pytest.mark.django_db
def test_workspace_admin_can_retrieve_project_without_project_membership(session_client, workspace):
    project = Project.objects.create(name="Admin visible", identifier="ADM", workspace=workspace)

    response = session_client.get(f"/api/workspaces/{workspace.slug}/projects/{project.id}/")

    assert response.status_code == status.HTTP_200_OK


@pytest.mark.django_db
def test_normal_member_cannot_create_project_or_issue(session_client, workspace):
    member = create_company_member(workspace, "no-create")
    project = Project.objects.create(name="Member project", identifier="MEM", workspace=workspace)
    ProjectMember.objects.create(project=project, member=member, role=15, is_active=True)
    session_client.force_authenticate(user=member)

    project_response = session_client.post(
        f"/api/workspaces/{workspace.slug}/projects/",
        {"name": "Forbidden", "identifier": "NOPE"},
        format="json",
    )
    issue_response = session_client.post(
        f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/",
        {"name": "Forbidden issue"},
        format="json",
    )

    assert project_response.status_code == status.HTTP_403_FORBIDDEN
    assert issue_response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
def test_normal_member_only_updates_status_of_own_assigned_issue(session_client, workspace, create_user, mocker):
    member = create_company_member(workspace, "worker")
    project = Project.objects.create(name="Work", identifier="WRK", workspace=workspace)
    ProjectMember.objects.create(project=project, member=member, role=15, is_active=True)
    todo = State.objects.create(
        name="Todo", color="#9ca3af", group="unstarted", project=project, workspace=workspace, default=True
    )
    done = State.objects.create(
        name="Done", color="#10b981", group="completed", project=project, workspace=workspace
    )
    own_issue = Issue.objects.create(
        name="Assigned task", project=project, workspace=workspace, state=todo, created_by=create_user
    )
    other_issue = Issue.objects.create(
        name="Someone else's task", project=project, workspace=workspace, state=todo, created_by=create_user
    )
    IssueAssignee.objects.create(issue=own_issue, assignee=member, project=project, workspace=workspace)
    mocker.patch("plane.app.views.issue.base.issue_activity.delay")
    mocker.patch("plane.app.views.issue.base.model_activity.delay")
    mocker.patch("plane.app.views.issue.base.issue_description_version_task.delay")
    session_client.force_authenticate(user=member)
    own_url = f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/{own_issue.id}/"
    other_url = f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/{other_issue.id}/"

    status_response = session_client.patch(own_url, {"state_id": str(done.id)}, format="json")
    field_response = session_client.patch(own_url, {"name": "Changed"}, format="json")
    other_response = session_client.patch(other_url, {"state_id": str(done.id)}, format="json")

    assert status_response.status_code == status.HTTP_204_NO_CONTENT
    assert field_response.status_code == status.HTTP_403_FORBIDDEN
    assert other_response.status_code == status.HTTP_403_FORBIDDEN
    own_issue.refresh_from_db()
    assert own_issue.state_id == done.id


@pytest.mark.django_db
def test_normal_member_directory_only_contains_project_teammates(session_client, workspace):
    requester = create_company_member(workspace, "requester")
    teammate = create_company_member(workspace, "teammate")
    outsider = create_company_member(workspace, "outsider")
    project = Project.objects.create(name="Shared", identifier="SHR", workspace=workspace)
    ProjectMember.objects.create(project=project, member=requester, role=15, is_active=True)
    ProjectMember.objects.create(project=project, member=teammate, role=15, is_active=True)
    session_client.force_authenticate(user=requester)

    response = session_client.get(f"/api/workspaces/{workspace.slug}/members/")

    assert response.status_code == status.HTTP_200_OK
    visible_ids = {str(item["member"]["id"]) for item in response.json()}
    assert str(requester.id) in visible_ids
    assert str(teammate.id) in visible_ids
    assert str(outsider.id) not in visible_ids


@pytest.mark.django_db
def test_project_membership_uses_authoritative_company_role(session_client, workspace):
    member = create_company_member(workspace, "project-role")
    project = Project.objects.create(name="Role sync", identifier="RLS", workspace=workspace)

    response = session_client.post(
        f"/api/workspaces/{workspace.slug}/projects/{project.id}/members/",
        {"members": [{"member_id": str(member.id), "role": 20}]},
        format="json",
    )

    assert response.status_code == status.HTTP_201_CREATED
    assert ProjectMember.objects.get(project=project, member=member).role == 15


@pytest.mark.django_db
def test_company_role_change_is_synced_to_project_memberships(session_client, workspace):
    member = create_company_member(workspace, "promoted")
    membership = WorkspaceMember.objects.get(workspace=workspace, member=member)
    project = Project.objects.create(name="Promotion", identifier="PRO", workspace=workspace)
    project_membership = ProjectMember.objects.create(
        project=project,
        workspace=workspace,
        member=member,
        role=15,
        is_active=True,
    )

    response = session_client.patch(
        f"/api/workspaces/{workspace.slug}/members/{membership.id}/",
        {"role": 20},
        format="json",
    )

    assert response.status_code == status.HTTP_200_OK
    project_membership.refresh_from_db()
    assert project_membership.role == 20
