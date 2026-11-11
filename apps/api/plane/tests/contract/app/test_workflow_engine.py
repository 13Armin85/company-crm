"""Workflow engine: definitions, versions, steps, approvals, deadlines, fast path (ticket 4)."""

import json
import threading
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from django.db import connection, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from plane.app.services import workflow_actions as actions
from plane.app.services import workflow_engine as engine
from plane.app.services.access_control import can_manage_absence
from plane.app.services.entity_records import save_record
from plane.app.services.permission_registry import sync_permission_catalog
from plane.app.services.work_calendar import availability, busy_blocks
from plane.db.models import (
    EntityEvent,
    EntityRecord,
    EntityType,
    Issue,
    Notification,
    OrganizationPermission,
    OrganizationRole,
    OrganizationUnit,
    OrganizationUnitDelegate,
    OrganizationUnitMember,
    RolePermission,
    User,
    UserAbsence,
    UserOrganizationRole,
    WorkflowDecision,
    WorkflowDefinition,
    WorkflowInstance,
    WorkflowStepRun,
    WorkflowVersion,
    WorkSchedule,
    WorkScheduleDay,
    Workspace,
    WorkspaceMember,
)

pytestmark = [pytest.mark.django_db, pytest.mark.contract]

TEHRAN = ZoneInfo("Asia/Tehran")
MEMBER = ["Workflow.View", "Issue.View", "Issue.Create", "Issue.Status.Edit", "Issue.Assign"]


def tehran(*args):
    return datetime(*args, tzinfo=TEHRAN)


def fa(value):
    return json.dumps(value, ensure_ascii=False)


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


def grant(user, *codes):
    role = own_role(user)
    for permission in OrganizationPermission.objects.filter(workspace=role.workspace, code__in=codes):
        RolePermission.objects.get_or_create(role=role, permission=permission)


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def org(workspace, create_user):
    """employee, colleague ∈ team (manager) ⊂ department (upper) ⊂ root (top)."""
    sync_permission_catalog(workspace)
    top = person(workspace, "top")
    upper = person(workspace, "upper")
    manager = person(workspace, "manager")
    employee = person(workspace, "employee")
    colleague = person(workspace, "colleague")
    root = OrganizationUnit.objects.create(workspace=workspace, title="ستاد", manager=top)
    department = OrganizationUnit.objects.create(workspace=workspace, title="معاونت", manager=upper, parent=root)
    team = OrganizationUnit.objects.create(
        workspace=workspace, title="تیم پشتیبانی", manager=manager, parent=department
    )
    for user in (employee, colleague):
        OrganizationUnitMember.objects.create(unit=team, user=user)
    return {
        "workspace": workspace,
        "admin": create_user,
        "top": top,
        "upper": upper,
        "manager": manager,
        "employee": employee,
        "colleague": colleague,
        "team": team,
        "department": department,
    }


def url(workspace, suffix=""):
    return f"/api/workspaces/{workspace.slug}/workflows/{suffix}"


def entity(workspace, code="ticket"):
    return EntityType.objects.get(workspace=workspace, code=code, parent__isnull=True)


def step(code, title, kind="normal", status="in_progress", assignee=None, **extra):
    return {
        "code": code,
        "title": title,
        "type": kind,
        "status_code": status,
        "assignee": assignee or {"type": "subject"},
        **extra,
    }


def move(code, source, target, kind="advance", label=None, **extra):
    return {"code": code, "from": source, "to": target, "kind": kind, "label": label or code, **extra}


def approval_graph(**review):
    """ثبت ← تأیید مدیر مستقیم ← تأیید مدیر بالادست ← پایان، با رد و بازگشت."""
    return {
        "steps": [
            step("request", "ثبت درخواست", "start", "todo"),
            step(
                "review",
                "تأیید مدیر مستقیم",
                "approval",
                "review",
                {"type": "direct_manager"},
                target_minutes=120,
                pause={"customer": True},
                reminder={"type": "percent", "value": 50},
                **review,
            ),
            step("upper", "تأیید مدیر بالادست", "approval", "review", {"type": "upper_manager"}),
            step("done", "انجام شد", "end", "done", {"type": "none"}),
            step("rejected", "رد شد", "end", "blocked", {"type": "none"}),
        ],
        "transitions": [
            move("submit", "request", "review", label="ارسال"),
            move("approve", "review", "upper", "approve", "تأیید"),
            move("reject", "review", "rejected", "reject", "رد"),
            move("return", "review", "request", "return", "بازگشت برای اصلاح"),
            move("refer", "review", "review", "refer", "ارجاع"),
            move("final", "upper", "done", "approve", "تأیید نهایی"),
        ],
    }


def create_workflow(
    admin, workspace, graph=None, *, code="ticket", kind="standard", title="فرایند", settings=None, publish=True
):
    body = {"entity": code, "kind": kind, "title": title, "settings": settings or {}}
    response = client_for(admin).post(url(workspace, "definitions/"), body, format="json")
    assert response.status_code == 201, response.data
    version_id = response.data["versions"][0]["id"]
    if graph is not None:
        saved = client_for(admin).put(url(workspace, f"versions/{version_id}/"), {"graph": graph}, format="json")
        assert saved.status_code == 200, saved.data
    if publish:
        published = client_for(admin).post(url(workspace, f"versions/{version_id}/publish/"), {}, format="json")
        assert published.status_code == 200, published.data
    return WorkflowDefinition.objects.get(id=response.data["id"]), WorkflowVersion.objects.get(id=version_id)


def ticket(workspace, owner, name="درخواست پشتیبانی"):
    issue = Issue(workspace=workspace, name=name)
    issue.save(created_by_id=owner.id)
    return issue


def start(workspace, record, actor, code="ticket", kind=None, now=None):
    target = entity(workspace, code)
    definition = engine.definition_for(target, None, kind)
    with transaction.atomic():
        return actions._start(target, record.id, actor, definition, now=now)


def act(actor, instance, action, workspace, **body):
    instance.refresh_from_db()
    body.setdefault("revision", instance.revision)
    return client_for(actor).post(url(workspace, f"runs/{instance.id}/{action}/"), body, format="json")


def run_of(instance):
    return WorkflowStepRun.objects.get(instance=instance, status="active")


