"""Database navigation and per-user preferences never widen API access."""

from copy import deepcopy
from uuid import uuid4

import pytest
from rest_framework.test import APIClient

from plane.app.services.entity_schema import initialize_engine
from plane.app.services.navigation_defaults import DEFAULT_NAVIGATION
from plane.app.services.permission_registry import sync_permission_catalog
from plane.db.models import SurfaceConfiguration, User, Workspace, WorkspaceMember

pytestmark = [pytest.mark.django_db, pytest.mark.contract]


def endpoint(workspace):
    return f"/api/workspaces/{workspace.slug}/navigation/"


@pytest.fixture
def navigation(workspace, session_client):
    initialize_engine(workspace)
    sync_permission_catalog(workspace)
    return workspace, session_client


def test_database_categories_labels_and_safe_paths(navigation):
    workspace, client = navigation
    document = deepcopy(DEFAULT_NAVIGATION)
    category = next(row for row in document["categories"] if row["id"] == "org")
    category["id"] = "company"
    category["title"] = "Database category"
    roles = next(item for item in category["items"] if item["path"] == "/roles")
    roles.update(
        label="Database roles", path="https://evil.example/", to="//evil.example"
    )
    category["items"].append({"code": "unknown", "path": "//evil.example"})
    SurfaceConfiguration.objects.create(
        workspace=workspace, code="crm-navigation", definition=document
    )
    response = client.get(endpoint(workspace))
    assert response.status_code == 200, response.data
    assert response["Cache-Control"] == "private, no-store"
    stored = next(row for row in response.data["categories"] if row["id"] == "company")
    assert stored["title"] == "Database category"
    role = next(row for row in stored["items"] if row["path"] == "/roles")
    assert role["label"] == "Database roles"
    assert role["to"] == "/sections/company/roles"
    assert not any(row["code"] == "unknown" for row in stored["items"])
    pages = response.data["design_pages"]
    assert pages and all(
        row["category"] in {cat["id"] for cat in response.data["categories"]}
        for row in pages
    )
    assert next(row for row in pages if row["code"] == "roles")["category"] == "company"


def test_preferences_persist_per_user_and_workspace(navigation, create_user):
    workspace, client = navigation
    response = client.patch(
        endpoint(workspace), {"design_sidebar": ["roles", "roles"]}, format="json"
    )
    assert response.status_code == 200, response.data
    assert client.get(endpoint(workspace)).data["preferences"]["design_sidebar"] == [
        "roles"
    ]
    other = User.objects.create(email=f"{uuid4()}@example.com", username=uuid4().hex)
    WorkspaceMember.objects.create(workspace=workspace, member=other, role=20)
    client.force_authenticate(other)
    assert client.get(endpoint(workspace)).data["preferences"]["design_sidebar"] is None
    second = Workspace.objects.create(name="Other", slug="other-nav", owner=create_user)
    WorkspaceMember.objects.create(workspace=second, member=create_user, role=20)
    client.force_authenticate(create_user)
    assert client.get(endpoint(second)).data["preferences"]["design_sidebar"] is None
    assert (
        client.patch(
            endpoint(workspace), {"design_sidebar": ["unknown"]}, format="json"
        ).status_code
        == 400
    )
    assert (
        client.patch(endpoint(workspace), {"categories": []}, format="json").status_code
        == 400
    )


def test_unauthenticated_and_nonmember_are_denied(navigation):
    workspace, _ = navigation
    client = APIClient()
    assert client.get(endpoint(workspace)).status_code in (401, 403)
    outsider = User.objects.create(email=f"{uuid4()}@example.com", username=uuid4().hex)
    client.force_authenticate(outsider)
    assert client.get(endpoint(workspace)).status_code in (403, 404)
    assert client.patch(
        endpoint(workspace), {"design_sidebar": []}, format="json"
    ).status_code in (403, 404)


def test_member_cannot_change_metadata_or_see_designer_pages(navigation):
    workspace, client = navigation
    member = User.objects.create(email=f"{uuid4()}@example.com", username=uuid4().hex)
    WorkspaceMember.objects.create(workspace=workspace, member=member, role=15)
    client.force_authenticate(member)
    response = client.get(endpoint(workspace))
    assert response.status_code == 200, response.data
    assert response.data["design_pages"] == []
    assert not any(
        row["path"] == "/settings/engine"
        for category in response.data["categories"]
        for row in category["items"]
    )
    assert (
        client.patch(
            endpoint(workspace), {"design_sidebar": []}, format="json"
        ).status_code
        == 403
    )
