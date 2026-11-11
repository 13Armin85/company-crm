"""Ticket 5 — ticket core on the native ``Issue`` row.

Single sources of truth:
- status category: :func:`work_category` / :func:`category_expression` (ن۶);
- deadline: ``Issue.target_*`` columns (decision 1), computed only through
  ``work_calendar.add_working_time`` / ``working_minutes_between``;
- history: ``EntityEvent`` rows on the ticket's public record id (append-only),
  plus ``TicketRoutingDecision`` for the referral chain and ``WorkflowExtension``
  / ``WorkflowDelayReport`` (ticket-level rows, ``issue`` set, ``step_run`` NULL).

Nothing here touches attendance, presence, overtime or payroll data.
"""

from datetime import datetime, timedelta

from django.db import transaction
from django.db.models import Case, CharField, Exists, OuterRef, Q, Value, When
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from plane.db.models import (
    EntityEvent,
    EntityType,
    Issue,
    IssueAssignee,
    IssueType,
    State,
    TicketRoleQueueEntry,
    TicketRoutingDecision,
    User,
    WorkflowDefinition,
    WorkflowDelayReport,
    WorkflowExtension,
    WorkflowInstance,
)
from .access_control import delegation_context, has_permission, management_relation
from .work_calendar import add_working_time, calendar_zone, schedule_for, working_minutes_between

TODO, IN_PROGRESS, DONE = "todo", "in_progress", "done"
CATEGORY_TITLES = {TODO: "انجام‌نشده", IN_PROGRESS: "در حال انجام", DONE: "انجام‌شده"}
# Plane state groups → category. cancelled is "done" (decision 8): it closes the ticket.
GROUP_CATEGORY = {
    "backlog": TODO,
    "unstarted": TODO,
    "triage": TODO,
    "started": IN_PROGRESS,
    "completed": DONE,
    "cancelled": DONE,
}
# task-status codes (tickets without a project) → category; review/blocked are still in progress.
STATUS_CATEGORY = {"todo": TODO, "in_progress": IN_PROGRESS, "review": IN_PROGRESS, "blocked": IN_PROGRESS, "done": DONE}
NEAR_DUE_PERCENT = 20  # decision 9
CALENDAR_LABELS = {
    "person": "برنامهٔ فرد",
    "exception": "استثنای برنامهٔ فرد",
    "team": "برنامهٔ تیم",
    "company": "برنامهٔ شرکت",
}
CALENDAR_HELP = {
    "person": "برنامهٔ کاری شخصی مسئول برای روز شروع ثبت شده است.",
    "exception": "برای روز شروع، استثنای برنامهٔ کاری مسئول (مثلاً تعطیلی یا شیفت) اعمال شده است.",
    "team": "مسئول برنامهٔ شخصی ندارد؛ برنامهٔ واحد/تیم او به کار رفته است.",
    "company": "نه برنامهٔ شخصی و نه برنامهٔ تیم وجود دارد؛ برنامهٔ عمومی شرکت به کار رفته است.",
}


# ---------------------------------------------------------------- ن۶ status categories


def work_category(*, group=None, status=None, project=True):
    """The one mapping to انجام‌نشده / در حال انجام / انجام‌شده (unknown codes are "todo")."""
    if project:
        return GROUP_CATEGORY.get(str(group or "").lower(), TODO)
    return STATUS_CATEGORY.get(str(status or "").lower(), TODO)


def category_of(issue):
    if issue.project_id:
        group = issue.state.group if issue.state_id else None
        return work_category(group=group)
    return work_category(status=issue.status, project=False)


def category_expression():
    """SQL twin of :func:`category_of` for filters, counters and kanban grouping."""
    whens = [
        When(project__isnull=True, status__in=[k for k, v in STATUS_CATEGORY.items() if v == cat], then=Value(cat))
        for cat in (IN_PROGRESS, DONE)
    ] + [
        When(project__isnull=False, state__group__in=[k for k, v in GROUP_CATEGORY.items() if v == cat], then=Value(cat))
        for cat in (IN_PROGRESS, DONE)
    ]
    return Case(*whens, default=Value(TODO), output_field=CharField())


def open_q(prefix=""):
    """Q for tickets not in the "done" category."""
    done_groups = [k for k, v in GROUP_CATEGORY.items() if v == DONE]
    done_status = [k for k, v in STATUS_CATEGORY.items() if v == DONE]
    return ~(
        Q(**{f"{prefix}project__isnull": True, f"{prefix}status__in": done_status})
        | Q(**{f"{prefix}project__isnull": False, f"{prefix}state__group__in": done_groups})
    )


def overdue_q(now=None):
    now = now or timezone.now()
    return open_q() & Q(target_anchor_at__isnull=False, target_at__isnull=False, target_at__lt=now)


def unassigned_q():
    active = IssueAssignee.objects.filter(issue_id=OuterRef("pk"), deleted_at__isnull=True)
    queued = TicketRoleQueueEntry.objects.filter(issue_id=OuterRef("pk"), status="open", deleted_at__isnull=True)
    return ~Q(Exists(active)) | Q(Exists(queued))


def preset_filter(queryset, preset, user, now=None):
    """Ready filters of ن۷; applied after the visibility filter, never instead of it."""
    if preset in (None, "", "all"):
        return queryset
    if preset == "mine":
        return queryset.filter(issue_assignee__assignee=user, issue_assignee__deleted_at__isnull=True).distinct()
    if preset == "unassigned":
        return queryset.filter(unassigned_q())
    if preset == "overdue":
        return queryset.filter(overdue_q(now))
    if preset == "closed":
        return queryset.exclude(open_q())
    raise ValidationError({"preset": "فیلتر آماده معتبر نیست."})


PRESETS = ("all", "mine", "unassigned", "overdue", "closed")


def preset_counts(queryset, user, now=None):
    return {name: preset_filter(queryset, name, user, now).order_by().values("pk").distinct().count() for name in PRESETS}


# ---------------------------------------------------------------- helpers


def root_entity(workspace_id):
    return EntityType.objects.filter(workspace_id=workspace_id, code="ticket", parent__isnull=True).first()


def fa_moment(value, workspace):
    from .workflow_engine import fa_moment as engine_moment

    return engine_moment(value, workspace)


def iso(value, workspace):
    return value.astimezone(calendar_zone(workspace)).isoformat() if value else None


def user_name(user):
    return (user.display_name or user.email or user.username) if user else ""


def _reason(data, key="reason", required=True):
    value = data.get(key)
    value = value.strip() if isinstance(value, str) else ""
    if required and not value:
        raise ValidationError({key: "ثبت دلیل الزامی است."})
    if len(value) > 2000:
        raise ValidationError({key: "متن حداکثر می‌تواند ۲۰۰۰ نویسه باشد."})
    return value


def _moment(value, label, workspace):
    if not isinstance(value, str) or not value:
        raise ValidationError({label: "زمان را انتخاب کنید."})
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise ValidationError({label: "قالب زمان معتبر نیست."})
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=calendar_zone(workspace))


