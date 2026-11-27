"""User-facing CRM events stored with the transaction that caused them."""

from django.db import transaction

from plane.db.models import IssueSubscriber, Notification, User, UserNotificationPreference, UserOrganizationRole, WorkspaceMember


def preference_field(sender):
    """Map a CRM event to the one optional inbox switch that controls it."""
    if sender.startswith("crm:routing:") or sender == "crm:ticket:referral":
        return "crm_routing"
    if sender in {"crm:ticket:extension", "crm:ticket:overdue"}:
        return "crm_deadline"
    if sender.startswith("crm:ticket:"):
        return "crm_ticket_status"
    if sender == "crm:workflow":
        return "crm_workflow_action"
    if sender == "crm:leave":
        return "crm_leave_result"
    if sender == "crm:daily_report:reminder":
        return "crm_daily_report"
    if sender.startswith("crm:portal:"):
        return "crm_portal"
    return None


def _may_view_notification(user, workspace_id, entity_name, entity_id):
    """Check the source before creating a CRM notification or copying its text."""
    if not entity_id:
        return True
    if entity_name == "issue":
        from rest_framework.exceptions import NotFound, PermissionDenied

        from plane.db.models import Workspace
        from .ticket_core import visible_ticket

        workspace = Workspace.objects.get(id=workspace_id)
        try:
            visible_ticket(workspace, user, entity_id)
            return True
        except (NotFound, PermissionDenied):
            return False
    if entity_name == "leave_request":
        from plane.db.models import LeaveRequest
        from .leave_requests import can_view

        row = LeaveRequest.objects.filter(workspace_id=workspace_id, id=entity_id).first()
        return bool(row and can_view(user, row))
    if entity_name == "workflow":
        from plane.db.models import WorkflowInstance
        from .workflow_engine import can_view_instance

        instance = WorkflowInstance.objects.filter(workspace_id=workspace_id, record_id=entity_id).order_by("-created_at").first()
        return bool(instance and can_view_instance(user, instance))
    return True


def notify_members(
    workspace_id,
    receiver_ids,
    *,
    actor_id,
    sender,
    entity_name,
    entity_id=None,
    project_id=None,
    title,
    message="",
    data=None,
    include_actor=False,
):
    receivers = (
        WorkspaceMember.objects.filter(
            workspace_id=workspace_id,
            member_id__in=set(receiver_ids),
            is_active=True,
            member__is_active=True,
            member__is_bot=False,
        )
        .values_list("member_id", flat=True)
        .distinct()
    )
    if actor_id and not include_actor:
        receivers = receivers.exclude(member_id=actor_id)
    receiver_ids = list(receivers)
    field = preference_field(sender)
    if field:
        disabled = set(
            UserNotificationPreference.objects.filter(user_id__in=receiver_ids, **{field: False}).values_list("user_id", flat=True)
        )
        receiver_ids = [user_id for user_id in receiver_ids if user_id not in disabled]
    if sender.startswith("crm:") and entity_name in {"issue", "leave_request", "workflow"}:
        users = User.objects.in_bulk(receiver_ids)
        receiver_ids = [
            user_id for user_id in receiver_ids
            if user_id in users and _may_view_notification(users[user_id], workspace_id, entity_name, entity_id)
        ]
    return Notification.objects.bulk_create(
        [
            Notification(
                workspace_id=workspace_id,
                project_id=project_id,
                receiver_id=receiver_id,
                triggered_by_id=actor_id,
                sender=sender,
                entity_name=entity_name,
                entity_identifier=entity_id,
                title=title,
                message_stripped=message,
                data=data,
            )
            for receiver_id in receiver_ids
        ]
    )


def task_snapshot(task):
    return {
        "assignee_id": str(task.assignee_id) if task.assignee_id else None,
        "assignee_name": task.assignee.display_name if task.assignee_id else "",
        "state": task.status,
        "priority": task.priority,
        "target_date": task.target_date.isoformat() if task.target_date else None,
    }


def notify_workspace_task(task, actor_id, previous=None):
    current = task_snapshot(task)
    base = {"issue": {"name": task.name}, "crm_event": {"kind": "workspace_task"}}

    def emit(receivers, field, old_value, new_value, *, include_actor=False, **identifiers):
        notify_members(
            task.workspace_id,
            receivers,
            actor_id=actor_id,
            sender="crm:workspace_task",
            entity_name="workspace_task",
            entity_id=task.id,
            title="به‌روزرسانی کار",
            include_actor=include_actor,
            data={
                **base,
                "issue_activity": {
                    "field": field,
                    "verb": "updated",
                    "old_value": old_value,
                    "new_value": new_value,
                    **identifiers,
                },
            },
        )

    if previous is None or previous["assignee_id"] != current["assignee_id"]:
        emit([task.assignee_id], "assignees", "", current["assignee_name"], new_identifier=current["assignee_id"])
        if previous is not None:
            emit(
                [previous["assignee_id"]],
                "assignees",
                previous["assignee_name"],
                "",
                old_identifier=previous["assignee_id"],
                include_actor=True,
            )
    if previous is not None:
        receivers = [task.assignee_id]
        if task.created_by_id:
            receivers.append(task.created_by_id)
        for field in ("state", "priority", "target_date"):
            if previous[field] != current[field]:
                emit(receivers, field, previous[field], current[field])


