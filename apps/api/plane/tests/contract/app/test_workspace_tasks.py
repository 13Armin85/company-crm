import pytest

from plane.db.models import (
    Issue,
    IssueAssignee,
    Project,
    ProjectMember,
    State,
    User,
    WorkspaceMember,
    WorkspaceTask,
)


def add_member(workspace, email):
    user = User.objects.create_user(email=email, username=email.split("@", 1)[0], password="SafePass123!")
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
    return user


@pytest.mark.django_db
def test_standalone_and_project_work_share_one_canonical_issue_table(session_client, workspace):
    assignee = add_member(workspace, "unified-assignee@example.com")
    legacy = session_client.post(
        f"/api/workspaces/{workspace.slug}/tasks/",
        {"name": "Old API work", "assignee_id": str(assignee.id)},
        format="json",
    )
    assert legacy.status_code == 201, legacy.data
    assert legacy.data["work_number"].startswith("TT")
    assert "-" not in legacy.data["work_number"]
    work = Issue.all_objects.get(id=legacy.data["id"])
    assert work.project_id is None
    assert WorkspaceTask._meta.db_table == Issue._meta.db_table == "issues"
    assert IssueAssignee.objects.filter(issue=work, assignee=assignee).exists()

    schema = session_client.get(f"/api/workspaces/{workspace.slug}/engine/entities/ticket/schema/")
    assert schema.status_code == 200, schema.data
    assert {field["binding"].get("source") for field in schema.data["fields"]} >= {
        "work_status", "assignee_ids", "project_id"
    }
    record = session_client.get(
        f"/api/workspaces/{workspace.slug}/engine/entities/ticket/records/{work.id}/"
    )
    assert record.status_code == 200, record.data
    assert record.data["id"] == str(work.id)
    assert record.data["number"] == legacy.data["work_number"]

    catalog = session_client.get(f"/api/workspaces/{workspace.slug}/engine/catalog/")
    assert catalog.status_code == 200
    codes = [item["code"] for item in catalog.data["entities"]]
    assert "ticket" in codes and "task" not in codes


@pytest.mark.django_db
def test_workspace_admin_creates_standalone_task_and_assignee_sees_it(session_client, workspace):
    assignee = add_member(workspace, "task-assignee@example.com")

    response = session_client.post(
        f"/api/workspaces/{workspace.slug}/tasks/",
        {
            "name": "Standalone task",
            "priority": "high",
            "target_date": "2026-09-20",
            "assignee_id": str(assignee.id),
        },
        format="json",
    )

    assert response.status_code == 201
    task = WorkspaceTask.objects.get(id=response.data["id"])
    assert task.workspace == workspace
    assert task.assignee == assignee
    assert task.sequence_id == 1

    session_client.force_authenticate(user=assignee)
    own_tasks = session_client.get(f"/api/workspaces/{workspace.slug}/tasks/")
    assert own_tasks.status_code == 200
    assert [row["id"] for row in own_tasks.json()] == [str(task.id)]


@pytest.mark.django_db
def test_normal_member_can_create_and_transfer_standalone_tasks(session_client, workspace):
    first_assignee = add_member(workspace, "first-assignee@example.com")
    next_assignee = add_member(workspace, "next-assignee@example.com")
    task = WorkspaceTask.objects.create(
        workspace=workspace,
        assignee=first_assignee,
        name="Transfer me",
        sequence_id=1,
    )
    session_client.force_authenticate(user=first_assignee)

    create_response = session_client.post(
        f"/api/workspaces/{workspace.slug}/tasks/",
        {"name": "Not allowed", "assignee_id": str(first_assignee.id)},
        format="json",
    )
    assert create_response.status_code == 400
    create_response = session_client.post(
        f"/api/workspaces/{workspace.slug}/tasks/",
        {"name": "Send to teammate", "assignee_id": str(next_assignee.id)}, format="json",
    )
    assert create_response.status_code == 201
    created = WorkspaceTask.objects.get(id=create_response.data["id"])
    assert created.created_by_id == first_assignee.id

    transfer_response = session_client.patch(
        f"/api/workspaces/{workspace.slug}/tasks/{task.id}/",
        {"assignee_id": str(next_assignee.id)},
        format="json",
    )
    assert transfer_response.status_code == 200
    task.refresh_from_db()
    assert task.assignee == next_assignee

    assert {str(row["id"]) for row in session_client.get(f"/api/workspaces/{workspace.slug}/tasks/").data} == {str(created.id)}
    session_client.force_authenticate(user=next_assignee)
    assert len(session_client.get(f"/api/workspaces/{workspace.slug}/tasks/").data) == 2

    status_response = session_client.patch(
        f"/api/workspaces/{workspace.slug}/tasks/{task.id}/",
        {"status": "done"},
        format="json",
    )
    assert status_response.status_code == 200
    task.refresh_from_db()
    assert task.status == WorkspaceTask.Status.DONE
    assert task.completed_at is not None


@pytest.mark.django_db
def test_normal_member_can_see_all_team_members_for_task_transfer(session_client, workspace):
    member = add_member(workspace, "team-viewer@example.com")
    teammate = add_member(workspace, "team-visible@example.com")
    session_client.force_authenticate(user=member)

    response = session_client.get(f"/api/workspaces/{workspace.slug}/members/")

    assert response.status_code == 200
    visible_ids = {str(row["member"]["id"]) for row in response.data}
    assert str(member.id) in visible_ids
    assert str(teammate.id) in visible_ids


@pytest.mark.django_db
def test_normal_member_can_transfer_own_project_issue_to_any_team_member(session_client, workspace):
    first_assignee = add_member(workspace, "project-first@example.com")
    next_assignee = add_member(workspace, "project-next@example.com")
    project = Project.objects.create(workspace=workspace, name="Transfer Project", identifier="TRN")
    ProjectMember.objects.create(project=project, member=first_assignee, role=15)
    state = State.objects.create(
        workspace=workspace,
        project=project,
        name="Todo",
        group="unstarted",
        color="#999999",
        default=True,
    )
    issue = Issue.objects.create(project=project, state=state, name="Project task")
    IssueAssignee.objects.create(project=project, issue=issue, assignee=first_assignee)
    session_client.force_authenticate(user=first_assignee)

    response = session_client.patch(
        f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/{issue.id}/",
        {"assignee_ids": [str(next_assignee.id)]},
        format="json",
    )

    assert response.status_code == 204
    assert ProjectMember.objects.filter(
        project=project,
        member=next_assignee,
        role=15,
        is_active=True,
        deleted_at__isnull=True,
    ).exists()
    assert IssueAssignee.objects.filter(issue=issue, assignee=next_assignee, deleted_at__isnull=True).exists()
    assert not IssueAssignee.objects.filter(issue=issue, assignee=first_assignee, deleted_at__isnull=True).exists()
