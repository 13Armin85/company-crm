"""Ticket 5 — ticket core and routing (section 8.1 of the ticket)."""

import importlib
import threading
from datetime import date, datetime, time, timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest
from django.db import connection, migrations
from django.utils import timezone
from rest_framework.test import APIClient

from plane.app.services import ticket_core as core
from plane.app.services.entity_schema import initialize_engine
from plane.app.services.permission_registry import sync_permission_catalog
from plane.app.services.ticket_routing import TicketRoutingService, shadowed_rules
from plane.app.services.work_calendar import add_working_time
from plane.db.models import (
    ActivityConfirmation,
    EntityEvent,
    EntityRecord,
    EntityRelation,
    EntityRelationLink,
    EntityType,
    FieldDefinition,
    Issue,
    IssueAssignee,
    IssueType,
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
    State,
    TicketRoleQueueEntry,
    TicketRoutingDecision,
    TicketRoutingRule,
    User,
    UserAbsence,
    UserOrganizationRole,
    WorkflowDelayReport,
    WorkflowExtension,
    WorkSchedule,
    WorkScheduleDay,
    WorkScheduleException,
    WorkspaceMember,
)

pytestmark = [pytest.mark.django_db, pytest.mark.contract]

TEHRAN = ZoneInfo("Asia/Tehran")
MON, TUE, WED, THU, FRI, SAT, SUN = range(7)
SAT_D, SUN_D, MON_D, TUE_D, THU_D, SAT2_D = (
    date(2026, 11, 14),
    date(2026, 11, 15),
    date(2026, 11, 16),
    date(2026, 11, 17),
    date(2026, 11, 19),
    date(2026, 11, 21),
)
MEMBER = ["Issue.View", "Issue.Create", "Issue.Edit", "Issue.Status.Edit", "Issue.Assign", "Routing.View"]


def at(day, hour, minute=0):
    return datetime.combine(day, time(hour, minute), tzinfo=TEHRAN)


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


def grant(user, *codes):
    role = OrganizationRole.objects.get(name=f"role-{user.username}")
    for permission in OrganizationPermission.objects.filter(workspace=role.workspace, code__in=codes):
        RolePermission.objects.get_or_create(role=role, permission=permission)


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def schedule(workspace, user):
    """Sat–Wed 08–16 with 12–13 break, Thu 08–12, Fri off, Sunday 2026-11-15 a holiday."""
    row = WorkSchedule.objects.create(
        workspace=workspace, scope="person", user=user, effective_from=date(2026, 1, 1), reason="آزمون"
    )
    for weekday in range(7):
        if weekday == FRI:
            WorkScheduleDay.objects.create(schedule=row, weekday=weekday, is_working=False)
        elif weekday == THU:
            WorkScheduleDay.objects.create(
                schedule=row, weekday=weekday, is_working=True, start_time=time(8), end_time=time(12)
            )
        else:
            WorkScheduleDay.objects.create(
                schedule=row,
                weekday=weekday,
                is_working=True,
                start_time=time(8),
                end_time=time(16),
                breaks=[{"start": "12:00", "end": "13:00"}],
            )
    WorkScheduleException.objects.create(
        workspace=workspace, user=user, date_from=SUN_D, date_to=SUN_D, is_working=False, reason="تعطیلی رسمی"
    )
    return row


@pytest.fixture
def org(workspace, create_user):
    initialize_engine(workspace)
    sync_permission_catalog(workspace)
    upper = person(workspace, "upper")
    manager = person(workspace, "manager", MEMBER + ["Ticket.TargetSet"])
    employee = person(workspace, "employee")
    colleague = person(workspace, "colleague")
    outsider = person(workspace, "outsider")
    delegate = person(workspace, "delegate")
    department = OrganizationUnit.objects.create(workspace=workspace, title="معاونت", manager=upper)
    team = OrganizationUnit.objects.create(workspace=workspace, title="تیم پشتیبانی", manager=manager, parent=department)
    for user in (employee, colleague, delegate):
        OrganizationUnitMember.objects.create(unit=team, user=user)
    schedule(workspace, employee)
    return {
        "workspace": workspace,
        "admin": create_user,
        "upper": upper,
        "manager": manager,
        "employee": employee,
        "colleague": colleague,
        "outsider": outsider,
        "delegate": delegate,
        "team": team,
        "department": department,
    }


def ticket(org, assignee=None, creator=None, name="تیکت آزمون", **extra):
    issue = Issue(workspace=org["workspace"], name=name, **extra)
    issue.save(created_by_id=(creator or org["colleague"]).id)
    if assignee:
        IssueAssignee.objects.create(issue=issue, assignee=assignee, workspace=org["workspace"], project=None)
    return issue


def move(issue, status, now):
    issue = Issue.objects.select_related("state", "workspace").get(id=issue.id)
    with patch("django.utils.timezone.now", return_value=now):
        issue.status = status
        issue.save()
    return Issue.objects.select_related("state", "workspace").get(id=issue.id)


def typed(org, minutes=480):
    return IssueType.objects.create(workspace=org["workspace"], name=f"پشتیبانی {minutes}", target_minutes=minutes)


def started(org, start, minutes=480, assignee="employee"):
    issue = ticket(org, org[assignee], type=typed(org, minutes))
    return move(issue, "in_progress", start)


def events(issue, kind):
    return list(EntityEvent.objects.filter(record_id=issue.id, event_type=kind).order_by("created_at"))


# ---------------------------------------------------------------- 1. additive data model


