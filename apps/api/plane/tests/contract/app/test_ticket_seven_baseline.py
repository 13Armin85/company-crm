"""Ticket 7 (customer portal), phase 1: characterization of the behavior before any change.

These tests pin what the code does on HEAD, including the gaps the ticket closes.
Tests marked "gap" describe a missing capability; after the ticket-7 work they were
turned into "after" assertions (see docs/TICKET-7-DELIVERY.fa.md, section 7) and the
original HEAD behavior is quoted in each docstring.
"""

import pytest
from django.db import models
from rest_framework.test import APIClient

from plane.app.services import ticket_core as core
from plane.app.services.entity_config import TEMPLATES
from plane.app.services.entity_files import validate_file
from plane.app.services.entity_schema import initialize_engine
from plane.app.services.permission_registry import PERMISSION_REGISTRY, sync_permission_catalog
from plane.db.models import (
    EntityEvent,
    Intake,
    Issue,
    IssueComment,
    User,
    WorkflowPause,
    WorkspaceMember,
)

pytestmark = [pytest.mark.django_db, pytest.mark.contract]

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.fixture
def ws(workspace):
    initialize_engine(workspace)
    sync_permission_catalog(workspace)
    return workspace


def make_ticket(workspace, creator, name="تیکت پایه"):
    issue = Issue(workspace=workspace, name=name)
    issue.save(created_by_id=creator.id)
    return issue


def test_comment_has_internal_external_access_defaulting_to_internal():
    field = IssueComment._meta.get_field("access")
    assert field.default == "INTERNAL"
    assert {value for value, _ in field.choices} == {"INTERNAL", "EXTERNAL"}


def test_comment_project_is_nullable_for_project_less_tickets():
    """gap — on HEAD ``IssueComment.project`` was NOT NULL, so a project-less ticket could not
    carry any comment. After ticket 7 the column is nullable (AlterField, relaxing only)."""
    assert IssueComment._meta.get_field("project").null is True  # after ticket 7 (HEAD: False)


def test_ticket_status_category_mapping_is_the_single_source():
    assert core.work_category(group="completed") == core.DONE
    assert core.work_category(group="cancelled") == core.DONE
    assert core.work_category(status="done", project=False) == core.DONE
    assert core.work_category(status="review", project=False) == core.IN_PROGRESS
    assert core.work_category(status="unknown", project=False) == core.TODO


def test_non_member_and_anonymous_cannot_read_a_ticket(ws, create_user):
    issue = make_ticket(ws, create_user)
    stranger = User.objects.create_user(email="stranger@example.test", username="stranger", password="Safe!2026pw")
    url = f"/api/workspaces/{ws.slug}/tickets/{issue.id}/core/"
    anonymous = APIClient().get(url)
    assert anonymous.status_code in (401, 403)
    client = APIClient()
    client.force_authenticate(user=stranger)
    assert client.get(url).status_code in (403, 404)


def test_portal_api_prefix_is_served():
    """gap — on HEAD ``/api/portal/v1/`` returned 404 (no customer API). Now the session
    endpoint exists and refuses an anonymous caller with 401."""
    assert APIClient().get("/api/portal/v1/session/").status_code == 401  # after ticket 7 (HEAD: 404)


def test_portal_ticket_source_exists_only_in_the_support_template():
    values = {(v["category"], v["code"]) for v in TEMPLATES["support"]["values"]}
    assert ("ticket-source", "portal") in values
    assert any(f["code"] == "sales_amount" and f["kind"] == "money" for f in TEMPLATES["sales"]["fields"])


def test_customer_wait_pause_belongs_to_a_workflow_step():
    assert WorkflowPause.Kind.CUSTOMER == "customer"
    assert WorkflowPause._meta.get_field("step_run").null is False


def test_contact_resolution_never_writes_a_comment(ws, create_user):
    issue = make_ticket(ws, create_user)
    client = APIClient()
    client.force_authenticate(user=create_user)
    response = client.post(
        f"/api/workspaces/{ws.slug}/tickets/{issue.id}/contact/",
        {"channel": "phone", "contact_name": "مشتری", "summary": "حل شد", "resolved": True},
        format="json",
    )
    assert response.status_code == 201, response.data
    assert not IssueComment.all_objects.filter(issue=issue).exists()


def test_validate_file_checks_size_and_extension_only():
    """Pinned: the shared helper never inspected content; ticket 7 adds a content check in
    ``portal_files`` on top of it instead of changing this helper's contract."""
    validate_file({"extensions": ["pdf"]}, "fake.pdf", len(PNG))
    with pytest.raises(Exception):
        validate_file({"extensions": ["pdf"]}, "x.exe", 10)
    with pytest.raises(Exception):
        validate_file({"max_file_size": 5}, "x.pdf", 10)


def test_portal_permission_codes_are_registered():
    """gap — on HEAD no ``Portal.*`` / ``Quote.Manage`` code existed."""
    for code in (
        "Portal.Account.Manage",
        "Portal.Settings.Manage",
        "Portal.Request.Triage",
        "Portal.Reply",
        "Quote.Manage",
        "Portal.Feedback.View",
    ):
        assert code in PERMISSION_REGISTRY  # after ticket 7 (HEAD: absent)


def test_entity_events_are_plain_append_rows():
    names = {c.name for c in EntityEvent._meta.constraints}
    # HEAD had no constraint at all; ticket 7 adds only the two partial unique ones.
    assert names == {"crm_quote_one_decision", "crm_portal_one_feedback"}  # after ticket 7 (HEAD: none)


def test_intake_is_project_bound():
    """Native Intake cannot hold project-less tickets: it is a ProjectBaseModel with a NOT NULL project."""
    assert Intake._meta.get_field("project").null is False
    assert isinstance(Intake._meta.get_field("project"), models.ForeignKey)


def test_customers_of_reads_the_existing_relation(ws, create_user):
    issue = make_ticket(ws, create_user)
    assert core.customers_of(issue, create_user) == []


def test_workspace_member_is_the_only_internal_identity(ws, create_user):
    assert WorkspaceMember.objects.filter(workspace=ws, member=create_user).exists()
