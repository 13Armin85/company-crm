"""Acceptance checks for public registration, sessions and access administration."""

import json
import uuid
from datetime import timedelta

import pytest
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.test import Client, RequestFactory
from django.urls import reverse
from django.utils import timezone

from plane.authentication.adapter.base import Adapter
from plane.authentication.adapter.error import AuthenticationException
from plane.db.models import (
    OrganizationPermission,
    User,
    UserPermissionException,
    WorkspaceMemberInvite,
    Workspace,
    WorkspaceMember,
)
from plane.license.models import Instance
from plane.settings.redis import redis_instance

from .test_crm_access_control import member, grant_role

pytestmark = pytest.mark.django_db


@pytest.fixture
def configured_instance():
    cache.clear()
    row = Instance.objects.create(
        instance_name="CRM test",
        instance_id=uuid.uuid4().hex,
        current_version="1.0",
        last_checked_at=timezone.now(),
        is_setup_done=True,
    )
    yield row
    cache.clear()


@pytest.mark.parametrize("route", ["sign-up", "space-sign-up", "magic-sign-up", "space-magic-sign-up"])
def test_public_registration_is_disabled_even_with_legacy_setting(route, configured_instance, monkeypatch, mocker):
    monkeypatch.setenv("ENABLE_SIGNUP", "1")
    email = "uninvited-registration@example.com"
    client = Client(HTTP_USER_AGENT="CRM test browser")
    payload = {"email": email, "username": "uninvited", "password": "StrongSignupPassword!2026"}
    if "magic" in route:
        mocker.patch("plane.authentication.views.app.magic.magic_link.delay")
        assert client.post(reverse("magic-generate"), {"email": email}).status_code == 200
        payload["code"] = json.loads(redis_instance().get(f"magic_{email}"))["token"]
    response = client.post(reverse(route), payload)
    assert response.status_code == 302
    assert "SIGNUP_DISABLED" in response.url
    assert not User.objects.filter(email=email).exists()
    assert "_auth_user_id" not in client.session


@pytest.mark.parametrize("invite_state", ["none", "declined", "deleted"])
def test_oauth_cannot_provision_an_uninvited_account(workspace, invite_state):
    email = "oauth-uninvited@example.com"
    if invite_state != "none":
        WorkspaceMemberInvite.objects.create(
            workspace=workspace,
            email=email,
            token=uuid.uuid4().hex,
            accepted=False,
            responded_at=timezone.now() if invite_state == "declined" else None,
            deleted_at=timezone.now() if invite_state == "deleted" else None,
        )
    adapter = Adapter(RequestFactory().get("/auth/google/callback/"), provider="google")
    adapter.user_data = {"email": email, "user": {"is_password_autoset": True}}
    with pytest.raises(AuthenticationException) as blocked:
        adapter.complete_login_or_signup()
    assert blocked.value.error_message == "SIGNUP_DISABLED"
    assert not User.objects.filter(email=email).exists()


def test_invited_password_registration_requires_proof_and_keeps_workspace_scope(
    workspace, create_user, configured_instance
):
    company = Workspace.objects.create(name="Invited company", slug="invited-company", owner=create_user)
    WorkspaceMember.objects.create(workspace=company, member=create_user, role=20)
    email = "accepted-scoped@example.com"
    invitation = WorkspaceMemberInvite.objects.create(
        workspace=company,
        email=email,
        token=uuid.uuid4().hex,
        accepted=True,
        responded_at=timezone.now(),
        role=15,
    )
    client = Client(HTTP_USER_AGENT="CRM test browser")
    payload = {"email": email, "username": "accepted-scoped", "password": "InvitedSafePassword!2026"}
    blocked = client.post(reverse("sign-up"), payload)
    assert "SIGNUP_DISABLED" in blocked.url
    assert not User.objects.filter(email=email).exists()
    permitted = client.post(reverse("sign-up"), {**payload, "invitation_token": invitation.token})
    assert permitted.status_code == 302 and "error_code" not in permitted.url
    user = User.objects.get(email=email)
    assert WorkspaceMember.objects.filter(member=user, workspace=company, is_active=True).exists()
    assert not WorkspaceMember.objects.filter(member=user, workspace=workspace).exists()


