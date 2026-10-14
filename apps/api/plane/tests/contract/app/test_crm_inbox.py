from datetime import timedelta
from uuid import uuid4

import pytest
from django.utils import timezone

from plane.db.models import Issue, Notification, Project, User, Workspace


def test_notification_context_in_list_and_details_is_scoped_to_its_project(session_client, workspace, create_user):
    project = Project.objects.create(workspace=workspace, name="پروژه پشتیبانی", identifier="SUP")
    issue = Issue.objects.create(workspace=workspace, project=project, name="پیگیری درخواست مشتری")
    row = notification(workspace, create_user, project=project, entity_identifier=issue.id)
    base = f"/api/workspaces/{workspace.slug}/users/notifications/"
    for response in (session_client.get(base, {"all_notifications": "true"}), session_client.get(f"{base}{row.id}/")):
        assert response.status_code == 200
        item = response.data[0] if isinstance(response.data, list) else response.data
        assert item["project_name"] == "پروژه پشتیبانی"
        assert item["entity_title"] == "پیگیری درخواست مشتری"

    other_project = Project.objects.create(workspace=workspace, name="پروژه دیگر", identifier="OTHER")
    row.project = other_project
    row.save(update_fields=["project"])
    assert session_client.get(f"{base}{row.id}/").data["entity_title"] is None


def test_notification_context_does_not_resolve_an_issue_from_another_workspace(session_client, workspace, create_user):
    other_workspace = Workspace.objects.create(name="شرکت دیگر", slug="other-context", owner=create_user)
    other_project = Project.objects.create(workspace=other_workspace, name="پروژه خصوصی", identifier="PRIVATE")
    private = Issue.objects.create(workspace=other_workspace, project=other_project, name="نام خصوصی")
    row = notification(workspace, create_user, project=other_project, entity_identifier=private.id)
    response = session_client.get(f"/api/workspaces/{workspace.slug}/users/notifications/{row.id}/")
    assert response.status_code == 200
    assert response.data["entity_title"] is None
    assert response.data["project_name"] is None


pytestmark = pytest.mark.django_db


def notification(workspace, receiver, **values):
    return Notification.objects.create(
        workspace=workspace,
        receiver=receiver,
        title="اعلان آزمایشی",
        **{"entity_name": "issue", "sender": "updated", "entity_identifier": uuid4(), **values},
    )


def test_crm_inbox_includes_mentions_and_other_notification_states(session_client, workspace, create_user):
    rows = [
        notification(workspace, create_user),
        notification(workspace, create_user, sender="mentioned"),
        notification(workspace, create_user, entity_name="project", archived_at=timezone.now()),
        notification(workspace, create_user, snoozed_till=timezone.now() - timedelta(days=1)),
    ]
    other = User.objects.create(email="inbox-other@example.com", username="inbox-other")
    notification(workspace, other)
    url = f"/api/workspaces/{workspace.slug}/users/notifications/"
    legacy = session_client.get(url)
    assert legacy.status_code == 200
    assert {str(row["id"]) for row in legacy.data} == {str(rows[0].id)}
    response = session_client.get(url, {"all_notifications": "true"})
    assert response.status_code == 200
    assert {str(row["id"]) for row in response.data} == {str(row.id) for row in rows}


def test_read_all_marks_every_own_notification_and_preserves_other_data(session_client, workspace, create_user):
    rows = [
        notification(workspace, create_user),
        notification(workspace, create_user, sender="mentioned", archived_at=timezone.now()),
        notification(workspace, create_user, snoozed_till=timezone.now() - timedelta(days=1)),
        notification(workspace, create_user, snoozed_till=timezone.now() + timedelta(days=1), entity_name="project"),
    ]
    prior_time = timezone.now() - timedelta(days=3)
    already_read = notification(workspace, create_user, read_at=prior_time)
    other = User.objects.create(email="inbox-other-receiver@example.com", username="inbox-other-receiver")
    other_receiver = notification(workspace, other)
    other_workspace = Workspace.objects.create(name="Other inbox", slug="other-inbox", owner=create_user)
    outside = notification(other_workspace, create_user)
    url = f"/api/workspaces/{workspace.slug}/users/notifications/mark-all-read/"
    response = session_client.post(url, {"all_notifications": True}, format="json")
    assert response.status_code == 200
    assert response.data["updated_count"] == len(rows)
    assert not Notification.objects.filter(id__in=[row.id for row in rows], read_at__isnull=True).exists()
    for row in (other_receiver, outside):
        row.refresh_from_db()
        assert row.read_at is None
    already_read.refresh_from_db()
    assert already_read.read_at == prior_time
    assert session_client.post(url, {"all_notifications": True}, format="json").data["updated_count"] == 0


def test_notification_details_returns_full_plain_text_and_is_receiver_scoped(session_client, workspace, create_user):
    full_text = "متن کامل اعلان " * 300
    row = notification(
        workspace,
        create_user,
        message_html=f"<p>{full_text}</p><p>پاراگراف آخر &amp; جزئیات</p>",
        message_stripped="خلاصه",
    )
    url = f"/api/workspaces/{workspace.slug}/users/notifications/{row.id}/"
    response = session_client.get(url)
    assert response.status_code == 200
    assert response.data["message_text"] == full_text + "\nپاراگراف آخر & جزئیات"
    other = User.objects.create(email="inbox-private@example.com", username="inbox-private")
    private = notification(workspace, other)
    assert session_client.get(f"/api/workspaces/{workspace.slug}/users/notifications/{private.id}/").status_code == 404


def test_read_one_is_scoped_and_missing_notifications_return_404(session_client, workspace, create_user):
    row = notification(workspace, create_user)
    url = f"/api/workspaces/{workspace.slug}/users/notifications/{row.id}/read/"
    assert session_client.post(url).status_code == 200
    row.refresh_from_db()
    assert row.read_at is not None
    other = User.objects.create(email="inbox-private-read@example.com", username="inbox-private-read")
    private = notification(workspace, other)
    assert (
        session_client.post(f"/api/workspaces/{workspace.slug}/users/notifications/{private.id}/read/").status_code
        == 404
    )
    private.refresh_from_db()
    assert private.read_at is None


def test_legacy_read_all_filters_are_preserved(session_client, workspace, create_user):
    visible = notification(workspace, create_user)
    archived = notification(workspace, create_user, archived_at=timezone.now())
    response = session_client.post(
        f"/api/workspaces/{workspace.slug}/users/notifications/mark-all-read/", {}, format="json"
    )
    assert response.status_code == 200
    visible.refresh_from_db()
    archived.refresh_from_db()
    assert visible.read_at is not None
    assert archived.read_at is None
