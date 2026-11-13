"""Ticket 8 — daily work reports and saved reports (section 4, phase 4 of the ticket).

Sections follow the numbered test list of the ticket (1 … 12). Dates use a fixed Saturday
(2027-01-09) and a company calendar where every day is a working day 08:00–16:00, so the
"today" of each test is controlled with ``frozen(now)`` (``django.utils.timezone.now``).
"""

import csv
import importlib
import io
import json
from contextlib import contextmanager
from datetime import date, datetime, time, timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest
from django.db import IntegrityError, connection, migrations, transaction
from django.test.utils import CaptureQueriesContext
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from plane.app.services import daily_report_draft as draft
from plane.app.services import daily_report_reminders as reminders
from plane.app.services import daily_reports as reports
from plane.app.services import leave_requests as leave
from plane.app.services import report_export as exports
from plane.app.services import report_sources as sources
from plane.app.services import saved_reports as saved
from plane.app.services import ticket_core as core
from plane.app.services.entity_schema import initialize_engine
from plane.app.services.permission_registry import PERMISSION_REGISTRY, sync_permission_catalog
from plane.app.services.report_scope import people_scope
from plane.db.models import (
    ActivityConfirmation,
    DailyReport,
    DailyReportItem,
    EntityEvent,
    EntityRecord,
    EntityRelation,
    EntityRelationLink,
    EntityType,
    EntityViewExport,
    FieldDefinition,
    FileAsset,
    FormLayout,
    FormVersion,
    Issue,
    IssueAssignee,
    IssueComment,
    LeaveRequest,
    LeaveRequestVersion,
    Notification,
    OrganizationPermission,
    OrganizationRole,
    OrganizationUnit,
    OrganizationUnitDelegate,
    OrganizationUnitMember,
    PresenceDeclaration,
    Project,
    ProjectMember,
    RolePermission,
    SavedReport,
    User,
    UserAbsence,
    UserOrganizationRole,
    WorkEvent,
    WorkEventParticipant,
    WorkflowDecision,
    WorkflowDefinition,
    WorkflowDelayReport,
    WorkflowExtension,
    WorkflowInstance,
    WorkflowVersion,
    WorkSchedule,
    WorkScheduleDay,
    WorkScheduleException,
    WorkspaceMember,
)

pytestmark = [pytest.mark.django_db, pytest.mark.contract]

TEHRAN = ZoneInfo("Asia/Tehran")
D = date(2027, 1, 9)  # Saturday
MEMBER = ["DailyReport.Submit", "Report.View", "Issue.View", "Issue.Create", "Issue.Edit", "Issue.Status.Edit"]
MANAGER = MEMBER + [
    "Issue.ViewAll",
    "DailyReport.Team.View",
    "Report.Team.View",
    "Report.Build",
    "Report.Share",
    "Report.Export",
]


def at(day, hour, minute=0):
    return datetime.combine(day, time(hour, minute), tzinfo=TEHRAN)


NOW = at(D, 11)


@contextmanager
def frozen(now):
    with patch("django.utils.timezone.now", return_value=now):
        yield


def person(workspace, name, codes=MEMBER):
    user = User.objects.create_user(email=f"{name}@example.test", username=name, password="SafePassword!2026")
    user.display_name = f"کاربر {name}"
    user.save(update_fields=["display_name"])
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
    role = OrganizationRole.objects.create(workspace=workspace, name=f"role-{name}")
    for permission in OrganizationPermission.objects.filter(workspace=workspace, code__in=codes):
        RolePermission.objects.create(role=role, permission=permission)
    UserOrganizationRole.objects.create(workspace=workspace, user=user, role=role)
    return user


def grant(user, *codes):
    role = OrganizationRole.objects.get(name=f"role-{user.username}")
    for permission in OrganizationPermission.objects.filter(workspace=role.workspace, code__in=codes):
        RolePermission.objects.get_or_create(role=role, permission=permission)


def revoke(user, *codes):
    RolePermission.objects.filter(role__name=f"role-{user.username}", permission__code__in=codes).delete()


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture(autouse=True)
def private_storage(monkeypatch, tmp_path):
    from django.core.files.storage import FileSystemStorage

    monkeypatch.setattr(FileAsset._meta.get_field("asset"), "storage", FileSystemStorage(location=tmp_path))


@pytest.fixture
def org(workspace, create_user):
    """employee, colleague, onleave, hourly, holiday ∈ team (manager) ⊂ department (upper);
    outsider ∈ other team (other_manager)."""
    initialize_engine(workspace)
    sync_permission_catalog(workspace)
    leave.ensure_leave_entity(workspace)
    company = WorkSchedule.objects.create(
        workspace=workspace, scope="company", effective_from=date(2020, 1, 1), reason="آزمون: همه روزها کاری"
    )
    for weekday in range(7):
        WorkScheduleDay.objects.create(
            schedule=company, weekday=weekday, is_working=True, start_time=time(8), end_time=time(16)
        )
    people = {name: person(workspace, name) for name in ("employee", "colleague", "onleave", "hourly", "holiday", "outsider", "delegate")}
    people["manager"] = person(workspace, "manager", MANAGER)
    people["other_manager"] = person(workspace, "other_manager", MANAGER)
    people["upper"] = person(workspace, "upper", MANAGER)
    department = OrganizationUnit.objects.create(workspace=workspace, title="معاونت", manager=people["upper"])
    team = OrganizationUnit.objects.create(workspace=workspace, title="تیم الف", manager=people["manager"], parent=department)
    other = OrganizationUnit.objects.create(workspace=workspace, title="تیم ب", manager=people["other_manager"])
    for name in ("employee", "colleague", "onleave", "hourly", "holiday", "delegate"):
        OrganizationUnitMember.objects.create(unit=team, user=people[name])
    OrganizationUnitMember.objects.create(unit=other, user=people["outsider"])
    return {"workspace": workspace, "admin": create_user, "team": team, "other": other, "department": department, **people}


def ws(org):
    return org["workspace"]


def url(org, suffix):
    return f"/api/workspaces/{ws(org).slug}/{suffix}"


def leave_row(org, user, start, end=None, mode="daily", status="approved", hours=None):
    end = end or start
    row = LeaveRequest.objects.create(
        workspace=ws(org), requester=user, number=f"LRQ-{LeaveRequest.objects.count() + 1:05}", status=status
    )
    if mode == "daily":
        starts, ends = at(start, 0), at(end + timedelta(days=1), 0)
    else:
        starts, ends = at(start, hours[0]), at(start, hours[1])
    LeaveRequestVersion.objects.create(
        request=row,
        number=1,
        mode=mode,
        start_date=start,
        end_date=end,
        starts_at=starts,
        ends_at=ends,
        duration_days=(end - start).days + 1 if mode == "daily" else None,
        duration_minutes=None if mode == "daily" else (hours[1] - hours[0]) * 60,
    )
    return row


def ticket(org, assignee=None, creator=None, name="تیکت آزمون", **extra):
    issue = Issue(workspace=ws(org), name=name, **extra)
    issue.save(created_by_id=(creator or assignee or org["employee"]).id)
    if assignee:
        IssueAssignee.objects.create(issue=issue, assignee=assignee, workspace=ws(org), project=None)
    return issue