def ensure_minutes(value, label="minutes", allow_empty=False):
    if value in (None, "") and allow_empty:
        return None
    try:
        minutes = int(value)
    except (TypeError, ValueError):
        raise ValidationError({label: "مدت را به دقیقهٔ کاری وارد کنید."})
    if minutes <= 0 or minutes > 60 * 24 * 365:
        raise ValidationError({label: "مدت باید بیشتر از صفر و کمتر از یک سال کاری باشد."})
    return minutes


def record(issue, actor, event_type, *, field="", before=None, after=None, reason="", **metadata):
    """Append one history row on the ticket (never updated or deleted)."""
    from .entity_records import json_value

    event = EntityEvent(
        workspace_id=issue.workspace_id,
        entity=root_entity(issue.workspace_id),
        record_id=issue.id,
        event_type=event_type,
        field=field,
        before=json_value(before),
        after=json_value(after),
        metadata={**{k: json_value(v) for k, v in metadata.items()}, **({"reason": reason} if reason else {})},
        created_by_id=getattr(actor, "id", actor),
    )
    event.save(created_by_id=getattr(actor, "id", actor))
    return event


def _notify(issue, receivers, actor_id, title, message, kind):
    from .crm_notifications import notify_members

    notify_members(
        issue.workspace_id,
        [r for r in receivers if r],
        actor_id=actor_id,
        sender=f"crm:ticket:{kind}",
        project_id=issue.project_id,
        entity_name="issue",
        entity_id=issue.id,
        title=title,
        message=message,
        data={"crm_event": {"kind": f"ticket_{kind}", "entity": "ticket", "record_id": str(issue.id)}},
    )


def primary_assignee(issue):
    """Decision 7: the oldest active assignee is the basis of calendar and direct manager."""
    row = (
        IssueAssignee.objects.filter(issue=issue, deleted_at__isnull=True, assignee__is_active=True)
        .select_related("assignee")
        .order_by("created_at", "id")
        .first()
    )
    return row.assignee if row else None


def calendar_user(issue):
    from .workflow_engine import company_calendar_user

    stored = (issue.target_calendar or {}).get("user_id")
    if stored:
        user = User.objects.filter(id=stored).first()
        if user:
            return user
    return primary_assignee(issue) or company_calendar_user()


def visible_ticket(workspace, user, issue_id, request=None):
    from .task_visibility import visible_issues

    try:
        rows = visible_issues(
            Issue.objects.filter(workspace=workspace), user, workspace.slug, request=request
        )
        return rows.select_related("state", "type", "workspace").get(id=issue_id)
    except (Issue.DoesNotExist, ValueError, TypeError):
        raise NotFound("تیکت پیدا نشد یا اجازهٔ دیدن آن را ندارید.")


def is_owner(issue, user, request=None):
    """Full (not read-only) relation: creator, assignee, project owner/lead or Issue.ViewAll."""
    if issue.created_by_id == user.id or has_permission(user, issue.workspace, "Issue.ViewAll", request=request):
        return True
    if IssueAssignee.objects.filter(issue=issue, assignee=user, deleted_at__isnull=True).exists():
        return True
    return bool(issue.project_id) and (
        issue.project.created_by_id == user.id or issue.project.project_lead_id == user.id
    )


def participant_q(user, workspace=None):
    """Decision 6: read-only visibility for extension approvers and referral participants."""
    substitutes = []
    if workspace is not None:
        substitutes = [
            item["manager_id"] for item in delegation_context(workspace).values() if item["user_id"] == user.id
        ]
    return (
        Q(deadline_extensions__approver=user, deadline_extensions__deleted_at__isnull=True)
        | Q(deadline_extensions__approver_id__in=substitutes, deadline_extensions__status="pending")
        | Q(routing_decisions__outcome="referred", routing_decisions__assigned_user=user)
        | Q(routing_decisions__outcome="referred", routing_decisions__referred_by=user)
    )


def require_owner(issue, user, request=None):
    if not is_owner(issue, user, request):
        raise PermissionDenied("دسترسی شما به این تیکت فقط‌خواندنی است.")


# ---------------------------------------------------------------- ن۲ target duration


def type_minutes(issue):
    if not issue.type_id:
        return None
    return IssueType.objects.filter(id=issue.type_id).values_list("target_minutes", flat=True).first()


def effective_minutes(issue):
    """Ticket override > type default > none."""
    if issue.target_minutes:
        return issue.target_minutes, "ticket"
    minutes = type_minutes(issue)
    return (minutes, "type") if minutes else (None, None)


def _calendar_info(user, start, workspace):
    day = schedule_for(user, start.astimezone(calendar_zone(workspace)).date(), workspace)
    return {
        "source": day.source,
        "source_id": day.source_id,
        "user_id": str(user.id) if user.id and user.id.int else None,
        "builtin": day.builtin,
    }


def _store(issue, **values):
    for key, value in values.items():
        setattr(issue, key, value)
    Issue.objects.filter(pk=issue.pk).update(**values)


def _deadline(issue, user, anchor, minutes):
    return add_working_time(user, anchor, max(minutes, 0), issue.workspace)


def on_saved(issue, old_category, created, now=None):
    """Post-save lifecycle (signal): start, close, reopen and restart of the target clock."""
    if issue.is_draft:
        return
    now = now or timezone.now()
    new_category = category_of(issue)
    actor = issue.updated_by_id or issue.created_by_id
    if old_category == new_category and not created:
        return
    if not created and old_category is not None:
        record(
            issue,
            actor,
            "ticket.category_changed",
            field="status",
            before=CATEGORY_TITLES[old_category],
            after=CATEGORY_TITLES[new_category],
            category_before=old_category,
            category_after=new_category,
        )
    if new_category == DONE and old_category != DONE:
        _close(issue, actor, now, created)
    elif old_category == DONE and new_category != DONE and not created:
        record(issue, actor, "ticket.reopened", before=CATEGORY_TITLES[DONE], after=CATEGORY_TITLES[new_category])
    if new_category == IN_PROGRESS:
        _start(issue, actor, now)


def _start(issue, actor, now):
    if issue.target_anchor_at is not None:
        return  # moving between "in progress" statuses never moves the start (ن۲)
    first = issue.target_started_at is None
    minutes, origin = effective_minutes(issue)
    if first:
        values = {"target_started_at": now}
        if minutes:
            user = primary_assignee(issue)
            from .workflow_engine import company_calendar_user

            user = user or company_calendar_user()
            target = _deadline(issue, user, now, minutes)
            calendar = {**_calendar_info(user, now, issue.workspace), "total": minutes, "origin": origin}
            values.update(
                target_anchor_at=now,
                target_anchor_minutes=minutes,
                target_at=target,
                target_calendar=calendar,
            )
        _store(issue, **values)
        record(
            issue,
            actor,
            "ticket.target_started",
            after=iso(issue.target_at, issue.workspace),
            started_at=iso(now, issue.workspace),
            target_minutes=minutes,
            target_origin=origin,
            calendar=issue.target_calendar,
        )
        return
    if issue.target_anchor_minutes is None:
        return
    # Decision 2: after reopening, the remaining working time continues from the restart.
    user = calendar_user(issue)
    previous = issue.target_at
    target = previous if issue.target_anchor_minutes <= 0 else _deadline(issue, user, now, issue.target_anchor_minutes)
    _store(issue, target_anchor_at=now, target_at=target, overdue_flagged_at=None, overdue_reminded_at=None)
    record(
        issue,
        actor,
        "ticket.target_restarted",
        field="target_at",
        before=iso(previous, issue.workspace),
        after=iso(target, issue.workspace),
        remaining_minutes=issue.target_anchor_minutes,
    )


