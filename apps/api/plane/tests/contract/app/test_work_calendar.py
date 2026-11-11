"""Work calendar: schedules, exceptions, events, presence and confirmations (ticket 3)."""

import json
from datetime import date, datetime, timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest
from rest_framework.test import APIClient

from plane.app.services.permission_registry import sync_permission_catalog
from plane.app.services.work_calendar import (
    add_working_time,
    availability,
    schedule_for,
    working_minutes_between,
)
from plane.db.models import (
    ActivityConfirmation,
    EntityEvent,
    Notification,
    OrganizationPermission,
    OrganizationRole,
    OrganizationUnit,
    OrganizationUnitMember,
    PresenceDeclaration,
    RolePermission,
    User,
    UserAbsence,
    UserOrganizationRole,
    WorkSchedule,
    Workspace,
    WorkspaceMember,
)

pytestmark = [pytest.mark.django_db, pytest.mark.contract]

TEHRAN = ZoneInfo("Asia/Tehran")
MEMBER = ["WorkSchedule.ViewOwn", "WorkEvent.Create"]
# Python weekday numbers.
MON, TUE, WED, THU, FRI, SAT, SUN = range(7)


def tehran(*args):
    return datetime(*args, tzinfo=TEHRAN)


def week(**overrides):
    days = []
    for weekday in range(7):
        day = {"weekday": weekday, "is_working": weekday != FRI, "start": "08:00", "end": "16:00", "breaks": []}
        day.update(overrides.get(str(weekday), {}))
        days.append(day)
    return days


def person(workspace, name, codes=MEMBER):
    user = User.objects.create_user(email=f"{name}@example.test", username=name, password="SafePassword!2026")
    user.display_name = name
    user.save(update_fields=["display_name"])
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
    role = OrganizationRole.objects.create(workspace=workspace, name=f"role-{name}")
    for permission in OrganizationPermission.objects.filter(workspace=workspace, code__in=codes):
        RolePermission.objects.create(role=role, permission=permission)
    UserOrganizationRole.objects.create(workspace=workspace, user=user, role=role)
    return user


def own_role(user):
    return OrganizationRole.objects.get(name=f"role-{user.username}")


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def org(workspace, create_user):
    """employee ∈ team (manager) ⊂ department (upper); colleague is a peer of employee."""
    sync_permission_catalog(workspace)
    upper = person(workspace, "upper", MEMBER + ["WorkSchedule.ViewHierarchy"])
    blind_upper = person(workspace, "blind-upper", MEMBER)
    manager = person(
        workspace,
        "manager",
        MEMBER + ["WorkSchedule.ViewTeam", "WorkSchedule.EditTeam", "WorkEvent.Manage"],
    )
    employee = person(workspace, "employee")
    colleague = person(workspace, "colleague")
    root = OrganizationUnit.objects.create(workspace=workspace, title="ستاد", manager=blind_upper)
    department = OrganizationUnit.objects.create(workspace=workspace, title="معاونت", manager=upper, parent=root)
    team = OrganizationUnit.objects.create(workspace=workspace, title="تیم", manager=manager, parent=department)
    for user in (employee, colleague):
        OrganizationUnitMember.objects.create(unit=team, user=user)
    return {
        "workspace": workspace,
        "admin": create_user,
        "upper": upper,
        "blind_upper": blind_upper,
        "manager": manager,
        "employee": employee,
        "colleague": colleague,
        "team": team,
        "department": department,
    }


def url(workspace, suffix=""):
    return f"/api/workspaces/{workspace.slug}/work-calendar/{suffix}"


def post_version(actor, target, effective_from, days=None, reason="تنظیم برنامه", workspace=None, **extra):
    workspace = workspace or Workspace.objects.get(slug="test-workspace")
    body = {"user": str(target.id), "effective_from": effective_from, "reason": reason, "days": days or week(), **extra}
    return client_for(actor).post(url(workspace, "schedules/"), body, format="json")


# ------------------------------------------------------------------ precedence and versions