def item(kind="done", text="بررسی و پاسخ به درخواست", **extra):
    return {"kind": kind, "text": text, **extra}


def put_day(org, user, now=NOW, day=D, **body):
    with frozen(now):
        return client_for(user).put(url(org, f"daily-reports/day/{day.isoformat()}/"), body, format="json")


def get_day(org, who, day=D, now=NOW, **params):
    with frozen(now):
        return client_for(who).get(url(org, f"daily-reports/day/{day.isoformat()}/"), params)


def run(org, user, source, definition=None, now=NOW, **kwargs):
    return sources.run(ws(org), user, source, definition or {}, now=now, **kwargs)


def all_cells(result):
    return json.dumps(result, ensure_ascii=False)


# ---------------------------------------------------------------- 1. quick report, lifecycle, lock, revision


def test_quick_report_with_items_linked_to_ticket_and_project(org):
    issue = ticket(org, org["employee"], name="نصب سرور مشتری")
    project = Project.objects.create(workspace=ws(org), name="پروژهٔ مهاجرت", identifier="MIG")
    ProjectMember.objects.create(project=project, member=org["employee"], role=15, workspace=ws(org))
    body = {
        "submit": True,
        "items": [
            item("done", "نصب انجام شد", issue_id=str(issue.id)),
            item("in_progress", "مستندسازی", project_id=str(project.id)),
            item("blocker", "دسترسی به سرور ندارم", needs_help=True),
            item("next_step", "آزمون نهایی", effort_minutes=90),
        ],
    }
    response = put_day(org, org["employee"], **body)
    assert response.status_code == 200, response.data
    data = response.data
    assert data["report"]["status"] == "submitted" and data["report"]["revision"] == 1
    kinds = {row["kind"]: row for row in data["report"]["items"]}
    assert kinds["done"]["issue"]["title"] == "نصب سرور مشتری"
    assert kinds["in_progress"]["project"]["name"] == "پروژهٔ مهاجرت"
    assert kinds["blocker"]["needs_help"] is True
    assert kinds["next_step"]["effort_minutes"] == 90
    assert data["effort_label"] == "تخمین تلاش (نه ساعت کاری)"


def test_one_report_per_person_and_day(org):
    assert put_day(org, org["employee"], items=[item()]).status_code == 200
    # A second create without the revision is a conflict (two tabs), not a second row.
    response = put_day(org, org["employee"], items=[item()])
    assert response.status_code == 400 and "revision" in response.data
    assert DailyReport.objects.filter(user=org["employee"], work_date=D).count() == 1
    with pytest.raises(IntegrityError), transaction.atomic():
        DailyReport.objects.create(workspace=ws(org), user=org["employee"], work_date=D)


def test_ticket_link_must_be_visible_and_project_must_be_a_membership(org):
    hidden = ticket(org, org["outsider"], name="تیکت پنهان")
    project = Project.objects.create(workspace=ws(org), name="پروژهٔ دیگران", identifier="OTH")
    assert put_day(org, org["employee"], items=[item(issue_id=str(hidden.id))]).status_code == 400
    assert put_day(org, org["employee"], items=[item(project_id=str(project.id))]).status_code == 400


def test_draft_submit_revise_history_and_revision(org):
    first = put_day(org, org["employee"], items=[item("done", "کار الف")])
    assert first.data["report"]["status"] == "draft" and first.data["report"]["revision"] == 1
    second = put_day(org, org["employee"], revision=1, submit=True, items=[item("done", "کار الف"), item("next_step", "کار ب")])
    assert second.data["report"]["status"] == "submitted" and second.data["report"]["revision"] == 2
    third = put_day(org, org["employee"], at(D, 12), revision=2, items=[item("done", "کار الف (اصلاح)")])
    assert third.data["report"]["status"] == "submitted" and third.data["report"]["revision"] == 3
    with frozen(NOW):
        events = client_for(org["employee"]).get(url(org, f"daily-reports/day/{D.isoformat()}/history/")).data["events"]
    assert [e["type"] for e in events] == ["daily_report.created", "daily_report.submitted", "daily_report.revised"]
    assert events[2]["added"] == ["کار الف (اصلاح)"] and set(events[2]["removed"]) == {"کار الف", "کار ب"}
    assert [e["revision"] for e in events] == [1, 2, 3]


def test_report_is_locked_after_the_correction_period(org):
    put_day(org, org["employee"], submit=True, items=[item()])
    # Default window: until the end of the next working day (every day works in this calendar).
    assert put_day(org, org["employee"], at(D + timedelta(days=1), 23), revision=1, items=[item("done", "اصلاح")]).status_code == 200
    late = put_day(org, org["employee"], at(D + timedelta(days=2), 0, 1), revision=2, items=[item("done", "دیر")])
    assert late.status_code == 400 and "قفل" in str(late.data)
    view = get_day(org, org["employee"], now=at(D + timedelta(days=2), 9))
    assert view.data["locked"] is True and view.data["can"]["edit"] is False


def test_week_end_correction_window_is_configurable(org):
    reports.save_policy(ws(org), org["admin"], {"edit_window": {"mode": "week_end"}})
    put_day(org, org["employee"], submit=True, items=[item()])
    friday = D + timedelta(days=6)
    assert put_day(org, org["employee"], at(friday, 23), revision=1, items=[item("done", "اصلاح جمعه")]).status_code == 200
    assert put_day(org, org["employee"], at(friday + timedelta(days=1), 1), revision=2, items=[item()]).status_code == 400


def test_concurrent_edit_with_stale_revision_is_refused(org):
    put_day(org, org["employee"], items=[item()])
    assert put_day(org, org["employee"], revision=1, items=[item("done", "تب اول")]).status_code == 200
    stale = put_day(org, org["employee"], revision=1, items=[item("done", "تب دوم")])
    assert stale.status_code == 409


def test_late_flag_is_set_once_at_first_submission(org):
    reports.save_policy(ws(org), org["admin"], {"deadline_time": "10:00"})
    put_day(org, org["employee"], at(D, 9), items=[item()])
    submitted = put_day(org, org["employee"], at(D, 10, 30), revision=1, submit=True, items=[item()])
    assert submitted.data["report"]["is_late"] is True
    put_day(org, org["colleague"], at(D, 9, 30), submit=True, items=[item()])
    assert DailyReport.objects.get(user=org["colleague"]).is_late is False


def test_future_day_and_empty_submission_are_refused(org):
    assert put_day(org, org["employee"], day=D + timedelta(days=1), submit=True, items=[item()]).status_code == 400
    assert put_day(org, org["employee"], submit=True, items=[]).status_code == 400


# ---------------------------------------------------------------- 2. leave: live, read-only, no category


def test_approved_daily_leave_shows_without_category_and_is_not_required(org):
    leave_row(org, org["employee"], D)
    data = get_day(org, org["employee"]).data
    assert data["requirement"] == "not_required"
    [shown] = data["leaves"]
    assert shown["full_day"] is True and shown["mode"] == "daily" and shown["url"].startswith("/leave-requests/")
    raw = json.dumps(data["leaves"], ensure_ascii=False)
    assert "category" not in raw and "دسته" not in raw and "leave_type" not in raw


def test_pending_rejected_or_cancelled_leave_is_not_shown(org):
    for status in ("pending", "rejected", "cancelled", "draft", "returned"):
        leave_row(org, org["employee"], D, status=status)
    data = get_day(org, org["employee"]).data
    assert data["leaves"] == [] and data["requirement"] == "required"