def _remaining(issue, now):
    """Signed working minutes until the deadline (negative = overdue)."""
    if not issue.target_at:
        return None
    user = calendar_user(issue)
    if now <= issue.target_at:
        return working_minutes_between(user, now, issue.target_at, issue.workspace)
    return -working_minutes_between(user, issue.target_at, now, issue.workspace)


def _close(issue, actor, now, created=False):
    spent = None
    if issue.target_anchor_at is not None:
        remaining = _remaining(issue, now)
        total = (issue.target_calendar or {}).get("total")
        spent = total - remaining if total is not None and remaining is not None else None
        _store(issue, target_anchor_at=None, target_anchor_minutes=remaining)
    if not created:
        record(issue, actor, "ticket.closed", after=CATEGORY_TITLES[DONE], spent_minutes=spent)


def set_target(workspace, actor, issue_id, data, request=None, now=None):
    """Set or change one ticket's target duration (manager with Ticket.TargetSet, reason required)."""
    now = now or timezone.now()
    if not has_permission(actor, workspace, "Ticket.TargetSet", request=request):
        raise PermissionDenied("مجوز تعیین مدت هدف تیکت را ندارید.")
    reason = _reason(data)
    minutes = ensure_minutes(data.get("minutes"), allow_empty=True)
    with transaction.atomic():
        visible_ticket(workspace, actor, issue_id, request)
        issue = Issue.objects.select_for_update(of=("self",)).select_related("state", "workspace").get(id=issue_id)
        before_minutes, before_origin = effective_minutes(issue)
        before_target = issue.target_at
        issue.target_minutes = minutes
        Issue.objects.filter(pk=issue.pk).update(target_minutes=minutes)
        after_minutes, after_origin = effective_minutes(issue)
        if before_minutes == after_minutes:
            raise ValidationError({"minutes": "مدت هدف جدید با مقدار فعلی یکی است."})
        _retarget(issue, before_minutes, after_minutes, after_origin, now)
        record(
            issue,
            actor,
            "ticket.target_changed",
            field="target_minutes",
            before=before_minutes,
            after=after_minutes,
            reason=reason,
            target_before=iso(before_target, workspace),
            target_after=iso(issue.target_at, workspace),
            origin_before=before_origin,
            origin_after=after_origin,
        )
    return issue


def _retarget(issue, before_minutes, after_minutes, origin, now):
    calendar = dict(issue.target_calendar or {})
    if issue.target_started_at is None:
        return  # not started: the deadline is computed at the first start
    delta = (after_minutes or 0) - (before_minutes or 0)
    if issue.target_anchor_minutes is None:
        # Started without a target: the clock counts from the first start (or waits if closed).
        if not after_minutes:
            return
        user = primary_assignee(issue)
        from .workflow_engine import company_calendar_user

        user = user or company_calendar_user()
        calendar = {**_calendar_info(user, issue.target_started_at, issue.workspace), "total": after_minutes}
        values = {"target_anchor_minutes": after_minutes, "target_calendar": {**calendar, "origin": origin}}
        if category_of(issue) != DONE:
            values.update(
                target_anchor_at=issue.target_started_at,
                target_at=_deadline(issue, user, issue.target_started_at, after_minutes),
            )
        _store(issue, **values)
        return
    calendar["total"] = (calendar.get("total") or 0) + delta
    calendar["origin"] = origin
    anchor_minutes = issue.target_anchor_minutes + delta
    values = {"target_anchor_minutes": anchor_minutes, "target_calendar": calendar}
    if issue.target_anchor_at is not None:
        values["target_at"] = _deadline(issue, calendar_user(issue), issue.target_anchor_at, anchor_minutes)
        values["overdue_flagged_at"] = None
        values["overdue_reminded_at"] = None
    _store(issue, **values)


def set_type_target(workspace, actor, type_id, data, request=None):
    """Default target of a ticket type; tickets already started keep their stored deadline."""
    if not has_permission(actor, workspace, "Ticket.TargetSet", request=request):
        raise PermissionDenied("مجوز تعیین مدت هدف تیکت را ندارید.")
    reason = _reason(data)
    minutes = ensure_minutes(data.get("minutes"), allow_empty=True)
    native = IssueType.objects.filter(workspace=workspace, id=type_id).first()
    if native is None:
        raise NotFound("نوع تیکت پیدا نشد.")
    before = native.target_minutes
    IssueType.objects.filter(id=native.id).update(target_minutes=minutes)
    from .entity_records import json_value

    EntityEvent(
        workspace=workspace,
        entity=root_entity(workspace.id),
        event_type="ticket.type_target_changed",
        field="target_minutes",
        before=json_value(before),
        after=json_value(minutes),
        metadata={"issue_type_id": str(native.id), "reason": reason},
    ).save(created_by_id=actor.id)
    native.target_minutes = minutes
    return native


# ---------------------------------------------------------------- ن۴ extension


def extension_recipient(owner, workspace, now=None):
    """Direct manager of the primary assignee; absent → their delegate, else the unit delegate (decision 4)."""
    from .workflow_engine import acting_delegate, is_absent, managers_of, unit_delegate

    unit, direct, _ = managers_of(owner, workspace)
    if direct:
        manager = User.objects.filter(id=direct[0], is_active=True).first()
        if manager and not is_absent(manager, workspace, now):
            return manager, "مدیر مستقیم"
        delegate = (acting_delegate(manager, workspace, now) if manager else None) or (
            unit_delegate(direct[1], workspace, now)
        )
        if delegate and delegate.id != owner.id:
            return delegate, "جانشین فعال مدیر مستقیم"
        raise ValidationError(
            f"مدیر مستقیم شما ({user_name(manager)}) غایب است و جانشین فعالی ندارد؛ درخواست تمدید قابل ثبت نیست."
        )
    delegate = unit_delegate(unit, workspace, now) if unit is not None else None
    if delegate and delegate.id != owner.id:
        return delegate, "جانشین واحد (واحد مدیر ندارد)"
    name = unit.title if unit is not None else "شما"
    raise ValidationError(f"برای واحد {name} مدیر مستقیم یا جانشین فعالی تعریف نشده است؛ درخواست تمدید قابل ثبت نیست.")


def requester_role(issue, actor, now=None):
    """"assignee" (primary), "delegate" (active substitute of the primary) or None."""
    from .workflow_engine import acting_delegate

    owner = primary_assignee(issue)
    if owner is None:
        return None, None
    if owner.id == actor.id:
        return "assignee", owner
    delegate = acting_delegate(owner, issue.workspace, now)
    if delegate and delegate.id == actor.id:
        return "delegate", owner
    return None, owner


def _extension_base(issue, actor, now):
    role, owner = requester_role(issue, actor, now)
    if role is None:
        raise PermissionDenied("درخواست تمدید فقط از سوی مسئول تیکت یا جانشین فعال او ممکن است.")
    if category_of(issue) == DONE:
        raise ValidationError("تیکت بسته است و موعدی برای تمدید ندارد.")
    if not issue.target_at or issue.target_anchor_at is None:
        raise ValidationError("برای این تیکت موعدی محاسبه نشده که تمدید شود.")
    return owner