def test_precedence_exception_over_person_over_team_over_company(org):
    workspace, admin, manager, employee = org["workspace"], org["admin"], org["manager"], org["employee"]
    day = date(2027, 1, 4)  # Monday
    assert schedule_for(employee, day, workspace).builtin is True

    company = client_for(admin).post(
        url(workspace, "defaults/"),
        {
            "scope": "company",
            "effective_from": "2027-01-01",
            "reason": "پیش‌فرض شرکت",
            "days": week(**{str(MON): {"start": "07:00"}}),
        },
        format="json",
    )
    assert company.status_code == 201, company.data
    assert (schedule_for(employee, day, workspace).source, schedule_for(employee, day, workspace).start.hour) == (
        "company",
        7,
    )

    unit = client_for(admin).post(
        url(workspace, "defaults/"),
        {
            "scope": "unit",
            "unit": str(org["department"].id),
            "effective_from": "2027-01-01",
            "reason": "برنامه معاونت",
            "days": week(**{str(MON): {"start": "09:00"}}),
        },
        format="json",
    )
    assert unit.status_code == 201, unit.data
    resolved = schedule_for(employee, day, workspace)
    assert (resolved.source, resolved.start.hour) == ("team", 9)

    assert post_version(manager, employee, "2027-01-01", week(**{str(MON): {"start": "10:00"}})).status_code == 201
    resolved = schedule_for(employee, day, workspace)
    assert (resolved.source, resolved.start.hour) == ("person", 10)

    exception = client_for(manager).post(
        url(workspace, "exceptions/"),
        {
            "user": str(employee.id),
            "date_from": "2027-01-04",
            "start": "12:00",
            "end": "18:00",
            "reason": "جلسه بیرونی",
        },
        format="json",
    )
    assert exception.status_code == 201, exception.data
    resolved = schedule_for(employee, day, workspace)
    assert (resolved.source, resolved.start.hour, resolved.end.hour) == ("exception", 12, 18)
    # The weekly schedule itself is unchanged on other dates.
    assert schedule_for(employee, day + timedelta(days=7), workspace).start.hour == 10


def test_thursday_off_and_sunday_from_ten_apply_from_effective_date_and_keep_old_version(org):
    workspace, manager, employee = org["workspace"], org["manager"], org["employee"]
    first = post_version(manager, employee, "2027-01-02")
    assert first.status_code == 201, first.data
    second = post_version(
        manager,
        employee,
        "2027-02-06",
        week(**{str(THU): {"is_working": False}, str(SUN): {"start": "10:00"}}),
        reason="درخواست کارمند",
    )
    assert second.status_code == 201, second.data

    before_thu, after_thu = date(2027, 1, 7), date(2027, 2, 11)
    before_sun, after_sun = date(2027, 1, 3), date(2027, 2, 7)
    assert before_thu.weekday() == THU and after_sun.weekday() == SUN
    assert schedule_for(employee, before_thu, workspace).working is True
    assert schedule_for(employee, after_thu, workspace).working is False
    assert schedule_for(employee, before_sun, workspace).start.hour == 8
    assert schedule_for(employee, after_sun, workspace).start.hour == 10

    old = WorkSchedule.objects.get(id=first.data["id"])
    assert old.effective_to == date(2027, 2, 5)
    assert old.days.get(weekday=THU).is_working is True
    assert WorkSchedule.objects.filter(user=employee).count() == 2

    events = EntityEvent.objects.filter(workspace=workspace, event_type__startswith="work_schedule").order_by(
        "created_at"
    )
    assert [event.event_type for event in events] == [
        "work_schedule.created",
        "work_schedule.closed",
        "work_schedule.created",
    ]
    last = events.last()
    assert last.created_by_id == manager.id
    assert last.metadata["reason"] == "درخواست کارمند"
    assert last.before["id"] == first.data["id"] and last.after["id"] == second.data["id"]


def test_overlapping_versions_rejected_in_persian(org):
    manager, employee = org["manager"], org["employee"]
    assert post_version(manager, employee, "2027-03-01", effective_to="2027-03-31").status_code == 201
    same_start = post_version(manager, employee, "2027-03-01")
    assert same_start.status_code == 400
    assert "تداخل" in json.dumps(same_start.data, ensure_ascii=False)
    inside_bounded = post_version(manager, employee, "2027-03-15")
    assert inside_bounded.status_code == 400
    assert "تداخل" in json.dumps(inside_bounded.data, ensure_ascii=False)
    earlier_reaching = post_version(manager, employee, "2027-02-01", effective_to="2027-03-05")
    assert earlier_reaching.status_code == 400
    assert post_version(manager, employee, "2027-04-01").status_code == 201


