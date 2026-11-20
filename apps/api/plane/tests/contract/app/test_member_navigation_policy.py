"""Administrator modules stay closed to ordinary users, including historical grants."""

from datetime import timedelta
from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APIClient

from plane.app.services.access_control import get_effective_permissions
from plane.app.services.entity_schema import initialize_engine
from plane.app.services.permission_registry import ADMIN_ONLY_PERMISSIONS, MEMBER_PERMISSIONS
from plane.app.services.task_policy import validate_creation_assignees
from plane.db.models import (
    EntityType,
    OrganizationPermission,
    OrganizationRole,
    OrganizationUnit,
    OrganizationUnitDelegate,
    RolePermission,
    User,
    UserAbsence,
    UserOrganizationRole,
    UserPermissionException,
    Workspace,
    WorkspaceMember,
)

pytestmark = [pytest.mark.django_db, pytest.mark.contract]


@pytest.fixture
def ordinary(workspace):
    initialize_engine(workspace)
    user = User.objects.create_user(email="ordinary@example.test", username="ordinary")
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
    client = APIClient()
    client.force_authenticate(user)
    return workspace, user, client


def legacy_grants(workspace, user):
    role = OrganizationRole.objects.create(workspace=workspace, name="Historical report operator")
    UserOrganizationRole.objects.create(workspace=workspace, user=user, role=role)
    permissions = OrganizationPermission.objects.filter(workspace=workspace, code__in=ADMIN_ONLY_PERMISSIONS)
    RolePermission.objects.bulk_create([RolePermission(role=role, permission=permission) for permission in permissions])
    UserPermissionException.objects.create(
        workspace=workspace,
        user=user,
        permission=permissions.get(code="Report.View"),
        effect="ALLOW",
    )


def test_administrator_modules_are_not_member_defaults():
    assert not MEMBER_PERMISSIONS.intersection(ADMIN_ONLY_PERMISSIONS)
    assert {"Issue.View", "DailyReport.Submit", "LeaveRequest.Create", "Workflow.View"} <= MEMBER_PERMISSIONS


def test_historical_grants_and_allow_cannot_reopen_administrator_modules(ordinary):
    workspace, user, _ = ordinary
    legacy_grants(workspace, user)
    access = get_effective_permissions(user, workspace)
    assert not access["is_admin"]
    assert not set(access["permissions"]).intersection(ADMIN_ONLY_PERMISSIONS)
    assert {"Issue.View", "DailyReport.Submit", "LeaveRequest.Create", "Workflow.View"} <= set(access["permissions"])
    assert any(row["code"] == "Report.View" for row in access["role_grants"])
    assert all(
        not row["granted"] and row["source"] == "admin_only"
        for row in access["explanations"]
        if row["code"] in ADMIN_ONLY_PERMISSIONS
    )


def test_navigation_contains_only_accessible_sections(ordinary):
    workspace, user, client = ordinary
    legacy_grants(workspace, user)
    response = client.get(f"/api/workspaces/{workspace.slug}/navigation/")
    assert response.status_code == 200
    document = response.data
    paths = {item["path"] for category in document["categories"] for item in category["items"]}
    assert {"/my-work", "/daily-report", "/leave-requests", "/settings", "/entities"} <= paths
    assert not paths.intersection(
        {
            "/reports",
            "/daily-report/team",
            "/routing",
            "/settings/engine",
            "/roles",
            "/team",
            "/organization",
            "/leave-templates",
            "/signatures",
            "/portal-settings",
        }
    )
    assert all(route["path"] in paths for route in document["routes"])
    assert all(
        category["items"] or any(page["category"] == category["id"] for page in document["entities"])
        for category in document["categories"]
    )
    assert document["design_pages"] == document["design_tabs"] == []


