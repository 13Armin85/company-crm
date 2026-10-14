import json

import pytest
from django.conf import settings
from django.contrib.sessions.middleware import SessionMiddleware
from django.test import RequestFactory
from django.utils import timezone

from plane.app.services.crm_notifications import notify_members
from plane.app.services.ticket_routing import TicketRoutingService
from plane.authentication.utils.login import user_login
from plane.bgtasks.issue_activities_task import issue_activity
from plane.bgtasks.notification_task import notifications
from plane.db.models import (
    IssueAssignee,
    IssueSubscriber,
    Notification,
    OrganizationRole,
    OrganizationUnit,
    ProjectMember,
    TicketRoleQueueEntry,
    TicketRoutingRule,
    UserOrganizationRole,
    Workspace,
    WorkspaceMember,
    WorkspaceTask,
)
from .test_crm_access_control import exception, member
from .test_organization_routing import create_issue

pytestmark = pytest.mark.django_db


def create_task(client, workspace, assignee, **values):
    response = client.post(
        f"/api/workspaces/{workspace.slug}/tasks/",
        {
            "name": "پیگیری مشتری",
            "assignee_id": str(assignee.id),
            **values,
        },
        format="json",
    )
    assert response.status_code == 201
    return WorkspaceTask.objects.get(pk=response.data["id"])


def test_task_assignment_transfer_and_unchanged_updates(session_client, workspace, create_user):
    first, second = member(workspace, "event-first"), member(workspace, "event-second")
    task = create_task(session_client, workspace, first)
    assigned = Notification.objects.get(receiver=first, entity_identifier=task.id)
    assert assigned.read_at is None
    assert assigned.data["issue_activity"]["new_identifier"] == str(first.id)
    assert not Notification.objects.filter(receiver=create_user).exists()
    path = f"/api/workspaces/{workspace.slug}/tasks/{task.id}/"
    assert session_client.patch(path, {"assignee_id": str(first.id)}, format="json").status_code == 200
    assert Notification.objects.count() == 1
    assert session_client.patch(path, {"assignee_id": str(second.id)}, format="json").status_code == 200
    assert Notification.objects.filter(receiver=second, entity_identifier=task.id).count() == 1
    removed = Notification.objects.filter(receiver=first).latest("created_at")
    assert removed.data["issue_activity"]["old_identifier"] == str(first.id)
    session_client.force_authenticate(user=second)
    response = session_client.get(f"/api/workspaces/{workspace.slug}/users/notifications/?all_notifications=true")
    assert len(response.data) == 1
    assert response.data[0]["entity_title"] == task.name
    assert session_client.get(f"/api/workspaces/{workspace.slug}/users/notifications/{assigned.id}/").status_code == 404


def test_task_changes_notify_related_users_and_only_actual_changes(session_client, workspace):
    assignee = member(workspace, "event-update")
    task = create_task(session_client, workspace, assignee)
    path = f"/api/workspaces/{workspace.slug}/tasks/{task.id}/"
    values = {"status": "done", "priority": "urgent", "target_date": "2026-10-25"}
    assert session_client.patch(path, values, format="json").status_code == 200
    fields = list(Notification.objects.filter(receiver=assignee).values_list("data__issue_activity__field", flat=True))
    assert sorted(fields) == ["assignees", "priority", "state", "target_date"]
    before = Notification.objects.count()
    assert session_client.patch(path, values, format="json").status_code == 200
    assert Notification.objects.count() == before


def test_task_completion_by_assignee_notifies_creator(session_client, workspace, create_user):
    assignee = member(workspace, "event-complete")
    task = create_task(session_client, workspace, assignee)
    task.created_by = create_user
    task.save(disable_auto_set_user=True)
    session_client.force_authenticate(user=assignee)
    response = session_client.patch(
        f"/api/workspaces/{workspace.slug}/tasks/{task.id}/", {"status": "done"}, format="json"
    )
    assert response.status_code == 200
    assert Notification.objects.get(receiver=create_user).data["issue_activity"]["new_value"] == "done"
    assert Notification.objects.filter(receiver=assignee).count() == 1


def test_failed_or_cross_workspace_assignment_emits_no_event(session_client, workspace, create_user):
    assignee = member(workspace, "event-valid")
    task = create_task(session_client, workspace, assignee)
    outside_workspace = Workspace.objects.create(owner=create_user, name="Other", slug="event-other")
    outside = member(outside_workspace, "event-outside")
    count = Notification.objects.count()
    response = session_client.patch(
        f"/api/workspaces/{workspace.slug}/tasks/{task.id}/", {"assignee_id": str(outside.id)}, format="json"
    )
    assert response.status_code == 400
    task.refresh_from_db()
    assert task.assignee_id == assignee.id
    assert Notification.objects.count() == count


