from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from django.db import close_old_connections
from django.utils import timezone

from plane.api.serializers.project import ProjectCreateSerializer, ProjectUpdateSerializer
from plane.api.serializers.issue import IssueSerializer as ApiIssueSerializer
from plane.app.serializers.project import ProjectSerializer
from plane.app.serializers.issue import IssueCreateSerializer, IssueFlatSerializer
from plane.app.serializers.workspace_task import WorkspaceTaskSerializer
from plane.db.models import Issue, Project, ProjectIdentifier, Workspace, WorkspaceTask
from plane.utils.issue_search import search_issues, search_workspace_tasks

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


def test_generated_project_identifiers_are_unique_across_workspaces(workspace, create_user):
    other = Workspace.objects.create(name="Other", slug="other", owner=create_user)
    projects = [
        Project.objects.create(name=f"Project {index}", workspace=scope)
        for index, scope in enumerate([workspace, workspace, other])
    ]
    assert len({project.id for project in projects}) == 3
    assert len({project.identifier for project in projects}) == 3
    assert all(project.identifier.startswith("PRJ") and len(project.identifier) <= 12 for project in projects)


def test_generated_identifiers_skip_legacy_and_deleted_reservations(workspace):
    legacy = Project.objects.create(name="Legacy", workspace=workspace, identifier="PRJ000001")
    ProjectIdentifier.objects.create(project=legacy, workspace=workspace, name="PRJ000002", deleted_at=timezone.now())
    Project.all_objects.filter(id=legacy.id).update(deleted_at=timezone.now())
    generated = Project.objects.create(name="Generated", workspace=workspace)
    assert generated.identifier == "PRJ000003"
    legacy.refresh_from_db()
    assert legacy.identifier == "PRJ000001"


def test_deleting_last_project_does_not_reuse_its_identifier(workspace):
    first = Project.objects.create(name="First", workspace=workspace)
    identifier = first.identifier
    Project.all_objects.filter(id=first.id).delete()
    assert Project.objects.create(name="Second", workspace=workspace).identifier != identifier


@pytest.mark.parametrize("serializer_class", [ProjectSerializer, ProjectCreateSerializer])
def test_project_creation_ignores_client_identifiers(workspace, serializer_class):
    supplied_id = uuid4()
    serializer = serializer_class(
        data={"id": str(supplied_id), "identifier": "MANUAL", "name": "Generated"},
        context={"workspace_id": workspace.id},
    )
    assert serializer.is_valid(), serializer.errors
    project = serializer.save()
    assert project.id != supplied_id
    assert project.identifier.startswith("PRJ")


@pytest.mark.parametrize("serializer_class", [ProjectSerializer, ProjectUpdateSerializer])
def test_project_update_cannot_change_identifiers(workspace, serializer_class):
    project = Project.objects.create(name="Original", workspace=workspace, identifier="LEGACY")
    original_id = project.id
    serializer = serializer_class(
        project,
        data={"id": str(uuid4()), "identifier": "CHANGED", "name": "Renamed"},
        partial=True,
        context={"workspace_id": workspace.id},
    )
    assert serializer.is_valid(), serializer.errors
    serializer.save()
    project.refresh_from_db()
    assert (project.id, project.identifier, project.name) == (original_id, "LEGACY", "Renamed")


def test_task_identifiers_skip_legacy_sequences_and_are_not_reused(workspace, create_user):
    WorkspaceTask.objects.create(workspace=workspace, assignee=create_user, name="Legacy", sequence_id=200)
    first = WorkspaceTask.objects.create(workspace=workspace, assignee=create_user, name="Generated")
    assert first.sequence_id == 201
    WorkspaceTask.all_objects.filter(id=first.id).delete()
    assert WorkspaceTask.objects.create(workspace=workspace, assignee=create_user, name="Next").sequence_id == 202


def test_task_serializer_cannot_choose_or_change_identifiers(workspace, create_user):
    supplied_id = uuid4()
    serializer = WorkspaceTaskSerializer(
        data={"id": str(supplied_id), "sequence_id": 999, "name": "Generated", "assignee_id": str(create_user.id)},
        context={"workspace_id": workspace.id},
    )
    assert serializer.is_valid(), serializer.errors
    task = serializer.save(workspace=workspace)
    assert task.id != supplied_id
    assert task.sequence_id == 1
    update = WorkspaceTaskSerializer(
        task,
        data={"sequence_id": 999, "id": str(supplied_id), "name": "Renamed"},
        partial=True,
        context={"workspace_id": workspace.id},
    )
    assert update.is_valid(), update.errors
    update.save()
    task.refresh_from_db()
    assert task.sequence_id == 1
    assert task.id != supplied_id


def test_issue_search_matches_the_entire_reference_and_uuid(workspace):
    projects = [Project.objects.create(workspace=workspace, name=f"Project {index}") for index in range(2)]
    issues = [Issue.objects.create(project=project, name="Task") for project in projects]
    queryset = Issue.issue_objects.all()
    reference = f" {projects[0].identifier.lower()} - ۱ "
    assert list(search_issues(reference, queryset)) == [issues[0]]
    assert list(search_issues(str(issues[1].id).upper(), queryset)) == [issues[1]]
    assert not search_issues("UNKNOWN-1", queryset).exists()
    assert not search_issues(f"{projects[0].identifier}-9999999999", queryset).exists()


@pytest.mark.parametrize("serializer_class", [IssueCreateSerializer, IssueFlatSerializer, ApiIssueSerializer])
def test_issue_serializer_cannot_change_the_sequence(workspace, serializer_class):
    project = Project.objects.create(workspace=workspace, name="Project")
    issue = Issue.objects.create(project=project, name="Original")
    original_id, original_sequence = issue.id, issue.sequence_id
    serializer = serializer_class(
        issue,
        data={"id": str(uuid4()), "sequence_id": 999, "name": "Renamed"},
        partial=True,
        context={"workspace_id": workspace.id, "project_id": project.id},
    )
    assert serializer.is_valid(), serializer.errors
    serializer.save()
    issue.refresh_from_db()
    assert (issue.id, issue.sequence_id) == (original_id, original_sequence)


@pytest.mark.parametrize("query", ["TEAM-1", " team - ۱ ", "TEAM-١"])
def test_workspace_task_search_accepts_displayed_identifiers(workspace, create_user, query):
    task = WorkspaceTask.objects.create(workspace=workspace, assignee=create_user, name="Task")
    WorkspaceTask.objects.create(workspace=workspace, assignee=create_user, name="Other")
    assert list(search_workspace_tasks(query, WorkspaceTask.objects.all())) == [task]
    assert list(search_workspace_tasks(str(task.id), WorkspaceTask.objects.all())) == [task]


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("kind", ["project", "task"])
def test_concurrent_creation_allocates_distinct_identifiers(workspace, create_user, kind):
    workspace_id, user_id = workspace.id, create_user.id

    def create(index):
        close_old_connections()
        try:
            if kind == "project":
                return Project.objects.create(workspace_id=workspace_id, name=f"Concurrent {index}").identifier
            return WorkspaceTask.objects.create(
                workspace_id=workspace_id, assignee_id=user_id, name=f"Concurrent {index}"
            ).sequence_id
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=4) as pool:
        identifiers = list(pool.map(create, range(8)))
    assert len(set(identifiers)) == 8