def test_migration_is_additive_and_creates_no_ticket_table():
    module = importlib.import_module("plane.db.migrations.0158_ticket_five_core")
    kinds = {type(op) for op in module.Migration.operations}
    assert kinds <= {migrations.AddField, migrations.AlterField, migrations.AlterModelOptions, migrations.AddConstraint}
    for op in module.Migration.operations:
        if isinstance(op, migrations.AlterField):
            # Only relaxing NOT NULL, adding choices; nothing becomes stricter.
            assert op.field.null or op.name in {"outcome", "scope"}, op.name
    tables = set(connection.introspection.table_names())
    assert not {t for t in tables if "ticket" in t} - {
        "ticket_routing_rules",
        "ticket_routing_decisions",
        "ticket_role_queue_entries",
    }


def test_existing_rows_keep_their_data_and_defaults(org):
    issue = ticket(org, org["employee"])
    assert issue.target_minutes is None and issue.target_at is None and issue.target_calendar == {}
    rule = TicketRoutingRule.objects.create(
        workspace=org["workspace"], name="قدیمی", unit=org["team"], required_role=OrganizationRole.objects.first()
    )
    assert rule.method == "manager" and rule.conditions == {} and rule.position == 0


# ---------------------------------------------------------------- 2. numbers stay stable


def test_numbers_survive_edit_type_change_close_and_reopen(org):
    issue = ticket(org, org["employee"])
    sequence = issue.sequence_id
    record = EntityRecord.objects.filter(source_id=issue.id).first()
    number = record.number if record else None
    other = typed(org, 60)
    issue = move(issue, "in_progress", at(MON_D, 9))
    issue.name, issue.type = "عنوان تازه", other
    issue.save()
    issue = move(issue, "done", at(MON_D, 10))
    issue = move(issue, "todo", at(MON_D, 11))
    issue.refresh_from_db()
    assert issue.sequence_id == sequence
    if record:
        record.refresh_from_db()
        assert record.number == number


# ---------------------------------------------------------------- 3. section 5 reference table


@pytest.mark.parametrize(
    "start, minutes, expected",
    [
        (at(SAT_D, 10), 8 * 60, at(MON_D, 11)),
        (at(MON_D, 11, 30), 2 * 60, at(MON_D, 14, 30)),
        (at(MON_D, 18), 60, at(TUE_D, 9)),
        (at(THU_D, 11), 2 * 60, at(SAT2_D, 9)),
    ],
)
def test_deadline_follows_the_assignee_calendar(org, start, minutes, expected):
    issue = started(org, start, minutes)
    assert issue.target_started_at == start
    assert issue.target_at == expected
    assert issue.target_calendar["source"] in {"person", "exception"}
    assert issue.target_calendar["user_id"] == str(org["employee"].id)


def test_stored_deadline_does_not_move_when_the_calendar_changes(org):
    issue = started(org, at(SAT_D, 10))
    WorkScheduleException.objects.create(
        workspace=org["workspace"], user=org["employee"], date_from=MON_D, date_to=MON_D, is_working=False, reason="x"
    )
    issue.refresh_from_db()
    assert issue.target_at == at(MON_D, 11)


# ---------------------------------------------------------------- 4. start only on first "in progress"


def test_start_is_the_first_entry_into_in_progress_only(org):
    issue = ticket(org, org["employee"], type=typed(org, 480))
    issue = move(issue, "todo", at(SAT_D, 9))
    assert issue.target_started_at is None and issue.target_at is None
    issue = move(issue, "in_progress", at(SAT_D, 10))
    first_target = issue.target_at
    issue = move(issue, "review", at(SAT_D, 11))
    issue = move(issue, "blocked", at(SAT_D, 13))
    issue = move(issue, "todo", at(SAT_D, 14))
    issue = move(issue, "in_progress", at(SAT_D, 15))
    assert issue.target_started_at == at(SAT_D, 10)
    assert issue.target_at == first_target
    assert len(events(issue, "ticket.target_started")) == 1


def test_ticket_override_beats_type_default(org):
    issue = ticket(org, org["employee"], type=typed(org, 480), target_minutes=120)
    issue = move(issue, "in_progress", at(MON_D, 11, 30))
    assert issue.target_at == at(MON_D, 14, 30)


# ---------------------------------------------------------------- 5. changing the target


def target_url(org, issue):
    return f"/api/workspaces/{org['workspace'].slug}/tickets/{issue.id}/target/"


def test_changing_target_needs_permission_and_reason_and_keeps_history(org):
    issue = started(org, at(SAT_D, 10))
    IssueAssignee.objects.get_or_create(issue=issue, assignee=org["manager"], workspace=org["workspace"])
    denied = client_for(org["employee"]).post(target_url(org, issue), {"minutes": 600, "reason": "x"}, format="json")
    assert denied.status_code == 403
    missing = client_for(org["manager"]).post(target_url(org, issue), {"minutes": 600}, format="json")
    assert missing.status_code == 400
    ok = client_for(org["manager"]).post(
        target_url(org, issue), {"minutes": 600, "reason": "کار بزرگ‌تر شد"}, format="json"
    )
    assert ok.status_code == 200, ok.data
    issue.refresh_from_db()
    assert issue.target_at == add_working_time(org["employee"], at(SAT_D, 10), 600, org["workspace"])
    change = events(issue, "ticket.target_changed")[-1]
    assert change.before == 480 and change.after == 600
    assert change.metadata["reason"] == "کار بزرگ‌تر شد"
    assert change.metadata["target_before"].startswith("2026-11-16T11:00")


def test_type_default_target_needs_permission(org):
    native = typed(org, 60)
    url = f"/api/workspaces/{org['workspace'].slug}/ticket-types/{native.id}/target/"
    assert client_for(org["employee"]).post(url, {"minutes": 480, "reason": "x"}, format="json").status_code == 403
    response = client_for(org["manager"]).post(url, {"minutes": 480, "reason": "استاندارد"}, format="json")
    assert response.status_code == 200 and response.data["target_minutes"] == 480


# ---------------------------------------------------------------- 6. extensions


