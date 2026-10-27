"""Core dashboard access, persistence, widget isolation and team providers."""

import pytest
from django.test import override_settings

from plane.db.models import DashboardConfiguration, OrganizationUnit, OrganizationUnitMember, User, WorkspaceMember
from plane.app.services.dashboard_team import team_cards
from plane.app.services.entity_identifiers import format_record_number
from plane.tests.contract.app.test_entity_engine import engine, make_entity, create_record

pytestmark = [pytest.mark.django_db, pytest.mark.contract]


def dashboard_path(workspace, suffix=""):
    return f"/api/workspaces/{workspace.slug}/dashboard/{suffix}"


def test_new_work_identifier_uses_tt_prefix_without_separator(engine):
    workspace, _, _ = engine
    from plane.db.models import EntityType

    entity = EntityType.objects.get(workspace=workspace, code="ticket", parent__isnull=True)
    assert format_record_number(entity, 4569) == "TT4569"
    entity.numbering = {"prefix": "TT", "padding": 6}
    assert format_record_number(entity, 1921) == "TT001921"


def test_personal_dashboard_and_widget_query_share_entity_layer(engine):
    workspace, _, client = engine
    entity, _ = make_entity(engine)
    create_record(engine, entity, {"title": "اول"})
    opened = client.get(dashboard_path(workspace))
    assert opened.status_code == 200, opened.data
    tab = opened.data["tabs"][0]
    tab["widgets"] = [{"id": "counter-1", "type": "counter", "title": "شمار", "x": 0, "y": 0, "w": 6, "h": 3, "config": {"entity": "sample"}}]
    saved = client.put(dashboard_path(workspace), {"tabs": [tab], "revision": opened.data["revision"]}, format="json")
    assert saved.status_code == 200, saved.data
    assert client.get(dashboard_path(workspace)).data["tabs"][0]["widgets"][0]["id"] == "counter-1"
    count = client.post(dashboard_path(workspace, "widgets/data/"), {"widget": tab["widgets"][0]}, format="json")
    assert count.status_code == 200, count.data
    assert count.data["value"] == 1
    filtered = client.post(dashboard_path(workspace, "widgets/data/"), {"widget": {"type": "counter", "config": {"entity": "sample", "filter": {"field": "title", "op": "contains", "value": "اول"}}}}, format="json")
    assert filtered.status_code == 200, filtered.data
    assert filtered.data["value"] == 1
    invalid = client.post(dashboard_path(workspace, "widgets/data/"), {"widget": {"type": "counter", "config": {"entity": "missing"}}}, format="json")
    assert invalid.status_code == 400
    assert client.post(dashboard_path(workspace, "widgets/data/"), {"widget": tab["widgets"][0]}, format="json").data["value"] == 1


def test_calendar_widget_uses_jalali_month_boundaries(engine):
    workspace, _, client = engine
    entity, _ = make_entity(engine, [{"code": "due_on", "title": "موعد", "kind": "date", "config": {}}])
    for day in ("2024-03-19", "2024-03-20", "2024-04-19", "2024-04-20"):
        create_record(engine, entity, {"title": day, "due_on": day})
    widget = {
        "type": "calendar",
        "config": {
            "entity": "sample", "date_field": "due_on", "calendar_view": "month",
            "calendar_range": {"start": "2024-03-20", "end": "2024-04-20"},
        },
    }
    response = client.post(dashboard_path(workspace, "widgets/data/"), {"widget": widget}, format="json")
    assert response.status_code == 200, response.data
    assert [item["date"] for item in response.data["items"]] == ["2024-03-20", "2024-04-19"]
    assert [item["title"] for item in response.data["items"]] == ["2024-03-20", "2024-04-19"]
    widget["config"]["calendar_range"]["end"] = "2024-04-21"
    invalid = client.post(dashboard_path(workspace, "widgets/data/"), {"widget": widget}, format="json")
    assert invalid.status_code == 400


def test_my_work_widget_uses_assignee_and_open_state(engine):
    workspace, user, client = engine
    tasks_url = dashboard_path(workspace).replace("dashboard/", "tasks/")
    owned = client.post(tasks_url, {"name": "کار مسئول", "assignee_id": str(user.id), "status": "review"}, format="json")
    assert owned.status_code == 201, owned.data
    closed = client.post(tasks_url, {"name": "کار بسته", "assignee_id": str(user.id), "status": "done"}, format="json")
    assert closed.status_code == 201, closed.data
    widget = {"type": "my-work", "config": {"entity": "ticket", "rows": 8}}
    response = client.post(dashboard_path(workspace, "widgets/data/"), {"widget": widget}, format="json")
    assert response.status_code == 200, response.data
    assert [row["title"] for row in response.data["results"]] == ["کار مسئول"]
    approvals = client.post(dashboard_path(workspace, "widgets/data/"), {"widget": {"type": "approvals", "config": {"entity": "ticket"}}}, format="json")
    assert approvals.status_code == 200, approvals.data
    assert [row["title"] for row in approvals.data["results"]] == ["کار مسئول"]


def test_locked_role_widget_cannot_be_removed(engine):
    workspace, user, client = engine
    from plane.app.services.dashboard_layout import selected_role

    role = selected_role(workspace, user)
    assert role is not None
    tab = {"id": "role-home", "title": "پیش‌فرض", "widgets": [{"id": "locked-1", "type": "note", "locked": True, "x": 0, "y": 0, "w": 6, "h": 2, "config": {"text": "مهم"}}]}
    response = client.put(dashboard_path(workspace, f"defaults/{role.id}/"), {"tabs": [tab], "revision": 0}, format="json")
    assert response.status_code == 200, response.data
    gallery = client.get(dashboard_path(workspace, f"defaults/{role.id}/"))
    assert gallery.status_code == 200
    assert len(gallery.data["gallery"]) == 15
    personal = client.get(dashboard_path(workspace)).data
    assert next(item for item in personal["tabs"] if item["id"] == "role-home")["widgets"][0]["locked"]
    forbidden = client.put(dashboard_path(workspace), {"tabs": [{"id": "role-home", "title": "پیش‌فرض", "widgets": []}], "revision": personal["revision"]}, format="json")
    assert forbidden.status_code == 400