def test_past_change_requires_edit_past(org):
    workspace, manager, employee = org["workspace"], org["manager"], org["employee"]
    past = (date.today() - timedelta(days=10)).isoformat()
    denied = post_version(manager, employee, past)
    assert denied.status_code == 403
    assert "تاریخ گذشته" in json.dumps(denied.data, ensure_ascii=False)
    role = own_role(manager)
    RolePermission.objects.create(
        role=role, permission=OrganizationPermission.objects.get(workspace=workspace, code="WorkSchedule.EditPast")
    )
    assert post_version(manager, employee, past).status_code == 201


@pytest.mark.parametrize(
    "override, message",
    [
        ({"start": "16:00", "end": "08:00"}, "ساعت پایان باید بعد از ساعت شروع باشد"),
        ({"breaks": [{"start": "07:00", "end": "07:30"}]}, "استراحت باید داخل بازهٔ کاری باشد"),
        ({"breaks": [{"start": "12:00", "end": "13:00"}, {"start": "12:30", "end": "13:30"}]}, "هم‌پوشانی"),
    ],
)
def test_invalid_hours_rejected_with_persian_messages(org, override, message):
    response = post_version(org["manager"], org["employee"], "2027-05-01", week(**{str(MON): override}))
    assert response.status_code == 400
    assert message in json.dumps(response.data, ensure_ascii=False)


def test_missing_effective_from_and_reason_rejected(org):
    response = post_version(org["manager"], org["employee"], "", reason="")
    assert response.status_code == 400
    assert "تاریخ شروع اعتبار" in json.dumps(response.data, ensure_ascii=False)
    response = post_version(org["manager"], org["employee"], "2027-05-01", reason="")
    assert response.status_code == 400
    assert "دلیل" in json.dumps(response.data, ensure_ascii=False)


# ------------------------------------------------------------------ working-time arithmetic


def test_working_minutes_and_add_working_time_skip_breaks_non_working_days_and_cross_midnight(org):
    workspace, manager, employee = org["workspace"], org["manager"], org["employee"]
    days = week(**{str(w): {"breaks": [{"start": "12:00", "end": "13:00"}]} for w in range(7)})
    assert post_version(manager, employee, "2027-01-01", days).status_code == 201

    # 11:00–14:00 minus a one-hour break.
    assert working_minutes_between(employee, tehran(2027, 1, 7, 11), tehran(2027, 1, 7, 14), workspace) == 120
    # Across midnight: Wednesday 22:00 → Thursday 09:00 counts only Thursday 08–09.
    assert working_minutes_between(employee, tehran(2027, 1, 6, 22), tehran(2027, 1, 7, 9), workspace) == 60
    # Friday is not a working day.
    assert working_minutes_between(employee, tehran(2027, 1, 8, 0), tehran(2027, 1, 9, 0), workspace) == 0
    # UTC input is interpreted in Tehran time: 04:30Z == 08:00 Tehran.
    utc_start = datetime(2027, 1, 7, 4, 30, tzinfo=ZoneInfo("UTC"))
    assert working_minutes_between(employee, utc_start, utc_start + timedelta(hours=1), workspace) == 60

    # Thursday 15:00 + 120 min: 60 min Thursday, skip Friday, 60 min Saturday.
    assert add_working_time(employee, tehran(2027, 1, 7, 15), 120, workspace) == tehran(2027, 1, 9, 9)
    # Starting inside a break resumes after it.
    assert add_working_time(employee, tehran(2027, 1, 9, 12, 15), 30, workspace) == tehran(2027, 1, 9, 13, 30)
    # Starting at night lands on the next morning.
    assert add_working_time(employee, tehran(2027, 1, 9, 23), 15, workspace) == tehran(2027, 1, 10, 8, 15)


# ------------------------------------------------------------------ access matrix