def test_password_change_invalidates_every_browser_session(session_client, workspace):
    user = member(workspace, "session-reset")
    first, second = Client(), Client()
    first.force_login(user)
    second.force_login(user)
    assert first.get("/api/users/me/").status_code == 200
    response = session_client.post(
        f"/api/workspaces/{workspace.slug}/organization/users/{user.id}/password/",
        {"new_password": "NewSessionPassword!2026", "confirm_password": "NewSessionPassword!2026"},
        format="json",
    )
    assert response.status_code == 200
    assert response["Cache-Control"] == "private, no-store"
    user.refresh_from_db()
    assert not user.check_password("SafePassword!2026")
    assert user.check_password("NewSessionPassword!2026")
    for client in (first, second):
        assert client.get("/api/users/me/").status_code == 401
        assert "_auth_user_id" not in client.session


def test_cookie_authenticated_mutations_require_csrf(workspace, create_user):
    target = member(workspace, "csrf-target")
    client = Client(enforce_csrf_checks=True)
    client.force_login(create_user)
    endpoint = f"/api/workspaces/{workspace.slug}/organization/users/{target.id}/"
    assert client.patch(endpoint, {"display_name": "Forged"}, content_type="application/json").status_code == 403
    target.refresh_from_db()
    assert target.display_name != "Forged"
    token = client.get("/auth/get-csrf-token/").json()["csrf_token"]
    response = client.patch(
        endpoint, {"display_name": "Verified"}, content_type="application/json", HTTP_X_CSRFTOKEN=token
    )
    assert response.status_code == 200
    target.refresh_from_db()
    assert target.display_name == "Verified"


def test_exception_duplicates_updates_and_conflict_priority(session_client, workspace):
    user = member(workspace, "exceptions-v2")
    permission = OrganizationPermission.objects.get(workspace=workspace, code="Referral.Delete")
    endpoint = f"/api/workspaces/{workspace.slug}/organization/users/{user.id}/exceptions/"
    payload = {"permission": str(permission.id), "effect": "ALLOW"}
    row = session_client.post(endpoint, payload, format="json")
    assert row.status_code == 201
    assert session_client.post(endpoint, payload, format="json").status_code == 400
    with pytest.raises(IntegrityError), transaction.atomic():
        UserPermissionException.objects.create(workspace=workspace, user=user, permission=permission, effect="ALLOW")
    deny = session_client.post(endpoint, {**payload, "effect": "DENY"}, format="json")
    assert deny.status_code == 201
    effective = session_client.get(
        f"/api/workspaces/{workspace.slug}/organization/users/{user.id}/effective-permissions/"
    ).json()
    explained = next(item for item in effective["explanations"] if item["code"] == permission.code)
    assert explained["has_conflict"] and not explained["granted"]
    assert explained["exception_effects"] == ["ALLOW", "DENY"]
    assert session_client.patch(f"{endpoint}{deny.data['id']}/", {"is_active": False}, format="json").status_code == 200
    expires = (timezone.now() + timedelta(hours=1)).isoformat()
    assert session_client.patch(f"{endpoint}{row.data['id']}/", {"ends_at": expires}, format="json").status_code == 200


def test_role_user_count_is_scoped_and_distinct(session_client, workspace):
    user = member(workspace, "role-count")
    role = grant_role(workspace, user, ["Referral.View"], name="Counted role")
    rows = session_client.get(f"/api/workspaces/{workspace.slug}/organization/roles/").json()
    assert next(row for row in rows if row["id"] == str(role.id))["user_count"] == 1


def test_unauthenticated_management_returns_401(api_client, workspace):
    assert api_client.get(f"/api/workspaces/{workspace.slug}/organization/roles/").status_code == 401