def submitted(org, graph=None, **kwargs):
    workspace = org["workspace"]
    create_workflow(org["admin"], workspace, graph or approval_graph(), **kwargs)
    issue = ticket(workspace, org["employee"])
    instance = start(workspace, issue, org["employee"])
    assert act(org["employee"], instance, "transition", workspace, transition="submit").status_code == 200
    instance.refresh_from_db()
    return issue, instance


# ------------------------------------------------------------------ 1. validation


def test_validation_reports_each_problem_in_persian(org):
    workspace, admin = org["workspace"], org["admin"]
    _, version = create_workflow(admin, workspace, publish=False)
    broken = {
        "steps": [
            step("a", "مرحلهٔ الف", "normal", "todo"),
            step("b", "مرحلهٔ ب", "normal", "no-such-status"),
            step("c", "مرحلهٔ ج", "normal", "todo", target_minutes=0),
            step("d", "مرحلهٔ د", "normal", "todo"),
        ],
        "transitions": [
            move("ab", "a", "b", auto=True),
            move("ba", "b", "a", auto=True),
            move("bc", "b", "c", condition={"field": "ghost", "op": "eq", "value": 1}),
            move("cd", "c", "d"),
        ],
    }
    response = client_for(admin).post(
        url(workspace, f"versions/{version.id}/validate/"), {"graph": broken}, format="json"
    )
    assert response.status_code == 200 and response.data["valid"] is False
    messages = fa(response.data["issues"])
    assert "دقیقاً یک مرحلهٔ شروع" in messages
    assert "دست‌کم یک مرحلهٔ پایان" in messages
    assert "وضعیت «no-such-status» در فهرست وضعیت‌های فعال این رکورد نیست" in messages
    assert "شرط انتقال «bc» ناقص یا نامعتبر است (فیلد ناموجود: ghost)" in messages
    assert "مدت هدف مرحلهٔ «مرحلهٔ ج» باید عددی مثبت" in messages
    assert "مرحلهٔ «مرحلهٔ د» انتقال خروجی ندارد" in messages
    assert "چرخهٔ انتقال‌های خودکار بدون اقدام انسانی" in messages
    by_target = {(row["step"], row["transition"]) for row in response.data["issues"]}
    assert ("b", None) in by_target and (None, "bc") in by_target
    unreachable = {
        "steps": [
            step("s", "شروع", "start", "todo"),
            step("x", "جزیره", "normal", "todo"),
            step("e", "پایان", "end", "done"),
        ],
        "transitions": [move("se", "s", "e"), move("xe", "x", "e")],
    }
    response = client_for(admin).post(
        url(workspace, f"versions/{version.id}/validate/"), {"graph": unreachable}, format="json"
    )
    assert "مرحلهٔ «جزیره» از مرحلهٔ شروع قابل دسترسی نیست" in fa(response.data["issues"])
    missing_role = approval_graph()
    missing_role["steps"][2]["assignee"] = {"type": "role", "role_id": "00000000-0000-0000-0000-000000000000"}
    response = client_for(admin).post(
        url(workspace, f"versions/{version.id}/validate/"), {"graph": missing_role}, format="json"
    )
    assert "نقش مسئول انتخاب‌شده فعال نیست" in fa(response.data["issues"])
    # Publishing an invalid draft is refused with the same report.
    client_for(admin).put(url(workspace, f"versions/{version.id}/"), {"graph": broken}, format="json")
    response = client_for(admin).post(url(workspace, f"versions/{version.id}/publish/"), {}, format="json")
    assert response.status_code == 400 and response.data["issues"]
    # A return loop with an exit to the end is valid.
    assert engine.validate_graph(version.definition, approval_graph()) == []


def test_design_and_publish_require_permissions(org):
    workspace, manager = org["workspace"], org["manager"]
    body = {"entity": "ticket", "kind": "standard", "title": "بی‌اجازه"}
    assert client_for(manager).post(url(workspace, "definitions/"), body, format="json").status_code == 403
    grant(manager, "Workflow.Design")
    created = client_for(manager).post(url(workspace, "definitions/"), body, format="json")
    assert created.status_code == 201
    version_id = created.data["versions"][0]["id"]
    assert (
        client_for(manager).post(url(workspace, f"versions/{version_id}/publish/"), {}, format="json").status_code
        == 403
    )


# ------------------------------------------------------------------ 2. versions


def test_published_version_is_immutable_and_running_instance_keeps_its_version(org):
    workspace, admin = org["workspace"], org["admin"]
    issue, instance = submitted(org)
    v1 = instance.version
    response = client_for(admin).put(url(workspace, f"versions/{v1.id}/"), {"graph": approval_graph()}, format="json")
    assert response.status_code == 400 and "قابل ویرایش نیست" in fa(response.data)
    draft = client_for(admin).post(url(workspace, f"definitions/{v1.definition_id}/versions/"), {}, format="json")
    assert draft.status_code == 201 and draft.data["number"] == 2
    changed = approval_graph()
    changed["steps"][1]["title"] = "بررسی سرپرست"
    assert (
        client_for(admin)
        .put(url(workspace, f"versions/{draft.data['id']}/"), {"graph": changed}, format="json")
        .status_code
        == 200
    )
    assert (
        client_for(admin).post(url(workspace, f"versions/{draft.data['id']}/publish/"), {}, format="json").status_code
        == 200
    )
    v1.refresh_from_db()
    instance.refresh_from_db()
    assert v1.status == "retired" and instance.version_id == v1.id
    assert WorkflowVersion.objects.filter(definition=v1.definition, status="published").count() == 1

    # Migration: preview first, permission required, before/after recorded.
    manager = org["manager"]
    preview_url = url(workspace, f"runs/{instance.id}/migration-preview/?version={draft.data['id']}")
    assert client_for(manager).get(preview_url).status_code == 403
    preview = client_for(admin).get(preview_url)
    assert preview.status_code == 200 and preview.data["can_migrate"] is True
    assert preview.data["after"]["step_title"] == "بررسی سرپرست"
    assert preview.data["after"]["assignee"]["id"] == str(manager.id)
    assert act(manager, instance, "migrate", workspace, version=draft.data["id"], reason="x").status_code == 403
    assert act(admin, instance, "migrate", workspace, version=draft.data["id"]).status_code == 400
    response = act(admin, instance, "migrate", workspace, version=draft.data["id"], reason="اصلاح عنوان مرحله")
    assert response.status_code == 200, response.data
    instance.refresh_from_db()
    assert instance.version.number == 2
    decision = WorkflowDecision.objects.get(instance=instance, kind="migrate")
    assert decision.data["before"]["version"] == 1 and decision.data["after"]["version"] == 2
    assert EntityEvent.objects.filter(record_id=issue.id, event_type="workflow.migrated").exists()