def test_schedule_access_matrix(org, workspace):
    manager, employee, colleague = org["manager"], org["employee"], org["colleague"]
    upper, blind_upper = org["upper"], org["blind_upper"]
    assert post_version(manager, employee, "2027-01-01").status_code == 201
    versions = url(workspace, f"schedules/?user={employee.id}")

    assert client_for(employee).get(versions).status_code == 200
    assert post_version(employee, employee, "2027-06-01").status_code == 403  # no EditOwn
    assert client_for(manager).get(versions).status_code == 200
    assert client_for(upper).get(versions).status_code == 200
    assert post_version(upper, employee, "2027-06-01").status_code == 403  # hierarchy: view only
    assert client_for(blind_upper).get(versions).status_code == 403  # no ViewHierarchy
    assert client_for(colleague).get(versions).status_code == 403
    assert post_version(colleague, employee, "2027-06-01").status_code == 403

    other_owner = User.objects.create_user(
        email="outsider@example.test", username="outsider", password="SafePassword!2026"
    )
    other = Workspace.objects.create(name="Other", slug="other-ws", owner=other_owner)
    WorkspaceMember.objects.create(workspace=other, member=other_owner, role=20)
    assert client_for(other_owner).get(versions).status_code == 403
    assert client_for(other_owner).get(url(workspace, f"?user={employee.id}")).status_code == 403

    role = own_role(employee)
    RolePermission.objects.create(
        role=role, permission=OrganizationPermission.objects.get(workspace=workspace, code="WorkSchedule.EditOwn")
    )
    assert post_version(employee, employee, "2027-06-01").status_code == 201


def test_calendar_view_for_colleague_is_restricted(org, workspace):
    manager, employee, colleague = org["manager"], org["employee"], org["colleague"]
    full = client_for(manager).get(url(workspace, f"?user={employee.id}&start=2027-01-01&end=2027-01-31"))
    assert full.status_code == 200 and full.data["restricted"] is False and len(full.data["days"]) == 31
    limited = client_for(colleague).get(url(workspace, f"?user={employee.id}&start=2027-01-01&end=2027-01-31"))
    assert limited.status_code == 200 and limited.data["restricted"] is True
    assert "days" not in limited.data and "absences" not in limited.data
    assert all(row["reason"] is None for row in limited.data["availability"])


# ------------------------------------------------------------------ events


def create_meeting(actor, participants, start, end, **extra):
    workspace = Workspace.objects.get(slug="test-workspace")
    body = {
        "kind": "meeting",
        "title": "جلسهٔ محرمانهٔ بودجه",
        "description": "بررسی حقوق",
        "private_note": "یادداشت خصوصی",
        "starts_at": start.isoformat(),
        "ends_at": end.isoformat(),
        "participant_ids": [str(user.id) for user in participants],
        **extra,
    }
    return client_for(actor).post(url(workspace, "events/"), body, format="json")


def test_event_privacy_colleague_gets_busy_block_without_title(org, workspace):
    manager, employee, colleague = org["manager"], org["employee"], org["colleague"]
    created = create_meeting(manager, [employee], tehran(2027, 1, 4, 10), tehran(2027, 1, 4, 11))
    assert created.status_code == 201, created.data
    query = url(workspace, f"?user={employee.id}&start=2027-01-04&end=2027-01-04")

    seen_by_colleague = client_for(colleague).get(query)
    raw = json.dumps(seen_by_colleague.data, ensure_ascii=False)
    for secret in ("جلسهٔ محرمانهٔ بودجه", "بررسی حقوق", "یادداشت خصوصی"):
        assert secret not in raw
    event = seen_by_colleague.data["events"][0]
    assert event["restricted"] is True and event["label"] == "در دسترس نیست"
    busy = [row for row in seen_by_colleague.data["availability"] if row["start"] == tehran(2027, 1, 4, 10).isoformat()]
    assert busy and busy[0]["available"] is False and busy[0]["label"] == "در دسترس نیست"
    detail = client_for(colleague).get(url(workspace, f"events/{created.data['event']['id']}/"))
    assert "title" not in detail.data

    for viewer in (employee, manager, org["upper"]):
        data = client_for(viewer).get(query).data
        assert data["events"][0]["title"] == "جلسهٔ محرمانهٔ بودجه"
        assert data["events"][0]["private_note"] == "یادداشت خصوصی"
    # An event is unavailability, never an absence.
    segments = availability(employee, tehran(2027, 1, 4, 9), tehran(2027, 1, 4, 12), workspace)
    assert [row["reason"] for row in segments] == ["schedule", "event", "schedule"]
    assert not UserAbsence.objects.filter(user=employee).exists()