def ext_url(org, issue, suffix=""):
    return f"/api/workspaces/{org['workspace'].slug}/tickets/{issue.id}/extension/{suffix}"


def decide_url(org, row_id):
    return f"/api/workspaces/{org['workspace'].slug}/ticket-extensions/{row_id}/decide/"


def test_extension_lifecycle_pending_reject_approve(org):
    issue = started(org, at(SAT_D, 10))
    base = issue.target_at
    employee = client_for(org["employee"])
    preview = employee.post(ext_url(org, issue, "preview/"), {"minutes": 120}, format="json")
    assert preview.status_code == 200, preview.data
    assert preview.data["approver"]["id"] == str(org["manager"].id)
    first = employee.post(ext_url(org, issue), {"minutes": 120, "reason": "منتظر قطعه"}, format="json")
    assert first.status_code == 201, first.data
    issue.refresh_from_db()
    assert issue.target_at == base  # pending → unchanged
    second = employee.post(ext_url(org, issue), {"minutes": 60, "reason": "دوباره"}, format="json")
    assert second.status_code == 400  # one open request at a time
    rejected = client_for(org["manager"]).post(decide_url(org, first.data["id"]), {"approve": False}, format="json")
    assert rejected.status_code == 400  # reason mandatory for rejection
    rejected = client_for(org["manager"]).post(
        decide_url(org, first.data["id"]), {"approve": False, "reason": "اولویت ندارد"}, format="json"
    )
    assert rejected.status_code == 200
    issue.refresh_from_db()
    assert issue.target_at == base
    again = employee.post(ext_url(org, issue), {"minutes": 120, "reason": "منتظر قطعه"}, format="json")
    approved = client_for(org["manager"]).post(decide_url(org, again.data["id"]), {"approve": True}, format="json")
    assert approved.status_code == 200, approved.data
    issue.refresh_from_db()
    assert issue.target_at == add_working_time(org["employee"], base, 120, org["workspace"]) == at(MON_D, 13, 0) + timedelta(hours=1)
    kinds = [e.event_type for e in EntityEvent.objects.filter(record_id=issue.id).order_by("created_at")]
    assert kinds.count("ticket.extension_requested") == 2
    assert "ticket.extension_rejected" in kinds and "ticket.extension_approved" in kinds


def test_only_direct_manager_or_their_active_delegate_may_decide(org):
    issue = started(org, at(SAT_D, 10))
    row = core.request_extension(org["workspace"], org["employee"], issue.id, {"minutes": 60, "reason": "x"})
    for actor in (org["upper"], org["employee"], org["colleague"]):
        response = client_for(actor).post(decide_url(org, row.id), {"approve": True}, format="json")
        assert response.status_code == 403, actor.username
    OrganizationUnitDelegate.objects.create(unit=org["team"], user=org["delegate"])
    UserAbsence.objects.create(
        workspace=org["workspace"],
        user=org["manager"],
        starts_at=timezone.now() - timedelta(hours=1),
        ends_at=timezone.now() + timedelta(days=2),
        status="scheduled",
    )
    response = client_for(org["delegate"]).post(decide_url(org, row.id), {"approve": True}, format="json")
    assert response.status_code == 200, response.data


def test_absent_manager_without_delegate_blocks_the_request_with_a_message(org):
    issue = started(org, at(SAT_D, 10))
    UserAbsence.objects.create(
        workspace=org["workspace"],
        user=org["manager"],
        starts_at=timezone.now() - timedelta(hours=1),
        ends_at=timezone.now() + timedelta(days=2),
        status="scheduled",
    )
    response = client_for(org["employee"]).post(ext_url(org, issue), {"minutes": 60, "reason": "x"}, format="json")
    assert response.status_code == 400
    assert "جانشین" in str(response.data)


def test_approver_sees_the_ticket_read_only(org):
    issue = started(org, at(SAT_D, 10))
    core.request_extension(org["workspace"], org["employee"], issue.id, {"minutes": 60, "reason": "x"})
    rows = core.visible_ticket(org["workspace"], org["manager"], issue.id)
    assert rows.id == issue.id
    assert core.is_owner(issue, org["manager"]) is False
    path = f"/api/workspaces/{org['workspace'].slug}/engine/entities/ticket/records/{issue.id}/"
    detail = client_for(org["manager"]).get(path)
    assert detail.status_code == 200, detail.data
    # The manager is not an owner: no edit grant for this record.
    from plane.app.services.entity_records import record_edit_actions

    entity = EntityType.objects.get(workspace=org["workspace"], code="ticket", parent__isnull=True)
    assert record_edit_actions(entity, org["manager"], issue) == {"edit": False, "assign": False, "status": False}


# ---------------------------------------------------------------- 7. overdue


def test_overdue_flag_is_idempotent_never_closes_and_delay_report_keeps_deadline(org):
    issue = started(org, at(SAT_D, 10))
    later = at(MON_D, 12)
    before = Notification.objects.count()
    first = core.mark_overdue(now=later)
    second = core.mark_overdue(now=later + timedelta(minutes=5))
    assert first["flagged"] == 1 and second == {"flagged": 0, "reminded": 0}
    assert len(events(issue, "ticket.overdue_flagged")) == 1
    assert Notification.objects.count() - before == 2  # assignee + direct manager, once
    issue.refresh_from_db()
    assert issue.status == "in_progress" and core.category_of(issue) == core.IN_PROGRESS
    report = core.delay_report(
        org["workspace"],
        org["employee"],
        issue.id,
        {"reason": "قطعه نرسید", "progress": "۸۰٪", "expected_at": at(TUE_D, 15).isoformat()},
        now=later,
    )
    issue.refresh_from_db()
    assert issue.target_at == at(MON_D, 11)  # an estimate never moves the official deadline
    assert report.issue_id == issue.id and report.step_run_id is None
    # daily reminder only while no report explains this deadline
    assert core.mark_overdue(now=later + timedelta(days=2)) == {"flagged": 0, "reminded": 0}


