"""Support time is explicit, overlap-safe, auditable and customer-scoped."""

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from rest_framework.test import APIClient

from plane.app.services.permission_registry import sync_permission_catalog
from plane.db.models import EntityEvent, EntityRecord, EntityType, SupportActivity, User, WorkspaceMember

pytestmark = [pytest.mark.django_db, pytest.mark.contract]
ZONE = ZoneInfo("Asia/Tehran")


def moment(hour, minute=0):
    return datetime(2025, 11, 16, hour, minute, tzinfo=ZONE).isoformat()


@pytest.fixture
def setup(workspace, create_user, session_client):
    sync_permission_catalog(workspace)
    customer_entity = EntityType.objects.create(workspace=workspace, code="customer", title="مشتری")
    customer = EntityRecord(workspace=workspace, entity=customer_entity, number="CUS-1", data={"title": "مشتری الف"})
    customer.save(created_by_id=create_user.id)
    url = f"/api/workspaces/{workspace.slug}/support-activities/"
    return workspace, create_user, session_client, customer, url


def payload(customer, start=8, end=9, **extra):
    return {
        "customer_id": str(customer.id),
        "kind": "phone",
        "starts_at": moment(start),
        "ends_at": moment(end),
        "summary": "پاسخ تلفنی به مشتری",
        "confirm": True,
        **extra,
    }


def test_explicit_confirmation_duration_overlap_correction_and_history(setup):
    workspace, actor, client, customer, url = setup
    without_confirmation = client.post(url, payload(customer, confirm=False), format="json")
    assert without_confirmation.status_code == 400
    invalid = client.post(url, payload(customer, start=9, end=8), format="json")
    assert invalid.status_code == 400
    created = client.post(url, payload(customer), format="json")
    assert created.status_code == 201, created.data
    assert created.data["duration_minutes"] == 60
    assert created.data["customer"]["id"] == str(customer.id)
    assert created.data["supporter"]["id"] == str(actor.id)
    row_id = created.data["id"]

    overlap = client.post(url, payload(customer, start=8, end=10), format="json")
    assert overlap.status_code == 400 and "هم‌پوشانی" in str(overlap.data)
    corrected = client.put(
        url + row_id + "/",
        payload(customer, start=8, end=10, revision=1, reason="اصلاح زمان واقعی"),
        format="json",
    )
    assert corrected.status_code == 200, corrected.data
    assert corrected.data["duration_minutes"] == 120 and corrected.data["revision"] == 2
    stale = client.put(
        url + row_id + "/",
        payload(customer, start=8, end=9, revision=1, reason="نسخهٔ قدیمی"),
        format="json",
    )
    assert stale.status_code == 400
    assert list(EntityEvent.objects.filter(record_id=row_id).values_list("event_type", flat=True)) == [
        "support_activity.confirmed",
        "support_activity.corrected",
    ]
    assert SupportActivity.objects.count() == 1
    assert client.get(url).data["results"][0]["duration_minutes"] == 120
    second = client.post(url, payload(customer, start=10, end=11, kind="support"), format="json")
    assert second.status_code == 201, second.data
    summary = client.get(url + "summary/")
    assert summary.status_code == 200 and summary.data["duration_minutes"] == 180
    assert summary.data["resolved_ticket_count"] == 0
    assert {group["kind"]: group["duration_minutes"] for group in summary.data["groups"]} == {
        "phone": 120,
        "support": 60,
    }
    for group in summary.data["groups"]:
        assert group["drilldown"].startswith("/support-activities?")
    assert client.get(url, {"kind": "phone"}).data["total"] == 1
    assert client.get(url, {"ticket_type": "invalid"}).status_code == 400
    assert client.get(url, {"result": "invalid"}).status_code == 400


def test_activity_list_does_not_expose_another_users_customer(setup):
    workspace, actor, client, customer, url = setup
    assert client.post(url, payload(customer), format="json").status_code == 201
    other = User.objects.create_user(email="other-support@example.test", username="other-support", password="SafePassword!2026")
    WorkspaceMember.objects.create(workspace=workspace, member=other, role=15)
    other_client = APIClient()
    other_client.force_authenticate(user=other)
    response = other_client.get(url)
    assert response.status_code == 200 and response.data["results"] == []
    assert actor.id != other.id