def test_cancel_or_move_after_opening_is_reflected_without_any_sync(org):
    row = leave_row(org, org["employee"], D)
    assert len(get_day(org, org["employee"]).data["leaves"]) == 1
    LeaveRequest.objects.filter(id=row.id).update(status="cancelled")
    assert get_day(org, org["employee"]).data["leaves"] == []
    LeaveRequest.objects.filter(id=row.id).update(status="approved")
    moved = D + timedelta(days=2)
    LeaveRequestVersion.objects.create(
        request=row, number=2, mode="daily", start_date=moved, end_date=moved,
        starts_at=at(moved, 0), ends_at=at(moved + timedelta(days=1), 0), duration_days=1,
    )
    assert get_day(org, org["employee"]).data["leaves"] == []
    assert get_day(org, org["employee"], moved, now=at(moved, 11)).data["requirement"] == "not_required"


def test_hourly_leave_is_shown_and_the_report_is_still_required(org):
    leave_row(org, org["hourly"], D, mode="hourly", hours=(10, 12))
    data = get_day(org, org["hourly"]).data
    assert data["requirement"] == "required"
    assert data["leaves"][0]["mode"] == "hourly" and data["leaves"][0]["full_day"] is False
    statuses = {r["user"].username: r["status"] for r in reports.day_statuses(ws(org), [org["hourly"].id], D, D, NOW)}
    assert statuses == {"hourly": "missing"}


def test_leave_is_never_a_report_item_and_full_day_report_is_voluntary(org):
    leave_row(org, org["employee"], D)
    refused = put_day(org, org["employee"], submit=True, items=[item("done", "مرخصی", source_kind="leave", source_id="x")])
    assert refused.status_code == 400
    voluntary = put_day(org, org["employee"], submit=True, items=[item("done", "پاسخ فوری به یک ایمیل")])
    assert voluntary.status_code == 200
    assert not DailyReportItem.objects.filter(source_kind="leave").exists()
    assert {r["status"] for r in reports.day_statuses(ws(org), [org["employee"].id], D, D, NOW)} == {"submitted"}


# ---------------------------------------------------------------- 3. calendar


def event(org, user, start, end, kind="meeting", title="جلسهٔ هفتگی"):
    row = WorkEvent.objects.create(workspace=ws(org), kind=kind, title=title, starts_at=start, ends_at=end)
    WorkEventParticipant.objects.create(event=row, user=user)
    return row


def test_future_event_cannot_be_reported_done_but_past_event_can(org):
    future = event(org, org["employee"], at(D, 14), at(D, 15))
    past = event(org, org["employee"], at(D, 8), at(D, 9), title="جلسهٔ صبح")
    refused = put_day(org, org["employee"], items=[item("done", "جلسه", source_kind="event", source_id=str(future.id))])
    assert refused.status_code == 400 and "آینده" in str(refused.data)
    ok = put_day(org, org["employee"], items=[item("done", "جلسهٔ صبح", source_kind="event", source_id=str(past.id))])
    assert ok.status_code == 200
    day = ok.data
    assert {e["title"]: e["past"] for e in day["events"]} == {"جلسهٔ صبح": True, "جلسهٔ هفتگی": False}


def test_presence_declaration_is_labelled_self_reported(org):
    PresenceDeclaration.objects.create(workspace=ws(org), user=org["employee"], date=D, declared_at=at(D, 8), time_zone="Asia/Tehran")
    presence = get_day(org, org["employee"]).data["presence"]
    assert presence["kind"] == "self_reported" and presence["label"] == "خوداظهاری — حضور تأییدشده نیست"
    schedule = run(org, org["manager"], "team_schedule", {"range": {"type": "absolute", "from": D.isoformat(), "to": D.isoformat()}})
    assert "خوداظهاری" in all_cells(schedule) and "تأییدشده" not in "".join(c["label"] for c in schedule["columns"])


# ---------------------------------------------------------------- 4. draft suggestions


def test_draft_uses_only_own_activity_of_that_day_with_sources_and_merges_per_ticket(org):
    mine = ticket(org, org["employee"], name="تیکت من")
    other = ticket(org, org["colleague"], name="تیکت همکار")
    with frozen(at(D, 9)):
        core.record(mine, org["employee"], "ticket.category_changed", after="در حال انجام")
        core.record(mine, org["employee"], "ticket.referred")
        core.record(other, org["colleague"], "ticket.category_changed", after="انجام‌شده")
    yesterday = core.record(mine, org["employee"], "ticket.closed")
    EntityEvent.objects.filter(id=yesterday.id).update(created_at=at(D - timedelta(days=1), 10))
    past = event(org, org["employee"], at(D, 8), at(D, 9), title="جلسهٔ صبح")
    event(org, org["employee"], at(D, 15), at(D, 16), title="جلسهٔ عصر")
    items = draft.suggestions(ws(org), org["employee"], D, now=NOW)
    by_kind = {row["source_kind"]: row for row in items}
    ticket_rows = [row for row in items if row["source_kind"] == "issue"]
    assert len(ticket_rows) == 1 and ticket_rows[0]["source_id"] == str(mine.id)
    assert "تغییر وضعیت به «در حال انجام»" in ticket_rows[0]["text"] and "ارجاع تیکت" in ticket_rows[0]["text"]
    assert "بستن" not in ticket_rows[0]["text"]  # yesterday's action is not today's work
    assert by_kind["event"]["source_id"] == str(past.id)
    assert "جلسهٔ عصر" not in all_cells(items)
    assert "تیکت همکار" not in all_cells(items)
    assert all(row["source_kind"] and row["source_id"] for row in items)


def test_draft_is_not_saved_until_the_person_saves_the_report(org):
    issue = ticket(org, org["employee"])
    with frozen(at(D, 9)):
        core.record(issue, org["employee"], "ticket.category_changed", after="در حال انجام")
    with frozen(NOW):
        response = client_for(org["employee"]).get(url(org, f"daily-reports/day/{D.isoformat()}/draft/"))
    assert response.status_code == 200 and len(response.data["suggestions"]) == 1
    assert not DailyReport.objects.exists()


def test_draft_excludes_inaccessible_ticket_and_never_copies_comment_text(org):
    lost = ticket(org, org["employee"], creator=org["colleague"], name="تیکت از دست‌رفته")
    kept = ticket(org, org["employee"], name="تیکت در دسترس")
    with frozen(at(D, 9)):
        core.record(lost, org["employee"], "ticket.category_changed", after="در حال انجام")
        IssueComment(workspace=ws(org), issue=kept, actor=org["employee"], comment_html="<p>x</p>",
                     comment_stripped="رمز سرور مشتری ۱۲۳", access="INTERNAL").save(created_by_id=org["employee"].id)
        IssueComment(workspace=ws(org), issue=lost, actor=org["employee"], comment_html="<p>y</p>",
                     comment_stripped="متن محرمانه", access="EXTERNAL").save(created_by_id=org["employee"].id)
    IssueAssignee.objects.filter(issue=lost).delete()  # the person lost access
    with frozen(NOW):
        raw = client_for(org["employee"]).get(url(org, f"daily-reports/day/{D.isoformat()}/draft/")).content.decode()
    assert "تیکت از دست‌رفته" not in raw and str(lost.id) not in raw
    assert "رمز سرور مشتری" not in raw and "متن محرمانه" not in raw
    assert "تیکت در دسترس" in raw and "ثبت یادداشت داخلی" in raw