def test_overdue_filter_and_payload(org):
    issue = started(org, at(SAT_D, 10))
    payload = core.deadline_payload(issue, org["employee"], now=at(MON_D, 14))
    assert payload["state"] == "overdue" and payload["overdue_minutes"] == 120
    assert payload["can"]["report_delay"] and payload["delay_report_needed"]
    rows = Issue.objects.filter(workspace=org["workspace"])
    assert issue.id in set(core.preset_filter(rows, "overdue", org["employee"], now=at(MON_D, 14)).values_list("id", flat=True))
    near = core.deadline_payload(issue, org["employee"], now=at(MON_D, 10))
    assert near["state"] == "near_due" and near["remaining_minutes"] == 60


# ---------------------------------------------------------------- 8. no attendance data


def test_extensions_and_delays_create_no_presence_rows(org):
    presence, confirmations = PresenceDeclaration.objects.count(), ActivityConfirmation.objects.count()
    issue = started(org, at(SAT_D, 10))
    row = core.request_extension(org["workspace"], org["employee"], issue.id, {"minutes": 60, "reason": "x"})
    core.decide_extension(org["workspace"], org["manager"], row.id, {"approve": True})
    core.mark_overdue(now=at(TUE_D, 15))
    core.delay_report(
        org["workspace"], org["employee"], issue.id,
        {"reason": "x", "progress": "y", "expected_at": at(SAT2_D, 10).isoformat()}, now=at(TUE_D, 15),
    )
    assert PresenceDeclaration.objects.count() == presence
    assert ActivityConfirmation.objects.count() == confirmations


# ---------------------------------------------------------------- 9. routing rules


def rule(org, name, method, position, **extra):
    return TicketRoutingRule.objects.create(
        workspace=org["workspace"], name=name, method=method, position=position, **extra
    )


def test_first_matching_rule_by_position_wins_and_shadowing_is_reported(org):
    catch_all = rule(org, "همه", "user", 2, target_user=org["colleague"])
    urgent = rule(org, "فوری", "user", 1, target_user=org["delegate"], conditions={"priorities": ["urgent"]})
    issue = ticket(org, priority="urgent")
    decision = TicketRoutingService.route_auto(issue)
    assert decision.rule == urgent and decision.assigned_user == org["delegate"]
    assert "فوری" in decision.reason
    other = ticket(org, priority="low")
    assert TicketRoutingService.route_auto(other).rule == catch_all
    rule(org, "هرگز", "user", 3, target_user=org["employee"])
    assert list(shadowed_rules(org["workspace"].id).values()) == ["همه"]


def test_each_criterion(org):
    native = typed(org, 60)
    project = Project.objects.create(workspace=org["workspace"], name="پ", identifier="TFP")
    state = State.objects.create(workspace=org["workspace"], project=project, name="Todo", group="unstarted", color="#999999", default=True)
    ProjectMember.objects.create(project=project, member=org["colleague"], role=15)
    by_type = rule(org, "نوع", "user", 1, target_user=org["colleague"], conditions={"type_ids": [str(native.id)]})
    by_project = rule(org, "پروژه", "user", 2, target_user=org["colleague"], conditions={"project_ids": [str(project.id)]})
    by_unit = rule(org, "واحد", "user", 3, target_user=org["colleague"], conditions={"unit_ids": [str(org["department"].id)]})
    customer_id = "4b9f4d1c-3c2e-4c55-9a52-1d6f1c2f9a10"
    by_customer = rule(org, "مشتری", "user", 4, target_user=org["colleague"], conditions={"customer_ids": [customer_id]})
    assert TicketRoutingService.select_rule(ticket(org, type=native))[0] == by_type
    project_issue = Issue.objects.create(project=project, state=state, name="p")
    assert TicketRoutingService.select_rule(project_issue)[0] == by_project
    # requester in a sub-unit of the listed unit
    assert TicketRoutingService.select_rule(ticket(org, creator=org["employee"]))[0] == by_unit
    outside = ticket(org, creator=org["outsider"])
    assert TicketRoutingService.select_rule(outside)[0] is None
    entity = EntityType.objects.get(workspace=org["workspace"], code="ticket", parent__isnull=True)
    left = FieldDefinition.objects.create(workspace=org["workspace"], code="t5_customer", title="مشتری", kind="relation")
    right = FieldDefinition.objects.create(workspace=org["workspace"], code="t5_tickets", title="تیکت‌ها", kind="relation")
    relation = EntityRelation.objects.create(
        left_entity=entity, right_entity=entity, left_field=left, right_field=right, kind="many_to_many"
    )
    EntityRelationLink.objects.create(relation=relation, left_id=outside.id, right_id=customer_id)
    matched, skipped = TicketRoutingService.select_rule(outside)
    assert matched == by_customer
    assert {"rule": "نوع", "failed": ["نوع"]} in skipped


def test_group_method_queues_for_the_role(org):
    role = OrganizationRole.objects.create(workspace=org["workspace"], name="پشتیبان")
    group = rule(org, "گروه", "group", 1, required_role=role)
    issue = ticket(org)
    decision = TicketRoutingService.route_auto(issue)
    assert decision.outcome == "queued"
    entry = TicketRoleQueueEntry.objects.get(issue=issue, status="open")
    assert entry.rule == group and entry.required_role == role


