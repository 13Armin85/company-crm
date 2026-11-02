"""Server-side paging, search and filters behind the CRM tables."""

import pytest
from rest_framework.test import APIClient

from plane.db.models import (
    Issue,

    OrganizationPermission,
    OrganizationRole,
    Project,
    ProjectMember,
    RolePermission,
    State,
    User,
    UserOrganizationRole,
    WorkspaceMember,
    WorkspaceTask,
)

pytestmark = [pytest.mark.django_db, pytest.mark.contract]


def member(workspace, suffix, codes=()):
    user = User.objects.create_user(
        email=f"paging-{suffix}@example.com", username=f"paging-{suffix}", password="SafePassword!2026"
    )
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
    if codes:
        role = OrganizationRole.objects.create(workspace=workspace, name=f"role-{suffix}")
        for permission in OrganizationPermission.objects.filter(workspace=workspace, code__in=codes):
            RolePermission.objects.create(role=role, permission=permission)
        UserOrganizationRole.objects.create(workspace=workspace, user=user, role=role)
    return user


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def test_roles_are_paged_and_searched_on_the_server(session_client, workspace):
    for index in range(23):
        OrganizationRole.objects.create(workspace=workspace, name=f"نقش آزمایشی {index:02d}")
    base = f"/api/workspaces/{workspace.slug}/organization/roles/"
    total = OrganizationRole.objects.filter(workspace=workspace).count()

    first = session_client.get(base, {"page": 1, "page_size": 10})
    assert first.status_code == 200, first.data
    assert first.data["count"] == total
    assert len(first.data["results"]) == 10
    assert first.data["pages"] == -(-total // 10)

    last = session_client.get(base, {"page": 999, "page_size": 10})
    assert last.data["page"] == last.data["pages"]

    # Arabic "ي" finds Persian "ی".
    searched = session_client.get(base, {"page": 1, "q": "آزمايشي 07"})
    assert [row["name"] for row in searched.data["results"]] == ["نقش آزمایشی 07"]

    # Callers that do not ask for a page still get the whole list.
    assert len(session_client.get(base).data) == total


def test_member_task_tabs_follow_received_history_and_sent_rules(workspace, create_user):
    user = member(workspace, "tasks", codes=("Issue.View",))
    manager = create_user

    def task(name, assignee, creator, status="todo"):
        row = WorkspaceTask.objects.create(
            workspace=workspace, name=name, assignee=assignee, status=status, created_by=creator
        )
        Issue.all_objects.filter(id=row.id).update(created_by=creator)
        return row

    task("received", user, manager)
    task("self-created", user, user)
    task("finished", user, manager, status="done")
    task("sent-to-manager", manager, user)
    task("someone-elses", manager, manager)

    client = client_for(user)
    base = f"/api/workspaces/{workspace.slug}/tasks/table/"

    def names(**params):
        response = client.get(base, {"page": 1, **params})
        assert response.status_code == 200, response.data
        return sorted(row["item"]["name"] for row in response.data["results"]), response.data

    received, data = names(view="all", tab="received")
    assert received == ["received"]
    assert data["tab_counts"] == {"received": 1, "history": 3, "sent": 1}
    assert names(view="all", tab="sent")[0] == ["sent-to-manager"]
    assert "someone-elses" not in names(view="all", tab="history")[0]
    assert names(view="mine", tab="all")[0] == ["received"]
    assert names(view="all", tab="history", statuses="Done")[0] == ["finished"]


def test_projects_table_computes_progress_tabs_and_filters(session_client, workspace, create_user):
    project = Project.objects.create(workspace=workspace, name="پروژه نیمه‌کاره", identifier="HALF")
    ProjectMember.objects.create(workspace=workspace, project=project, member=create_user, role=20)
    todo = State.objects.create(workspace=workspace, project=project, name="Open", group="unstarted")
    done = State.objects.create(workspace=workspace, project=project, name="Closed", group="completed")
    Issue.objects.create(workspace=workspace, project=project, name="باز", state=todo)
    Issue.objects.create(workspace=workspace, project=project, name="بسته", state=done)
    base = f"/api/workspaces/{workspace.slug}/projects/table/"

    response = session_client.get(base, {"page": 1, "tab": "active"})
    assert response.status_code == 200, response.data
    row = next(item for item in response.data["results"] if str(item["id"]) == str(project.id))
    assert row["progress"] == 50
    assert response.data["tab_counts"]["completed"] == 0

    filtered = session_client.get(base, {"page": 1, "progress_min": 60})
    assert str(project.id) not in [str(item["id"]) for item in filtered.data["results"]]


def test_members_table_searches_email_and_keeps_role_chips(session_client, workspace, create_user):
    colleague = member(workspace, "colleague", codes=("Issue.View",))
    response = session_client.get(
        f"/api/workspaces/{workspace.slug}/members/", {"page": 1, "q": "paging-colleague@example"}
    )
    assert response.status_code == 200, response.data
    assert [str(row["member"]["id"]) for row in response.data["results"]] == [str(colleague.id)]
    assert "role-colleague" in [role["name"] for role in response.data["results"][0]["organization_roles"]]