def test_day_without_activity_gives_an_empty_draft_not_invented_text(org):
    with frozen(NOW):
        response = client_for(org["employee"]).get(url(org, f"daily-reports/day/{D.isoformat()}/draft/"))
    assert response.data["suggestions"] == [] and response.data["empty"]


def test_event_marked_not_done_is_not_suggested(org):
    row = event(org, org["employee"], at(D, 8), at(D, 9))
    ActivityConfirmation.objects.create(
        workspace=ws(org), user=org["employee"], source_type="event", source_id=row.id, outcome="not_done", confirmed_at=at(D, 10)
    )
    assert draft.suggestions(ws(org), org["employee"], D, now=NOW) == []


# ---------------------------------------------------------------- 5. reminders


def notifications(user):
    return Notification.objects.filter(receiver=user, sender="crm:daily_report:reminder")


def test_reminder_is_sent_after_its_time_once_per_day(org):
    assert reminders.send_reminders(now=at(D, 16)) == {"sent": 0, "skipped": 0}
    first = reminders.send_reminders(now=at(D, 16, 45))
    assert notifications(org["employee"]).count() == 1 and first["sent"] >= 1
    again = reminders.send_reminders(now=at(D, 17))
    assert notifications(org["employee"]).count() == 1 and again["sent"] == 0 and again["skipped"] == first["sent"]
    assert EntityEvent.objects.filter(event_type="daily_report.reminder_sent", metadata__user_id=str(org["employee"].id)).count() == 1


def test_no_reminder_on_holiday_full_leave_or_after_submission_but_yes_on_hourly_leave(org):
    WorkScheduleException.objects.create(workspace=ws(org), user=org["holiday"], date_from=D, date_to=D, is_working=False, reason="تعطیلی رسمی")
    leave_row(org, org["onleave"], D)
    leave_row(org, org["hourly"], D, mode="hourly", hours=(9, 11))
    put_day(org, org["colleague"], at(D, 15), submit=True, items=[item()])
    reminders.send_reminders(now=at(D, 17))
    assert notifications(org["holiday"]).count() == 0
    assert notifications(org["onleave"]).count() == 0
    assert notifications(org["colleague"]).count() == 0
    assert notifications(org["hourly"]).count() == 1
    assert notifications(org["employee"]).count() == 1


def test_non_working_weekday_and_disabled_weekdays_are_skipped(org):
    reports.save_policy(ws(org), org["admin"], {"reminder": {"weekdays": [0, 1, 2, 3, 4]}})  # D is a Saturday (5)
    reminders.send_reminders(now=at(D, 17))
    assert notifications(org["employee"]).count() == 0


def test_external_channels_are_never_called(org, monkeypatch):
    calls = []
    for adapter in reminders.ADAPTERS.values():
        monkeypatch.setattr(adapter, "send", lambda *args, **kwargs: calls.append(args) or False)
    reports.save_policy(ws(org), org["admin"], {"channels": {"email": True, "sms": True}})
    reminders.send_reminders(now=at(D, 17))
    assert notifications(org["employee"]).count() == 1 and calls == []  # server setting is off by default


def test_reminder_precedence_and_personal_override_permission(org):
    reports.save_policy(ws(org), org["admin"], {"reminder": {"time": "15:00"}})
    payload = reminders.settings_payload(ws(org), org["employee"])
    assert payload["effective"]["time"] == "15:00" and payload["source"] == "workspace"
    reminders.save_unit(ws(org), org["admin"], org["team"].id, {"reminder": {"time": "14:00"}, "allow_personal": False})
    payload = reminders.settings_payload(ws(org), org["employee"])
    assert payload["effective"]["time"] == "14:00" and payload["source"] == "unit" and payload["allow_personal"] is False
    response = client_for(org["employee"]).put(url(org, "daily-reports/reminder/"), {"reminder": {"time": "18:00"}}, format="json")
    assert response.status_code == 403
    reminders.save_unit(ws(org), org["admin"], org["team"].id, {"reminder": {"time": "14:00"}, "allow_personal": True})
    response = client_for(org["employee"]).put(url(org, "daily-reports/reminder/"), {"reminder": {"time": "18:00"}}, format="json")
    assert response.status_code == 200 and response.data["effective"]["time"] == "18:00" and response.data["source"] == "personal"
    assert EntityEvent.objects.filter(event_type="daily_report.reminder_changed").count() == 3
    assert EntityEvent.objects.filter(event_type="daily_report.settings_changed").count() == 1


def test_unit_reminder_is_managed_only_by_an_allowed_manager(org):
    grant(org["manager"], "DailyReport.Reminder.Manage")
    grant(org["other_manager"], "DailyReport.Reminder.Manage")
    ok = client_for(org["manager"]).put(url(org, f"daily-reports/reminder/units/{org['team'].id}/"), {"reminder": {"time": "13:00"}}, format="json")
    assert ok.status_code == 200
    refused = client_for(org["other_manager"]).put(url(org, f"daily-reports/reminder/units/{org['team'].id}/"), {"reminder": {"time": "09:00"}}, format="json")
    assert refused.status_code == 404
    assert client_for(org["manager"]).put(url(org, "daily-reports/settings/"), {"deadline_time": "09:00"}, format="json").status_code == 403


# ---------------------------------------------------------------- 6. scope


def scenario(org):
    """Data of the employee (team of manager) and of the outsider (team of other_manager)."""
    mine = ticket(org, org["employee"], name="تیکت کارمند تیم الف")
    theirs = ticket(org, org["outsider"], name="تیکت فرد تیم ب")
    for issue, user in ((mine, org["employee"]), (theirs, org["outsider"])):
        Issue.objects.filter(id=issue.id).update(
            target_minutes=60, target_at=NOW - timedelta(hours=1), target_anchor_at=NOW - timedelta(hours=3),
            target_started_at=NOW - timedelta(hours=3), status="in_progress", target_calendar={"total": 60},
        )
        WorkflowExtension.objects.create(
            issue=issue, scope="ticket", minutes=30, requested_by=user, approver=org["manager"] if user == org["employee"] else org["other_manager"],
            previous_target_at=NOW, requested_target_at=NOW + timedelta(minutes=30), reason="زمان بیشتر",
        )
        with frozen(at(D, 9)):
            core.record(issue, user, "ticket.category_changed", after="در حال انجام")
        leave_row(org, user, D + timedelta(days=1))
    put_day(org, org["employee"], submit=True, items=[item("blocker", "مانع کارمند", needs_help=True)])
    put_day(org, org["outsider"], submit=True, items=[item("blocker", "مانع فرد تیم ب")])
    return mine, theirs


ALL_SOURCES = ("my_work", "daily_reports", "leave", "activity", "team_schedule", "status_trend", "ticket_deadlines", "extensions")
WIDE = {"range": {"type": "absolute", "from": D.isoformat(), "to": (D + timedelta(days=2)).isoformat()}}