def test_record_panel_offers_latest_version_and_migration_can_pick_the_target_step(org):
    workspace, admin, manager = org["workspace"], org["admin"], org["manager"]
    issue, instance = submitted(org)
    panel = lambda user: client_for(user).get(url(workspace, f"records/ticket/{issue.id}/")).data["instance"]  # noqa: E731
    assert panel(admin)["migration_target"] is None  # already on the only published version
    draft = client_for(admin).post(url(workspace, f"definitions/{instance.definition_id}/versions/"), {}, format="json")
    renamed = approval_graph()
    renamed["steps"][1]["code"] = "check"
    renamed["steps"][1]["title"] = "بررسی کارشناس ارشد"
    for row in renamed["transitions"]:
        row["from"] = "check" if row["from"] == "review" else row["from"]
        row["to"] = "check" if row["to"] == "review" else row["to"]
    client_for(admin).put(url(workspace, f"versions/{draft.data['id']}/"), {"graph": renamed}, format="json")
    assert (
        client_for(admin).post(url(workspace, f"versions/{draft.data['id']}/publish/"), {}, format="json").status_code
        == 200
    )
    target = panel(admin)["migration_target"]
    assert target["id"] == draft.data["id"] and target["number"] == 2
    assert {"code": "check", "title": "بررسی کارشناس ارشد"} in target["steps"]
    assert panel(manager)["migration_target"] is None  # no Workflow.Migrate
    base = url(workspace, f"runs/{instance.id}/migration-preview/?version={draft.data['id']}")
    missing = client_for(admin).get(base).data
    assert missing["can_migrate"] is False and "مرحلهٔ مقصد را انتخاب کنید" in fa(missing["problems"])
    chosen = client_for(admin).get(f"{base}&step=check").data
    assert chosen["can_migrate"] is True and chosen["after"]["step"] == "check"
    response = act(
        admin,
        instance,
        "migrate",
        workspace,
        version=draft.data["id"],
        step_map={"review": "check"},
        reason="نام‌گذاری تازه",
    )
    assert response.status_code == 200, response.data
    instance.refresh_from_db()
    assert instance.version.number == 2 and instance.current_step == "check"
    assert run_of(instance).assignee_id == manager.id


def test_workflow_participants_can_read_but_not_edit_the_record(org):
    workspace, manager, colleague = org["workspace"], org["manager"], org["colleague"]
    issue, instance = submitted(org)
    record = f"/api/workspaces/{workspace.slug}/engine/entities/ticket/records/{issue.id}/"
    # The approver is not the creator or an assignee, yet must open the record to decide.
    response = client_for(manager).get(record)
    assert response.status_code == 200, response.data
    assert client_for(manager).get(url(workspace, f"records/ticket/{issue.id}/")).status_code == 200
    # Reading only: a save still follows the record's own visibility rules.
    revision = response.data.get("revision", 0)
    edit = client_for(manager).patch(record, {"revision": revision, "values": {"title": "تغییر"}}, format="json")
    assert edit.status_code in {403, 404}
    issue.refresh_from_db()
    assert issue.name == "درخواست پشتیبانی"
    # Someone outside the workflow still cannot see it.
    assert client_for(colleague).get(record).status_code in {403, 404}
    # A past assignee keeps read access after the step moves on.
    assert act(manager, instance, "transition", workspace, transition="approve").status_code == 200
    assert client_for(manager).get(record).status_code == 200


def test_refer_to_a_group_lets_any_present_member_act(org):
    workspace, manager, colleague, top = org["workspace"], org["manager"], org["colleague"], org["top"]
    issue, instance = submitted(org)
    group = OrganizationRole.objects.create(workspace=workspace, name="کارشناسان فنی")
    for member in (colleague, top):
        UserOrganizationRole.objects.create(workspace=workspace, user=member, role=group)
    response = act(
        manager, instance, "transition", workspace, transition="refer", role=str(group.id), reason="نیاز فنی"
    )
    assert response.status_code == 200, response.data
    instance.refresh_from_db()
    run = run_of(instance)
    assert run.assignee_id is None and set(run.candidate_ids) == {str(colleague.id), str(top.id)}
    assert act(org["employee"], instance, "transition", workspace, transition="approve").status_code == 403
    assert act(colleague, instance, "transition", workspace, transition="approve").status_code == 200
    empty = OrganizationRole.objects.create(workspace=workspace, name="گروه خالی")
    other = start(workspace, ticket(workspace, org["employee"], "دومی"), org["employee"])
    assert act(org["employee"], other, "transition", workspace, transition="submit").status_code == 200
    response = act(manager, other, "transition", workspace, transition="refer", role=str(empty.id), reason="x")
    assert response.status_code == 400 and "هیچ کاربر فعال و حاضری" in fa(response.data)


def test_definition_settings_can_be_set_and_cleared(org):
    workspace, admin = org["workspace"], org["admin"]
    definition, _ = create_workflow(admin, workspace, approval_graph())
    path = url(workspace, f"definitions/{definition.id}/")
    body = {"is_active": False, "settings": {"instance_target_minutes": 960}}
    response = client_for(admin).patch(path, body, format="json")
    assert response.status_code == 200 and response.data["settings"]["instance_target_minutes"] == 960
    assert response.data["is_active"] is False
    cleared = client_for(admin).patch(path, {"settings": {"instance_target_minutes": None}}, format="json")
    assert "instance_target_minutes" not in cleared.data["settings"]
    assert client_for(org["manager"]).patch(path, {"is_active": True}, format="json").status_code == 403


# ------------------------------------------------------------------ 3. dry run


def test_dry_run_saves_nothing_and_reports_path_assignees_and_deadlines(org):
    workspace, admin = org["workspace"], org["admin"]
    _, version = create_workflow(admin, workspace, approval_graph(), publish=False)
    counts = lambda: (  # noqa: E731
        EntityRecord.objects.count(),
        Issue.objects.count(),
        WorkflowInstance.objects.count(),
        WorkflowStepRun.objects.count(),
        WorkflowDecision.objects.count(),
        EntityEvent.objects.count(),
        Notification.objects.count(),
    )
    before = counts()
    response = client_for(admin).post(
        url(workspace, f"versions/{version.id}/simulate/"),
        {"values": {"title": "نمونه"}, "subject": str(org["employee"].id)},
        format="json",
    )
    assert response.status_code == 200, response.data
    assert counts() == before
    path = response.data["path"]
    assert [row["step"] for row in path] == ["request", "review", "upper", "done"]
    assert path[1]["assignee"]["id"] == str(org["manager"].id)
    assert path[2]["assignee"]["id"] == str(org["upper"].id)
    assert path[1]["target_at"] and "ساعت" in path[1]["target_text"]


