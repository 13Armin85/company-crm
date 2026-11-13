"""Ticket 8 (daily reports and saved reports), phase 1: characterization before any change.

These tests pin what the code does on HEAD (``365adfd``), including the gaps the ticket
closes. Tests marked "gap" describe a missing capability; after the ticket-8 work they
were turned into "after" assertions and the original HEAD behavior is quoted in each
docstring (see docs/TICKET-8-DELIVERY.fa.md, section 7).
"""

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from django.apps import apps
from django.db import connection
from rest_framework.test import APIClient

from plane.app.services import leave_requests as leave
from plane.app.services import ticket_core as core
from plane.app.services.entity_schema import initialize_engine
from plane.app.services.permission_registry import PERMISSION_REGISTRY, sync_permission_catalog
from plane.app.services.work_calendar import schedule_for, schedule_range
from plane.db.models import (
    ActivityConfirmation,
    EntityEvent,
    EntityViewExport,
    Issue,
    IssueAssignee,
    LeaveRequest,
    LeaveRequestVersion,
    OrganizationPermission,
    OrganizationRole,
    OrganizationUnit,
    OrganizationUnitMember,
    RolePermission,
    SurfaceValues,
    User,
    UserOrganizationRole,
    WorkflowDelayReport,
    WorkflowExtension,
    WorkspaceMember,
)

pytestmark = [pytest.mark.django_db, pytest.mark.contract]

TEHRAN = ZoneInfo("Asia/Tehran")
SAT = date(2027, 1, 9)  # Saturday
FRI = date(2027, 1, 15)  # Friday — the built-in weekly day off


def person(workspace, name, codes=()):
    user = User.objects.create_user(email=f"{name}@example.test", username=name, password="SafePassword!2026")
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
    role = OrganizationRole.objects.create(workspace=workspace, name=f"role-{name}")
    for permission in OrganizationPermission.objects.filter(workspace=workspace, code__in=codes):
        RolePermission.objects.create(role=role, permission=permission)
    UserOrganizationRole.objects.create(workspace=workspace, user=user, role=role)
    return user


@pytest.fixture
def org(workspace, create_user):
    initialize_engine(workspace)
    sync_permission_catalog(workspace)
    leave.ensure_leave_entity(workspace)
    people = {name: person(workspace, name, ["LeaveRequest.Create"]) for name in ("manager", "employee", "other_manager", "outsider")}
    team = OrganizationUnit.objects.create(workspace=workspace, title="تیم الف", manager=people["manager"])
    other = OrganizationUnit.objects.create(workspace=workspace, title="تیم ب", manager=people["other_manager"])
    OrganizationUnitMember.objects.create(unit=team, user=people["employee"])
    OrganizationUnitMember.objects.create(unit=other, user=people["outsider"])
    return {"workspace": workspace, **people}


def approved_leave(workspace, user, start, end=None, mode="daily", starts_at=None, ends_at=None):
    row = LeaveRequest.objects.create(
        workspace=workspace, requester=user, number=f"LRQ-{LeaveRequest.objects.count() + 1}", status="approved"
    )
    end = end or start
    LeaveRequestVersion.objects.create(
        request=row,
        number=1,
        mode=mode,
        start_date=start,
        end_date=end,
        starts_at=starts_at or datetime.combine(start, time(0), tzinfo=TEHRAN),
        ends_at=ends_at or datetime.combine(end + timedelta(days=1), time(0), tzinfo=TEHRAN),
        duration_days=1 if mode == "daily" else None,
        duration_minutes=None if mode == "daily" else 120,
    )
    return row


# ---------------------------------------------------------------- gaps the ticket closes


def test_daily_report_model_exists():
    """gap — on HEAD there was no daily report anywhere (no model, no table). After ticket 8
    the minimal ``DailyReport``/``DailyReportItem`` pair exists (decision 8.1)."""
    assert apps.get_model("db", "DailyReport")._meta.db_table == "crm_daily_reports"  # HEAD: LookupError
    assert "crm_daily_reports" in connection.introspection.table_names()


def test_daily_report_api_is_served(org):
    """gap — on HEAD ``/daily-reports/`` was 404. After ticket 8 an unauthenticated caller is refused."""
    url = f"/api/workspaces/{org['workspace'].slug}/daily-reports/today/"
    assert APIClient().get(url).status_code in (401, 403)  # HEAD: 404


def test_report_permission_codes_are_registered():
    """gap — on HEAD no ``DailyReport.*``/``Report.*`` code existed."""
    for code in (
        "DailyReport.Submit",
        "DailyReport.Team.View",
        "DailyReport.Reminder.Manage",
        "Report.View",
        "Report.Team.View",
        "Report.Build",
        "Report.Share",
        "Report.Export",
    ):
        assert code in PERMISSION_REGISTRY, code  # HEAD: absent


