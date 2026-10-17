import pytest
from plane.db.models import User, WorkspaceMember

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize("uppercase", [False, True])
def test_duplicate_user_email_is_persian_and_preserves_accounts(session_client, workspace, create_user, uppercase):
    email = create_user.email.upper() if uppercase else create_user.email
    before = User.objects.count(), WorkspaceMember.objects.count()
    response = session_client.post(f"/api/workspaces/{workspace.slug}/members/", {
        "email": f" {email} ", "username": "new-username", "password": "SafePassword!2026",
    }, format="json")
    assert response.status_code == 400
    assert response.data == {"error": "این ایمیل ثبت شده است"}
    assert (User.objects.count(), WorkspaceMember.objects.count()) == before


def test_unknown_validation_errors_are_localized(session_client, workspace):
    response = session_client.post(f"/api/workspaces/{workspace.slug}/members/", {
        "email": "new-user@example.com", "username": "new-user", "password": "12345678",
    }, format="json")
    assert response.status_code == 400
    assert response.data["password"]
    assert all(not message.isascii() for message in response.data["password"])