def preview_extension(workspace, actor, issue_id, data, request=None, now=None):
    now = now or timezone.now()
    issue = visible_ticket(workspace, actor, issue_id, request)
    owner = _extension_base(issue, actor, now)
    minutes = ensure_minutes(data.get("minutes"))
    approver, why = extension_recipient(owner, workspace, now)
    requested = add_working_time(calendar_user(issue), issue.target_at, minutes, workspace)
    return {
        "current_target_at": iso(issue.target_at, workspace),
        "current_target_text": fa_moment(issue.target_at, workspace),
        "requested_target_at": iso(requested, workspace),
        "requested_target_text": fa_moment(requested, workspace),
        "minutes": minutes,
        "approver": {"id": str(approver.id), "name": user_name(approver), "relation": why},
    }


def request_extension(workspace, actor, issue_id, data, request=None, now=None):
    now = now or timezone.now()
    with transaction.atomic():
        visible_ticket(workspace, actor, issue_id, request)
        issue = Issue.objects.select_for_update(of=("self",)).select_related("state", "workspace").get(id=issue_id)
        owner = _extension_base(issue, actor, now)
        minutes = ensure_minutes(data.get("minutes"))
        reason = _reason(data)
        if WorkflowExtension.objects.filter(issue=issue, status=WorkflowExtension.Status.PENDING).exists():
            raise ValidationError("یک درخواست تمدید باز برای این تیکت وجود دارد.")
        approver, why = extension_recipient(owner, workspace, now)
        requested = add_working_time(calendar_user(issue), issue.target_at, minutes, workspace)
        row = WorkflowExtension.objects.create(
            issue=issue,
            scope=WorkflowExtension.Scope.TICKET,
            requested_by=actor,
            previous_target_at=issue.target_at,
            requested_target_at=requested,
            minutes=minutes,
            reason=reason,
            approver=approver,
        )
        record(
            issue,
            actor,
            "ticket.extension_requested",
            field="target_at",
            before=iso(issue.target_at, workspace),
            after=iso(requested, workspace),
            reason=reason,
            extension_id=str(row.id),
            minutes=minutes,
            approver_id=str(approver.id),
            approver_name=user_name(approver),
        )
        _notify(
            issue,
            [approver.id],
            actor.id,
            "درخواست تمدید موعد تیکت",
            f"{user_name(actor)} برای «{issue.name}» {minutes} دقیقهٔ کاری تمدید خواسته است (تا {fa_moment(requested, workspace)}).",
            "extension",
        )
    return row


def approver_ok(actor, extension, workspace, request=None, now=None):
    """Only the stored approver, the assignee's direct manager, or the approver's active delegate."""
    from .workflow_engine import acting_delegate

    owner_ids = {extension.requested_by_id}
    primary = primary_assignee(extension.issue)
    if primary:
        owner_ids.add(primary.id)
    if actor.id in owner_ids:
        return False
    if extension.approver_id == actor.id:
        return True
    if primary and management_relation(actor, primary, workspace, request=request) == "direct":
        return True
    if extension.approver_id:
        delegate = acting_delegate(User(id=extension.approver_id), workspace, now)
        return bool(delegate and delegate.id == actor.id)
    return False


def decide_extension(workspace, actor, extension_id, data, request=None, now=None):
    now = now or timezone.now()
    with transaction.atomic():
        try:
            extension = WorkflowExtension.objects.select_for_update(of=("self",)).get(
                id=extension_id, issue__workspace=workspace
            )
        except (WorkflowExtension.DoesNotExist, ValueError, TypeError):
            raise NotFound("درخواست تمدید پیدا نشد.")
        issue = Issue.objects.select_for_update(of=("self",)).select_related("state", "workspace").get(
            id=extension.issue_id
        )
        extension.issue = issue
        if extension.status != WorkflowExtension.Status.PENDING:
            raise ValidationError("این درخواست تمدید قبلاً بررسی شده است.")
        if not approver_ok(actor, extension, workspace, request, now):
            raise PermissionDenied(
                "فقط مدیر مستقیم مسئول تیکت (یا جانشین فعال او) می‌تواند درخواست تمدید را بررسی کند."
            )
        approve = data.get("approve")
        if not isinstance(approve, bool):
            raise ValidationError({"approve": "تأیید یا رد درخواست را مشخص کنید."})
        reason = _reason(data, required=not approve)
        extension.status = WorkflowExtension.Status.APPROVED if approve else WorkflowExtension.Status.REJECTED
        extension.decided_by, extension.decided_at, extension.decision_reason = actor, now, reason
        extension.save()
        before = issue.target_at
        if approve:
            # The new deadline is computed on the deadline in force at decision time.
            target = add_working_time(calendar_user(issue), issue.target_at, extension.minutes or 0, workspace)
            if not extension.minutes:
                target = extension.requested_target_at
            calendar = dict(issue.target_calendar or {})
            calendar["total"] = (calendar.get("total") or 0) + (extension.minutes or 0)
            _store(
                issue,
                target_at=target,
                target_anchor_minutes=(issue.target_anchor_minutes or 0) + (extension.minutes or 0),
                target_calendar=calendar,
                overdue_flagged_at=None,
                overdue_reminded_at=None,
            )
        record(
            issue,
            actor,
            "ticket.extension_approved" if approve else "ticket.extension_rejected",
            field="target_at",
            before=iso(before, workspace),
            after=iso(issue.target_at, workspace),
            reason=reason,
            extension_id=str(extension.id),
            minutes=extension.minutes,
        )
        _notify(
            issue,
            [extension.requested_by_id],
            actor.id,
            "نتیجهٔ درخواست تمدید",
            "درخواست تمدید شما تأیید شد." if approve else f"درخواست تمدید شما رد شد: {reason}",
            "extension",
        )
    return extension


def pending_extensions_for(actor, workspace, now=None):
    """Inbox rows: pending ticket extensions this person may decide."""
    rows = WorkflowExtension.objects.filter(
        issue__workspace=workspace, status=WorkflowExtension.Status.PENDING
    ).select_related("issue", "requested_by", "approver")
    return [row for row in rows if approver_ok(actor, row, workspace, now=now)]


# ---------------------------------------------------------------- ن۵ delay


def is_overdue(issue, now=None):
    now = now or timezone.now()
    return bool(
        issue.target_at and issue.target_anchor_at is not None and category_of(issue) != DONE and now > issue.target_at
    )