def test_manager_sees_only_own_team_on_every_source(org):
    scenario(org)
    for code in ALL_SOURCES:
        # my_work/extensions have no default range; the rest look at D … D+2.
        definition = {"filters": []} if code in ("my_work", "extensions") else {**WIDE, "filters": []}
        mine = all_cells(run(org, org["manager"], code, definition))
        theirs = all_cells(run(org, org["other_manager"], code, definition))
        assert "کاربر employee" in mine, code
        assert "کاربر employee" not in theirs, code
        assert "کاربر outsider" not in mine, code
        assert "کاربر outsider" in theirs, code


def test_injected_ids_outside_scope_change_nothing(org):
    scenario(org)
    outsider = str(org["outsider"].id)
    result = run(org, org["manager"], "daily_reports", {**WIDE, "filters": [{"field": "person", "op": "in", "value": [outsider]}]})
    assert result["total"] == 0
    response = client_for(org["manager"]).post(
        url(org, "reports/run/"),
        {"source": "leave", "user_id": outsider, "unit_id": str(org["other"].id),
         "definition": {**WIDE, "filters": [{"field": "person", "op": "in", "value": [outsider]}]}},
        format="json",
    )
    assert response.status_code == 200 and response.data["total"] == 0
    assert get_day(org, org["other_manager"], user=str(org["employee"].id)).status_code == 404
    assert get_day(org, org["manager"], user=str(org["employee"].id)).status_code == 200
    with frozen(NOW):
        team = client_for(org["other_manager"]).get(url(org, "daily-reports/team/"), {"date": D.isoformat(), "user": str(org["employee"].id)})
    assert "کاربر employee" not in all_cells(team.data)


def test_a_team_permission_without_subordinates_is_only_self(org):
    grant(org["outsider"], "Report.Team.View", "DailyReport.Team.View")
    scope = people_scope(org["outsider"], ws(org), source="daily_reports")
    assert scope.user_ids == {org["outsider"].id} and scope.team is False
    upper = people_scope(org["upper"], ws(org))
    assert {org["manager"].id, org["employee"].id} <= upper.user_ids and org["outsider"].id not in upper.user_ids


def test_without_team_permission_a_manager_sees_only_self(org):
    revoke(org["manager"], "Report.Team.View", "DailyReport.Team.View")
    assert people_scope(org["manager"], ws(org)).user_ids == {org["manager"].id}
    with frozen(NOW):
        assert client_for(org["manager"]).get(url(org, "daily-reports/team/")).status_code == 403


def test_active_delegate_sees_the_absent_managers_team(org):
    grant(org["delegate"], "Report.Team.View")
    OrganizationUnitDelegate.objects.create(unit=org["team"], user=org["delegate"])
    assert org["employee"].id not in people_scope(org["delegate"], ws(org)).user_ids
    UserAbsence.objects.create(
        workspace=ws(org), user=org["manager"], starts_at=NOW - timedelta(days=1),
        ends_at=NOW + timedelta(days=1), reason="مأموریت", status="scheduled",
    )
    with frozen(NOW):
        assert org["employee"].id in people_scope(org["delegate"], ws(org)).user_ids


# ---------------------------------------------------------------- 7. reports with expected totals


def deadline_fixture(org):
    def make(name, **values):
        issue = ticket(org, org["employee"], name=name)
        Issue.objects.filter(id=issue.id).update(**values)
        return issue

    base = {"target_minutes": 1000, "target_calendar": {"total": 1000}, "target_started_at": NOW - timedelta(days=1)}
    running = make("در موعد", status="in_progress", target_at=NOW + timedelta(days=30), target_anchor_at=NOW - timedelta(days=1), **base)
    near = make("نزدیک موعد", status="in_progress", target_at=NOW + timedelta(minutes=100), target_anchor_at=NOW - timedelta(days=1), **base)
    overdue = make("دیرکرده", status="in_progress", target_at=NOW - timedelta(minutes=120), target_anchor_at=NOW - timedelta(days=1), **base)
    on_time = make("بسته در موعد", status="done", target_at=NOW, completed_at=NOW - timedelta(hours=1), **base)
    late = make("بسته با دیرکرد", status="done", target_at=NOW - timedelta(hours=2), completed_at=NOW - timedelta(minutes=30), **base)
    WorkflowDelayReport.objects.create(
        issue=overdue, reporter=org["employee"], reason="قطعی برق", progress="۸۰٪", expected_at=NOW + timedelta(hours=3), target_at=overdue.target_at
    )
    for status in ("approved", "rejected"):
        WorkflowExtension.objects.create(
            issue=overdue, scope="ticket", minutes=60, requested_by=org["employee"], approver=org["manager"], status=status,
            previous_target_at=NOW - timedelta(hours=3), requested_target_at=NOW + timedelta(hours=5), reason="ابزار",
        )
    return running, near, overdue, on_time, late


def test_ticket_deadline_report_states_delay_reason_and_extensions(org):
    deadline_fixture(org)
    result = run(org, org["manager"], "ticket_deadlines", {
        "columns": ["title", "deadline_state", "delay_minutes", "delay_reason", "extensions", "extensions_approved", "new_target_at"],
        "filters": [], "sort": [{"field": "title", "dir": "asc"}],
        "aggregates": [{"fn": "count"}, {"fn": "sum", "field": "delay_minutes"}, {"fn": "sum", "field": "extensions"}],
    })
    rows = {r["cells"][0]: r["cells"] for r in result["rows"]}
    assert rows["در موعد"][1] == "در موعد"
    assert rows["نزدیک موعد"][1] == "نزدیک موعد"
    assert rows["دیرکرده"][1:6] == ["دیرکرده", 120, "قطعی برق", 2, 1]
    assert rows["دیرکرده"][6]  # new deadline from the approved extension
    assert rows["بسته در موعد"][1:3] == ["بسته در موعد", 0]
    assert rows["بسته با دیرکرد"][1:3] == ["بسته با دیرکرد", 90]
    totals = {a["fn"] + a.get("field", ""): a["value"] for a in result["aggregates"]}
    assert totals == {"count": 5, "sumdelay_minutes": 210, "sumextensions": 2}
    overdue_only = run(org, org["manager"], "ticket_deadlines", {"filters": [{"field": "deadline_state", "op": "in", "value": ["overdue", "near_due"]}]})
    assert overdue_only["total"] == 2


def test_deadline_states_match_the_existing_ticket_badges(org):
    issues = deadline_fixture(org)
    badges = core.deadline_badges([i.id for i in issues], ws(org), NOW)
    assert [badges[str(i.id)]["state"] for i in issues] == ["running", "near_due", "overdue", "closed", "closed"]


def test_status_trend_counts_open_closed_overdue_and_wait(org):
    deadline_fixture(org)
    result = run(org, org["manager"], "status_trend", {
        "range": {"type": "absolute", "from": (D - timedelta(days=3)).isoformat(), "to": D.isoformat()},
        "filters": [{"field": "person", "op": "in", "value": [str(org["employee"].id)]}],
        "columns": ["person", "open_now", "in_progress_now", "overdue_now", "closed"],
    })
    assert result["rows"][0]["cells"] == ["کاربر employee", 3, 3, 1, 2]
    assert any("روش" not in c["method"] and c["method"] for c in result["columns"][1:])