def test_task_creation_and_notice_are_atomic(session_client, workspace, mocker):
    assignee = member(workspace, "event-atomic")
    mocker.patch(
        "plane.app.views.workspace.task.notify_workspace_task", side_effect=RuntimeError("notification failure")
    )
    response = session_client.post(
        f"/api/workspaces/{workspace.slug}/tasks/",
        {"name": "Rollback", "assignee_id": str(assignee.id)},
        format="json",
    )
    assert response.status_code == 500
    assert not WorkspaceTask.objects.filter(name="Rollback").exists()
    assert not Notification.objects.exists()


def test_recipient_scope_excludes_inactive_members_and_bots(workspace, create_user):
    active = member(workspace, "event-active")
    inactive = member(workspace, "event-inactive")
    disabled = member(workspace, "event-disabled")
    bot = member(workspace, "event-bot")
    WorkspaceMember.objects.filter(workspace=workspace, member=inactive).update(is_active=False)
    disabled.is_active = False
    disabled.save()
    bot.is_bot = True
    bot.save()
    other = Workspace.objects.create(owner=create_user, name="Outside", slug="event-private")
    outsider = member(other, "event-private")
    notify_members(
        workspace.id,
        [active.id, active.id, inactive.id, disabled.id, bot.id, outsider.id, create_user.id],
        actor_id=create_user.id,
        sender="crm:test",
        entity_name="account",
        title="رویداد",
    )
    assert list(Notification.objects.values_list("receiver_id", flat=True)) == [active.id]


def routing_rule(workspace, user=None):
    role = OrganizationRole.objects.create(workspace=workspace, name="پشتیبانی")
    if user:
        UserOrganizationRole.objects.create(workspace=workspace, user=user, role=role)
    unit = OrganizationUnit.objects.create(workspace=workspace, title="پشتیبانی", manager=user)
    return TicketRoutingRule.objects.create(workspace=workspace, name="ارجاع پشتیبانی", unit=unit, required_role=role)


def test_automatic_routing_notifies_once_and_subscribes_assignee(workspace, create_user):
    assignee = member(workspace, "event-routed")
    issue = create_issue(workspace)
    rule = routing_rule(workspace, assignee)
    TicketRoutingService.route(issue, rule, actor_id=create_user.id)
    TicketRoutingService.route(issue, rule, actor_id=create_user.id)
    assert Notification.objects.filter(receiver=assignee, entity_identifier=issue.id).count() == 1
    assert IssueSubscriber.objects.filter(issue=issue, subscriber=assignee).exists()


def test_role_queue_notifies_eligible_role_members_once(session_client, workspace, create_user):
    eligible, denied, unrelated = [member(workspace, f"event-queue-{suffix}") for suffix in ("yes", "deny", "other")]
    issue = create_issue(workspace)
    issue.created_by = create_user
    issue.save(disable_auto_set_user=True)
    rule = routing_rule(workspace)
    for user in (eligible, denied):
        UserOrganizationRole.objects.create(workspace=workspace, user=user, role=rule.required_role)
    exception(workspace, denied, "Routing.Queue.View", "DENY")
    TicketRoutingService.route(issue, rule, actor_id=create_user.id)
    TicketRoutingService.route(issue, rule, actor_id=create_user.id)
    assert list(Notification.objects.filter(sender="crm:routing:queued").values_list("receiver_id", flat=True)) == [
        eligible.id
    ]
    entry = TicketRoleQueueEntry.objects.get(issue=issue)
    session_client.force_authenticate(user=eligible)
    response = session_client.post(
        f"/api/workspaces/{workspace.slug}/organization/role-queue/{entry.id}/claim/", {}, format="json"
    )
    assert response.status_code == 200
    assert Notification.objects.filter(receiver=create_user, sender="crm:routing:claimed").count() == 1
    assert IssueSubscriber.objects.filter(issue=issue, subscriber=eligible).exists()
    assert (
        session_client.post(
            f"/api/workspaces/{workspace.slug}/organization/role-queue/{entry.id}/claim/", {}, format="json"
        ).status_code
        == 409
    )
    assert Notification.objects.filter(sender="crm:routing:claimed").count() == 1
    assert not Notification.objects.filter(receiver=unrelated).exists()


def login_request(user):
    request = RequestFactory().get("/", HTTP_USER_AGENT="Mozilla Windows Chrome/130.0")
    SessionMiddleware(lambda request: None).process_request(request)
    user.backend = settings.AUTHENTICATION_BACKENDS[0]
    return request