def test_round_robin_and_least_loaded(org):
    pool = [str(org["colleague"].id), str(org["delegate"].id)]
    rr = rule(org, "نوبتی", "round_robin", 1, member_ids=pool)
    picks = [TicketRoutingService.route_auto(ticket(org, name=f"t{i}")).assigned_user_id for i in range(3)]
    expected = sorted(pool)
    assert [str(p) for p in picks] == [expected[0], expected[1], expected[0]]
    rr.is_active = False
    rr.save()
    rule(org, "کم‌بار", "least_loaded", 2, member_ids=pool)
    load = TicketRoutingService.open_load(org["workspace"].id, pool)
    lighter = min(pool, key=lambda uid: (load[uid], sorted(pool).index(uid)))
    assert str(TicketRoutingService.route_auto(ticket(org)).assigned_user_id) == lighter
    # closed tickets do not count as load
    for row in IssueAssignee.objects.filter(assignee_id=lighter):
        move(row.issue, "done", timezone.now())
    load = TicketRoutingService.open_load(org["workspace"].id, pool)
    assert load[lighter] == 0


def test_absent_person_is_replaced_by_delegate_and_all_absent_goes_unassigned(org):
    OrganizationUnitDelegate.objects.create(unit=org["team"], user=org["delegate"])
    window = {"starts_at": timezone.now() - timedelta(hours=1), "ends_at": timezone.now() + timedelta(days=1)}
    UserAbsence.objects.create(workspace=org["workspace"], user=org["manager"], status="scheduled", **window)
    fixed = rule(org, "مدیر ثابت", "user", 1, target_user=org["manager"])
    decision = TicketRoutingService.route_auto(ticket(org))
    assert decision.assigned_user == org["delegate"]
    assert "جانشین" in decision.reason and "غایب" in decision.reason
    fixed.is_active = False
    fixed.save()
    pool = [str(org["colleague"].id), str(org["employee"].id)]
    rule(org, "نوبتی", "round_robin", 2, member_ids=pool)
    for user in (org["colleague"], org["employee"]):
        UserAbsence.objects.create(workspace=org["workspace"], user=user, status="scheduled", **window)
    grant(org["upper"], "Routing.Queue.ViewAll")
    before = Notification.objects.filter(receiver=org["upper"]).count()
    issue = ticket(org)
    decision = TicketRoutingService.route_auto(issue)
    assert decision.outcome == "queued" and decision.assigned_user is None
    assert "غایب" in decision.reason
    assert TicketRoleQueueEntry.objects.filter(issue=issue, rule__isnull=True, status="open").exists()
    assert Notification.objects.filter(receiver=org["upper"]).count() == before + 1
    rows = Issue.objects.filter(workspace=org["workspace"])
    assert issue.id in set(core.preset_filter(rows, "unassigned", org["upper"]).values_list("id", flat=True))


def test_no_matching_rule_leaves_ticket_unassigned_and_preview_writes_nothing(org):
    issue = ticket(org)
    rule(org, "فقط فوری", "user", 1, target_user=org["colleague"], conditions={"priorities": ["urgent"]})
    preview = TicketRoutingService.preview(issue)
    assert preview["rule"] is None and preview["queued"]
    assert not TicketRoutingDecision.objects.filter(issue=issue).exists()
    assert TicketRoutingService.route_auto(issue).outcome == "queued"


def test_project_less_ticket_can_be_routed_to_a_person(org):
    """Fixed defect: notification subscription no longer writes issue_subscribers with project NULL."""
    rule(org, "ثابت", "user", 1, target_user=org["colleague"])
    decision = TicketRoutingService.route_auto(ticket(org, creator=org["employee"]))
    assert decision.assigned_user == org["colleague"]


@pytest.mark.django_db(transaction=True)
def test_round_robin_is_safe_under_concurrency(workspace, create_user):
    initialize_engine(workspace)
    sync_permission_catalog(workspace)
    people = [person(workspace, f"rr{i}") for i in range(2)]
    TicketRoutingRule.objects.create(
        workspace=workspace, name="نوبتی", method="round_robin", position=1, member_ids=[str(p.id) for p in people]
    )
    issues = []
    for i in range(2):
        issue = Issue(workspace=workspace, name=f"c{i}")
        issue.save(created_by_id=create_user.id)
        issues.append(issue)
    barrier = threading.Barrier(2)
    results, errors = [], []

    def run(issue):
        try:
            barrier.wait()
            results.append(TicketRoutingService.route_auto(Issue.objects.get(id=issue.id)).assigned_user_id)
        except Exception as exc:  # pragma: no cover - surfaced below
            errors.append(exc)
        finally:
            connection.close()

    threads = [threading.Thread(target=run, args=(issue,)) for issue in issues]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors
    assert len(set(results)) == 2


# ---------------------------------------------------------------- 10. manual referral


def refer_url(org, issue, suffix="refer/"):
    return f"/api/workspaces/{org['workspace'].slug}/tickets/{issue.id}/{suffix}"