def test_team_endpoint_requires_permission_in_backend(engine):
    from rest_framework.test import APIClient

    workspace, _, _ = engine
    other = User.objects.create(username="dashboard-no-team", email="dashboard-no-team@example.test")
    WorkspaceMember.objects.create(workspace=workspace, member=other, role=5)
    client = APIClient()
    client.force_authenticate(user=other)
    response = client.get(dashboard_path(workspace, "team/"))
    assert response.status_code == 403, response.data
    personal = client.get(dashboard_path(workspace))
    assert personal.status_code == 200, personal.data
    assert personal.data["can_team"] is False


class FakePresence:
    def status(self, workspace, user_ids, now):
        return {user_id: {"present": False, "label": "آزمایشی", "reason": "آزمایش", "return_at": now.isoformat()} for user_id in user_ids}


@override_settings(DASHBOARD_PRESENCE_PROVIDER="plane.tests.contract.app.test_ticket_seven.FakePresence")
def test_team_presence_provider_can_be_replaced_without_card_changes(engine):
    workspace, manager, client = engine
    other = User.objects.create(username="dashboard-team", email="dashboard-team@example.test", first_name="Team", last_name="Member")
    WorkspaceMember.objects.create(workspace=workspace, member=other, role=5)
    unit = OrganizationUnit.objects.create(workspace=workspace, title="تیم آزمایش", manager=manager)
    OrganizationUnitMember.objects.create(unit=unit, user=other)
    response = client.get(dashboard_path(workspace, "team/"))
    assert response.status_code == 200, response.data
    assert response.data["cards"][0]["presence"] == "absent"
    assert response.data["cards"][0]["color"] == "gray"


def test_team_started_review_red_transition_and_absence(engine):
    from datetime import timedelta
    from django.utils import timezone
    from plane.db.models import UserAbsence

    workspace, manager, client = engine
    active = User.objects.create(username="dashboard-active", email="dashboard-active@example.test", first_name="Active")
    absent = User.objects.create(username="dashboard-absent", email="dashboard-absent@example.test", first_name="Absent")
    for user in (active, absent):
        WorkspaceMember.objects.create(workspace=workspace, member=user, role=5)
    unit = OrganizationUnit.objects.create(workspace=workspace, title="تیم رنگ", manager=manager)
    for user in (active, absent):
        OrganizationUnitMember.objects.create(unit=unit, user=user)
    work = client.post(dashboard_path(workspace).replace("dashboard/", "tasks/"), {"name": "بررسی", "assignee_id": str(active.id), "status": "review"}, format="json")
    assert work.status_code == 201, work.data
    UserAbsence.objects.create(workspace=workspace, user=absent, starts_at=timezone.now()-timedelta(hours=1), ends_at=timezone.now()+timedelta(days=1), reason="مرخصی")
    cards = client.get(dashboard_path(workspace, "team/"))
    assert cards.status_code == 200, cards.data
    by_id = {card["id"]: card for card in cards.data["cards"]}
    assert by_id[str(active.id)]["color"] == "green"
    assert by_id[str(absent.id)]["color"] == "gray"
    assert by_id[str(absent.id)]["reason"] == "مرخصی"
    from plane.db.models import Issue
    issue = Issue.objects.get(id=work.data["id"])
    issue.status = "done"
    issue.save(update_fields=["status"])
    refreshed = client.get(dashboard_path(workspace, "team/"))
    assert next(card for card in refreshed.data["cards"] if card["id"] == str(active.id))["color"] == "red"


def test_idle_alert_uses_eight_to_sixteen_tehran_and_can_be_disabled(engine):
    from datetime import datetime
    from unittest.mock import patch
    from zoneinfo import ZoneInfo
    from plane.app.views.workspace.dashboard import _issue_idle_alerts
    from plane.app.services.dashboard_team import settings_for
    from plane.db.models import Notification

    workspace, manager, _ = engine
    subordinate = User.objects.create(username="dashboard-idle", email="dashboard-idle@example.test")
    result = {"cards": [{"id": str(subordinate.id), "name": "عضو", "presence": "present", "in_progress_count": 0, "last_activity": None}]}
    zone = ZoneInfo("Asia/Tehran")
    with patch("plane.app.views.workspace.dashboard.timezone.now", return_value=datetime(2026, 10, 26, 7, 59, tzinfo=zone)):
        _issue_idle_alerts(workspace, manager, result)
    assert not Notification.objects.filter(workspace=workspace, entity_name="team_idle").exists()
    with patch("plane.app.views.workspace.dashboard.timezone.now", return_value=datetime(2026, 10, 26, 8, 31, tzinfo=zone)):
        _issue_idle_alerts(workspace, manager, result)
    assert Notification.objects.filter(workspace=workspace, entity_name="team_idle").count() == 1
    settings = settings_for(workspace, manager)
    settings.alert_enabled = False
    settings.save(update_fields=["alert_enabled"])
    with patch("plane.app.views.workspace.dashboard.timezone.now", return_value=datetime(2026, 10, 26, 9, 31, tzinfo=zone)):
        _issue_idle_alerts(workspace, manager, result)
    assert Notification.objects.filter(workspace=workspace, entity_name="team_idle").count() == 1