def delay_report(workspace, actor, issue_id, data, request=None, now=None):
    """Append-only report; its expected time is an estimate and never moves the official deadline."""
    now = now or timezone.now()
    with transaction.atomic():
        visible_ticket(workspace, actor, issue_id, request)
        issue = Issue.objects.select_for_update(of=("self",)).select_related("state", "workspace").get(id=issue_id)
        role, _ = requester_role(issue, actor, now)
        if role is None:
            raise PermissionDenied("گزارش تأخیر فقط از سوی مسئول تیکت یا جانشین فعال او ممکن است.")
        if not is_overdue(issue, now):
            raise ValidationError("این تیکت هنوز از موعد نگذشته است.")
        reason = _reason(data)
        progress = _reason(data, key="progress")
        expected = _moment(data.get("expected_at"), "expected_at", workspace)
        if expected <= now:
            raise ValidationError({"expected_at": "زمان پایان جدید باید در آینده باشد."})
        report = WorkflowDelayReport.objects.create(
            issue=issue, reporter=actor, reason=reason, progress=progress, expected_at=expected, target_at=issue.target_at
        )
        record(
            issue,
            actor,
            "ticket.delay_reported",
            reason=reason,
            progress=progress,
            expected_at=iso(expected, workspace),
            target_at=iso(issue.target_at, workspace),
            report_id=str(report.id),
        )
    return report


def mark_overdue(now=None):
    """Periodic (celery beat): flag overdue tickets once per deadline and remind once a day (decision 9).

    Idempotent: the flag/reminder columns are set under a row lock with skip_locked,
    so a second run in the same window does nothing. Never changes status.
    """
    from .workflow_engine import managers_of

    now = now or timezone.now()
    flagged = reminded = 0
    candidates = (
        Issue.objects.filter(overdue_q(now), deleted_at__isnull=True, is_draft=False)
        .filter(Q(overdue_flagged_at__isnull=True) | Q(overdue_reminded_at__lt=now - timedelta(days=1)))
        .values_list("id", flat=True)[:2000]
    )
    for issue_id in list(candidates):
        with transaction.atomic():
            issue = (
                Issue.objects.select_for_update(skip_locked=True, of=("self",))
                .select_related("state", "workspace")
                .filter(id=issue_id)
                .first()
            )
            if issue is None or not is_overdue(issue, now):
                continue
            first = issue.overdue_flagged_at is None
            if not first and issue.overdue_reminded_at and issue.overdue_reminded_at >= now - timedelta(days=1):
                continue
            reported = WorkflowDelayReport.objects.filter(issue=issue, target_at=issue.target_at).exists()
            if not first and reported:
                continue
            owner = primary_assignee(issue)
            receivers = [owner.id] if owner else []
            if owner and first:
                _, direct, _ = managers_of(owner, issue.workspace)
                if direct:
                    receivers.append(direct[0])
            values = {"overdue_reminded_at": now}
            if first:
                values["overdue_flagged_at"] = now
            _store(issue, **values)
            if first:
                record(issue, None, "ticket.overdue_flagged", target_at=iso(issue.target_at, issue.workspace))
                flagged += 1
            else:
                reminded += 1
            _notify(
                issue,
                receivers,
                None,
                "موعد تیکت گذشته است",
                f"موعد «{issue.name}» ({fa_moment(issue.target_at, issue.workspace)}) گذشته است؛ "
                "دلیل تأخیر، وضعیت پیشرفت و زمان پایان جدید را ثبت کنید.",
                "overdue",
            )
    return {"flagged": flagged, "reminded": reminded}


# ---------------------------------------------------------------- ن۳ display payload


def deadline_payload(issue, viewer, request=None, now=None):
    now = now or timezone.now()
    workspace = issue.workspace
    minutes, origin = effective_minutes(issue)
    category = category_of(issue)
    calendar = issue.target_calendar or {}
    pending = (
        WorkflowExtension.objects.filter(issue=issue, status=WorkflowExtension.Status.PENDING)
        .select_related("approver", "requested_by")
        .first()
    )
    history = WorkflowExtension.objects.filter(issue=issue).select_related("approver", "decided_by", "requested_by")
    last_report = WorkflowDelayReport.objects.filter(issue=issue).select_related("reporter").order_by("-created_at").first()
    remaining = _remaining(issue, now) if issue.target_anchor_at is not None else None
    total = calendar.get("total")
    if not minutes and not issue.target_at:
        state = "none"
    elif category == DONE and issue.target_started_at:
        state = "closed"
    elif issue.target_anchor_at is None:
        state = "not_started"
    elif remaining is not None and remaining < 0 or is_overdue(issue, now):
        state = "overdue"
    elif remaining is not None and total and remaining <= total * NEAR_DUE_PERCENT / 100:
        state = "near_due"
    else:
        state = "running"
    role, _ = requester_role(issue, viewer, now)
    owner = is_owner(issue, viewer, request)
    source = calendar.get("source")
    spent = None
    if state == "closed" and total is not None and issue.target_anchor_minutes is not None:
        spent = total - issue.target_anchor_minutes
    return {
        "state": state,
        "category": category,
        "category_title": CATEGORY_TITLES[category],
        "target_minutes": minutes,
        "target_origin": origin,
        "ticket_minutes": issue.target_minutes,
        "type_minutes": type_minutes(issue),
        "total_minutes": total,
        "started_at": iso(issue.target_started_at, workspace),
        "started_text": fa_moment(issue.target_started_at, workspace),
        "target_at": iso(issue.target_at, workspace),
        "target_text": fa_moment(issue.target_at, workspace),
        "remaining_minutes": remaining if remaining is None or remaining >= 0 else 0,
        "overdue_minutes": -remaining if remaining is not None and remaining < 0 else 0,
        "spent_minutes": spent,
        "calendar": {
            "source": source,
            "label": CALENDAR_LABELS.get(source, ""),
            "help": CALENDAR_HELP.get(source, ""),
            "source_id": calendar.get("source_id"),
            "builtin": calendar.get("builtin", False),
        },
        "overdue_flagged_at": iso(issue.overdue_flagged_at, workspace),
        "pending_extension": serialize_extension(pending, workspace) if pending else None,
        "extensions": [serialize_extension(row, workspace) for row in history],
        "last_delay_report": serialize_report(last_report, workspace) if last_report else None,
        "delay_report_needed": state == "overdue"
        and not WorkflowDelayReport.objects.filter(issue=issue, target_at=issue.target_at).exists(),
        "can": {
            "set_target": owner and has_permission(viewer, workspace, "Ticket.TargetSet", request=request),
            "request_extension": role is not None and state in {"running", "near_due", "overdue"} and pending is None,
            "report_delay": role is not None and state == "overdue",
            "decide_extension": bool(pending and approver_ok(viewer, pending, workspace, request, now)),
        },
        "why": {
            "request_extension": (
                "فقط مسئول تیکت یا جانشین فعال او می‌تواند تمدید بخواهد."
                if role is None
                else "یک درخواست تمدید در انتظار تأیید است."
                if pending
                else "موعدی برای تمدید محاسبه نشده است."
                if state not in {"running", "near_due", "overdue"}
                else ""
            ),
            "report_delay": (
                "فقط مسئول تیکت یا جانشین فعال او گزارش تأخیر ثبت می‌کند."
                if role is None
                else "گزارش تأخیر فقط پس از گذشتن موعد لازم است."
                if state != "overdue"
                else ""
            ),
        },
    }


def serialize_extension(row, workspace):
    return {
        "id": str(row.id),
        "status": row.status,
        "status_title": row.get_status_display(),
        "minutes": row.minutes,
        "reason": row.reason,
        "decision_reason": row.decision_reason,
        "previous_target_at": iso(row.previous_target_at, workspace),
        "previous_target_text": fa_moment(row.previous_target_at, workspace),
        "requested_target_at": iso(row.requested_target_at, workspace),
        "requested_target_text": fa_moment(row.requested_target_at, workspace),
        "requested_by": user_name(row.requested_by),
        "approver": user_name(row.approver),
        "decided_by": user_name(row.decided_by),
        "decided_at": iso(row.decided_at, workspace),
        "created_at": iso(row.created_at, workspace),
    }


