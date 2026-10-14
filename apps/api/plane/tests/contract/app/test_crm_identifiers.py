from uuid import uuid4

import pytest

from plane.db.models import Issue, Project, WorkspaceTask
from .test_crm_access_control import grant_role, member

pytestmark = pytest.mark.django_db


def test_project_api_generates_and_preserves_identifiers(session_client, workspace):
    path = f"/api/workspaces/{workspace.slug}/projects/"
    supplied_id = str(uuid4())
    response = session_client.post(
        path, {"name": "Automatic identifiers", "id": supplied_id, "identifier": "MANUAL"}, format="json"
    )
    assert response.status_code == 201, response.data
    assert str(response.data["id"]) != supplied_id
    identifier = response.data["identifier"]
    assert identifier.startswith("PRJ")
    project_id = response.data["id"]
    response = session_client.patch(f"{path}{project_id}/", {"identifier": "CHANGED"}, format="json")
    assert response.status_code == 200, response.data
    assert response.data["identifier"] == identifier
    assert Project.objects.get(id=project_id).identifier == identifier
    for query in [identifier.lower(), str(project_id)]:
        response = session_client.get(path, {"search": query})
        assert response.status_code == 200
        assert [str(row["id"]) for row in response.data] == [str(project_id)]


def test_task_api_generates_and_searches_identifiers_without_exposing_other_work(
    session_client, workspace, create_user
):
    path = f"/api/workspaces/{workspace.slug}/tasks/"
    other = member(workspace, "identifier-other")
    WorkspaceTask.objects.create(workspace=workspace, assignee=other, name="Other user")
    response = session_client.post(
        path,
        {"name": "Generated task", "assignee_id": str(create_user.id), "sequence_id": 999, "id": str(uuid4())},
        format="json",
    )
    assert response.status_code == 201, response.data
    assert response.data["sequence_id"] == 2

    task_id = str(response.data["id"])
    for query in ["team - ۲", task_id]:
        response = session_client.get(path, {"search": query})
        assert response.status_code == 200
        assert [str(row["id"]) for row in response.data] == [task_id]
    response = session_client.patch(f"{path}{task_id}/", {"sequence_id": 999}, format="json")
    assert response.status_code == 200, response.data
    assert response.data["sequence_id"] == 2

    grant_role(workspace, other, ["Issue.View"], "Identifier viewer")
    session_client.force_authenticate(user=other)
    for query in ["TEAM-2", task_id]:
        response = session_client.get(path, {"search": query})
        assert response.status_code == 200
        assert response.data == []


def test_issue_api_cannot_change_its_reference(session_client, workspace):
    project = Project.objects.create(workspace=workspace, name="Issue identifiers")
    issue = Issue.objects.create(project=project, name="Original")
    path = f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/{issue.id}/"
    response = session_client.patch(path, {"sequence_id": 999, "name": "Renamed"}, format="json")
    assert response.status_code == 204, response.data
    issue.refresh_from_db()
    assert issue.sequence_id == 1
    assert issue.name == "Renamed"