def test_event_overlap_and_outside_hours_warn_but_succeed(org):
    manager, employee = org["manager"], org["employee"]
    assert create_meeting(manager, [employee], tehran(2027, 1, 4, 10), tehran(2027, 1, 4, 11)).status_code == 201
    overlap = create_meeting(manager, [employee], tehran(2027, 1, 4, 10, 30), tehran(2027, 1, 4, 11, 30))
    assert overlap.status_code == 201
    assert [w["code"] for w in overlap.data["warnings"]] == ["overlap"]
    late = create_meeting(manager, [employee], tehran(2027, 1, 4, 18), tehran(2027, 1, 4, 19))
    assert late.status_code == 201
    assert [w["code"] for w in late.data["warnings"]] == ["outside_hours"]
    calendar = client_for(employee).get(
        url(Workspace.objects.get(slug="test-workspace"), "?start=2027-01-04&end=2027-01-04")
    )
    flags = {row["starts_at"]: row["outside_working_hours"] for row in calendar.data["events"]}
    assert flags[tehran(2027, 1, 4, 18).isoformat()] is True
    assert flags[tehran(2027, 1, 4, 10).isoformat()] is False


def test_event_participants_must_be_schedulable(org):
    colleague, employee, manager = org["colleague"], org["employee"], org["manager"]
    denied = create_meeting(colleague, [colleague, employee], tehran(2027, 1, 4, 10), tehran(2027, 1, 4, 11))
    assert denied.status_code == 403
    assert "اجازهٔ زمان‌بندی" in json.dumps(denied.data, ensure_ascii=False)
    assert create_meeting(colleague, [colleague], tehran(2027, 1, 4, 10), tehran(2027, 1, 4, 11)).status_code == 201
    assert create_meeting(employee, [manager], tehran(2027, 1, 4, 10), tehran(2027, 1, 4, 11)).status_code == 403


def test_event_cancel_and_update_are_audited(org, workspace):
    manager, employee, colleague = org["manager"], org["employee"], org["colleague"]
    event_id = create_meeting(manager, [employee], tehran(2027, 1, 4, 10), tehran(2027, 1, 4, 11)).data["event"]["id"]
    assert (
        client_for(colleague)
        .post(url(workspace, f"events/{event_id}/cancel/"), {"reason": "x"}, format="json")
        .status_code
        == 403
    )
    no_reason = client_for(manager).patch(url(workspace, f"events/{event_id}/"), {"title": "جدید"}, format="json")
    assert no_reason.status_code == 400
    updated = client_for(manager).patch(
        url(workspace, f"events/{event_id}/"), {"title": "جدید", "reason": "تغییر موضوع"}, format="json"
    )
    assert updated.status_code == 200, updated.data
    cancelled = client_for(manager).post(
        url(workspace, f"events/{event_id}/cancel/"), {"reason": "لغو جلسه"}, format="json"
    )
    assert cancelled.status_code == 200 and cancelled.data["status"] == "cancelled"
    audit = list(
        EntityEvent.objects.filter(workspace=workspace, event_type__startswith="work_event").order_by("created_at")
    )
    assert [row.event_type for row in audit] == ["work_event.created", "work_event.updated", "work_event.cancelled"]
    assert audit[1].before["title"] == "جلسهٔ محرمانهٔ بودجه" and audit[1].after["title"] == "جدید"
    assert audit[2].metadata["reason"] == "لغو جلسه" and audit[2].created_by_id == manager.id


# ------------------------------------------------------------------ presence and confirmations