def serialize_report(row, workspace):
    return {
        "id": str(row.id),
        "reason": row.reason,
        "progress": row.progress,
        "expected_at": iso(row.expected_at, workspace),
        "expected_text": fa_moment(row.expected_at, workspace),
        "target_at": iso(row.target_at, workspace),
        "reporter": user_name(row.reporter),
        "created_at": iso(row.created_at, workspace),
    }


# ---------------------------------------------------------------- ن۹ manual referral


def _active_referral(issue):
    return (
        TicketRoutingDecision.objects.filter(
            issue=issue, outcome=TicketRoutingDecision.Outcome.REFERRED, response=TicketRoutingDecision.Response.PENDING
        )
        .select_related("assigned_user", "referred_by")
        .order_by("-created_at")
        .first()
    )


def _replace_assignee(issue, user):
    rows = IssueAssignee.objects.filter(issue=issue, deleted_at__isnull=True)
    previous = list(rows.values_list("assignee_id", flat=True))
    for row in rows.exclude(assignee=user):
        row.delete()
    IssueAssignee.objects.get_or_create(
        issue=issue, assignee=user, deleted_at__isnull=True,
        defaults={"workspace_id": issue.workspace_id, "project_id": issue.project_id},
    )
    if not issue.project_id:
        Issue.objects.filter(pk=issue.pk).update(assignee=user)
    TicketRoleQueueEntry.objects.filter(issue=issue, status="open").update(status="closed")
    return previous


def _member(workspace, user_id):
    from plane.db.models import WorkspaceMember

    try:
        row = WorkspaceMember.objects.select_related("member").get(
            workspace=workspace, member_id=user_id, is_active=True, member__is_active=True, member__is_bot=False
        )
    except (WorkspaceMember.DoesNotExist, ValueError, TypeError):
        raise ValidationError({"user_id": "گیرنده باید عضو فعال شرکت باشد."})
    return row.member


def _check_project_member(issue, user):
    from plane.db.models import ProjectMember

    if issue.project_id and not ProjectMember.objects.filter(
        project_id=issue.project_id, member=user, is_active=True, role__gte=15
    ).exists():
        raise ValidationError({"user_id": "گیرنده باید عضو فعال پروژهٔ این تیکت باشد."})


def refer(workspace, actor, issue_id, data, request=None, previous=None):
    """Manual referral with a mandatory reason; the target must accept, reject or forward."""
    from .task_policy import validate_other_assignees

    reason = _reason(data)
    with transaction.atomic():
        visible_ticket(workspace, actor, issue_id, request)
        issue = Issue.objects.select_for_update(of=("self",)).select_related("workspace", "state").get(id=issue_id)
        pending = _active_referral(issue)
        if previous is None:
            assigned = IssueAssignee.objects.filter(issue=issue, assignee=actor, deleted_at__isnull=True).exists()
            manager = has_permission(actor, workspace, "Routing.Route", request=request) and (
                is_owner(issue, actor, request) or has_permission(actor, workspace, "Routing.Queue.ViewAll", request=request)
            )
            if not (assigned or manager):
                raise PermissionDenied("فقط مسئول تیکت یا مدیر دارای مجوز ارجاع می‌تواند تیکت را ارجاع دهد.")
            if pending is not None:
                raise ValidationError("این تیکت یک ارجاع در انتظار پاسخ دارد.")
        target = _member(workspace, data.get("user_id"))
        validate_other_assignees(actor, workspace, [target.id])
        if target.id == actor.id:
            raise ValidationError({"user_id": "نمی‌توانید تیکت را به خودتان ارجاع دهید."})
        _check_project_member(issue, target)
        before = _replace_assignee(issue, target)
        decision = TicketRoutingDecision.objects.create(
            issue=issue,
            outcome=TicketRoutingDecision.Outcome.REFERRED,
            assigned_user=target,
            referred_by=actor,
            previous=previous,
            method="manual",
            reason=reason,
            response=TicketRoutingDecision.Response.PENDING,
            details={"previous_assignees": [str(x) for x in before]},
        )
        record(
            issue,
            actor,
            "ticket.referred",
            field="assignee",
            before=[str(x) for x in before],
            after=[str(target.id)],
            reason=reason,
            decision_id=str(decision.id),
            to_name=user_name(target),
        )
        _notify(issue, [target.id], actor.id, "تیکت به شما ارجاع شد", f"«{issue.name}» — {reason}", "referral")
    return decision


def respond_referral(workspace, actor, issue_id, data, request=None):
    """accept / reject (back to the referrer, decision 5) / forward (a new referral, with a reason)."""
    action = data.get("action")
    if action not in {"accept", "reject", "forward"}:
        raise ValidationError({"action": "اقدام معتبر نیست."})
    with transaction.atomic():
        visible_ticket(workspace, actor, issue_id, request)
        issue = Issue.objects.select_for_update(of=("self",)).select_related("workspace", "state").get(id=issue_id)
        decision = _active_referral(issue)
        if decision is None:
            raise ValidationError("ارجاعی در انتظار پاسخ برای این تیکت نیست.")
        if decision.assigned_user_id != actor.id:
            raise PermissionDenied("فقط گیرندهٔ ارجاع می‌تواند به آن پاسخ دهد.")
        reason = _reason(data, required=action != "accept")
        now = timezone.now()
        if action == "forward":
            TicketRoutingDecision.objects.filter(id=decision.id).update(
                response=TicketRoutingDecision.Response.FORWARDED, responded_at=now, response_reason=reason
            )
            return refer(workspace, actor, issue.id, {"user_id": data.get("user_id"), "reason": reason}, request, decision)
        if action == "accept":
            TicketRoutingDecision.objects.filter(id=decision.id).update(
                response=TicketRoutingDecision.Response.ACCEPTED, responded_at=now, response_reason=reason
            )
            record(issue, actor, "ticket.referral_accepted", reason=reason, decision_id=str(decision.id))
            return decision
        referrer = decision.referred_by
        if referrer is None or not referrer.is_active:
            raise ValidationError("ارجاع‌دهنده دیگر فعال نیست؛ تیکت را به فرد دیگری ارجاع دهید.")
        TicketRoutingDecision.objects.filter(id=decision.id).update(
            response=TicketRoutingDecision.Response.REJECTED, responded_at=now, response_reason=reason
        )
        _replace_assignee(issue, referrer)
        record(
            issue,
            actor,
            "ticket.referral_rejected",
            field="assignee",
            before=[str(actor.id)],
            after=[str(referrer.id)],
            reason=reason,
            decision_id=str(decision.id),
            to_name=user_name(referrer),
        )
        _notify(issue, [referrer.id], actor.id, "ارجاع تیکت رد شد", f"«{issue.name}» به شما برگشت: {reason}", "referral")
    return decision