def test_view_export_can_carry_a_report_source():
    """gap — on HEAD ``EntityViewExport.entity`` was NOT NULL (exports only for engine entities).
    After ticket 8 the column is nullable and ``report_source`` names the report source."""
    assert EntityViewExport._meta.get_field("entity").null is True  # HEAD: False
    assert EntityViewExport._meta.get_field("report_source").max_length == 40


def test_reminder_idempotency_constraint_exists():
    """gap — on HEAD ``crm_entity_events`` had only the two ticket-7 constraints."""
    names = {c.name for c in EntityEvent._meta.constraints}
    assert {"crm_quote_one_decision", "crm_portal_one_feedback"} <= names
    assert "crm_daily_report_one_reminder" in names  # HEAD: absent


# ---------------------------------------------------------------- what is reused unchanged


def test_ticket_extension_and_delay_report_are_readable_ticket_rows(org):
    issue = Issue(workspace=org["workspace"], name="تیکت")
    issue.save(created_by_id=org["employee"].id)
    now = datetime(2027, 1, 9, 10, tzinfo=TEHRAN)
    ext = WorkflowExtension.objects.create(
        issue=issue,
        scope="ticket",
        minutes=60,
        requested_by=org["employee"],
        approver=org["manager"],
        previous_target_at=now,
        requested_target_at=now + timedelta(hours=1),
        reason="نیاز به زمان بیشتر",
    )
    report = WorkflowDelayReport.objects.create(
        issue=issue, reporter=org["employee"], reason="قطعی", progress="نیمه", expected_at=now, target_at=now
    )
    assert WorkflowExtension.objects.filter(issue=issue, status="pending").get() == ext
    assert WorkflowDelayReport.objects.filter(issue=issue).get() == report
    assert ext.step_run_id is None and report.step_run_id is None


def test_leave_visibility_refuses_a_manager_outside_the_scope(org):
    row = approved_leave(org["workspace"], org["employee"], SAT)
    assert leave.visible_queryset(org["manager"], org["workspace"]).filter(id=row.id).exists()
    assert not leave.visible_queryset(org["other_manager"], org["workspace"]).filter(id=row.id).exists()
    assert not leave.visible_queryset(org["outsider"], org["workspace"]).filter(id=row.id).exists()


def test_leave_current_version_is_the_highest_number(org):
    row = approved_leave(org["workspace"], org["employee"], SAT)
    LeaveRequestVersion.objects.create(
        request=row,
        number=2,
        mode="hourly",
        start_date=SAT,
        end_date=SAT,
        starts_at=datetime.combine(SAT, time(10), tzinfo=TEHRAN),
        ends_at=datetime.combine(SAT, time(12), tzinfo=TEHRAN),
        duration_minutes=120,
    )
    assert leave.current_version(row).number == 2


def test_builtin_calendar_marks_friday_off_and_range_resolves_every_day(org):
    assert schedule_for(org["employee"], FRI, org["workspace"]).working is False
    assert schedule_for(org["employee"], SAT, org["workspace"]).working is True
    days = schedule_range(org["employee"], SAT, FRI, org["workspace"])
    assert [d.working for d in days] == [True, True, True, True, True, True, False]


def test_near_due_threshold_and_status_categories_are_single_sources():
    assert core.NEAR_DUE_PERCENT == 20
    assert core.work_category(group="started") == core.IN_PROGRESS
    assert core.work_category(status="blocked", project=False) == core.IN_PROGRESS


def test_overdue_query_ignores_tickets_without_a_started_clock(org):
    issue = Issue(workspace=org["workspace"], name="بی‌موعد")
    issue.save(created_by_id=org["employee"].id)
    IssueAssignee.objects.create(issue=issue, assignee=org["employee"], workspace=org["workspace"], project=None)
    assert not Issue.objects.filter(core.overdue_q(), id=issue.id).exists()


def test_activity_confirmation_is_one_row_per_person_and_source(org):
    field_names = {f.name for f in ActivityConfirmation._meta.get_fields()}
    assert {"source_type", "source_id", "outcome"} <= field_names
    assert {c.name for c in ActivityConfirmation._meta.constraints} == {"crm_activity_confirmation_unique"}


def test_surface_values_store_per_object_settings(org):
    row = SurfaceValues.objects.create(
        workspace=org["workspace"], code="baseline-probe", object_id=org["employee"].id, values={"a": 1}
    )
    assert SurfaceValues.objects.get(id=row.id).values == {"a": 1}