def test_presence_only_on_non_working_day_once_with_cancel_history(org, workspace):
    employee = org["employee"]
    with patch("django.utils.timezone.now", return_value=tehran(2027, 1, 7, 10)):  # Thursday, working by default
        working = client_for(employee).post(url(workspace, "presence/"), {}, format="json")
        assert working.status_code == 400 and "روز کاری" in json.dumps(working.data, ensure_ascii=False)
        calendar = client_for(employee).get(url(workspace, "?start=2027-01-07&end=2027-01-07"))
        assert calendar.data["presence_today"]["can_declare"] is False
    with patch("django.utils.timezone.now", return_value=tehran(2027, 1, 8, 10)):  # Friday
        assert (
            client_for(employee)
            .get(url(workspace, "?start=2027-01-08&end=2027-01-08"))
            .data["presence_today"]["can_declare"]
            is True
        )
        first = client_for(employee).post(url(workspace, "presence/"), {}, format="json")
        assert first.status_code == 201, first.data
        assert first.data["label"] == "اعلام‌شده توسط خود فرد"
        assert first.data["time_zone"] == "Asia/Tehran"
        assert client_for(employee).post(url(workspace, "presence/"), {}, format="json").status_code == 400
        assert (
            client_for(org["manager"])
            .post(url(workspace, f"presence/{first.data['id']}/cancel/"), {}, format="json")
            .status_code
            == 403
        )
        cancelled = client_for(employee).post(
            url(workspace, f"presence/{first.data['id']}/cancel/"), {"reason": "اشتباه"}, format="json"
        )
        assert cancelled.status_code == 200 and cancelled.data["status"] == "cancelled"
        assert client_for(employee).post(url(workspace, "presence/"), {}, format="json").status_code == 201
    assert PresenceDeclaration.objects.filter(user=employee).count() == 2
    types = list(
        EntityEvent.objects.filter(workspace=workspace, event_type__startswith="presence").values_list(
            "event_type", flat=True
        )
    )
    assert sorted(types) == [
        "presence_declaration.cancelled",
        "presence_declaration.created",
        "presence_declaration.created",
    ]
    manager_view = client_for(org["manager"]).get(
        url(workspace, f"?user={employee.id}&start=2027-01-08&end=2027-01-08")
    )
    assert manager_view.data["presence"][0]["label"] == "اعلام‌شده توسط خود فرد"


def test_negative_no_inference_from_missing_declaration_or_schedule_change(org, workspace):
    manager, employee = org["manager"], org["employee"]
    UserAbsence.objects.create(
        workspace=workspace,
        user=employee,
        starts_at=tehran(2027, 3, 1, 8),
        ends_at=tehran(2027, 3, 2, 8),
        reason="مرخصی قبلی",
    )
    absences_before = list(UserAbsence.objects.values("id", "starts_at", "ends_at", "status", "reason"))
    notifications_before = Notification.objects.count()
    assert post_version(manager, employee, "2027-01-02", week(**{str(THU): {"is_working": False}})).status_code == 201
    with patch(
        "django.utils.timezone.now", return_value=tehran(2027, 1, 14, 18)
    ):  # Thursday, non-working, nobody declares
        client_for(employee).get(url(workspace, "?start=2027-01-01&end=2027-01-31"))
        client_for(manager).get(url(workspace, f"?user={employee.id}&start=2027-01-01&end=2027-01-31"))
        assert client_for(employee).get(url(workspace, "pending/")).data["items"] == []
    with patch("django.utils.timezone.now", return_value=tehran(2027, 1, 15, 9)):
        assert client_for(employee).get(url(workspace, "pending/")).data["items"] == []
    assert list(UserAbsence.objects.values("id", "starts_at", "ends_at", "status", "reason")) == absences_before
    assert Notification.objects.count() == notifications_before
    assert not PresenceDeclaration.objects.exists() and not ActivityConfirmation.objects.exists()