def test_referral_chain_reject_forward_accept(org):
    issue = ticket(org, org["employee"])
    employee = client_for(org["employee"])
    assert employee.post(refer_url(org, issue), {"user_id": str(org["colleague"].id)}, format="json").status_code == 400
    sent = employee.post(
        refer_url(org, issue), {"user_id": str(org["colleague"].id), "reason": "تخصص دارد"}, format="json"
    )
    assert sent.status_code == 201, sent.data
    assert list(IssueAssignee.objects.filter(issue=issue).values_list("assignee_id", flat=True)) == [org["colleague"].id]
    colleague = client_for(org["colleague"])
    no_reason = colleague.post(refer_url(org, issue, "referral/respond/"), {"action": "reject"}, format="json")
    assert no_reason.status_code == 400
    rejected = colleague.post(
        refer_url(org, issue, "referral/respond/"), {"action": "reject", "reason": "مربوط به من نیست"}, format="json"
    )
    assert rejected.status_code == 200, rejected.data
    assert list(IssueAssignee.objects.filter(issue=issue).values_list("assignee_id", flat=True)) == [org["employee"].id]
    employee.post(refer_url(org, issue), {"user_id": str(org["colleague"].id), "reason": "دوباره ببین"}, format="json")
    forwarded = colleague.post(
        refer_url(org, issue, "referral/respond/"),
        {"action": "forward", "user_id": str(org["delegate"].id), "reason": "همکارم بهتر است"},
        format="json",
    )
    assert forwarded.status_code == 200, forwarded.data
    outsider = client_for(org["outsider"]).post(refer_url(org, issue, "referral/respond/"), {"action": "accept"}, format="json")
    assert outsider.status_code in {403, 404}
    accepted = client_for(org["delegate"]).post(refer_url(org, issue, "referral/respond/"), {"action": "accept"}, format="json")
    assert accepted.status_code == 200, accepted.data
    chain = core.referral_chain(issue)
    assert [(row["to"], row["response"]) for row in chain] == [
        ("colleague", "rejected"),
        ("colleague", "forwarded"),
        ("delegate", "accepted"),
    ]
    kinds = [e.event_type for e in EntityEvent.objects.filter(record_id=issue.id).order_by("created_at")]
    assert kinds.count("ticket.referred") == 3 and "ticket.referral_rejected" in kinds


def test_referral_keeps_assignment_policy(org):
    issue = ticket(org, org["employee"])
    response = client_for(org["employee"]).post(
        refer_url(org, issue), {"user_id": str(org["employee"].id), "reason": "x"}, format="json"
    )
    assert response.status_code == 400  # cannot refer to oneself
    response = client_for(org["outsider"]).post(
        refer_url(org, issue), {"user_id": str(org["colleague"].id), "reason": "x"}, format="json"
    )
    assert response.status_code == 404  # cannot see it


# ---------------------------------------------------------------- 11. first-contact resolution


def contact(org, issue, resolved):
    return client_for(org["employee"]).post(
        refer_url(org, issue, "contact/"),
        {"channel": "phone", "contact_name": "آقای مشتری", "summary": "راهنمایی تلفنی", "resolved": resolved},
        format="json",
    )


def test_contact_resolved_closes_and_unresolved_routes(org):
    solved = ticket(org, org["employee"])
    tables = set(connection.introspection.table_names())
    response = contact(org, solved, True)
    assert response.status_code == 201, response.data
    solved.refresh_from_db()
    assert solved.status == "done"
    event = events(solved, "ticket.contact")[0]
    assert event.metadata["contact"]["channel_title"] and event.metadata["contact"]["resolved"] is True
    assert events(solved, "ticket.closed")
    rule(org, "ثابت", "user", 1, target_user=org["colleague"])
    open_one = ticket(org, org["employee"])
    response = contact(org, open_one, False)
    assert response.status_code == 201 and response.data["routed"]["outcome"] == "assigned"
    open_one.refresh_from_db()
    assert open_one.status != "done"
    assert set(connection.introspection.table_names()) == tables


# ---------------------------------------------------------------- 12. visibility


def test_unauthorized_user_sees_the_ticket_nowhere(org, monkeypatch, tmp_path):
    hidden = ticket(org, org["employee"], name="تیکت محرمانهٔ ۵")
    hidden.priority = "urgent"
    hidden.save()
    outsider = client_for(org["outsider"])
    base = f"/api/workspaces/{org['workspace'].slug}/engine/entities/ticket/"
    spec = {"version": 1, "type": "table", "columns": [{"field": "title", "width": 180}], "sort": []}
    listing = outsider.post(base + "query/", {"definition": spec}, format="json")
    assert listing.status_code == 200 and "محرمانه" not in str(listing.data["results"])
    assert listing.data["preset_counts"]["all"] == 0
    search = outsider.post(base + "query/", {"definition": spec, "search": "محرمانه"}, format="json")
    assert search.status_code == 200 and search.data["results"] == []
    kanban = outsider.post(base + "query/", {"definition": {**spec, "type": "kanban"}}, format="json")
    assert "محرمانه" not in str(kanban.data)
    assert outsider.get(base + f"records/{hidden.id}/").status_code in {403, 404}
    for suffix in ("core/", "history/"):
        assert outsider.get(f"/api/workspaces/{org['workspace'].slug}/tickets/{hidden.id}/{suffix}").status_code == 404
    from django.core.files.storage import FileSystemStorage
    from plane.app.services.entity_view_export import build_entity_export
    from plane.db.models import EntityViewExport, FileAsset

    grant(org["outsider"], "Export.Data")
    monkeypatch.setattr(FileAsset._meta.get_field("asset"), "storage", FileSystemStorage(location=tmp_path))
    monkeypatch.setattr(build_entity_export, "delay", lambda identifier: None)
    job = outsider.post(base + "exports/", {"format": "csv", "definition": spec}, format="json")
    assert job.status_code == 202, job.data
    build_entity_export.run(job.data["id"])
    content = EntityViewExport.objects.get(id=job.data["id"]).asset.asset.read().decode("utf-8-sig")
    assert "محرمانه" not in content
    widget = {"type": "chart", "config": {"entity": "ticket", "group_by": "priority"}}
    data = outsider.post(f"/api/workspaces/{org['workspace'].slug}/dashboard/widgets/data/", {"widget": widget}, format="json")
    assert data.status_code == 200, data.data
    assert "محرمانه" not in str(data.data)
    assert sum(point["value"] for point in data.data.get("points", [])) == 0


# ---------------------------------------------------------------- 13. close and reopen


