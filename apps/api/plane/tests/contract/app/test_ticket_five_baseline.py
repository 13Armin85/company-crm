"""Ticket 5, phase 1: characterization of the behavior that exists before any change.

These tests pin what the code does today (not what ticket 5 wants). A test here
that fails after ticket 5 work means existing behavior moved and must be
reported in docs/TICKET-5-DELIVERY.fa.md, not silently "fixed".
"""

from datetime import date, datetime, time
from zoneinfo import ZoneInfo

import pytest
from rest_framework.exceptions import ValidationError

from plane.app.services import TicketRoutingService
from plane.app.services.task_policy import validate_other_assignees
from plane.app.services.task_visibility import visible_issues
from plane.app.services.work_calendar import add_working_time, availability, working_minutes_between
from plane.app.services.workflow_engine import STATE_GROUPS, managers_of
from plane.db.models import (
    Issue,
    IssueAssignee,
    OrganizationRole,
    OrganizationUnit,
    OrganizationUnitMember,
    Project,
    State,
    TicketRoleQueueEntry,
    TicketRoutingDecision,
    TicketRoutingRule,
    User,
    UserAbsence,
    UserOrganizationRole,
    WorkEvent,
    WorkEventParticipant,
    WorkSchedule,
    WorkScheduleDay,
    WorkScheduleException,
    WorkspaceMember,
    WorkspaceTask,
)

pytestmark = [pytest.mark.django_db, pytest.mark.contract]

TEHRAN = ZoneInfo("Asia/Tehran")
MON, TUE, WED, THU, FRI, SAT, SUN = range(7)
# Reference week (section 5): Sat 2026-11-14 … Sat 2026-11-21; Sunday 2026-11-15 is a public holiday.
SAT_D, SUN_D, MON_D, TUE_D, THU_D, SAT2_D = (
    date(2026, 11, 14),
    date(2026, 11, 15),
    date(2026, 11, 16),
    date(2026, 11, 17),
    date(2026, 11, 19),
    date(2026, 11, 21),
)


def at(day, hour, minute=0):
    return datetime.combine(day, time(hour, minute), tzinfo=TEHRAN)


def member(workspace, name):
    user = User.objects.create_user(email=f"{name}@example.test", username=name, password="SafePassword!2026")
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
    return user


@pytest.fixture
def assignee(workspace):
    """Sat–Wed 08–16 with 12–13 break, Thu 08–12, Fri off, Sunday 2026-11-15 a holiday."""
    user = member(workspace, "t5-assignee")
    schedule = WorkSchedule.objects.create(
        workspace=workspace, scope="person", user=user, effective_from=date(2026, 1, 1), reason="آزمون"
    )
    for weekday in range(7):
        if weekday == FRI:
            WorkScheduleDay.objects.create(schedule=schedule, weekday=weekday, is_working=False)
        elif weekday == THU:
            WorkScheduleDay.objects.create(
                schedule=schedule, weekday=weekday, is_working=True, start_time=time(8), end_time=time(12)
            )
        else:
            WorkScheduleDay.objects.create(
                schedule=schedule,
                weekday=weekday,
                is_working=True,
                start_time=time(8),
                end_time=time(16),
                breaks=[{"start": "12:00", "end": "13:00"}],
            )
    WorkScheduleException.objects.create(
        workspace=workspace, user=user, date_from=SUN_D, date_to=SUN_D, is_working=False, reason="تعطیلی رسمی"
    )
    return user


# ------------------------------------------------------------------ section 5 calendar table


@pytest.mark.parametrize(
    "start, minutes, expected",
    [
        (at(SAT_D, 10), 8 * 60, at(MON_D, 11)),  # holiday Sunday skipped
        (at(MON_D, 11, 30), 2 * 60, at(MON_D, 14, 30)),  # crosses the break
        (at(MON_D, 18), 60, at(TUE_D, 9)),  # starts outside working hours
        (at(THU_D, 11), 2 * 60, at(SAT2_D, 9)),  # short Thursday + Friday off
    ],
)
def test_add_working_time_matches_reference_table(workspace, assignee, start, minutes, expected):
    assert add_working_time(assignee, start, minutes, workspace) == expected
    assert working_minutes_between(assignee, start, expected, workspace) == minutes


def test_add_working_time_does_not_skip_planned_work_events(workspace, assignee):
    """Current behavior (differs from section 5 row 5): events are busy in availability() only."""
    event = WorkEvent.objects.create(
        workspace=workspace,
        kind="meeting",
        title="جلسه",
        starts_at=at(MON_D, 9),
        ends_at=at(MON_D, 10),
        status=WorkEvent.Status.PLANNED,
    )
    WorkEventParticipant.objects.create(event=event, user=assignee)
    assert add_working_time(assignee, at(MON_D, 8), 2 * 60, workspace) == at(MON_D, 10)
    reasons = [row["reason"] for row in availability(assignee, at(MON_D, 8), at(MON_D, 11), workspace)]
    assert reasons == ["schedule", "event", "schedule"]


# ------------------------------------------------------------------ status mapping


def test_task_status_group_mapping_has_no_cancelled_or_backlog():
    assert STATE_GROUPS == {
        "todo": "unstarted",
        "in_progress": "started",
        "review": "started",
        "blocked": "started",
        "done": "completed",
    }
    assert set(WorkspaceTask.Status.values) == set(STATE_GROUPS)