def test_past_event_needs_own_confirmation_and_manager_cannot_confirm(org, workspace):
    manager, employee = org["manager"], org["employee"]
    event_id = create_meeting(manager, [employee], tehran(2027, 1, 4, 10), tehran(2027, 1, 4, 11)).data["event"]["id"]
    with patch("django.utils.timezone.now", return_value=tehran(2027, 1, 4, 10, 30)):
        assert client_for(employee).get(url(workspace, "pending/")).data["items"] == []
    with patch("django.utils.timezone.now", return_value=tehran(2027, 1, 5, 9)):
        pending = client_for(employee).get(url(workspace, "pending/")).data["items"]
        assert [item["source_id"] for item in pending] == [event_id]
        assert not ActivityConfirmation.objects.exists()  # planned ≠ done
        body = {"source_type": "event", "source_id": event_id, "outcome": "done", "summary": "انجام شد"}
        denied = client_for(manager).post(url(workspace, "pending/"), body, format="json")
        assert denied.status_code == 403
        assert not ActivityConfirmation.objects.exists()
        assert client_for(employee).post(url(workspace, "pending/"), body, format="json").status_code == 201
        assert client_for(employee).post(url(workspace, "pending/"), body, format="json").status_code == 400
        assert client_for(employee).get(url(workspace, "pending/")).data["items"] == []
    row = ActivityConfirmation.objects.get()
    assert row.user_id == employee.id and row.outcome == "done"
    assert EntityEvent.objects.filter(event_type="activity_confirmation.created", created_by_id=employee.id).exists()


def test_presence_confirmation_only_by_declarant(org, workspace):
    employee, manager = org["employee"], org["manager"]
    with patch("django.utils.timezone.now", return_value=tehran(2027, 1, 8, 10)):
        declaration = client_for(employee).post(url(workspace, "presence/"), {}, format="json").data
    with patch("django.utils.timezone.now", return_value=tehran(2027, 1, 9, 10)):
        items = client_for(employee).get(url(workspace, "pending/")).data["items"]
        assert [item["source_type"] for item in items] == ["presence"]
        body = {"source_type": "presence", "source_id": declaration["id"], "outcome": "not_done"}
        assert client_for(manager).post(url(workspace, "pending/"), body, format="json").status_code == 403
        assert client_for(employee).post(url(workspace, "pending/"), body, format="json").status_code == 201


# ------------------------------------------------------------------ dashboard regression


def test_team_dashboard_output_unchanged_by_schedules(org, workspace):
    from plane.app.services.dashboard_team import team_cards
    from plane.app.services.entity_schema import initialize_engine

    initialize_engine(workspace)
    manager, employee = org["manager"], org["employee"]
    role = own_role(manager)
    RolePermission.objects.create(
        role=role, permission=OrganizationPermission.objects.get(workspace=workspace, code="Dashboard.Team.View")
    )
    fixed = tehran(2027, 1, 7, 10)
    with patch("django.utils.timezone.now", return_value=fixed):
        before = team_cards(workspace, manager)
    today = date.today().isoformat()
    own_role(manager).permissions.add(
        OrganizationPermission.objects.get(workspace=workspace, code="WorkSchedule.EditPast")
    )
    assert (
        post_version(manager, employee, today, week(**{str(w): {"is_working": False} for w in range(7)})).status_code
        == 201
    )
    create_meeting(manager, [employee], fixed - timedelta(hours=1), fixed + timedelta(hours=1))
    with patch("django.utils.timezone.now", return_value=fixed):
        after = team_cards(workspace, manager)
    assert after == before
    assert next(card for card in after["cards"] if card["id"] == str(employee.id))["presence"] == "present"


def test_people_list_marks_who_can_be_viewed_in_detail(org, workspace):
    people = {row["name"]: row for row in client_for(org["colleague"]).get(url(workspace, "people/")).data["people"]}
    assert people["colleague"]["can_view"] is True and people["colleague"]["relation"] == "self"
    assert people["employee"]["can_view"] is False and people["employee"]["can_schedule"] is False
    managed = {row["name"]: row for row in client_for(org["manager"]).get(url(workspace, "people/")).data["people"]}
    assert managed["employee"]["relation"] == "direct" and managed["employee"]["can_edit"] is True
    upper = {row["name"]: row for row in client_for(org["upper"]).get(url(workspace, "people/")).data["people"]}
    assert upper["employee"]["relation"] == "ancestor" and upper["employee"]["can_view"] is True
    assert upper["employee"]["can_edit"] is False