def customer_fixture(org):
    def entity(code, title):
        row, _ = EntityType.objects.get_or_create(workspace=ws(org), code=code, parent=None, defaults={"title": title, "numbering": {"prefix": code[0].upper()}})
        layout = {"tabs": [], "sections": [{"id": "main", "title": "اصلی", "columns": 1, "bindings": [{"field": "title"}]}]}
        form, _ = FormLayout.objects.get_or_create(entity=row, defaults={"draft": layout})
        if not form.published_id:
            form.published = FormVersion.objects.create(layout=form, number=1, schema=layout)
            form.save()
        return row

    customer = entity("customer", "مشتری")
    ticket_entity = EntityType.objects.get(workspace=ws(org), code="ticket", parent__isnull=True)
    lf = FieldDefinition.objects.create(workspace=ws(org), code="cust_t_l", title="r", kind="relation")
    rf = FieldDefinition.objects.create(workspace=ws(org), code="cust_t_r", title="r", kind="relation")
    rel = EntityRelation.objects.create(left_entity=customer, right_entity=ticket_entity, left_field=lf, right_field=rf, kind="one_to_many")
    a = EntityRecord(entity=customer, workspace=ws(org), number="C-1", data={"title": "شرکت الف"})
    a.save(created_by_id=org["manager"].id)
    b = EntityRecord(entity=customer, workspace=ws(org), number="C-2", data={"title": "شرکت ب"})
    b.save(created_by_id=org["manager"].id)
    tickets = [ticket(org, org["employee"], name=f"تیکت {i}") for i in range(3)]
    for record, issue in ((a, tickets[0]), (a, tickets[1]), (b, tickets[2])):
        EntityRelationLink.objects.create(relation=rel, left_id=record.id, right_id=issue.id)
    return a, b, tickets


def test_customer_report_counts_tickets_from_relation_links_only(org):
    customer_fixture(org)
    result = run(org, org["manager"], "relations", {"group_by": ["related"], "filters": [{"field": "relation_kind", "op": "eq", "value": "customer"}]})
    counts = {g["keys"][0]["value"]: g["count"] for g in result["groups"]}
    assert counts == {"شرکت الف": 2, "شرکت ب": 1} and result["total"] == 3
    # Customer records the viewer may not see are not named.
    revoke(org["other_manager"], "Issue.ViewAll")
    assert "شرکت الف" not in all_cells(run(org, org["other_manager"], "relations", {}))


def test_leave_report_duration_and_approver_without_category(org):
    entity = leave.leave_entity(ws(org))
    definition = WorkflowDefinition.objects.create(workspace=ws(org), entity=entity, title="تأیید مرخصی")
    version = WorkflowVersion.objects.create(definition=definition, number=1, status="published")
    approved = leave_row(org, org["employee"], D, D + timedelta(days=1))
    instance = WorkflowInstance.objects.create(
        workspace=ws(org), entity=entity, record_id=approved.id, definition=definition, version=version, current_step="end", status="completed"
    )
    WorkflowDecision.objects.create(instance=instance, kind="transition", actor=org["manager"], version_number=1)
    leave_row(org, org["colleague"], D, mode="hourly", hours=(9, 11))
    leave_row(org, org["colleague"], D + timedelta(days=1), status="pending")
    result = run(org, org["manager"], "leave", {
        **WIDE, "columns": ["person", "mode", "status", "duration_days", "duration_minutes", "approver"],
        "sort": [{"field": "person", "dir": "asc"}, {"field": "status", "dir": "asc"}],
        "aggregates": [{"fn": "count"}, {"fn": "sum", "field": "duration_days"}, {"fn": "sum", "field": "duration_minutes"}],
    })
    cells = [r["cells"] for r in result["rows"]]
    assert ["کاربر employee", "روزانه", "تأییدشده", 2, "", "کاربر manager"] in cells
    assert ["کاربر colleague", "ساعتی", "تأییدشده", "", 120, ""] in cells
    totals = [a["value"] for a in result["aggregates"]]
    assert totals == [3, 3, 120]  # the pending request counts too: 2 + 1 days
    assert "category" not in all_cells(sources.catalog(org["manager"], ws(org))[2]) and "دسته" not in json.dumps(
        [f.label for f in sources.SOURCES["leave"].fields], ensure_ascii=False
    )


def test_activity_report_counts_by_kind_and_is_labelled_not_attendance(org):
    issue = ticket(org, org["employee"], name="تیکت فعالیت")
    with frozen(at(D, 9)):
        core.record(issue, org["employee"], "ticket.category_changed", after="در حال انجام")
        core.record(issue, org["employee"], "ticket.referred")
        IssueComment(workspace=ws(org), issue=issue, actor=org["employee"], comment_html="<p>a</p>", access="EXTERNAL").save(created_by_id=org["employee"].id)
    event(org, org["employee"], at(D, 8), at(D, 9))
    result = run(org, org["manager"], "activity", {"range": {"type": "absolute", "from": D.isoformat(), "to": D.isoformat()}, "group_by": ["kind"]})
    counts = {g["keys"][0]["value"]: g["count"] for g in result["groups"]}
    assert counts == {"تغییر وضعیت": 1, "ارجاع": 1, "مکاتبه": 1, "جلسه / مأموریت / رویداد": 1}
    assert result["note"] == "گزارش فعالیت — کارکرد حضور نیست."


def test_pending_extensions_report(org):
    issue = ticket(org, org["employee"])
    for status in ("pending", "approved"):
        WorkflowExtension.objects.create(
            issue=issue, scope="ticket", minutes=45, requested_by=org["employee"], approver=org["manager"], status=status,
            previous_target_at=NOW, requested_target_at=NOW + timedelta(minutes=45), reason=f"دلیل {status}",
        )
    result = run(org, org["manager"], "extensions", {"columns": ["ticket_title", "minutes", "reason", "status", "approver"]})
    assert result["total"] == 1 and result["rows"][0]["cells"][2:] == ["دلیل pending", "در انتظار تأیید", "کاربر manager"]


def test_team_daily_status_summary_with_blockers_and_help(org):
    reports.save_policy(ws(org), org["admin"], {"deadline_time": "10:00"})
    put_day(org, org["employee"], at(D, 9), submit=True, items=[item("blocker", "منتظر تأیید", needs_help=True), item("blocker", "کندی شبکه")])
    put_day(org, org["colleague"], at(D, 10, 30), submit=True, items=[item()])
    put_day(org, org["holiday"], at(D, 9), items=[item()])
    leave_row(org, org["onleave"], D)
    with frozen(at(D, 11)):
        data = client_for(org["manager"]).get(url(org, "daily-reports/team/"), {"date": D.isoformat()}).data
    status = {p["person"]["name"]: p["status"] for p in data["people"]}
    assert status == {
        "کاربر employee": "submitted", "کاربر colleague": "late", "کاربر holiday": "draft",
        "کاربر onleave": "not_required", "کاربر hourly": "missing", "کاربر delegate": "missing",
    }
    employee = next(p for p in data["people"] if p["person"]["name"] == "کاربر employee")
    assert [i["text"] for i in employee["help"]] == ["منتظر تأیید"] and [i["text"] for i in employee["blockers"]] == ["کندی شبکه"]
    assert data["summary"]["missing"] == 2 and data["summary"]["late"] == 1


# ---------------------------------------------------------------- 8. no attendance anywhere