def test_successful_app_login_is_personal_and_not_repeated_on_session_reads(session_client, workspace, create_user):
    other = member(workspace, "event-login-other")
    inactive_workspace = Workspace.objects.create(owner=create_user, name="Inactive", slug="event-login-inactive")
    WorkspaceMember.objects.create(workspace=inactive_workspace, member=create_user, is_active=False)
    request = login_request(create_user)
    user_login(request, create_user, is_app=True)
    row = Notification.objects.get(sender="crm:login")
    assert row.receiver_id == create_user.id
    assert row.workspace_id == workspace.id
    assert row.data["crm_event"] == {"kind": "login", "browser": "کروم", "device": "ویندوز"}
    assert not Notification.objects.filter(receiver=other).exists()
    for _ in range(2):
        assert session_client.get("/api/users/me/").status_code == 200
    assert Notification.objects.filter(sender="crm:login").count() == 1
    user_login(login_request(create_user), create_user, is_admin=True)
    assert Notification.objects.filter(sender="crm:login").count() == 1


def test_login_failure_does_not_emit_and_notice_failure_does_not_break_login(workspace, create_user, mocker):
    request = login_request(create_user)
    login = mocker.patch("plane.authentication.utils.login.login", side_effect=ValueError("failed login"))
    with pytest.raises(ValueError):
        user_login(request, create_user, is_app=True)
    assert not Notification.objects.exists()
    mocker.stop(login)
    mocker.patch("plane.app.services.crm_notifications.notify_login", side_effect=RuntimeError("notice unavailable"))
    mocker.patch("plane.utils.exception_logger.log_exception")
    user_login(request, create_user, is_app=True)
    assert request.session["_auth_user_id"] == str(create_user.id)


def test_existing_project_assignments_and_updates_reach_the_assignee(workspace, create_user, mocker):
    assignee = member(workspace, "event-project")
    issue = create_issue(workspace)
    ProjectMember.objects.create(project=issue.project, member=assignee, role=15)
    IssueAssignee.objects.create(project=issue.project, issue=issue, assignee=assignee)
    mocker.patch("plane.bgtasks.issue_activities_task.notifications.delay", side_effect=notifications.run)

    def activity(requested, previous):
        issue_activity.run(
            type="issue.activity.updated",
            issue_id=str(issue.id),
            project_id=str(issue.project_id),
            actor_id=str(create_user.id),
            epoch=int(timezone.now().timestamp()),
            notification=True,
            requested_data=json.dumps(requested),
            current_instance=json.dumps(previous),
        )

    activity({"assignee_ids": [str(assignee.id)]}, {"assignee_ids": []})
    row = Notification.objects.get(receiver=assignee)
    assert row.data["issue_activity"]["field"] == "assignees"
    activity({"priority": "urgent"}, {"priority": "none"})
    assert Notification.objects.filter(receiver=assignee, data__issue_activity__field="priority").exists()


def test_routed_assignee_receives_followup_even_without_project_membership(workspace, create_user, mocker):
    assignee = member(workspace, "event-routed-followup")
    issue = create_issue(workspace)
    rule = routing_rule(workspace, assignee)
    TicketRoutingService.route(issue, rule, actor_id=create_user.id)
    assert not ProjectMember.objects.filter(project=issue.project, member=assignee).exists()
    mocker.patch("plane.bgtasks.issue_activities_task.notifications.delay", side_effect=notifications.run)
    issue_activity.run(
        type="issue.activity.updated",
        issue_id=str(issue.id),
        project_id=str(issue.project_id),
        actor_id=str(create_user.id),
        epoch=int(timezone.now().timestamp()),
        notification=True,
        requested_data=json.dumps({"priority": "urgent"}),
        current_instance=json.dumps({"priority": "none"}),
    )
    assert Notification.objects.filter(receiver=assignee, data__issue_activity__field="priority").exists()


def test_all_event_feed_orders_newest_first(session_client, workspace, create_user):
    first = Notification.objects.create(
        workspace=workspace,
        receiver=create_user,
        title="قدیمی",
        sender="crm:login",
        entity_name="account",
        snoozed_till=timezone.now(),
    )
    latest = Notification.objects.create(
        workspace=workspace, receiver=create_user, title="تازه", sender="crm:login", entity_name="account"
    )
    response = session_client.get(f"/api/workspaces/{workspace.slug}/users/notifications/?all_notifications=true")
    assert [str(row["id"]) for row in response.data] == [str(latest.id), str(first.id)]