def test_close_reopen_keeps_history_category_and_continues_remaining_time(org):
    issue = started(org, at(SAT_D, 10))  # deadline Mon 11:00, 8h budget
    issue = move(issue, "done", at(SAT_D, 12))  # 2h used → 6h left
    assert issue.target_anchor_at is None and issue.target_anchor_minutes == 360
    assert core.category_of(issue) == core.DONE
    rows = Issue.objects.filter(workspace=org["workspace"])
    assert issue.id in set(core.preset_filter(rows, "closed", org["employee"]).values_list("id", flat=True))
    closed = core.deadline_payload(issue, org["employee"], now=at(SAT_D, 13))
    assert closed["state"] == "closed" and closed["spent_minutes"] == 120
    issue = move(issue, "todo", at(MON_D, 8))
    assert events(issue, "ticket.reopened")
    issue = move(issue, "in_progress", at(MON_D, 9))
    assert issue.target_at == at(MON_D, 16)  # 6 working hours from Monday 09:00 with the lunch break
    kinds = [e.event_type for e in EntityEvent.objects.filter(record_id=issue.id).order_by("created_at")]
    for kind in ("ticket.target_started", "ticket.closed", "ticket.reopened", "ticket.target_restarted"):
        assert kind in kinds
    assert issue.target_started_at == at(SAT_D, 10)


def test_status_category_mapping_is_single_and_explicit():
    assert core.work_category(group="backlog") == core.TODO
    assert core.work_category(group="unstarted") == core.TODO
    assert core.work_category(group="started") == core.IN_PROGRESS
    assert core.work_category(group="completed") == core.DONE
    assert core.work_category(group="cancelled") == core.DONE
    for status, category in {"todo": "todo", "in_progress": "in_progress", "review": "in_progress", "blocked": "in_progress", "done": "done"}.items():
        assert core.work_category(status=status, project=False) == category


def test_cancelled_project_ticket_counts_as_closed(org):
    project = Project.objects.create(workspace=org["workspace"], name="پ", identifier="TFC")
    cancelled = State.objects.create(workspace=org["workspace"], project=project, name="لغو", group="cancelled", color="#999999")
    issue = Issue.objects.create(project=project, state=cancelled, name="c")
    assert core.category_of(issue) == core.DONE
    annotated = Issue.objects.filter(id=issue.id).annotate(category=core.category_expression()).get()
    assert annotated.category == core.DONE


def test_card_endpoint_reports_state_and_permissions(org):
    issue = ticket(org, org["employee"])
    response = client_for(org["employee"]).get(f"/api/workspaces/{org['workspace'].slug}/tickets/{issue.id}/core/")
    assert response.status_code == 200, response.data
    assert response.data["deadline"]["state"] == "none"
    assert response.data["deadline"]["can"]["set_target"] is False
    assert response.data["deadline"]["can"]["request_extension"] is False
    assert response.data["deadline"]["why"]["request_extension"]


def test_advanced_condition_uses_the_shared_condition_language(org):
    expression = {"field": "priority", "op": "eq", "value": "high"}
    url = f"/api/workspaces/{org['workspace'].slug}/organization/routing-rules/"
    grant(org["manager"], "Routing.Manage")
    bad = client_for(org["manager"]).post(
        url,
        {"name": "بد", "method": "user", "target_user_id": str(org["colleague"].id), "conditions": {"expression": {"field": "nope", "op": "eq"}}},
        format="json",
    )
    assert bad.status_code == 400
    created = client_for(org["manager"]).post(
        url,
        {"name": "بالا", "method": "user", "target_user_id": str(org["colleague"].id), "position": 1, "conditions": {"expression": expression}},
        format="json",
    )
    assert created.status_code == 201, created.data
    assert TicketRoutingService.select_rule(ticket(org, priority="high"))[0].name == "بالا"
    assert TicketRoutingService.select_rule(ticket(org, priority="low"))[0] is None


def test_rule_order_endpoint_and_preview(org):
    grant(org["manager"], "Routing.Manage")
    first = rule(org, "الف", "user", 1, target_user=org["colleague"])
    second = rule(org, "ب", "user", 2, target_user=org["delegate"])
    client = client_for(org["manager"])
    base = f"/api/workspaces/{org['workspace'].slug}/organization/routing-rules/"
    assert client.post(base + "order/", {"ids": [str(first.id)]}, format="json").status_code == 400
    ordered = client.post(base + "order/", {"ids": [str(second.id), str(first.id)]}, format="json")
    assert ordered.status_code == 200 and ordered.data["shadowed"] == {str(first.id): "ب"}
    issue = ticket(org, org["manager"])
    preview = client.post(base + "preview/", {"issue_id": str(issue.id)}, format="json")
    assert preview.status_code == 200 and preview.data["rule"]["name"] == "ب"
    assert preview.data["user"]["name"] == "delegate"
    assert client_for(org["employee"]).post(base + "order/", {"ids": []}, format="json").status_code == 403


# ---------------------------------------------------------------- ن۱ parent/child and ن۱۱ field history


def test_parent_child_blocks_cycles_and_foreign_workspaces(org):
    from plane.db.models import Workspace

    parent = ticket(org, org["employee"], name="والد")
    child = ticket(org, org["employee"], name="فرزند")
    url = lambda issue: f"/api/workspaces/{org['workspace'].slug}/tickets/{issue.id}/parent/"  # noqa: E731
    client = client_for(org["employee"])
    ok = client.post(url(child), {"parent_id": str(parent.id)}, format="json")
    assert ok.status_code == 200, ok.data
    assert ok.data["details"]["parent"]["name"] == "والد"
    assert client.post(url(parent), {"parent_id": str(child.id)}, format="json").status_code == 400  # cycle
    assert client.post(url(parent), {"parent_id": str(parent.id)}, format="json").status_code == 400  # self
    other_ws = Workspace.objects.create(name="دیگر", slug="t5-other-ws", owner=org["admin"])
    foreign = Issue(workspace=other_ws, name="بیگانه")
    foreign.save(created_by_id=org["admin"].id)
    assert client.post(url(parent), {"parent_id": str(foreign.id)}, format="json").status_code == 400
    card = client.get(f"/api/workspaces/{org['workspace'].slug}/tickets/{parent.id}/core/").data
    assert [row["name"] for row in card["details"]["children"]] == ["فرزند"]
    assert card["details"]["creator"] == "colleague"
    change = events(child, "ticket.field_changed")[-1]
    assert change.field == "parent_id" and change.after == "والد"