def referral_chain(issue):
    workspace = issue.workspace
    return [
        {
            "id": str(row.id),
            "outcome": row.outcome,
            "method": row.method,
            "rule": row.rule.name if row.rule_id else "",
            "to": user_name(row.assigned_user),
            "to_id": str(row.assigned_user_id) if row.assigned_user_id else None,
            "by": user_name(row.referred_by),
            "reason": row.reason,
            "details": row.details,
            "response": row.response,
            "response_title": row.get_response_display() if row.response else "",
            "response_reason": row.response_reason,
            "responded_at": iso(row.responded_at, workspace),
            "created_at": iso(row.created_at, workspace),
            "created_text": fa_moment(row.created_at, workspace),
        }
        for row in issue.routing_decisions.select_related("assigned_user", "referred_by", "rule").order_by("created_at")
    ]


# ---------------------------------------------------------------- ن۱۲ first-contact resolution


def _close_ticket(issue, actor):
    entity = root_entity(issue.workspace_id)
    if entity is not None and issue.project_id is None:
        from .entity_records import apply_workflow_status

        apply_workflow_status(entity, actor, issue.id, "done")
        return
    if issue.project_id:
        state = (
            State.objects.filter(project_id=issue.project_id, group="completed").order_by("-default", "sequence").first()
        )
        if state is None:
            raise ValidationError("پروژهٔ این تیکت وضعیت «انجام‌شده» ندارد.")
        issue.state = state
    else:
        issue.status = "done"
    issue.updated_by = actor
    issue.save()


def contact_resolve(workspace, actor, issue_id, data, request=None, now=None):
    """Record a first contact on the ticket's own history; solved → closed, not solved → normal routing."""
    from .workflow_engine import contact_channels

    now = now or timezone.now()
    issue = visible_ticket(workspace, actor, issue_id, request)
    require_owner(issue, actor, request)
    if category_of(issue) == DONE:
        raise ValidationError("تیکت بسته است.")
    channels = {row["code"]: row["title"] for row in contact_channels(workspace)}
    channel = data.get("channel")
    if channel not in channels:
        raise ValidationError({"channel": "کانال تماس را از فهرست انتخاب کنید."})
    contact_name = _reason(data, key="contact_name")
    summary = _reason(data, key="summary")
    resolved = data.get("resolved")
    if not isinstance(resolved, bool):
        raise ValidationError({"resolved": "نتیجهٔ تماس (حل شد / حل نشد) را انتخاب کنید."})
    contact_at = _moment(data.get("contact_at"), "contact_at", workspace) if data.get("contact_at") else now
    if contact_at > now:
        raise ValidationError({"contact_at": "زمان تماس نمی‌تواند در آینده باشد."})
    contact = {
        "channel": channel,
        "channel_title": channels[channel],
        "contact_name": contact_name,
        "contact_at": iso(contact_at, workspace),
        "contact_text": fa_moment(contact_at, workspace),
        "summary": summary,
        "resolved": resolved,
    }
    instance = (
        WorkflowInstance.objects.filter(
            workspace=workspace, record_id=issue.id, status=WorkflowInstance.Status.RUNNING,
            definition__kind=WorkflowDefinition.Kind.FAST_PATH,
        )
        .first()
    )
    with transaction.atomic():
        if instance is not None:
            # The ticket runs ticket 4's fast path: the same contact goes through that engine.
            from . import workflow_actions

            if resolved:
                workflow_actions.contact_resolve(
                    workspace,
                    actor,
                    instance.id,
                    {**data, "contact_at": contact["contact_at"], "outcome": "حل شد", "revision": instance.revision},
                    now=now,
                )
            else:
                workflow_actions.to_standard(
                    workspace, actor, instance.id, {"reason": summary, "revision": instance.revision}, request, now
                )
        record(issue, actor, "ticket.contact", reason=summary, contact=contact)
        routed = None
        if instance is None:
            if resolved:
                _close_ticket(Issue.objects.select_related("state", "workspace").get(id=issue.id), actor)
            else:
                from .ticket_routing import TicketRoutingService

                routed = TicketRoutingService.route_auto(issue, actor_id=actor.id)
    return {"contact": contact, "routed": routed}


# ---------------------------------------------------------------- ن۱۱ / ۶.۹ history


EVENT_KINDS = {
    "status": ("ticket.category_changed", "record.status_changed"),
    "assignee": ("ticket.referred", "ticket.referral_rejected", "ticket.referral_accepted", "ticket.routed", "ticket.queued"),
    "deadline": ("ticket.target_started", "ticket.target_changed", "ticket.target_restarted", "ticket.overdue_flagged"),
    "extension": ("ticket.extension_requested", "ticket.extension_approved", "ticket.extension_rejected"),
    "delay": ("ticket.delay_reported",),
    "contact": ("ticket.contact",),
    "lifecycle": ("ticket.closed", "ticket.reopened"),
    "fields": ("ticket.field_changed",),
}


def history(issue, kind=None):
    workspace = issue.workspace
    rows = EntityEvent.objects.filter(workspace=workspace, record_id=issue.id).order_by("created_at", "id")
    status_fields = ("ticket_state", "task_status", "status")
    if kind:
        if kind not in EVENT_KINDS:
            raise ValidationError({"kind": "نوع رویداد معتبر نیست."})
        matched = Q(event_type__in=EVENT_KINDS[kind])
        # Form saves record one "record.field_changed" row per field; place them under the right filter.
        if kind == "status":
            matched |= Q(event_type="record.field_changed", field__in=status_fields)
        elif kind == "assignee":
            matched |= Q(event_type="record.field_changed", field__in=("ticket_assignees", "assignee"))
        elif kind == "fields":
            matched |= Q(event_type="record.field_changed") & ~Q(
                field__in=(*status_fields, "ticket_assignees", "assignee")
            )
        rows = rows.filter(matched)
    actors = {u.id: u for u in User.objects.filter(id__in={r.created_by_id for r in rows if r.created_by_id})}
    kinds = {event: name for name, events in EVENT_KINDS.items() for event in events}

    def kind_of(row):
        if row.event_type == "record.field_changed":
            if row.field in status_fields:
                return "status"
            if row.field in ("ticket_assignees", "assignee"):
                return "assignee"
            return "fields"
        return kinds.get(row.event_type, "other")
    return [
        {
            "id": str(row.id),
            "type": row.event_type,
            "kind": kind_of(row),
            "field": row.field,
            "before": row.before,
            "after": row.after,
            "metadata": row.metadata,
            "reason": (row.metadata or {}).get("reason", ""),
            "actor": user_name(actors.get(row.created_by_id)) or "سامانه",
            "created_at": iso(row.created_at, workspace),
            "created_text": fa_moment(row.created_at, workspace),
        }
        for row in rows
    ]


