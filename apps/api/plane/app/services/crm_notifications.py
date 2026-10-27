"""User-facing CRM events stored with the transaction that caused them."""

from django.db import transaction

from plane.db.models import IssueSubscriber, Notification, UserOrganizationRole, WorkspaceMember


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
            for receiver_id in receivers
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
        row.member_id for row in members if has_permission(row.member, entry.issue.workspace_id, "Routing.Queue.View")
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