def test_core_field_changes_are_in_history(org):
    issue = ticket(org, org["employee"], priority="low")
    native = typed(org, 60)
    issue.priority, issue.type, issue.target_date = "urgent", native, date(2026, 12, 1)
    issue.save()
    rows = {e.field: e for e in events(issue, "ticket.field_changed")}
    assert rows["priority"].before == "low" and rows["priority"].after == "urgent"
    assert rows["type_id"].after == native.name
    assert rows["target_date"].after == "2026-12-01"
    issue.save()  # no change → no duplicate rows
    assert len(events(issue, "ticket.field_changed")) == 3


def test_creating_a_ticket_with_auto_routing_through_the_engine_api(org):
    rule(org, "ثابت", "user", 1, target_user=org["delegate"])
    response = client_for(org["colleague"]).post(
        f"/api/workspaces/{org['workspace'].slug}/engine/entities/ticket/records/",
        {"values": {"title": "خودکار"}, "routing_rule_id": "auto"},
        format="json",
    )
    assert response.status_code == 201, response.data
    issue = Issue.objects.get(id=response.data["id"])
    assert list(IssueAssignee.objects.filter(issue=issue).values_list("assignee_id", flat=True)) == [org["delegate"].id]
    assert events(issue, "ticket.routed")


def test_all_work_table_has_presets_counts_and_deadlines(org):
    late = started(org, at(SAT_D, 10))
    plain = ticket(org, org["employee"], name="بی‌موعد")
    url = f"/api/workspaces/{org['workspace'].slug}/tasks/table/"
    client = client_for(org["employee"])
    with patch("django.utils.timezone.now", return_value=at(MON_D, 14)):
        everything = client.get(url, {"view": "mine", "tab": "all", "today": "2026-11-16"})
        overdue = client.get(url, {"view": "mine", "tab": "all", "today": "2026-11-16", "preset": "overdue"})
    assert everything.status_code == 200, everything.data
    counts = everything.data["preset_counts"]
    assert counts["all"] >= 2 and counts["overdue"] == 1 and counts["mine"] >= 2
    rows = {str(row["item"]["id"]): row for row in everything.data["results"]}
    assert len(rows) >= 2, (everything.data["count"], list(rows), str(late.id), str(plain.id))
    assert rows[str(late.id)]["deadline"]["state"] == "overdue"
    assert rows[str(plain.id)]["deadline"] is None
    assert [str(row["item"]["id"]) for row in overdue.data["results"]] == [str(late.id)]
    outsider = client_for(org["outsider"]).get(url, {"view": "all", "tab": "received", "preset": "overdue"})
    assert outsider.status_code == 200 and outsider.data["results"] == []


# ---------------------------------------------------------------- ن۶ one mapping in report, lists and card


def test_status_report_and_lists_use_the_single_category_mapping(org):
    todo = ticket(org, org["employee"], name="انجام‌نشده")
    doing = move(ticket(org, org["employee"], name="در جریان"), "in_progress", at(MON_D, 9))
    review = move(ticket(org, org["employee"], name="بازبینی"), "review", at(MON_D, 9))
    done = move(ticket(org, org["employee"], name="تمام"), "done", at(MON_D, 9))
    project = Project.objects.create(workspace=org["workspace"], name="پ", identifier="TFR")
    cancelled_state = State.objects.create(
        workspace=org["workspace"], project=project, name="لغو", group="cancelled", color="#999999"
    )
    Issue.objects.create(project=project, state=cancelled_state, name="لغوشده")
    widget = {"type": "chart", "config": {"entity": "ticket", "group_by": "__work_category__"}}
    response = client_for(org["admin"]).post(
        f"/api/workspaces/{org['workspace'].slug}/dashboard/widgets/data/", {"widget": widget}, format="json"
    )
    assert response.status_code == 200, response.data
    points = {point["label"]: point["value"] for point in response.data["points"]}
    assert points["in_progress"] >= 2 and points["done"] >= 2 and points["todo"] >= 1
    assert response.data["labels"] == {"todo": "انجام‌نشده", "in_progress": "در حال انجام", "done": "انجام‌شده"}
    table = client_for(org["employee"]).get(
        f"/api/workspaces/{org['workspace'].slug}/tasks/table/", {"view": "all", "tab": "history"}
    )
    categories = {str(row["item"]["id"]): row["category"] for row in table.data["results"]}
    assert categories[str(todo.id)] == "todo"
    assert categories[str(doing.id)] == "in_progress" and categories[str(review.id)] == "in_progress"
    assert categories[str(done.id)] == "done"


def test_card_has_status_menu_number_and_visible_customers_only(org):
    issue = ticket(org, org["employee"])
    url = f"/api/workspaces/{org['workspace'].slug}/tickets/{issue.id}/core/"
    data = client_for(org["employee"]).get(url).data
    status = data["status"]
    assert status["current"] == "todo" and status["category"] == "todo"
    assert {"todo", "in_progress", "done"} <= {row["id"] for row in status["options"]}
    assert all(row["category"] in {"todo", "in_progress", "done"} for row in status["options"])
    assert data["number"] and data["title"] == issue.name
    assert data["details"]["customers"] == []
    read_only = core.status_payload(issue, org["outsider"])
    assert read_only["can_change"] is False and read_only["why"]