def deadline_badges(issue_ids, workspace, now=None):
    """Compact deadline state for a page of list/kanban rows (bounded by the page size)."""
    now = now or timezone.now()
    rows = Issue.objects.filter(id__in=[i for i in issue_ids if i], workspace=workspace).select_related("state", "workspace")
    result = {}
    for issue in rows:
        if not issue.target_at and not effective_minutes(issue)[0]:
            continue
        category = category_of(issue)
        if category == DONE and issue.target_started_at:
            state = "closed"
        elif issue.target_anchor_at is None:
            state = "not_started"
        elif now > issue.target_at:
            state = "overdue"
        else:
            total = (issue.target_calendar or {}).get("total") or 0
            threshold = total * NEAR_DUE_PERCENT / 100
            wall = (issue.target_at - now).total_seconds() / 60
            near = wall <= threshold or (
                wall <= 7 * 24 * 60 and working_minutes_between(calendar_user(issue), now, issue.target_at, workspace) <= threshold
            )
            state = "near_due" if near else "running"
        result[str(issue.id)] = {
            "state": state,
            "target_at": iso(issue.target_at, workspace),
            "target_text": fa_moment(issue.target_at, workspace),
        }
    return result


# ---------------------------------------------------------------- ن۱ / ن۱۱ core fields


FIELD_EVENT_TITLES = {
    "priority": "اولویت",
    "target_date": "سررسید",
    "type_id": "نوع",
    "project_id": "پروژه",
    "parent_id": "تیکت والد",
}


def _label(field, value):
    from plane.db.models import Project

    if value in (None, ""):
        return None
    if field == "type_id":
        return IssueType.objects.filter(id=value).values_list("name", flat=True).first() or str(value)
    if field == "project_id":
        return Project.objects.filter(id=value).values_list("name", flat=True).first() or str(value)
    if field == "parent_id":
        return Issue.all_objects.filter(id=value).values_list("name", flat=True).first() or str(value)
    return str(value)


def on_field_changes(issue, changes):
    """One immutable history row per changed core field (any write path)."""
    actor = issue.updated_by_id or issue.created_by_id
    for field, (before, after) in changes.items():
        record(
            issue,
            actor,
            "ticket.field_changed",
            field=field,
            before=_label(field, before),
            after=_label(field, after),
            field_title=FIELD_EVENT_TITLES.get(field, field),
            before_id=str(before) if before else None,
            after_id=str(after) if after else None,
        )


def _ancestors(issue_id, limit=200):
    seen, current = [], issue_id
    while current and len(seen) < limit:
        seen.append(current)
        current = Issue.all_objects.filter(id=current).values_list("parent_id", flat=True).first()
    return seen


def set_parent(workspace, actor, issue_id, data, request=None):
    """Parent/child on Issue.parent: same workspace, visible to the actor, never a cycle."""
    with transaction.atomic():
        visible_ticket(workspace, actor, issue_id, request)
        issue = (
            Issue.objects.select_for_update(of=("self",))
            .select_related("state", "workspace", "project")
            .get(id=issue_id)
        )
        require_owner(issue, actor, request)
        parent_id = data.get("parent_id") or None
        parent = None
        if parent_id:
            try:
                parent = visible_ticket(workspace, actor, parent_id, request)
            except NotFound:
                raise ValidationError({"parent_id": "تیکت والد پیدا نشد یا اجازهٔ دیدن آن را ندارید."})
            if parent.workspace_id != issue.workspace_id:
                raise ValidationError({"parent_id": "تیکت والد باید در همین شرکت باشد."})
            if str(issue.id) in map(str, _ancestors(parent.id)):
                raise ValidationError(
                    {"parent_id": "این انتخاب حلقه می‌سازد؛ تیکت نمی‌تواند والد خودش یا والد والدش باشد."}
                )
        issue.parent = parent
        issue.updated_by = actor
        issue.save()
    return issue


def details_payload(issue, viewer, request=None):
    from .task_visibility import visible_issues

    workspace = issue.workspace
    rows = visible_issues(Issue.objects.filter(workspace=workspace), viewer, workspace.slug, request=request)
    parent = rows.filter(id=issue.parent_id).values("id", "name").first() if issue.parent_id else None
    children = list(rows.filter(parent_id=issue.id).values("id", "name")[:50])
    creator = User.objects.filter(id=issue.created_by_id).first()
    labels = (
        list(issue.labels.filter(label_issue__deleted_at__isnull=True).values_list("name", flat=True))
        if issue.project_id
        else []
    )
    estimate = getattr(issue.estimate_point, "value", None) if issue.estimate_point_id else None
    return {
        "creator": user_name(creator),
        "type": IssueType.objects.filter(id=issue.type_id).values_list("name", flat=True).first()
        if issue.type_id
        else None,
        "project": issue.project.name if issue.project_id else None,
        "priority": issue.priority,
        "due_date": issue.target_date.isoformat() if issue.target_date else None,
        "estimate": estimate,
        "labels": labels,
        "parent": {"id": str(parent["id"]), "name": parent["name"]} if parent else None,
        "parent_hidden": bool(issue.parent_id and not parent),
        "children": [{"id": str(c["id"]), "name": c["name"]} for c in children],
    }


# ---------------------------------------------------------------- ۶.۲ header: status menu and customer


def status_payload(issue, viewer, request=None):
    """Current status and its choices (project states or task-status), each with its ن۶ category.

    Changing it goes through the normal record save (permissions, workflow lock, history);
    ``field`` is the form field bound to the work status.
    """
    from plane.db.models import LookupValue
    from .entity_schema import schema_fields

    entity = root_entity(issue.workspace_id)
    field = None
    if entity is not None:
        _, fields = schema_fields(entity)
        field = next((code for code, item in fields.items() if item["binding"].get("source") == "work_status"), None)
    if issue.project_id:
        options = [
            {"id": str(row.id), "title": row.name, "category": work_category(group=row.group)}
            for row in State.objects.filter(project_id=issue.project_id).exclude(group="triage").order_by("sequence")
        ]
        current = str(issue.state_id) if issue.state_id else None
    else:
        options = [
            {"id": row.code, "title": row.title, "category": work_category(status=row.code, project=False)}
            for row in LookupValue.objects.filter(
                category__workspace_id=issue.workspace_id,
                category__code="task-status",
                category__is_active=True,
                is_active=True,
            ).order_by("position", "id")
        ]
        current = issue.status
    can = has_permission(viewer, issue.workspace, "Issue.Status.Edit", request=request) and is_owner(
        issue, viewer, request
    )
    return {
        "field": field,
        "current": current,
        "category": category_of(issue),
        "options": options,
        "can_change": bool(field and can),
        "why": "" if field and can else "اجازهٔ تغییر وضعیت این تیکت را ندارید.",
    }


def customers_of(issue, viewer, request=None):
    """Customer records linked through the existing relation, only those the viewer may see."""
    from plane.db.models import EntityRecord, EntityRelationLink
    from .entity_records import record_queryset

    customer = EntityType.objects.filter(
        workspace_id=issue.workspace_id, code="customer", parent__isnull=True, is_active=True
    ).first()
    if customer is None:
        return []
    links = EntityRelationLink.objects.filter(relation__deleted_at__isnull=True).filter(
        Q(left_id=issue.id, relation__right_entity=customer) | Q(right_id=issue.id, relation__left_entity=customer)
    )
    ids = {str(link.right_id if str(link.left_id) == str(issue.id) else link.left_id) for link in links}
    if not ids:
        return []
    visible = record_queryset(customer, viewer, request).filter(id__in=ids)
    return [
        {"id": str(row.id), "title": (row.data or {}).get(customer.title_field) or row.number or "مشتری"}
        for row in visible[:10]
    ]