# ------------------------------------------------------------------ 4. decisions


def test_approve_reject_return_refer_and_end_are_recorded(org):
    workspace, manager, employee, upper = org["workspace"], org["manager"], org["employee"], org["upper"]
    issue, instance = submitted(org)
    issue.refresh_from_db()
    assert issue.status == "review" and run_of(instance).assignee_id == manager.id
    # Only the assignee may decide; reasons are mandatory for reject/return.
    assert act(employee, instance, "transition", workspace, transition="approve").status_code == 403
    response = act(manager, instance, "transition", workspace, transition="reject")
    assert response.status_code == 400 and "ثبت دلیل برای «رد» الزامی است" in fa(response.data)
    response = act(manager, instance, "transition", workspace, transition="return", reason="پیوست ناقص است")
    assert response.status_code == 200, response.data
    instance.refresh_from_db()
    assert instance.current_step == "request" and run_of(instance).assignee_id == employee.id
    assert act(employee, instance, "transition", workspace, transition="submit").status_code == 200
    response = act(
        manager,
        instance,
        "transition",
        workspace,
        transition="refer",
        user=str(org["colleague"].id),
        reason="کارشناس فنی",
    )
    assert response.status_code == 200
    instance.refresh_from_db()
    assert run_of(instance).assignee_id == org["colleague"].id
    assert act(org["colleague"], instance, "transition", workspace, transition="approve").status_code == 200
    instance.refresh_from_db()
    assert run_of(instance).assignee_id == upper.id
    assert act(upper, instance, "transition", workspace, transition="final").status_code == 200
    instance.refresh_from_db()
    issue.refresh_from_db()
    assert instance.status == "completed" and issue.status == "done"
    decisions = list(
        WorkflowDecision.objects.filter(instance=instance).exclude(kind__in=["start"]).order_by("created_at")
    )
    assert [row.kind for row in decisions] == ["advance", "return", "advance", "refer", "approve", "approve"]
    assert all(row.actor_id and row.created_at and row.version_number == 1 for row in decisions)
    assert decisions[1].reason == "پیوست ناقص است" and decisions[1].to_step == "request"
    timeline = client_for(employee).get(url(workspace, f"records/ticket/{issue.id}/")).data["instance"]["timeline"]
    assert any(row["reason"] == "پیوست ناقص است" for row in timeline)
    assert EntityEvent.objects.filter(record_id=issue.id, event_type="record.status_changed").count() >= 4


def test_reject_ends_with_reason_in_history(org):
    workspace, manager = org["workspace"], org["manager"]
    issue, instance = submitted(org)
    assert (
        act(manager, instance, "transition", workspace, transition="reject", reason="خارج از حوزه").status_code == 200
    )
    instance.refresh_from_db()
    issue.refresh_from_db()
    assert instance.status == "completed" and instance.current_step == "rejected" and issue.status == "blocked"
    event = (
        EntityEvent.objects.filter(record_id=issue.id, event_type="workflow.transition").order_by("-created_at").first()
    )
    assert event.metadata["reason"] == "خارج از حوزه" and event.metadata["workflow_version"] == 1


# ------------------------------------------------------------------ 5. assignee resolution


def test_manager_resolution_delegate_fallback_and_error(org):
    workspace, employee = org["workspace"], org["employee"]
    unit, direct, upper = engine.managers_of(employee, workspace)
    assert (unit.id, direct[0], upper[0]) == (org["team"].id, org["manager"].id, org["upper"].id)
    # The manager of a unit is not their own direct manager: the next manager up is.
    _, direct, upper = engine.managers_of(org["manager"], workspace)
    assert (direct[0], upper[0]) == (org["upper"].id, org["top"].id)
    loner = person(workspace, "loner")
    orphan = OrganizationUnit.objects.create(workspace=workspace, title="واحد بی‌مدیر")
    OrganizationUnitMember.objects.create(unit=orphan, user=loner)
    review = approval_graph()["steps"][1]
    result = engine.resolve_assignee(review, workspace=workspace, subject=loner, values={})
    assert result["error"] == "برای واحد واحد بی‌مدیر مدیر مستقیم یا جانشین فعالی تعریف نشده است."
    delegate = person(workspace, "delegate")
    OrganizationUnitDelegate.objects.create(unit=orphan, user=delegate, priority=1)
    result = engine.resolve_assignee(review, workspace=workspace, subject=loner, values={})
    assert result["assignee"].id == delegate.id and "جانشین" in result["reason"]


def test_missing_manager_puts_instance_in_visible_error(org):
    workspace, admin = org["workspace"], org["admin"]
    create_workflow(admin, workspace, approval_graph())
    loner = person(workspace, "loner")
    OrganizationUnitMember.objects.create(
        unit=OrganizationUnit.objects.create(workspace=workspace, title="بایگانی"), user=loner
    )
    instance = start(workspace, ticket(workspace, loner), loner)
    assert act(loner, instance, "transition", workspace, transition="submit").status_code == 200
    instance.refresh_from_db()
    assert instance.status == "error" and "برای واحد بایگانی" in instance.error_message
    listed = client_for(admin).get(url(workspace, "runs/?status=error")).data["results"]
    assert listed[0]["error_message"] == instance.error_message
    # Never silently routed to an administrator.
    assert WorkflowStepRun.objects.filter(instance=instance, assignee=admin).count() == 0


def test_absent_assignee_is_replaced_by_delegate_with_reason(org):
    workspace, manager = org["workspace"], org["manager"]
    substitute = person(workspace, "substitute")
    OrganizationUnitDelegate.objects.create(unit=org["team"], user=substitute, priority=1)
    now = timezone.now()
    UserAbsence.objects.create(
        workspace=workspace, user=manager, starts_at=now - timedelta(hours=1), ends_at=now + timedelta(days=2)
    )
    _, instance = submitted(org)
    run = run_of(instance)
    assert run.assignee_id == substitute.id
    assert "manager غایب است" in run.assignment_reason and "substitute" in run.assignment_reason


