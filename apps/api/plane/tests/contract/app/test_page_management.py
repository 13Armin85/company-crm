"""Pages are created atomically and removed only when the server permits it."""

from uuid import uuid4

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from plane.db.models import (
    DashboardConfiguration,
    EntityType,
    EntityRecord,
    FormLayout,
    IssueView,
    User,
    Workspace,
    WorkspaceMember,
    WorkflowDefinition,
)
from plane.tests.contract.app.test_entity_engine import engine, endpoint, make_entity, create_record  # noqa: F401

pytestmark = [pytest.mark.django_db, pytest.mark.contract]


def controls(engine, entity):
    workspace, _, client = engine
    response = client.get(endpoint(workspace, "catalog/"))
    assert response.status_code == 200, response.data
    return next(row["page_management"] for row in response.data["entities"] if row["id"] == str(entity.id))


def test_created_page_has_a_published_form_and_can_be_deleted(engine):
    workspace, _, client = engine
    result = client.post(endpoint(workspace, "pages/"), {"code": "contracts", "title": "Contracts"}, format="json")
    assert result.status_code == 201, result.data
    entity = EntityType.objects.get(pk=result.data["id"])
    assert FormLayout.objects.get(entity=entity).published_id
    assert controls(engine, entity)["can_delete"] is True
    result = client.delete(endpoint(workspace, f"definitions/entities/{entity.id}/"))
    assert result.status_code == 204, result.data
    assert not EntityType.all_objects.filter(pk=entity.id).exists()
    assert not FormLayout.all_objects.filter(entity_id=entity.id).exists()
    navigation = client.get(f"/api/workspaces/{workspace.slug}/navigation/").data
    assert not any(row["code"] == "contracts" for row in navigation["entities"])


def test_failed_form_creation_rolls_back_the_page(engine, monkeypatch):
    workspace, _, client = engine

    def reject(*args, **kwargs):
        raise ValidationError("Invalid layout")

    monkeypatch.setattr("plane.app.views.workspace.entity.validate_layout", reject)
    response = client.post(endpoint(workspace, "pages/"), {"code": "incomplete", "title": "Incomplete"}, format="json")
    assert response.status_code == 400
    assert not EntityType.all_objects.filter(workspace=workspace, code="incomplete").exists()


def test_page_creation_rejects_unregistered_policy_input(engine):
    workspace, _, client = engine
    result = client.post(
        endpoint(workspace, "pages/"), {"code": "override", "title": "Override", "adapter": "user"}, format="json"
    )
    assert result.status_code == 400
    assert not EntityType.objects.filter(workspace=workspace, code="override").exists()


@pytest.mark.parametrize(
    "dependency", ["record", "historical-record", "workflow", "view", "historical-view", "dashboard"]
)
def test_dependencies_block_deletion_without_internal_errors(engine, dependency):
    workspace, owner, client = engine
    entity, _ = make_entity(engine)
    if "record" in dependency:
        row = create_record(engine, entity, {"title": "Stored"})
        if dependency == "historical-record":
            EntityRecord.objects.filter(pk=row["id"]).update(deleted_at=timezone.now())
    elif dependency == "workflow":
        WorkflowDefinition.objects.create(workspace=workspace, entity=entity, title="Approval")
    elif dependency == "dashboard":
        DashboardConfiguration.objects.create(
            workspace=workspace,
            user=owner,
            tabs=[{"id": "main", "widgets": [{"id": "counter", "type": "counter", "config": {"entity": entity.code}}]}],
        )
    else:
        view = IssueView.objects.create(
            workspace=workspace, engine_entity=entity, owned_by=owner, name="Saved", query={}
        )
        if dependency == "historical-view":
            IssueView.objects.filter(pk=view.pk).update(deleted_at=timezone.now())
    management = controls(engine, entity)
    assert management["can_delete"] is False
    assert management["can_archive"] is True
    assert management["delete_blockers"]
    response = client.delete(endpoint(workspace, f"definitions/entities/{entity.id}/"))
    assert response.status_code == 400, response.data
    assert response.data["blockers"]
    assert EntityType.objects.filter(pk=entity.pk).exists()
    assert (
        client.patch(
            endpoint(workspace, f"definitions/entities/{entity.id}/"), {"is_active": False}, format="json"
        ).status_code
        == 200
    )
    assert controls(engine, entity)["can_restore"] is True
    assert (
        client.patch(
            endpoint(workspace, f"definitions/entities/{entity.id}/"), {"is_active": True}, format="json"
        ).status_code
        == 200
    )


def test_catalog_controls_do_not_bypass_permissions_or_workspace_scope(engine):
    workspace, _, client = engine
    entity, _ = make_entity(engine)
    member = User.objects.create(email=f"{uuid4()}@example.com", username=uuid4().hex)
    WorkspaceMember.objects.create(workspace=workspace, member=member, role=15)
    client.force_authenticate(member)
    assert (
        client.post(endpoint(workspace, "pages/"), {"code": "denied", "title": "Denied"}, format="json").status_code
        == 403
    )
    assert client.delete(endpoint(workspace, f"definitions/entities/{entity.id}/")).status_code == 403
    client.force_authenticate(engine[1])
    other = Workspace.objects.create(name="Other", slug="other-pages", owner=engine[1])
    foreign = EntityType.objects.create(workspace=other, code="foreign", title="Foreign")
    assert client.delete(endpoint(workspace, f"definitions/entities/{foreign.id}/")).status_code == 404
    assert controls(engine, EntityType.objects.get(workspace=workspace, code="ticket"))["can_delete"] is False


def test_catalog_management_queries_do_not_grow_per_page(engine):
    workspace, _, client = engine
    with CaptureQueriesContext(connection) as first:
        assert client.get(endpoint(workspace, "catalog/")).status_code == 200
    EntityType.objects.bulk_create(
        [EntityType(workspace=workspace, code=f"page-{index}", title=f"Page {index}") for index in range(100)]
    )
    with CaptureQueriesContext(connection) as large:
        response = client.get(endpoint(workspace, "catalog/"))
    assert response.status_code == 200
    assert len(large) <= len(first) + 2, (len(first), len(large))