# ------------------------------------------------------------------ data model gaps


def test_issue_has_due_date_and_estimate_and_now_a_single_target_duration():
    """Before ticket 5: no target columns (gap). After: one additive set on Issue (decision 1)."""
    names = {f.name for f in Issue._meta.get_fields()}
    assert {"target_date", "estimate_point", "parent", "priority", "created_by"} <= names
    assert {"target_minutes", "target_at", "target_started_at"} <= names


def test_routing_rule_keeps_unit_and_role_and_gains_criteria_additively():
    """Before ticket 5: only unit + role, ordered by name, queue needs a rule (gap). After: same table, extended."""
    names = {f.name for f in TicketRoutingRule._meta.concrete_fields}
    assert {"unit", "required_role", "is_active", "name"} <= names
    assert {"position", "method", "conditions", "cursor", "target_user", "member_ids"} <= names
    assert TicketRoutingRule._meta.ordering == ("position", "name")
    assert TicketRoleQueueEntry._meta.get_field("rule").null is True
    assert {"assigned", "queued"} <= set(TicketRoutingDecision.Outcome.values)
    assert {"reason", "details"} <= {f.name for f in TicketRoutingDecision._meta.concrete_fields}


# ------------------------------------------------------------------ routing behavior


def _rule(workspace, manager):
    role = OrganizationRole.objects.create(workspace=workspace, name="Support lead")
    UserOrganizationRole.objects.create(workspace=workspace, user=manager, role=role)
    unit = OrganizationUnit.objects.create(workspace=workspace, title="Support", manager=manager)
    return TicketRoutingRule.objects.create(workspace=workspace, name="Support", unit=unit, required_role=role)


def _standalone(workspace, creator, name="ticket"):
    return WorkspaceTask.objects.create(workspace=workspace, name=name, created_by=creator, sequence_id=1)


def _project_ticket(workspace, name):
    project = Project.objects.filter(workspace=workspace, identifier="TFV").first() or Project.objects.create(
        workspace=workspace, name="T5", identifier="TFV"
    )
    state = State.objects.filter(project=project).first() or State.objects.create(
        workspace=workspace, project=project, name="Todo", group="unstarted", color="#999999", default=True
    )
    return Issue.objects.create(project=project, state=state, name=name)


def test_routing_sends_every_ticket_to_the_same_unit_manager(workspace):
    manager = member(workspace, "t5-lead")
    rule = _rule(workspace, manager)
    first = TicketRoutingService.route(_project_ticket(workspace, "a"), rule)
    second = TicketRoutingService.route(_project_ticket(workspace, "b"), rule)
    assert first.assigned_user == second.assigned_user == manager  # no round-robin / workload


def test_routing_a_project_less_ticket_to_a_person_now_works(workspace, create_user):
    """Was an IntegrityError before ticket 5 (IssueSubscriber.project_id NULL); fixed in crm_notifications."""
    lead = member(workspace, "t5-lead-2")
    rule = _rule(workspace, lead)
    ticket = _standalone(workspace, create_user)
    assert TicketRoutingService.route(ticket, rule).assigned_user == lead


def test_routing_absent_manager_without_delegate_goes_to_role_queue(workspace, create_user):
    manager = member(workspace, "t5-absent-lead")
    rule = _rule(workspace, manager)
    UserAbsence.objects.create(
        workspace=workspace,
        user=manager,
        starts_at=datetime(2020, 1, 1, tzinfo=TEHRAN),
        ends_at=datetime(2099, 1, 1, tzinfo=TEHRAN),
        status="scheduled",
    )
    ticket = _standalone(workspace, create_user)
    decision = TicketRoutingService.route(ticket, rule)
    assert decision.outcome == TicketRoutingDecision.Outcome.QUEUED
    assert TicketRoleQueueEntry.objects.filter(issue=ticket, rule=rule, status="open").exists()
    assert not IssueAssignee.objects.filter(issue=ticket).exists()


# ------------------------------------------------------------------ assignment policy


def test_non_admin_cannot_assign_work_to_self(workspace):
    user = member(workspace, "t5-self")
    with pytest.raises(ValidationError):
        validate_other_assignees(user, workspace.slug, [user.id])
    validate_other_assignees(user, workspace.slug, [member(workspace, "t5-other").id])


# ------------------------------------------------------------------ visibility (ticket 4 open item)


def test_direct_manager_of_assignee_cannot_see_ticket_without_view_all(workspace, create_user, assignee):
    manager = member(workspace, "t5-manager")
    unit = OrganizationUnit.objects.create(workspace=workspace, title="Ops", manager=manager)
    OrganizationUnitMember.objects.create(unit=unit, user=assignee)
    _, direct, _ = managers_of(assignee, workspace)
    assert direct[0] == manager.id

    ticket = WorkspaceTask.objects.create(
        workspace=workspace, name="private", created_by=create_user, assignee=assignee, sequence_id=1
    )
    rows = Issue.objects.filter(workspace=workspace)
    assert ticket.id in set(visible_issues(rows, assignee, workspace.slug).values_list("id", flat=True))
    assert ticket.id not in set(visible_issues(rows, manager, workspace.slug).values_list("id", flat=True))