# ------------------------------------------------------------------ 6. managerial reassignment


def test_reassign_requires_permission_scope_and_reason(org, workspace):
    manager, colleague, admin = org["manager"], org["colleague"], org["admin"]
    _, instance = submitted(org)
    upper = org["upper"]
    assert act(upper, instance, "reassign", workspace, user=str(colleague.id), reason="x").status_code == 403
    grant(upper, "Workflow.Reassign")
    response = act(upper, instance, "reassign", workspace, user=str(colleague.id))
    assert response.status_code == 400
    target_before = run_of(instance).target_at
    response = act(upper, instance, "reassign", workspace, user=str(colleague.id), reason="مرخصی مدیر تیم")
    assert response.status_code == 200, response.data
    run = run_of(instance)
    # Policy: the deadline does not move with the assignee.
    assert run.assignee_id == colleague.id and run.target_at == target_before
    decision = WorkflowDecision.objects.get(instance=instance, kind="reassign")
    assert decision.data["before"]["assignee"]["id"] == str(manager.id)
    assert decision.data["after"]["assignee"]["id"] == str(colleague.id)
    outsider_owner = User.objects.create_user(
        email="owner2@example.test", username="owner2", password="SafePassword!2026"
    )
    other = Workspace.objects.create(name="Other", owner=outsider_owner, slug="other-workspace")
    WorkspaceMember.objects.create(workspace=other, member=outsider_owner, role=20)
    assert act(outsider_owner, instance, "reassign", workspace, user=str(manager.id), reason="x").status_code in {
        403,
        404,
    }
    del admin


# ------------------------------------------------------------------ 7. deadlines and pauses


def _working_week_with_break(workspace, user):
    version = WorkSchedule.objects.create(
        workspace=workspace, scope="person", user=user, effective_from=tehran(2026, 1, 1).date(), reason="آزمون"
    )
    for weekday in range(7):
        WorkScheduleDay.objects.create(
            schedule=version,
            weekday=weekday,
            is_working=weekday != 4,
            start_time=time(8),
            end_time=time(16),
            breaks=[{"start": "12:00", "end": "13:00"}],
        )


def test_deadline_uses_assignee_calendar_across_break_friday_and_midnight(org):
    workspace, manager, employee = org["workspace"], org["manager"], org["employee"]
    _working_week_with_break(workspace, manager)
    create_workflow(org["admin"], workspace, approval_graph())
    instance = start(workspace, ticket(workspace, employee), employee)
    thursday = tehran(2027, 1, 7, 11, 30)
    with transaction.atomic():
        actions.transition(
            workspace, employee, instance.id, {"transition": "submit", "revision": instance.revision}, now=thursday
        )
    run = run_of(instance)
    # 11:30–12:00 (30) + break + 13:00–14:30 (90) = 120 working minutes.
    assert run.target_at.astimezone(TEHRAN) == tehran(2027, 1, 7, 14, 30)
    instance.refresh_from_db()
    with transaction.atomic():
        actions.transition(
            workspace,
            manager,
            instance.id,
            {"transition": "return", "reason": "اصلاح", "revision": instance.revision},
            now=thursday,
        )
    instance.refresh_from_db()
    late = tehran(2027, 1, 7, 15, 30)
    with transaction.atomic():
        actions.transition(
            workspace, employee, instance.id, {"transition": "submit", "revision": instance.revision}, now=late
        )
    # 15:30–16:00 (30), Friday off, over midnight, Saturday 08:00–09:30 (90).
    assert run_of(instance).target_at.astimezone(TEHRAN) == tehran(2027, 1, 9, 9, 30)


def test_pause_only_where_allowed_and_resume_shifts_deadline(org):
    workspace, manager, employee = org["workspace"], org["manager"], org["employee"]
    create_workflow(org["admin"], workspace, approval_graph())
    instance = start(workspace, ticket(workspace, employee), employee)
    response = act(employee, instance, "pause", workspace, kind="customer", reason="منتظر مشتری")
    assert response.status_code == 400 and "اجازهٔ «در انتظار پاسخ مشتری» را ندارد" in fa(response.data)
    monday = tehran(2027, 1, 4, 9)
    with transaction.atomic():
        actions.transition(
            workspace, employee, instance.id, {"transition": "submit", "revision": instance.revision}, now=monday
        )
    assert run_of(instance).target_at.astimezone(TEHRAN) == tehran(2027, 1, 4, 11)
    instance.refresh_from_db()
    assert act(manager, instance, "pause", workspace, kind="formal", reason="x").status_code == 400
    assert act(manager, instance, "pause", workspace, kind="customer").status_code == 400
    instance.refresh_from_db()
    with transaction.atomic():
        actions.pause(
            workspace,
            manager,
            instance.id,
            {"kind": "customer", "reason": "منتظر مدارک مشتری", "revision": instance.revision},
            now=tehran(2027, 1, 4, 10),
        )
    instance.refresh_from_db()
    with transaction.atomic():
        actions.resume(
            workspace,
            manager,
            instance.id,
            {"reason": "مدارک رسید", "revision": instance.revision},
            now=tehran(2027, 1, 4, 15),
        )
    # 60 working minutes were left at pause time: 15:00 + 60 → 16:00.
    run = run_of(instance)
    assert run.target_at.astimezone(TEHRAN) == tehran(2027, 1, 4, 16) and run.paused_at is None
    pause = run.pauses.get()
    assert pause.remaining_minutes == 60 and pause.resumed_by_id == manager.id and pause.reason == "منتظر مدارک مشتری"
    kinds = list(
        WorkflowDecision.objects.filter(instance=instance, kind__in=["pause", "resume"]).values_list("kind", flat=True)
    )
    assert kinds == ["pause", "resume"]


# ------------------------------------------------------------------ 8. reminders and overdue


