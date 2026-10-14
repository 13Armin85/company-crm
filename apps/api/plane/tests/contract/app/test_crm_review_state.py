import importlib
from types import SimpleNamespace

import pytest
from django.apps import apps
from django.db import connection

from plane.db.models import State
from .test_organization_routing import create_issue

pytestmark = pytest.mark.django_db


def apply_review_migration():
    migration = importlib.import_module("plane.db.migrations.0132_crm_review_state")
    migration.add_review_state(apps, SimpleNamespace(connection=connection))


def test_review_is_available_without_changing_existing_issue_state(workspace):
    issue = create_issue(workspace)
    old_state_id = issue.state_id
    apply_review_migration()
    review = State.objects.get(project=issue.project, name="Review")
    assert review.group == "started"
    assert review.workspace_id == workspace.id
    assert review.default is False
    issue.refresh_from_db()
    assert issue.state_id == old_state_id
    apply_review_migration()
    assert State.objects.filter(project=issue.project, name="Review").count() == 1


@pytest.mark.parametrize("name", ["بازبینی", "In Review"])
def test_review_migration_preserves_custom_review_states(workspace, name):
    issue = create_issue(workspace)
    existing = State.objects.create(project=issue.project, name=name, group="started", color="#123456")
    apply_review_migration()
    assert not State.objects.filter(project=issue.project, name="Review").exists()
    existing.refresh_from_db()
    assert existing.name == name
    assert existing.color == "#123456"


def test_review_migration_does_not_repurpose_a_completed_state_named_review(workspace):
    issue = create_issue(workspace)
    existing = State.objects.create(project=issue.project, name="Review", group="completed", color="#123456")
    apply_review_migration()
    existing.refresh_from_db()
    assert existing.group == "completed"
    review = State.objects.get(project=issue.project, name="بازبینی")
    assert review.group == "started"
