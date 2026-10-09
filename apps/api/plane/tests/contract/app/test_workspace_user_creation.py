import pytest
from django.test import Client
from django.utils import timezone

from plane.authentication.utils.user_auth_workflow import post_user_auth_workflow
from plane.db.models import Profile, User, WorkspaceMember
from plane.license.models import Instance


@pytest.mark.django_db
def test_workspace_admin_can_create_a_login_account(session_client, workspace):
    response = session_client.post(
        f"/api/workspaces/{workspace.slug}/members/",
        {
            "email": "new-member@example.com",
            "password": "StrongPassword!2026",
            "username": "new.member",
            "display_name": "New Member",
            "role": 15,
        },
        format="json",
    )

    assert response.status_code == 201
    user = User.objects.get(email="new-member@example.com")
    assert user.check_password("StrongPassword!2026")
    assert user.username == "new.member"
    assert user.is_managed is True
    assert Profile.objects.filter(user=user).exists()
    assert WorkspaceMember.objects.filter(workspace=workspace, member=user, role=15, is_active=True).exists()


@pytest.mark.django_db
def test_removing_workspace_membership_preserves_global_identity(session_client, workspace):
    create_response = session_client.post(
        f"/api/workspaces/{workspace.slug}/members/",
        {
            "email": "first-owner@example.com",
            "password": "StrongPassword!2026",
            "username": "reusable.username",
            "display_name": "First Owner",
            "role": 15,
        },
        format="json",
    )
    membership_id = create_response.data["id"]

    assert session_client.delete(f"/api/workspaces/{workspace.slug}/members/{membership_id}/").status_code == 204

    user = User.objects.get(email="first-owner@example.com")
    assert user.username == "reusable.username"
    assert user.is_active
    assert not WorkspaceMember.objects.get(id=membership_id).is_active


@pytest.mark.django_db
def test_workspace_admin_can_add_an_existing_account(session_client, workspace):
    user = User.objects.create(email="existing@example.com", username="existing-user")
    user.set_password("ExistingPassword!2026")
    user.save()

    response = session_client.post(
        f"/api/workspaces/{workspace.slug}/members/",
        {"email": user.email, "display_name": "Existing User", "role": 20},
        format="json",
    )

    assert response.status_code == 201
    assert WorkspaceMember.objects.filter(workspace=workspace, member=user, role=20, is_active=True).exists()


@pytest.mark.django_db
def test_signup_workflow_without_invitation_does_not_create_membership():
    user = User.objects.create_user(
        email="standalone@example.com",
        username="standalone-user",
        password="SafePass123!",
    )

    post_user_auth_workflow(user=user, is_signup=True, request=None)

    assert not WorkspaceMember.objects.filter(member=user).exists()


@pytest.mark.django_db
def test_signup_workflow_does_not_enroll_an_uninvited_company_member(monkeypatch, workspace):
    monkeypatch.setenv("INTERNAL_WORKSPACE_SLUG", workspace.slug)
    user = User.objects.create_user(
        email="company-member@example.com",
        username="company-member",
        password="SafePass123!",
    )

    post_user_auth_workflow(user=user, is_signup=True, request=None)

    assert not WorkspaceMember.objects.filter(
        workspace=workspace,
        member=user,
        role=15,
        is_active=True,
    ).exists()


@pytest.mark.django_db
def test_password_signup_without_invitation_is_blocked():
    Instance.objects.create(
        instance_name="Test Instance",
        instance_id="signup-contract-instance",
        current_version="1.0.0",
        domain="http://testserver",
        last_checked_at=timezone.now(),
        is_setup_done=True,
    )
    client = Client(HTTP_USER_AGENT="Mozilla/5.0")

    response = client.post(
        "/auth/sign-up/",
        {
            "email": "browser-signup@example.com",
            "username": "browser.signup",
            "password": "T7!mQ2#vL9@xP4",
            "next_path": "/login",
        },
        follow=False,
    )

    assert response.status_code == 302
    assert "SIGNUP_DISABLED" in response.url
    assert not User.objects.filter(email="browser-signup@example.com").exists()
    assert "_auth_user_id" not in client.session