def test_near_due_reminder_is_sent_once_and_overdue_needs_report(org):
    workspace, manager, employee, upper = org["workspace"], org["manager"], org["employee"], org["upper"]
    create_workflow(org["admin"], workspace, approval_graph())
    instance = start(workspace, ticket(workspace, employee), employee)
    monday = tehran(2027, 1, 4, 8)
    with transaction.atomic():
        actions.transition(
            workspace, employee, instance.id, {"transition": "submit", "revision": instance.revision}, now=monday
        )
    run = run_of(instance)
    step = engine.current_step(WorkflowInstance.objects.get(id=instance.id))
    assert engine.needs_reminder(step, run, workspace, tehran(2027, 1, 4, 8, 30)) is False
    assert engine.needs_reminder(step, run, workspace, tehran(2027, 1, 4, 9, 30)) is True
    before = Notification.objects.count()
    assert actions.send_due_reminders(tehran(2027, 1, 4, 9, 30)) == 1
    receivers = set(Notification.objects.order_by("-created_at")[:2].values_list("receiver_id", flat=True))
    assert Notification.objects.count() == before + 2 and receivers == {manager.id, upper.id}
    assert actions.send_due_reminders(tehran(2027, 1, 4, 9, 45)) == 0
    assert Notification.objects.count() == before + 2

    late = tehran(2027, 1, 4, 11, 30)
    instance.refresh_from_db()
    payload = engine.instance_payload(WorkflowInstance.objects.get(id=instance.id), manager, now=late)
    assert payload["run"]["overdue"] is True and payload["actions"]["can_report_delay"] is True
    with pytest.raises(Exception) as error, transaction.atomic():
        actions.transition(
            workspace, manager, instance.id, {"transition": "approve", "revision": instance.revision}, now=late
        )
    assert "گزارش دیرکرد" in fa(error.value.detail)
    with transaction.atomic():
        actions.delay_report(
            workspace,
            manager,
            instance.id,
            {
                "reason": "حجم کار",
                "progress": "نیمی بررسی شد",
                "expected_at": "2027-01-04T15:00:00+03:30",
                "revision": instance.revision,
            },
            now=late,
        )
    instance.refresh_from_db()
    with transaction.atomic():
        actions.transition(
            workspace, manager, instance.id, {"transition": "approve", "revision": instance.revision}, now=late
        )
    report = WorkflowDecision.objects.get(instance=instance, kind="delay_report")
    assert report.reason == "حجم کار" and report.data["progress"] == "نیمی بررسی شد"


# ------------------------------------------------------------------ 9. extensions


def _work_graph():
    return {
        "steps": [
            step("request", "ثبت", "start", "todo"),
            step("work", "انجام کار", "normal", "in_progress", {"type": "subject"}, target_minutes=60),
            step("done", "پایان", "end", "done", {"type": "none"}),
        ],
        "transitions": [move("submit", "request", "work"), move("finish", "work", "done", "end", "پایان")],
    }


def test_extension_only_direct_manager_decides_and_old_deadline_stays_in_history(org):
    workspace, manager, employee, upper = org["workspace"], org["manager"], org["employee"], org["upper"]
    _, instance = submitted(org, _work_graph())
    run = run_of(instance)
    old_target = run.target_at
    response = act(employee, instance, "extension", workspace, minutes=120, reason="نیاز به هماهنگی بیشتر")
    assert response.status_code == 200, response.data
    extension = response.data["instance"]["pending_extension"]
    assert act(employee, instance, "extension", workspace, minutes=60, reason="دوباره").status_code == 400
    assert run_of(instance).target_at == old_target
    decide = lambda user, **body: client_for(user).post(  # noqa: E731
        url(workspace, f"extensions/{extension['id']}/decide/"),
        {"revision": WorkflowInstance.objects.get(id=instance.id).revision, **body},
        format="json",
    )
    assert decide(employee, approve=True).status_code == 403
    assert decide(upper, approve=True).status_code == 403
    assert decide(manager, approve=False).status_code == 400
    response = decide(manager, approve=True)
    assert response.status_code == 200, response.data
    run = run_of(instance)
    assert run.target_at > old_target
    approved = WorkflowDecision.objects.get(instance=instance, kind="extension_approved")
    assert approved.data["previous_target_at"] == engine.iso(old_target, workspace)
    history = [row["kind"] for row in response.data["instance"]["timeline"]]
    assert "extension" in history and "extension_approved" in history


# ------------------------------------------------------------------ 10. fast path


def test_fast_path_contact_resolution_and_conversion_to_standard(org):
    workspace, admin, employee, colleague = org["workspace"], org["admin"], org["employee"], org["colleague"]
    create_workflow(admin, workspace, approval_graph(), title="مسیر عادی")
    create_workflow(admin, workspace, None, kind="fast_path", title="مسیر کوتاه")
    issue = ticket(workspace, employee)
    instance = start(workspace, issue, employee)
    assert instance.definition.kind == "fast_path"
    contact = {
        "channel": "phone",
        "contact_name": "آقای رضایی",
        "contact_at": timezone.now().isoformat(),
        "summary": "رمز عبور فراموش شده بود",
        "outcome": "رمز بازنشانی شد",
    }
    assert act(employee, instance, "contact-resolve", workspace, **{**contact, "channel": "fax"}).status_code == 400
    response = act(employee, instance, "contact-resolve", workspace, **contact)
    assert response.status_code == 200, response.data
    instance.refresh_from_db()
    issue.refresh_from_db()
    assert instance.status == "completed" and issue.status == "done"
    decision = WorkflowDecision.objects.get(instance=instance, kind="end")
    assert decision.from_step == "register" and decision.data["contact"]["contact_name"] == "آقای رضایی"
    event = EntityEvent.objects.get(record_id=issue.id, event_type="workflow.transition")
    assert event.metadata["data"]["contact"]["outcome"] == "رمز بازنشانی شد"

    second = ticket(workspace, employee, "قطعی شبکه")
    instance = start(workspace, second, employee)
    response = act(
        employee,
        instance,
        "to-standard",
        workspace,
        reason="در تماس حل نشد",
        followup={"title": "پیگیری قطعی شبکه", "assignee": str(colleague.id)},
    )
    assert response.status_code == 200, response.data
    instance.refresh_from_db()
    assert instance.definition.kind == "standard" and instance.current_step == "request"
    converted = WorkflowDecision.objects.get(instance=instance, kind="to_standard")
    followup = Issue.objects.get(id=converted.data["followup"]["id"])
    assert followup.name == "پیگیری قطعی شبکه"
    assert followup.issue_assignee.filter(assignee=colleague).exists()
    kinds = list(
        WorkflowDecision.objects.filter(instance=instance).order_by("created_at").values_list("kind", flat=True)
    )
    assert kinds[:2] == ["start", "to_standard"]