def test_no_entry_exit_lateness_overtime_or_effort_hours_in_any_source():
    for source in sources.SOURCES.values():
        for field in source.fields:
            text = f"{field.key} {field.label} {field.method}".casefold()
            for word in sources.FORBIDDEN_WORDS:
                assert word.casefold() not in text, (source.code, field.key, word)
            assert "effort" not in field.key, (source.code, field.key)


# ---------------------------------------------------------------- 9. saved reports


def create_saved(org, user, **extra):
    body = {"name": "تیکت‌های دیرکرده", "source": "ticket_deadlines", "definition": {"filters": [{"field": "deadline_state", "op": "eq", "value": "overdue"}]}, **extra}
    return client_for(user).post(url(org, "reports/saved/"), body, format="json")


def test_saved_report_create_open_edit_copy_delete_with_history(org):
    created = create_saved(org, org["manager"])
    assert created.status_code == 201, created.data
    report_id = created.data["id"]
    client = client_for(org["manager"])
    assert client.get(url(org, f"reports/saved/{report_id}/")).data["name"] == "تیکت‌های دیرکرده"
    edited = client.patch(url(org, f"reports/saved/{report_id}/"), {"name": "دیرکردها", "revision": 1}, format="json")
    assert edited.status_code == 200 and edited.data["revision"] == 2
    assert client.patch(url(org, f"reports/saved/{report_id}/"), {"name": "x", "revision": 1}, format="json").status_code == 409
    copied = client.post(url(org, f"reports/saved/{report_id}/copy/"))
    assert copied.status_code == 201 and copied.data["name"] == "نسخه از دیرکردها"
    assert client.delete(url(org, f"reports/saved/{report_id}/")).status_code == 204
    assert client.get(url(org, f"reports/saved/{report_id}/")).status_code == 404
    assert SavedReport.all_objects.get(id=report_id).deleted_at is not None
    types = list(EntityEvent.objects.filter(event_type__startswith="saved_report.").order_by("created_at").values_list("event_type", flat=True))
    assert types == ["saved_report.created", "saved_report.updated", "saved_report.copied", "saved_report.deleted"]


def test_personal_report_is_invisible_to_others(org):
    report_id = create_saved(org, org["manager"]).data["id"]
    other = client_for(org["other_manager"])
    assert other.get(url(org, f"reports/saved/{report_id}/")).status_code == 404
    assert other.post(url(org, f"reports/saved/{report_id}/run/"), {}, format="json").status_code == 404
    assert other.patch(url(org, f"reports/saved/{report_id}/"), {"name": "x"}, format="json").status_code == 404
    assert report_id not in all_cells(other.get(url(org, "reports/saved/")).data)


def test_sharing_needs_the_share_permission_and_grants_no_data(org):
    scenario(org)
    revoke(org["manager"], "Report.Share")
    role = OrganizationRole.objects.get(name="role-other_manager")
    refused = create_saved(org, org["manager"], visibility="shared", shared_roles=[str(role.id)])
    assert refused.status_code == 403
    grant(org["manager"], "Report.Share")
    shared = create_saved(org, org["manager"], name="تمدیدها", source="extensions", definition={"filters": []},
                          visibility="shared", shared_roles=[str(role.id)], shared_units=[str(org["other"].id)])
    assert shared.status_code == 201
    owner_run = client_for(org["manager"]).post(url(org, f"reports/saved/{shared.data['id']}/run/"), {}, format="json").data
    recipient = client_for(org["other_manager"])
    recipient_run = recipient.post(url(org, f"reports/saved/{shared.data['id']}/run/"), {}, format="json").data
    assert "کاربر employee" in all_cells(owner_run["rows"]) and "کاربر employee" not in all_cells(recipient_run["rows"])
    assert "کاربر outsider" in all_cells(recipient_run["rows"])
    assert recipient.patch(url(org, f"reports/saved/{shared.data['id']}/"), {"name": "x"}, format="json").status_code == 403
    assert recipient.delete(url(org, f"reports/saved/{shared.data['id']}/")).status_code == 403
    assert recipient.post(url(org, f"reports/saved/{shared.data['id']}/copy/")).status_code == 201
    unit_member = client_for(org["outsider"])  # member of the shared unit, but only Report.View
    assert unit_member.post(url(org, f"reports/saved/{shared.data['id']}/run/"), {}, format="json").status_code == 200


def test_unknown_field_or_operator_is_refused_in_persian(org):
    client = client_for(org["manager"])
    for definition in (
        {"columns": ["number", "salary"]},
        {"filters": [{"field": "title", "op": "gt", "value": 3}]},
        {"aggregates": [{"fn": "sum", "field": "title"}]},
        {"group_by": ["number", "title", "assignee"]},
        {"filters": [{"field": "category", "op": "eq", "value": "deleted"}]},
    ):
        response = client.post(url(org, "reports/run/"), {"source": "my_work", "definition": definition}, format="json")
        assert response.status_code == 400, definition
        assert any("؀" <= ch <= "ۿ" for ch in json.dumps(response.data, ensure_ascii=False)), definition
    assert create_saved(org, org["manager"], definition={"columns": ["salary"]}).status_code == 400


def test_saved_definition_incompatible_with_the_current_source_fails_clearly(org, monkeypatch):
    report_id = create_saved(org, org["manager"], definition={"columns": ["title", "delay_reason"]}).data["id"]
    source = sources.SOURCES["ticket_deadlines"]
    monkeypatch.setattr(source, "fields", [f for f in source.fields if f.key != "delay_reason"])
    response = client_for(org["manager"]).post(url(org, f"reports/saved/{report_id}/run/"), {}, format="json")
    assert response.status_code == 409
    assert response.data["code"] == "incompatible" and "delay_reason" in response.data["missing"]
    assert "دیگر در منبع" in response.data["error"]
    monkeypatch.setattr(source, "fields", sources.TICKET_DEADLINES.fields)
    monkeypatch.setattr(source, "compatible_since", 2)
    assert client_for(org["manager"]).post(url(org, f"reports/saved/{report_id}/run/"), {}, format="json").status_code == 409


def test_personal_saved_report_limit_is_configurable(org):
    reports.save_policy(ws(org), org["admin"], {"personal_report_limit": 1})
    assert create_saved(org, org["manager"]).status_code == 201
    assert create_saved(org, org["manager"]).status_code == 400


# ---------------------------------------------------------------- 10. export


def export(org, user, body):
    with transaction.atomic():
        response = client_for(user).post(url(org, "reports/exports/"), body, format="json")
    if response.status_code == 202:
        exports.build_report_export(response.data["id"])
    return response


def test_csv_export_has_the_same_rows_scope_and_order_as_the_page(org):
    deadline_fixture(org)
    scenario(org)
    definition = {"columns": ["number", "title", "assignee", "deadline_state", "target_minutes"], "sort": [{"field": "title", "dir": "asc"}], "filters": []}
    with frozen(NOW):
        page = client_for(org["manager"]).post(url(org, "reports/run/"), {"source": "ticket_deadlines", "definition": definition, "page_size": 200}, format="json").data
        response = export(org, org["manager"], {"source": "ticket_deadlines", "definition": definition, "format": "csv"})
        job = EntityViewExport.objects.get(id=response.data["id"])
        assert job.status == "ready" and job.row_count == page["total"] and job.entity_id is None
        download = client_for(org["manager"]).get(url(org, f"reports/exports/{job.id}/download/"))
    assert download.status_code == 200
    rows = list(csv.reader(io.StringIO(b"".join(download.streaming_content).decode("utf-8-sig"))))
    assert rows[0] == [c["label"] for c in page["columns"]]
    assert rows[1:] == [[str(v) for v in r["cells"]] for r in page["rows"]]
    assert "کاربر outsider" not in all_cells(rows)