def subscribe_assignee(issue, user_id):
    if not issue.project_id:
        return  # issue_subscribers.project_id is NOT NULL; standalone work has no subscriber row
    IssueSubscriber.objects.get_or_create(
        issue=issue,
        subscriber_id=user_id,
        defaults={"workspace_id": issue.workspace_id, "project_id": issue.project_id},
    )


def notify_routed_issue(issue, assignee_id, actor_id):
    subscribe_assignee(issue, assignee_id)
    notify_members(
        issue.workspace_id,
        [assignee_id],
        actor_id=actor_id,
        sender="crm:routing:assigned",
        project_id=issue.project_id,
        entity_name="issue",
        entity_id=issue.id,
        title="واگذاری کار",
        data={
            "issue": {"name": issue.name},
            "issue_activity": {
                "field": "assignees",
                "verb": "updated",
                "old_value": "",
                "new_value": "شما",
                "new_identifier": str(assignee_id),
            },
        },
    )


def notify_role_queue(entry, actor_id):
    from .access_control import has_permission
    from .project_visibility import visible_projects
    from plane.db.models import Project

    members = WorkspaceMember.objects.filter(
        workspace_id=entry.issue.workspace_id,
        is_active=True,
        member__is_active=True,
        member__is_bot=False,
        member_id__in=UserOrganizationRole.objects.filter(
            workspace_id=entry.issue.workspace_id,
            role=entry.required_role,
            role__is_active=True,
            is_active=True,
        ).values("user_id"),
    ).select_related("member")
    receivers = [
        row.member_id for row in members
        if has_permission(row.member, entry.issue.workspace_id, "Routing.Queue.View")
        and (
            not entry.issue.project_id
            or visible_projects(
                Project.objects.filter(id=entry.issue.project_id, workspace_id=entry.issue.workspace_id),
                row.member, entry.issue.workspace.slug,
            ).exists()
        )
    ]
    notify_members(
        entry.issue.workspace_id,
        receivers,
        actor_id=actor_id,
        sender="crm:routing:queued",
        project_id=entry.issue.project_id,
        entity_name="issue",
        entity_id=entry.issue_id,
        title="کار جدید در صف نقش شما",
        message=f"کار «{entry.issue.name}» در صف نقش «{entry.required_role.name}» آمادهٔ پذیرش است.",
        data={"issue": {"name": entry.issue.name}, "crm_event": {"kind": "queued"}},
    )


def notify_queue_claim(entry, actor_id):
    subscribe_assignee(entry.issue, actor_id)
    receivers = [entry.issue.created_by_id] if entry.issue.created_by_id else []
    notify_members(
        entry.issue.workspace_id,
        receivers,
        actor_id=actor_id,
        sender="crm:routing:claimed",
        project_id=entry.issue.project_id,
        entity_name="issue",
        entity_id=entry.issue_id,
        title="پذیرش کار از صف",
        data={"issue": {"name": entry.issue.name}, "crm_event": {"kind": "claimed"}},
    )


@transaction.atomic
def notify_login(user, request):
    if not user.is_active or user.is_bot:
        return
    agent = request.META.get("HTTP_USER_AGENT", "").lower()
    browser = next(
        (
            label
            for token, label in [
                ("edg/", "اج"),
                ("firefox/", "فایرفاکس"),
                ("chrome/", "کروم"),
                ("safari/", "سافاری"),
            ]
            if token in agent
        ),
        "مرورگر",
    )
    device = next(
        (
            label
            for token, label in [
                ("android", "اندروید"),
                ("iphone", "آیفون"),
                ("ipad", "آیپد"),
                ("windows", "ویندوز"),
                ("macintosh", "مک"),
                ("linux", "لینوکس"),
            ]
            if token in agent
        ),
        "دستگاه شما",
    )
    workspace_ids = (
        WorkspaceMember.objects.filter(member=user, is_active=True).values_list("workspace_id", flat=True).distinct()
    )
    for workspace_id in workspace_ids:
        notify_members(
            workspace_id,
            [user.id],
            actor_id=user.id,
            sender="crm:login",
            entity_name="account",
            entity_id=user.id,
            title="ورود تازه به حساب شما",
            include_actor=True,
            message=f"ورود موفق به حساب شما با {browser} در {device} ثبت شد.",
            data={"crm_event": {"kind": "login", "browser": browser, "device": device}},
        )