def test_fast_path_manager_close_only_when_configured(org):
    workspace, admin, employee, manager = org["workspace"], org["admin"], org["employee"], org["manager"]
    create_workflow(
        admin, workspace, None, kind="fast_path", title="کوتاه با تأیید", settings={"require_manager_close": True}
    )
    instance = start(workspace, ticket(workspace, employee), employee)
    body = {
        "channel": "onsite",
        "contact_name": "خانم احمدی",
        "contact_at": timezone.now().isoformat(),
        "summary": "s",
        "outcome": "o",
    }
    assert act(employee, instance, "contact-resolve", workspace, **body).status_code == 200
    instance.refresh_from_db()
    assert instance.status == "running" and instance.current_step == "close_approval"
    assert run_of(instance).assignee_id == manager.id
    assert act(manager, instance, "transition", workspace, transition="close_approve").status_code == 200
    instance.refresh_from_db()
    assert instance.status == "completed"


# ------------------------------------------------------------------ 11. concurrency


def test_stale_revision_is_rejected_with_409(org):
    workspace, manager = org["workspace"], org["manager"]
    _, instance = submitted(org)
    stale = instance.revision
    assert act(manager, instance, "transition", workspace, transition="approve", revision=stale).status_code == 200
    response = act(manager, instance, "transition", workspace, transition="approve", revision=stale)
    assert response.status_code == 409
    assert fa(response.data["error"] if "error" in response.data else response.data).find("هم‌زمان") >= 0