def test_export_neutralizes_formula_injection_and_writes_xlsx(org):
    ticket(org, org["employee"], name='=HYPERLINK("http://evil.test","x")')
    with frozen(NOW):
        response = export(org, org["manager"], {"source": "my_work", "definition": {"columns": ["title"], "filters": []}, "format": "csv"})
        download = client_for(org["manager"]).get(url(org, f"reports/exports/{response.data['id']}/download/"))
        content = b"".join(download.streaming_content).decode("utf-8-sig")
        assert "'=HYPERLINK" in content
        xlsx = export(org, org["manager"], {"source": "my_work", "definition": {"columns": ["title"], "filters": []}, "format": "xlsx"})
        assert EntityViewExport.objects.get(id=xlsx.data["id"]).status == "ready"


def test_export_is_refused_to_other_users_without_permission_and_after_scope_change(org):
    scenario(org)
    with frozen(NOW):
        response = export(org, org["manager"], {"source": "daily_reports", "definition": WIDE, "format": "csv"})
        job_id = response.data["id"]
        assert client_for(org["other_manager"]).get(url(org, f"reports/exports/{job_id}/download/")).status_code == 404
        assert client_for(org["other_manager"]).get(url(org, f"reports/exports/{job_id}/")).status_code == 404
        assert export(org, org["employee"], {"source": "my_work", "definition": {}, "format": "csv"}).status_code == 403
        OrganizationUnitMember.objects.filter(user=org["employee"]).update(is_active=False)
        refused = client_for(org["manager"]).get(url(org, f"reports/exports/{job_id}/download/"))
    assert refused.status_code == 403 and "تغییر کرده" in str(refused.data)


def test_export_of_a_shared_report_uses_the_recipients_scope(org):
    scenario(org)
    role = OrganizationRole.objects.get(name="role-other_manager")
    shared = create_saved(org, org["manager"], name="روزانه", source="daily_reports", definition=WIDE, visibility="shared", shared_roles=[str(role.id)])
    with frozen(NOW):
        response = export(org, org["other_manager"], {"saved_id": shared.data["id"], "format": "csv"})
        download = client_for(org["other_manager"]).get(url(org, f"reports/exports/{response.data['id']}/download/"))
    content = b"".join(download.streaming_content).decode("utf-8-sig")
    assert "کاربر outsider" in content and "کاربر employee" not in content


# ---------------------------------------------------------------- 11. performance


def query_count(callable_):
    with CaptureQueriesContext(connection) as context:
        callable_()
    return len(context)


@pytest.mark.parametrize("code", sorted(sources.SOURCES))
def test_query_count_does_not_grow_with_rows(org, code):
    def data(n):
        for i in range(n):
            issue = ticket(org, org["employee"] if i % 2 else org["colleague"], name=f"تیکت {code} {i}")
            Issue.objects.filter(id=issue.id).update(target_minutes=60, target_at=NOW + timedelta(days=20), target_anchor_at=NOW, target_calendar={"total": 60})
            WorkflowExtension.objects.create(issue=issue, scope="ticket", minutes=5, requested_by=org["employee"], approver=org["manager"],
                                             previous_target_at=NOW, requested_target_at=NOW, reason="r", status="approved")
            with frozen(at(D, 9)):
                core.record(issue, org["employee"], "ticket.category_changed", after="در حال انجام")
            leave_row(org, org["employee"] if i % 2 else org["colleague"], D + timedelta(days=i + 3))

    definition = {"range": {"type": "absolute", "from": D.isoformat(), "to": (D + timedelta(days=30)).isoformat()}} if sources.SOURCES[code].range_required else {}
    data(2)
    run(org, org["manager"], code, definition)  # warm caches
    small = query_count(lambda: run(org, org["manager"], code, definition))
    data(6)
    large = query_count(lambda: run(org, org["manager"], code, definition))
    assert large == small, (code, small, large)


def test_range_over_the_cap_is_refused_and_too_many_rows_need_the_background_path(org):
    response = client_for(org["manager"]).post(
        url(org, "reports/run/"),
        {"source": "activity", "definition": {"range": {"type": "absolute", "from": "2025-01-01", "to": "2026-12-31"}}},
        format="json",
    )
    assert response.status_code == 400 and "۳۶۶" in str(response.data)
    for i in range(3):
        ticket(org, org["employee"], name=f"t{i}")
    source = sources.SOURCES["my_work"]
    definition = sources.validate(source, {})
    with pytest.raises(sources.TooLarge):
        sources.compute(ws(org), org["manager"], source, definition, now=NOW, limit=2)


# ---------------------------------------------------------------- 12. migration and permissions


def test_migration_is_additive_and_creates_no_parallel_leave_calendar_or_activity_table():
    module = importlib.import_module("plane.db.migrations.0164_daily_reports_and_saved_reports")
    kinds = {type(op) for op in module.Migration.operations}
    assert kinds <= {migrations.CreateModel, migrations.AddField, migrations.AlterField, migrations.AddConstraint, migrations.AddIndex}
    created = {op.name for op in module.Migration.operations if isinstance(op, migrations.CreateModel)}
    assert created == {"DailyReport", "DailyReportItem", "SavedReport"}
    for op in module.Migration.operations:
        if isinstance(op, migrations.AlterField):
            assert op.name == "entity" and op.field.null is True
    tables = set(connection.introspection.table_names())
    new = {t for t in tables if t.startswith("crm_") and any(w in t for w in ("leave", "calendar", "schedule", "activit", "attendance", "presence", "notification", "export", "report"))}
    assert new == {
        "crm_leave_requests", "crm_leave_request_versions", "crm_leave_template_versions", "crm_work_schedules",
        "crm_work_schedule_days", "crm_work_schedule_exceptions", "crm_presence_declarations",
        "crm_activity_confirmations", "crm_entity_view_exports", "crm_workflow_delay_reports",
        "crm_daily_reports", "crm_daily_report_items", "crm_saved_reports",
    }


def test_permission_codes_and_data_migration_grants(org):
    module = importlib.import_module("plane.db.migrations.0165_report_permissions")
    assert set(module.PERMISSIONS) <= set(PERMISSION_REGISTRY)
    assert module.MEMBER == {"DailyReport.Submit", "Report.View"}
    assert not PERMISSION_REGISTRY["Report.Team.View"]["is_delegatable"]


def test_endpoints_require_authentication_and_membership(org):
    stranger = User.objects.create_user(email="s@example.test", username="stranger", password="SafePassword!2026")
    for path in ("daily-reports/today/", "reports/sources/", "reports/saved/", "daily-reports/team/"):
        assert APIClient().get(url(org, path)).status_code in (401, 403)
        assert client_for(stranger).get(url(org, path)).status_code in (403, 404)


def test_validation_helper_rejects_unknown_definition_keys():
    with pytest.raises(ValidationError):
        sources.validate(sources.SOURCES["my_work"], {"columns": ["title"], "sql": "drop"})