def test_member_directory_and_navigation_share_page_permissions(ordinary):
    workspace, user, client = ordinary
    for code, grant in [("member-page", "Issue.View"), ("admin-page", "EntityType.View")]:
        EntityType.objects.create(
            workspace=workspace,
            code=code,
            title=code,
            record_permissions={"view": grant},
        )
    navigation = client.get(f"/api/workspaces/{workspace.slug}/navigation/").data
    catalog = client.get(f"/api/workspaces/{workspace.slug}/engine/catalog/")
    assert catalog.status_code == 200
    for pages in [navigation["entities"], catalog.data["entities"]]:
        codes = {page["code"] for page in pages}
        assert "member-page" in codes
        assert "admin-page" not in codes
    directory = next(route for route in navigation["routes"] if route["path"] == "/entities")
    assert directory["to"] == "/sections/data/entities"
    assert "EntityType.View" not in get_effective_permissions(user, workspace)["permissions"]
    denied = client.get(f"/api/workspaces/{workspace.slug}/engine/entities/admin-page/records/")
    assert denied.status_code == 403


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "reports/sources/"),
        ("post", "reports/run/"),
        ("get", "reports/saved/"),
        ("post", "reports/saved/"),
        ("get", "reports/saved/{id}/"),
        ("patch", "reports/saved/{id}/"),
        ("delete", "reports/saved/{id}/"),
        ("post", "reports/saved/{id}/run/"),
        ("post", "reports/saved/{id}/copy/"),
        ("get", "reports/share-options/"),
        ("get", "reports/exports/"),
        ("post", "reports/exports/"),
        ("get", "reports/exports/{id}/"),
        ("get", "reports/exports/{id}/download/"),
        ("get", "daily-reports/team/"),
        ("put", "daily-reports/settings/"),
        ("get", "organization/routing-rules/"),
        ("post", "organization/routing-rules/"),
        ("get", "organization/role-queue/"),
        ("post", "organization/role-queue/{id}/claim/"),
        ("get", "engine/definitions/entities/"),
        ("post", "engine/pages/"),
    ],
)
def test_direct_api_access_is_denied_even_with_historical_grants(ordinary, method, path):
    workspace, user, client = ordinary
    legacy_grants(workspace, user)
    url = f"/api/workspaces/{workspace.slug}/{path.format(id=uuid4())}"
    response = getattr(client, method)(url, {}, format="json")
    assert response.status_code == 403, (url, response.status_code, response.data)


def test_numeric_legacy_admin_flag_does_not_grant_administrator_access(ordinary):
    workspace, user, _ = ordinary
    legacy_grants(workspace, user)
    WorkspaceMember.objects.filter(workspace=workspace, member=user).update(role=20)
    assert not set(get_effective_permissions(user, workspace)["permissions"]).intersection(ADMIN_ONLY_PERMISSIONS)


def test_active_workspace_administrator_keeps_modules_and_loses_them_on_demotion(ordinary):
    workspace, user, client = ordinary
    role = OrganizationRole.objects.get(workspace=workspace, system_key="admin")
    assignment = UserOrganizationRole.objects.create(workspace=workspace, user=user, role=role)
    assert ADMIN_ONLY_PERMISSIONS <= set(get_effective_permissions(user, workspace)["permissions"])
    assert client.get(f"/api/workspaces/{workspace.slug}/reports/sources/").status_code == 200
    assert client.get(f"/api/workspaces/{workspace.slug}/organization/role-queue/").status_code == 200
    assignment.is_active = False
    assignment.save(update_fields=["is_active"])
    assert client.get(f"/api/workspaces/{workspace.slug}/reports/sources/").status_code == 403


def test_administrator_role_in_another_workspace_does_not_grant_access(ordinary):
    workspace, user, _ = ordinary
    other = Workspace.objects.create(name="Other", slug="other-admin-policy", owner=user)
    WorkspaceMember.objects.create(workspace=other, member=user, role=20)
    assert get_effective_permissions(user, other)["is_admin"]
    assert not get_effective_permissions(user, workspace)["is_admin"]
    assert not set(get_effective_permissions(user, workspace)["permissions"]).intersection(ADMIN_ONLY_PERMISSIONS)


def test_administrator_delegation_cannot_open_reports_or_routing(ordinary, create_user):
    workspace, user, _ = ordinary
    now = timezone.now()
    unit = OrganizationUnit.objects.create(workspace=workspace, title="Delegated", manager=create_user)
    OrganizationUnitDelegate.objects.create(unit=unit, user=user, priority=1)
    UserAbsence.objects.create(
        workspace=workspace,
        user=create_user,
        starts_at=now - timedelta(hours=1),
        ends_at=now + timedelta(hours=1),
    )
    assert not set(get_effective_permissions(user, workspace)["permissions"]).intersection(ADMIN_ONLY_PERMISSIONS)


def test_personal_daily_report_stays_accessible(ordinary):
    workspace, _, client = ordinary
    response = client.get(f"/api/workspaces/{workspace.slug}/daily-reports/today/")
    assert response.status_code == 200, response.data


def test_member_cannot_select_smart_routing_through_ticket_creation(ordinary):
    workspace, user, _ = ordinary
    with pytest.raises(PermissionDenied):
        validate_creation_assignees(user, workspace.slug, {"routing_rule_id": "auto"}, allow_routing=True)