@pytest.mark.django_db(transaction=True)
def test_two_concurrent_approvals_apply_only_once(org):
    workspace, manager = org["workspace"], org["manager"]
    _, instance = submitted(org)
    revision = instance.revision
    barrier, outcomes = threading.Barrier(2), []

    def approve():
        try:
            barrier.wait()
            actions.transition(workspace, manager, instance.id, {"transition": "approve", "revision": revision})
            outcomes.append("ok")
        except engine.Conflict:
            outcomes.append("conflict")
        finally:
            connection.close()

    threads = [threading.Thread(target=approve) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert sorted(outcomes) == ["conflict", "ok"]
    assert WorkflowDecision.objects.filter(instance=instance, kind="approve").count() == 1
    assert WorkflowStepRun.objects.filter(instance=instance, step_code="upper").count() == 1


# ------------------------------------------------------------------ 12. automatic cap


def test_automatic_transition_cap_stops_with_visible_error(org, settings):
    settings.WORKFLOW_MAX_AUTO_STEPS = 2
    workspace, admin, employee = org["workspace"], org["admin"], org["employee"]
    graph = {
        "steps": [step("s", "شروع", "start", "todo")]
        + [step(f"a{i}", f"خودکار {i}", "normal", "in_progress") for i in range(4)]
        + [step("e", "پایان", "end", "done", {"type": "none"})],
        "transitions": [move("go", "s", "a0")]
        + [move(f"t{i}", f"a{i}", f"a{i + 1}", auto=True) for i in range(3)]
        + [move("t3", "a3", "e", auto=True)],
    }
    create_workflow(admin, workspace, graph)
    instance = start(workspace, ticket(workspace, employee), employee)
    assert act(employee, instance, "transition", workspace, transition="go").status_code == 200
    instance.refresh_from_db()
    assert instance.status == "error" and "سقف ۲ گام" in instance.error_message
    assert WorkflowDecision.objects.filter(instance=instance, kind="auto").count() == 2
    panel = client_for(employee).get(url(workspace, f"records/ticket/{instance.record_id}/")).data["instance"]
    assert panel["status"] == "error" and panel["error_message"] == instance.error_message


# ------------------------------------------------------------------ 13. field rules


def test_required_fields_and_locked_fields_are_enforced_on_the_server(org):
    workspace, admin, manager = org["workspace"], org["admin"], org["manager"]
    issue, instance = submitted(
        org, approval_graph(required_fields=["due_date"], lock_fields=True, editable_fields=["due_date"])
    )
    response = act(manager, instance, "transition", workspace, transition="approve")
    assert response.status_code == 400 and "تکمیل فیلد «سررسید» پیش از ادامه الزامی است" in fa(response.data)
    target = entity(workspace)
    from rest_framework.exceptions import PermissionDenied

    def revision():
        rows = EntityRecord.objects.filter(entity=target, source_id=issue.id)
        return rows.values_list("revision", flat=True).first() or 0

    with pytest.raises(PermissionDenied) as error:
        save_record(target, admin, {"revision": revision(), "values": {"title": "عنوان جدید"}}, identifier=issue.id)
    assert "در مرحلهٔ «تأیید مدیر مستقیم» قابل ویرایش نیست" in fa(error.value.detail)
    with pytest.raises(PermissionDenied) as error:
        save_record(target, admin, {"revision": revision(), "values": {"ticket_state": "done"}}, identifier=issue.id)
    assert "گردش‌کار تعیین می‌کند" in fa(error.value.detail)
    save_record(target, admin, {"revision": revision(), "values": {"due_date": "2027-02-01"}}, identifier=issue.id)
    response = act(manager, instance, "transition", workspace, transition="approve")
    assert response.status_code == 200, response.data
    decision = WorkflowDecision.objects.get(instance=instance, kind="approve")
    assert decision.changed_values["due_date"]["after"] == "2027-02-01"


# ------------------------------------------------------------------ 14. leave readiness


def _leave_graph(definition_statuses=None):
    return {
        "steps": [
            step("request", "درخواست", "start", "pending"),
            step("manager", "تأیید مدیر مستقیم", "approval", "pending", {"type": "direct_manager"}),
            step("upper", "تأیید مدیر بالادست", "approval", "pending", {"type": "upper_manager"}),
            step("approved", "تأییدشده", "end", "scheduled", {"type": "none"}),
            step("rejected", "ردشده", "end", "cancelled", {"type": "none"}),
        ],
        "transitions": [
            move("submit", "request", "manager", label="ارسال درخواست"),
            move(
                "approve", "manager", "approved", "approve", "تأیید", condition={"field": "leave_type", "op": "empty"}
            ),
            move(
                "escalate",
                "manager",
                "upper",
                "approve",
                "تأیید و ارسال به بالادست",
                condition={"field": "leave_type", "op": "not_empty"},
            ),
            move("reject", "manager", "rejected", "reject", "رد"),
            move("return", "manager", "request", "return", "بازگشت برای اصلاح"),
            move("final", "upper", "approved", "approve", "تأیید نهایی"),
            move("upper_reject", "upper", "rejected", "reject", "رد"),
        ],
    }


def test_leave_contract_pending_request_is_not_unavailable_until_approved(org):
    workspace, admin, manager, employee = org["workspace"], org["admin"], org["manager"], org["employee"]
    create_workflow(admin, workspace, _leave_graph(), code="leave", title="درخواست مرخصی")
    grant(manager, "Absence.View", "Absence.Create", "Absence.Edit")
    leave = entity(workspace, "leave")
    starts, ends = tehran(2027, 2, 6, 8), tehran(2027, 2, 6, 16)
    record = save_record(
        leave,
        manager,
        {
            "values": {
                "leave_user": str(employee.id),
                "starts_at": starts.isoformat(),
                "ends_at": ends.isoformat(),
                "reason": "کار شخصی",
            }
        },
    )
    absence = UserAbsence.objects.get(id=record["id"])
    assert absence.status == "pending"
    instance = WorkflowInstance.objects.get(record_id=absence.id)
    assert instance.subject_id == employee.id
    assert busy_blocks(workspace, employee, starts, ends) == []
    assert all(segment["reason"] != "absence" for segment in availability(employee, starts, ends, workspace))

    assert act(employee, instance, "transition", workspace, transition="submit").status_code == 200
    assert run_of(instance).assignee_id == manager.id
    assert act(manager, instance, "transition", workspace, transition="reject").status_code == 400
    assert (
        act(manager, instance, "transition", workspace, transition="return", reason="تاریخ را اصلاح کنید").status_code
        == 200
    )
    assert act(employee, instance, "transition", workspace, transition="submit").status_code == 200
    absence.refresh_from_db()
    assert absence.status == "pending" and busy_blocks(workspace, employee, starts, ends) == []
    assert act(manager, instance, "transition", workspace, transition="approve").status_code == 200
    absence.refresh_from_db()
    instance.refresh_from_db()
    assert instance.status == "completed" and absence.status == "scheduled"
    assert [kind for *_, kind in busy_blocks(workspace, employee, starts, ends)] == ["absence"]
    assert any(segment["reason"] == "absence" for segment in availability(employee, starts, ends, workspace))


def test_leave_rejection_cancels_and_upper_approval_is_optional_by_condition(org):
    workspace, admin, manager, employee, upper = (
        org["workspace"],
        org["admin"],
        org["manager"],
        org["employee"],
        org["upper"],
    )
    create_workflow(admin, workspace, _leave_graph(), code="leave", title="درخواست مرخصی")
    leave = entity(workspace, "leave")
    absence = UserAbsence.objects.create(
        workspace=workspace,
        user=employee,
        starts_at=tehran(2027, 3, 1, 8),
        ends_at=tehran(2027, 3, 1, 12),
        status="pending",
    )
    with transaction.atomic():
        instance = actions._start(leave, absence.id, employee, engine.definition_for(leave))
    act(employee, instance, "transition", workspace, transition="submit")
    assert (
        act(manager, instance, "transition", workspace, transition="reject", reason="هم‌زمان با تحویل پروژه").status_code
        == 200
    )
    absence.refresh_from_db()
    assert absence.status == "cancelled"
    assert UserAbsence.objects.filter(id=absence.id).exists()
    del upper


# ------------------------------------------------------------------ 15. regressions


def test_can_manage_absence_scope_is_unchanged(org):
    workspace, manager, upper, employee, colleague = (
        org["workspace"],
        org["manager"],
        org["upper"],
        org["employee"],
        org["colleague"],
    )
    for user in (manager, upper, colleague):
        grant(user, "Absence.Edit")
    assert can_manage_absence(manager, employee, workspace, "Absence.Edit") is True
    assert can_manage_absence(upper, employee, workspace, "Absence.Edit") is True
    assert can_manage_absence(colleague, employee, workspace, "Absence.Edit") is False
    assert can_manage_absence(employee, employee, workspace, "Absence.Edit") is False


def test_failed_auto_start_keeps_the_record_and_shows_an_error(org):
    workspace, admin = org["workspace"], org["admin"]
    graph = approval_graph()
    graph["steps"][0]["status_code"] = "review"
    create_workflow(admin, workspace, graph)
    from plane.db.models import LookupValue

    LookupValue.objects.filter(category__workspace=workspace, category__code="task-status", code="review").update(
        is_active=False
    )
    created = save_record(
        entity(workspace), admin, {"values": {"title": "ثبت با خطا", "ticket_assignees": [str(org["employee"].id)]}}
    )
    instance = WorkflowInstance.objects.get(record_id=created["id"])
    assert Issue.objects.filter(id=created["id"]).exists()
    assert instance.status == "error" and "وضعیت مرحله در فهرست وضعیت کارها فعال نیست" in instance.error_message


def test_records_without_workflow_are_unaffected(org):
    workspace, admin = org["workspace"], org["admin"]
    target = entity(workspace)
    created = save_record(
        target, admin, {"values": {"title": "بدون گردش‌کار", "ticket_assignees": [str(org["employee"].id)]}}
    )
    assert not WorkflowInstance.objects.filter(record_id=created["id"]).exists()


def test_inbox_lists_my_steps_and_extensions_to_decide(org):
    workspace, manager, employee = org["workspace"], org["manager"], org["employee"]
    _, instance = submitted(org, _work_graph())
    inbox = client_for(employee).get(url(workspace, "inbox/")).data
    assert [row["instance_id"] for row in inbox["steps"]] == [str(instance.id)]
    act(employee, instance, "extension", workspace, minutes=30, reason="منتظر قطعه")
    inbox = client_for(manager).get(url(workspace, "inbox/")).data
    assert inbox["steps"] == [] and inbox["extensions"][0]["instance_id"] == str(instance.id)
    assert client_for(org["upper"]).get(url(workspace, "inbox/")).data["extensions"] == []


def test_actions_work_with_a_real_session_cookie(org):
    """Plane's SessionMiddleware switches to the admin cookie for paths containing "instances"."""
    from django.test import Client

    from plane.app.urls.workflow import urlpatterns

    assert all("instances" not in str(row.pattern) for row in urlpatterns)
    workspace, employee = org["workspace"], org["employee"]
    create_workflow(org["admin"], workspace, approval_graph())
    instance = start(workspace, ticket(workspace, employee), employee)
    client = Client()
    client.force_login(employee)
    response = client.post(
        url(workspace, f"runs/{instance.id}/transition/"),
        {"transition": "submit", "revision": instance.revision},
        content_type="application/json",
    )
    assert response.status_code == 200, response.content
    assert response.json()["instance"]["current_step"]["code"] == "review"
