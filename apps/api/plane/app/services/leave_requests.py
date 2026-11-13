"""Leave requests (ticket 6): the first real record of the workflow engine.

Reuse, not parallel machinery:
- duration: ``work_calendar`` (weekly schedules, unit/company calendars and dated
  exceptions such as holidays); nothing here defines working time;
- approval route: ``workflow_actions``/``workflow_engine`` through the record
  source registered below; the leave request never decides who approves;
- absence: an approved request creates exactly one ``UserAbsence`` (idempotent);
- files: private ``FileAsset`` rows; audit: ``EntityEvent`` via ``emit``;
- notifications: ``crm_notifications.notify_members``.

The mode ("daily"/"hourly") only says how the period is entered. There is no
leave category anywhere: it is owned by another system.
"""

import hashlib
import json
from datetime import date, datetime, time, timedelta
from uuid import UUID

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from plane.db.models import (
    LEAVE_ATTACHMENT,
    LEAVE_DOCUMENT,
    EntityEvent,
    EntityRecord,
    EntityType,
    FileAsset,
    LeaveRequest,
    LeaveRequestVersion,
    OrganizationUnit,
    OrganizationUnitMember,
    SystemIdentifierCounter,
    User,
    UserAbsence,
    WorkflowDecision,
    WorkflowInstance,
    WorkflowStepRun,
    WorkspaceMember,
)
from . import leave_documents as documents
from . import leave_templates as templates
from . import signatures
from . import workflow_engine as engine
from .access_control import delegation_context, has_permission, management_relation
from .crm_notifications import notify_members
from .entity_identifiers import format_record_number
from .entity_records import emit
from .work_calendar import calendar_zone, schedule_range, working_minutes_between
from .work_calendar_actions import fa_date

ENTITY_CODE = "leave_request"
ADAPTER = "leave_request"
MAX_SPAN_DAYS = 366
MAX_ATTACHMENTS = 10
ATTACHMENT_CONFIG = {
    "max_file_size": 5 * 1024 * 1024,
    "extensions": ["pdf", "jpg", "jpeg", "png", "doc", "docx", "xls", "xlsx", "txt"],
}
STATUS = LeaveRequest.Status
STATUS_TITLES = dict(STATUS.choices)
MODE_TITLES = dict(LeaveRequestVersion.Mode.choices)
WORKFLOW_STATUSES = [STATUS.PENDING, STATUS.RETURNED, STATUS.APPROVED, STATUS.REJECTED]
EDITABLE_STATUSES = {STATUS.DRAFT, STATUS.RETURNED}
FA_DIGITS = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")
SUBMIT_BLOCKED = "ارسال درخواست مرخصی فقط با دکمهٔ «ثبت امضا و ارسال برای تأیید» در صفحهٔ درخواست انجام می‌شود."


def fa(value):
    return str(value).translate(FA_DIGITS)


def person(user):
    return {"id": str(user.id), "name": engine.user_name(user)} if user else None


# ---------------------------------------------------------------- entity


def ensure_leave_entity(workspace):
    """The workflow record type of leave requests (idempotent; designers pick it for the approval route)."""
    entity, _ = EntityType.objects.get_or_create(
        workspace=workspace,
        code=ENTITY_CODE,
        defaults={
            "title": "درخواست مرخصی (فرم و امضا)",
            "adapter": ADAPTER,
            "icon": "calendar-off",
            "numbering": {"prefix": "LRQ", "padding": 5},
            "title_field": "number",
            "record_permissions": {
                "view": "LeaveRequest.Create",
                "view_all": "LeaveRequest.ViewAll",
                "create": "LeaveRequest.Create",
                "edit": "LeaveRequest.Create",
                "delete": "LeaveRequest.ViewAll",
            },
        },
    )
    return entity


def leave_entity(workspace):
    return ensure_leave_entity(workspace)


# ---------------------------------------------------------------- calendar


def working_days(user, workspace, start_date, end_date):
    return sum(1 for day in schedule_range(user, start_date, end_date, workspace) if day.working)


def duration_text(mode, days, minutes):
    if mode == LeaveRequestVersion.Mode.DAILY:
        return f"{fa(days or 0)} روز کاری"
    hours, rest = divmod(minutes or 0, 60)
    parts = []
    if hours:
        parts.append(f"{fa(hours)} ساعت")
    if rest:
        parts.append(f"{fa(rest)} دقیقه")
    return " و ".join(parts or ["۰ دقیقه"]) + " کاری"


def _date(value, label):
    try:
        return date.fromisoformat(str(value))
    except (TypeError, ValueError):
        raise ValidationError({label: "تاریخ معتبر نیست."})


def _time(value, label):
    try:
        return time.fromisoformat(str(value))
    except (TypeError, ValueError):
        raise ValidationError({label: "ساعت معتبر نیست."})


def resolve_period(workspace, user, data):
    """Validate the period and compute the working duration on the person's own calendar.

    Returns a dict with mode, dates, aware ``starts_at``/``ends_at`` and the
    duration. Daily: whole local days, counted only when the resolved schedule
    says the day is a working day (weekly off days and dated non-working
    exceptions such as holidays are skipped). Hourly: only the part of the
    period inside the person's working intervals (shift hours minus breaks).
    """
    mode = data.get("mode")
    if mode not in LeaveRequestVersion.Mode.values:
        raise ValidationError({"mode": "شیوهٔ مدت فقط «روزانه» یا «ساعتی» است."})
    zone = calendar_zone(workspace)
    start_date = _date(data.get("start_date"), "start_date")
    end_date = _date(data.get("end_date") or data.get("start_date"), "end_date")
    if end_date < start_date:
        raise ValidationError({"end_date": "پایان مرخصی نباید پیش از شروع آن باشد."})
    if (end_date - start_date).days >= MAX_SPAN_DAYS:
        raise ValidationError({"end_date": "بازهٔ مرخصی نمی‌تواند بیش از یک سال باشد."})
    if mode == LeaveRequestVersion.Mode.DAILY:
        starts_at = datetime.combine(start_date, time(0), tzinfo=zone)
        ends_at = datetime.combine(end_date + timedelta(days=1), time(0), tzinfo=zone)
        days = working_days(user, workspace, start_date, end_date)
        if days == 0:
            raise ValidationError(
                {"end_date": "در این بازه هیچ روز کاری (طبق تقویم کاری شما) وجود ندارد؛ مدت صفر پذیرفته نمی‌شود."}
            )
        return {
            "mode": mode,
            "start_date": start_date,
            "end_date": end_date,
            "starts_at": starts_at,
            "ends_at": ends_at,
            "duration_days": days,
            "duration_minutes": None,
        }
    start_time = _time(data.get("start_time"), "start_time")
    end_time = _time(data.get("end_time"), "end_time")
    starts_at = datetime.combine(start_date, start_time, tzinfo=zone)
    ends_at = datetime.combine(end_date, end_time, tzinfo=zone)
    if ends_at <= starts_at:
        raise ValidationError({"end_time": "پایان مرخصی باید بعد از شروع آن باشد."})
    minutes = working_minutes_between(user, starts_at, ends_at, workspace)
    if minutes == 0:
        raise ValidationError({"end_time": "این بازه بیرون از ساعات کاری شیفت شماست؛ مدت صفر پذیرفته نمی‌شود."})
    return {
        "mode": mode,
        "start_date": start_date,
        "end_date": end_date,
        "starts_at": starts_at,
        "ends_at": ends_at,
        "duration_days": None,
        "duration_minutes": minutes,
    }


# ---------------------------------------------------------------- reading


def get_request(workspace, request_id, lock=False):
    rows = LeaveRequest.objects.filter(workspace=workspace).select_related("requester", "absence")
    if lock:
        rows = rows.select_for_update(of=("self",))
    try:
        row = rows.filter(id=UUID(str(request_id))).first()
    except (TypeError, ValueError):
        row = None
    if row is None:
        raise NotFound("درخواست مرخصی پیدا نشد.")
    return row


def current_version(row):
    return (
        row.versions.select_related("substitute", "template_version", "signature", "signed_by")
        .order_by("-number")
        .first()
    )


def instance_of(row):
    return engine.instance_for(leave_entity(row.workspace), row.id)


def managed_user_ids(actor, workspace, request=None):
    """People below ``actor`` in the organization (direct or indirect), from the shared manager scope."""
    from .access_control import _org_scope

    _, target_units = _org_scope(workspace, request)
    result = set()
    for user_id in target_units:
        if management_relation(actor, User(id=user_id), workspace, request=request):
            result.add(user_id)
    return result


def visible_queryset(actor, workspace, request=None):
    """Server-side visibility: own requests, requests I take part in, my organization's people, or ViewAll."""
    rows = LeaveRequest.objects.filter(workspace=workspace)
    if has_permission(actor, workspace, "LeaveRequest.ViewAll", request=request):
        return rows
    entity = leave_entity(workspace)
    me = str(actor.id)
    delegated_for = [
        item["manager_id"] for item in delegation_context(workspace).values() if item["user_id"] == actor.id
    ]
    runs = WorkflowStepRun.objects.filter(instance__entity=entity, instance__workspace=workspace).filter(
        Q(assignee=actor)
        | Q(candidate_ids__contains=[me])
        | Q(assignee_id__in=delegated_for, status=WorkflowStepRun.Status.ACTIVE)
    )
    decided = WorkflowDecision.objects.filter(instance__entity=entity, instance__workspace=workspace, actor=actor)
    return rows.filter(
        Q(requester=actor)
        | Q(id__in=runs.values("instance__record_id"))
        | Q(id__in=decided.values("instance__record_id"))
        | Q(requester_id__in=managed_user_ids(actor, workspace, request))
    )


def can_view(actor, row, request=None):
    if row.requester_id == actor.id:
        return True
    return visible_queryset(actor, row.workspace, request).filter(id=row.id).exists()


def require_view(actor, row, request=None):
    if not can_view(actor, row, request):
        raise PermissionDenied("اجازهٔ مشاهدهٔ این درخواست مرخصی را ندارید.")


def holder(instance):
    """Where the request is now: the current step and the person(s) it waits for."""
    if instance is None:
        return None
    if instance.status == WorkflowInstance.Status.ERROR:
        return {"step": engine.current_step(instance).get("title", ""), "people": [], "error": instance.error_message}
    if instance.status != WorkflowInstance.Status.RUNNING:
        return None
    run = engine.active_run(instance)
    if run is None:
        return None
    people = [run.assignee] if run.assignee_id else list(User.objects.filter(id__in=run.candidate_ids or []))
    acting = engine.acting_delegate(run.assignee, instance.workspace) if run.assignee_id else None
    return {
        "step": run.step_title,
        "people": [person(user) for user in people],
        "acting_delegate": person(acting),
        "error": "",
    }


def _attachments(ids):
    rows = {str(row.id): row for row in FileAsset.objects.filter(id__in=ids or [], entity_type=LEAVE_ATTACHMENT)}
    return [
        {"id": key, "name": rows[key].attributes.get("name", ""), "size": rows[key].size}
        for key in ids or []
        if key in rows
    ]


def version_payload(version, workspace):
    zone = calendar_zone(workspace)
    hourly = version.mode == LeaveRequestVersion.Mode.HOURLY
    return {
        "id": str(version.id),
        "number": version.number,
        "mode": version.mode,
        "mode_label": MODE_TITLES.get(version.mode, ""),
        "start_date": version.start_date.isoformat(),
        "end_date": version.end_date.isoformat(),
        "start_time": version.starts_at.astimezone(zone).strftime("%H:%M") if hourly else None,
        "end_time": version.ends_at.astimezone(zone).strftime("%H:%M") if hourly else None,
        "starts_at": version.starts_at.astimezone(zone).isoformat(),
        "ends_at": version.ends_at.astimezone(zone).isoformat(),
        "period_text": period_text(version, workspace),
        "reason": version.reason,
        "substitute": person(version.substitute),
        "attachments": _attachments(version.attachment_ids),
        "duration_days": version.duration_days,
        "duration_minutes": version.duration_minutes,
        "duration_text": duration_text(version.mode, version.duration_days, version.duration_minutes),
        "is_locked": version.is_locked,
        "signed_at": version.signed_at.astimezone(zone).isoformat() if version.signed_at else None,
        "signed_by": person(version.signed_by),
        "template": (
            {
                "id": str(version.template_version_id),
                "number": version.template_version.number,
                "title": version.template_version.title,
            }
            if version.template_version_id
            else None
        ),
        "has_document": bool(version.document_id),
        "created_at": version.created_at.astimezone(zone).isoformat(),
    }


def period_text(version, workspace):
    zone = calendar_zone(workspace)
    if version.mode == LeaveRequestVersion.Mode.DAILY:
        if version.start_date == version.end_date:
            return fa_date(version.start_date)
        return f"از {fa_date(version.start_date)} تا {fa_date(version.end_date)}"
    start = version.starts_at.astimezone(zone)
    end = version.ends_at.astimezone(zone)
    if start.date() == end.date():
        return f"{fa_date(start.date())} از ساعت {fa(start.strftime('%H:%M'))} تا {fa(end.strftime('%H:%M'))}"
    return (
        f"از {fa_date(start.date())} ساعت {fa(start.strftime('%H:%M'))} "
        f"تا {fa_date(end.date())} ساعت {fa(end.strftime('%H:%M'))}"
    )


def sign_blockers(actor, row, version, now=None):
    """Why "sign and submit" is not possible now (shown on the disabled button; the server re-checks)."""
    workspace = row.workspace
    blockers = []
    if actor.id != row.requester_id:
        return ["فقط خود درخواست‌دهنده می‌تواند امضا و ارسال کند."]
    if row.status not in EDITABLE_STATUSES:
        return [f"درخواست در وضعیت «{STATUS_TITLES[row.status]}» است و ارسال دوباره ممکن نیست."]
    if version is None or version.is_locked:
        return ["این نسخه قبلاً امضا و ارسال شده است؛ برای اصلاح، نسخهٔ تازه بسازید."]
    image = signatures.current(workspace, actor)
    if image is None:
        blockers.append("تصویر امضای شما هنوز بارگذاری نشده است؛ از نقش مسئول بخواهید آن را بارگذاری کند.")
    elif not image.has_consent:
        blockers.append("هنوز اجازهٔ درج تصویر امضای خود را نداده‌اید؛ ابتدا تصویر را ببینید و اجازه دهید.")
    _, problem = templates.active_or_problem(workspace, now)
    if problem:
        blockers.append(problem)
    if engine.definition_for(leave_entity(workspace)) is None:
        blockers.append("مسیر تأیید درخواست مرخصی هنوز تعریف یا منتشر نشده است؛ با مدیر سامانه تماس بگیرید.")
    return blockers


def can_cancel_request(actor, row, now=None):
    now = now or timezone.now()
    if actor.id != row.requester_id:
        return False
    if row.status in {STATUS.DRAFT, STATUS.PENDING, STATUS.RETURNED}:
        return True
    if row.status == STATUS.APPROVED:
        # After approval only before the leave starts; the recorded absence is cancelled too.
        version = current_version(row)
        return bool(version and version.starts_at > now)
    return False


def request_payload(row, actor, request=None, *, detail=True, now=None):
    workspace = row.workspace
    version = current_version(row)
    instance = instance_of(row)
    data = {
        "id": str(row.id),
        "number": row.number,
        "status": row.status,
        "status_label": STATUS_TITLES.get(row.status, row.status),
        "revision": row.revision,
        "requester": person(row.requester),
        "created_at": row.created_at.astimezone(calendar_zone(workspace)).isoformat(),
        "current": version_payload(version, workspace) if version else None,
        "holder": holder(instance),
        "is_mine": row.requester_id == actor.id,
    }
    if not detail:
        return data
    blockers = sign_blockers(actor, row, version, now)
    mine = row.requester_id == actor.id
    data.update(
        {
            "versions": [version_payload(item, workspace) for item in row.versions.order_by("-number")],
            "workflow": (
                {"instance_id": str(instance.id), "status": instance.status, "revision": instance.revision}
                if instance
                else None
            ),
            "absence": (
                {
                    "id": str(row.absence_id),
                    "status": row.absence.status,
                    "starts_at": row.absence.starts_at.isoformat(),
                    "ends_at": row.absence.ends_at.isoformat(),
                }
                if row.absence_id
                else None
            ),
            "cancel_reason": row.cancel_reason,
            "actions": {
                "can_edit": mine and row.status in EDITABLE_STATUSES and bool(version and not version.is_locked),
                "can_new_version": mine and row.status == STATUS.RETURNED and bool(version and version.is_locked),
                "can_sign": not blockers,
                "sign_blockers": blockers,
                "can_cancel": can_cancel_request(actor, row, now),
            },
        }
    )
    return data


def history(row):
    entity = leave_entity(row.workspace)
    zone = calendar_zone(row.workspace)
    events = (
        EntityEvent.objects.filter(workspace=row.workspace, entity=entity, record_id=row.id)
        .select_related("created_by")
        .order_by("created_at", "id")
    )
    return [
        {
            "id": str(event.id),
            "type": event.event_type,
            "actor": person(event.created_by),
            "at": event.created_at.astimezone(zone).isoformat(),
            "reason": (event.metadata or {}).get("reason", ""),
            "version": (event.metadata or {}).get("version_number"),
            "data": {key: value for key, value in (event.metadata or {}).items() if key in {"template_number"}},
        }
        for event in events
    ]


# ---------------------------------------------------------------- writing helpers


def _audit(row, actor, event_type, before=None, after=None, reason="", **extra):
    return emit(
        leave_entity(row.workspace),
        actor,
        event_type,
        row.id,
        before=before,
        after=after,
        metadata={"reason": reason, "actor_id": str(actor.id), "request_number": row.number, **extra},
    )


def _lock_person(workspace, user):
    """Serialize all writes of one person's requests (overlap checks must not race)."""
    list(WorkspaceMember.objects.select_for_update().filter(workspace=workspace, member=user).values_list("id"))


def _check_revision(row, data):
    revision = data.get("revision")
    if revision is None or isinstance(revision, bool) or not isinstance(revision, int):
        raise ValidationError({"revision": "شمارهٔ نسخهٔ درخواست ارسال نشده است؛ صفحه را تازه کنید."})
    if revision != row.revision:
        raise engine.Conflict("این درخواست هم‌زمان تغییر کرده است؛ صفحه را تازه کنید.")


def _bump(row):
    row.revision += 1
    row.save()


def check_overlap(workspace, user, starts_at, ends_at, exclude_id=None):
    """Reject a period overlapping another active request (draft, pending, returned, approved)."""
    others = LeaveRequest.objects.filter(workspace=workspace, requester=user, status__in=LeaveRequest.ACTIVE_STATUSES)
    if exclude_id:
        others = others.exclude(id=exclude_id)
    for other in others:
        version = current_version(other)
        if version and version.starts_at < ends_at and version.ends_at > starts_at:
            raise ValidationError(
                {
                    "start_date": (
                        f"این بازه با درخواست مرخصی فعال {other.number} ({STATUS_TITLES[other.status]}، "
                        f"{period_text(version, workspace)}) هم‌پوشانی دارد."
                    )
                }
            )
    absence = UserAbsence.objects.filter(
        workspace=workspace,
        user=user,
        status=UserAbsence.Status.SCHEDULED,
        starts_at__lt=ends_at,
        ends_at__gt=starts_at,
        leave_request__isnull=True,
    ).first()
    if absence is not None:
        raise ValidationError({"start_date": "این بازه با یک عدم حضور ثبت‌شدهٔ دیگر هم‌پوشانی دارد."})


def _substitute(workspace, requester, value):
    if value in (None, ""):
        return None
    try:
        user = (
            User.objects.filter(
                id=value,
                is_active=True,
                member_workspace__workspace=workspace,
                member_workspace__is_active=True,
                member_workspace__deleted_at__isnull=True,
            )
            .distinct()
            .first()
        )
    except (TypeError, ValueError, DjangoValidationError):
        user = None
    if user is None:
        raise ValidationError({"substitute": "جانشین باید از کاربران فعال همین شرکت باشد."})
    if user.id == requester.id:
        raise ValidationError({"substitute": "درخواست‌دهنده نمی‌تواند جانشین خودش باشد."})
    return user


def _attachment_ids(workspace, row_or_none, requester, value):
    ids = value if isinstance(value, list) else []
    ids = list(dict.fromkeys(str(item) for item in ids))
    if len(ids) > MAX_ATTACHMENTS:
        raise ValidationError({"attachments": f"حداکثر {fa(MAX_ATTACHMENTS)} پیوست مجاز است."})
    if not ids:
        return []
    try:
        allowed = FileAsset.objects.filter(
            workspace=workspace, entity_type=LEAVE_ATTACHMENT, is_uploaded=True, id__in=ids
        )
    except (ValueError, DjangoValidationError):
        raise ValidationError({"attachments": "پیوست انتخاب‌شده معتبر نیست."})
    previous = set()
    if row_or_none is not None:
        for version in row_or_none.versions.all():
            previous.update(version.attachment_ids or [])
    found = {str(asset.id) for asset in allowed if asset.user_id == requester.id or str(asset.id) in previous}
    if found != set(ids):
        raise ValidationError({"attachments": "پیوست باید توسط خود شما برای همین درخواست بارگذاری شده باشد."})
    return ids


def _clean(workspace, requester, data, row=None):
    period = resolve_period(workspace, requester, data)
    reason = str(data.get("reason") or "").strip()
    if len(reason) > 2000:
        raise ValidationError({"reason": "دلیل حداکثر می‌تواند ۲۰۰۰ نویسه باشد."})
    return {
        **period,
        "reason": reason,
        "substitute": _substitute(workspace, requester, data.get("substitute")),
        "attachment_ids": _attachment_ids(workspace, row, requester, data.get("attachments")),
    }


def _snapshot(version):
    return engine.json_safe(
        {
            "mode": version.mode,
            "start_date": version.start_date,
            "end_date": version.end_date,
            "starts_at": version.starts_at,
            "ends_at": version.ends_at,
            "reason": version.reason,
            "substitute": str(version.substitute_id) if version.substitute_id else None,
            "attachments": version.attachment_ids,
            "duration_days": version.duration_days,
            "duration_minutes": version.duration_minutes,
        }
    )


def require_creator(actor, workspace, request=None):
    if not has_permission(actor, workspace, "LeaveRequest.Create", request=request):
        raise PermissionDenied("مجوز ثبت درخواست مرخصی را ندارید.")


def preview_duration(workspace, actor, data, request=None):
    """Read-only duration for the form (the same calculation the server stores)."""
    require_creator(actor, workspace, request)
    period = resolve_period(workspace, actor, data)
    return {
        "duration_days": period["duration_days"],
        "duration_minutes": period["duration_minutes"],
        "duration_text": duration_text(period["mode"], period["duration_days"], period["duration_minutes"]),
    }


# ---------------------------------------------------------------- create / edit / version


@transaction.atomic
def create(workspace, actor, data, request=None):
    require_creator(actor, workspace, request)
    _lock_person(workspace, actor)
    values = _clean(workspace, actor, data)
    check_overlap(workspace, actor, values["starts_at"], values["ends_at"])
    entity = leave_entity(workspace)
    counter = SystemIdentifierCounter.locked(f"entity:{entity.id}", "default")
    row = LeaveRequest.objects.create(
        workspace=workspace,
        requester=actor,
        number=format_record_number(entity, counter.advance()),
        created_by=actor,
    )
    version = LeaveRequestVersion.objects.create(request=row, number=1, created_by=actor, **values)
    _link_attachments(row, version)
    _audit(row, actor, "leave.created", None, _snapshot(version), version_number=1)
    return row


def _link_attachments(row, version):
    FileAsset.objects.filter(id__in=version.attachment_ids or [], entity_identifier="").update(
        entity_identifier=str(row.id)
    )


def _require_owner(actor, row):
    if actor.id != row.requester_id:
        raise PermissionDenied("فقط خود درخواست‌دهنده می‌تواند درخواستش را تغییر دهد.")


@transaction.atomic
def update(workspace, actor, request_id, data, request=None):
    row = get_request(workspace, request_id, lock=True)
    _require_owner(actor, row)
    _check_revision(row, data)
    if row.status not in EDITABLE_STATUSES:
        raise ValidationError(f"درخواست در وضعیت «{STATUS_TITLES[row.status]}» قابل ویرایش نیست.")
    version = current_version(row)
    if version.is_locked:
        raise ValidationError("نسخهٔ امضاشده قفل است و تغییر نمی‌کند؛ برای اصلاح «ساخت نسخهٔ تازه» را بزنید.")
    _lock_person(workspace, actor)
    values = _clean(workspace, actor, data, row)
    check_overlap(workspace, actor, values["starts_at"], values["ends_at"], exclude_id=row.id)
    before = _snapshot(version)
    for key, value in values.items():
        setattr(version, key, value)
    version.updated_by = actor
    version.save()
    _link_attachments(row, version)
    _bump(row)
    _audit(row, actor, "leave.updated", before, _snapshot(version), version_number=version.number)
    return row


@transaction.atomic
def new_version(workspace, actor, request_id, data, request=None):
    """A returned request gets a fresh, unlocked version; the signed one stays untouched."""
    row = get_request(workspace, request_id, lock=True)
    _require_owner(actor, row)
    _check_revision(row, data)
    version = current_version(row)
    if row.status != STATUS.RETURNED or not version.is_locked:
        raise ValidationError("نسخهٔ تازه فقط برای درخواستِ بازگشت‌خورده برای اصلاح ساخته می‌شود.")
    fresh = LeaveRequestVersion.objects.create(
        request=row,
        number=version.number + 1,
        mode=version.mode,
        start_date=version.start_date,
        end_date=version.end_date,
        starts_at=version.starts_at,
        ends_at=version.ends_at,
        reason=version.reason,
        substitute=version.substitute,
        attachment_ids=list(version.attachment_ids or []),
        duration_days=version.duration_days,
        duration_minutes=version.duration_minutes,
        created_by=actor,
    )
    _bump(row)
    _audit(
        row,
        actor,
        "leave.version_created",
        {"version": version.number},
        {"version": fresh.number},
        version_number=fresh.number,
        previous_version=str(version.id),
    )
    return row


# ---------------------------------------------------------------- document


def document_values(row, version, now=None):
    """Values of the Word form: identity from the account and org structure, the rest from the request."""
    workspace, user = row.workspace, row.requester
    zone = calendar_zone(workspace)
    units = OrganizationUnit.objects.filter(workspace=workspace, is_active=True).filter(
        Q(manager=user)
        | Q(
            id__in=OrganizationUnitMember.objects.filter(user=user, is_active=True, unit__workspace=workspace).values(
                "unit_id"
            )
        )
    )
    user_entity = EntityType.objects.filter(workspace=workspace, adapter="user", parent__isnull=True).first()
    record = EntityRecord.objects.filter(entity=user_entity, source_id=user.id).first() if user_entity else None
    hourly = version.mode == LeaveRequestVersion.Mode.HOURLY
    start, end = version.starts_at.astimezone(zone), version.ends_at.astimezone(zone)
    submitted = (version.signed_at or now or timezone.now()).astimezone(zone)
    full_name = " ".join(part for part in (user.first_name, user.last_name) if part).strip()
    return {
        "employee_name": user.display_name or full_name or user.username,
        "employee_id": record.number if record else user.username,
        "unit": "، ".join(sorted(unit.title for unit in units)) or "—",
        "start": fa_date(version.start_date),
        "end": fa_date(version.end_date),
        "mode": MODE_TITLES[version.mode],
        "start_time": fa(start.strftime("%H:%M")) if hourly else "",
        "end_time": fa(end.strftime("%H:%M")) if hourly else "",
        "duration": duration_text(version.mode, version.duration_days, version.duration_minutes),
        "reason": version.reason or "—",
        "substitute": engine.user_name(version.substitute) if version.substitute_id else "—",
        "submitted_at": f"{fa_date(submitted.date())} ساعت {fa(submitted.strftime('%H:%M'))}",
        "request_number": row.number,
    }


def _fingerprint(version, template, values):
    payload = {
        "version": str(version.id),
        "template": str(template.id) if template else None,
        "values": {key: value for key, value in values.items() if key != "submitted_at"},
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


def _document_bytes(version):
    with version.document.asset.open("rb") as stream:
        return stream.read()


def preview(workspace, actor, request_id, version_id=None, request=None, now=None):
    """HTML preview of the filled document. A signed version always shows its stored, signed document."""
    row = get_request(workspace, request_id)
    require_view(actor, row, request)
    version = current_version(row)
    if version_id:
        version = row.versions.filter(id=version_id).first()
        if version is None:
            raise NotFound("نسخهٔ درخواست پیدا نشد.")
    if version.is_locked and version.document_id:
        return {
            "html": documents.to_html(_document_bytes(version)),
            "fingerprint": "",
            "signed": True,
            "version": version.number,
            "template": {"id": str(version.template_version_id), "number": version.template_version.number},
        }
    template, problem = templates.active_or_problem(workspace, now)
    if problem:
        raise ValidationError({"template": problem})
    values = document_values(row, version, now)
    filled = documents.render(templates.content(template), values, None)
    return {
        "html": documents.to_html(filled),
        "fingerprint": _fingerprint(version, template, values),
        "signed": False,
        "version": version.number,
        "template": {"id": str(template.id), "number": template.number},
    }


def document_file(workspace, actor, request_id, version_id, request=None):
    """The final Word file of a signed version, for printing or archiving."""
    row = get_request(workspace, request_id)
    require_view(actor, row, request)
    version = row.versions.filter(id=version_id).select_related("document").first()
    if version is None or not version.document_id:
        raise NotFound("برای این نسخه سند امضاشده‌ای وجود ندارد.")
    return f"{row.number}-v{version.number}.docx", _document_bytes(version)


# ---------------------------------------------------------------- sign and submit


@transaction.atomic
def sign_and_submit(workspace, actor, request_id, data, request=None, now=None):
    """The only path that places a signature: an explicit action of the requester on the previewed document."""
    from . import workflow_actions as actions

    now = now or timezone.now()
    row = get_request(workspace, request_id, lock=True)
    _require_owner(actor, row)
    _check_revision(row, data)
    if data.get("confirm") is not True:
        raise ValidationError({"confirm": "برای ثبت امضا، تأیید صریح شما لازم است."})
    version = current_version(row)
    blockers = sign_blockers(actor, row, version, now)
    if blockers:
        raise ValidationError({"detail": blockers[0], "blockers": blockers})
    version = LeaveRequestVersion.objects.select_for_update().get(id=version.id)
    _lock_person(workspace, actor)
    # Re-check the period against today's calendar and other requests.
    period = resolve_period(
        workspace,
        actor,
        {
            "mode": version.mode,
            "start_date": version.start_date.isoformat(),
            "end_date": version.end_date.isoformat(),
            "start_time": version.starts_at.astimezone(calendar_zone(workspace)).strftime("%H:%M"),
            "end_time": version.ends_at.astimezone(calendar_zone(workspace)).strftime("%H:%M"),
        },
    )
    check_overlap(workspace, actor, version.starts_at, version.ends_at, exclude_id=row.id)
    if (period["duration_days"], period["duration_minutes"]) != (version.duration_days, version.duration_minutes):
        raise ValidationError(
            {
                "fingerprint": (
                    "تقویم کاری تغییر کرده و مدت محاسبه‌شده فرق کرده است؛ درخواست را دوباره ذخیره و پیش‌نمایش را ببینید."
                )
            }
        )
    template, problem = templates.active_or_problem(workspace, now)
    if problem:
        raise ValidationError({"template": problem})
    values = document_values(row, version, now)
    if data.get("fingerprint") != _fingerprint(version, template, values):
        raise ValidationError(
            {"fingerprint": "سند پس از پیش‌نمایش تغییر کرده است؛ پیش‌نمایش تازه را ببینید و دوباره تأیید کنید."}
        )
    image = signatures.current(workspace, actor)
    version.signed_at = now
    values = document_values(row, version, now)
    signed = documents.render(templates.content(template), values, signatures.image_bytes(image))
    digest = hashlib.sha256(signed).hexdigest()
    name = f"{row.number}-v{version.number}.docx"
    asset = FileAsset.objects.create(
        workspace=workspace,
        user=actor,
        asset=ContentFile(signed, name=name),
        entity_type=LEAVE_DOCUMENT,
        entity_identifier=str(row.id),
        size=len(signed),
        is_uploaded=True,
        attributes={
            "name": name,
            "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "version": str(version.id),
        },
    )
    version.is_locked, version.locked_at, version.signed_by = True, now, actor
    version.signature, version.template_version, version.document = image, template, asset
    version.document_sha256, version.document_values = digest, values
    version.save()
    signatures.audit(
        workspace,
        actor,
        "signature.used",
        image,
        None,
        {"request": str(row.id), "version": str(version.id)},
        request={"id": str(row.id), "number": row.number, "version": version.number},
    )
    _audit(
        row,
        actor,
        "leave.signed",
        None,
        {
            "version_id": str(version.id),
            "template_version_id": str(template.id),
            "signature_id": str(image.id),
            "document_sha256": digest,
        },
        version_number=version.number,
        version_id=str(version.id),
        template_id=str(template.id),
        template_number=template.number,
        signature_id=str(image.id),
        signed_at=now.isoformat(),
    )
    _submit_to_workflow(workspace, actor, row, now, actions)
    row.refresh_from_db()
    return row


def _submit_to_workflow(workspace, actor, row, now, actions):
    entity = leave_entity(workspace)
    instance = engine.instance_for(entity, row.id, active_only=True)
    if instance is None:
        definition = engine.definition_for(entity)
        if definition is None:
            raise ValidationError("مسیر تأیید درخواست مرخصی تعریف یا منتشر نشده است.")
        instance = actions._start(entity, row.id, actor, definition, now)
    if instance.status != WorkflowInstance.Status.RUNNING:
        raise ValidationError(f"شروع مسیر تأیید ممکن نشد: {instance.error_message}")
    start = engine.start_step(instance.version.graph)
    if instance.current_step != start["code"]:
        raise ValidationError("این درخواست همین حالا در مسیر تأیید است.")
    values = engine.record_values(entity, None, row)
    rows = [
        item
        for item in engine.transitions_from(instance.version.graph, instance.current_step)
        if not item.get("auto")
        and item.get("kind") in engine.FORWARD_KINDS
        and engine.transition_available(instance, item, values)
    ]
    if not rows:
        raise ValidationError("مسیر تأیید از مرحلهٔ ثبت درخواست هیچ انتقال «ارسال» ندارد؛ با مدیر سامانه تماس بگیرید.")
    instance.refresh_from_db()
    actions.transition(
        workspace,
        actor,
        instance.id,
        {"transition": rows[0]["code"], "revision": instance.revision},
        now=now,
        via_source=True,
    )


# ---------------------------------------------------------------- cancel


@transaction.atomic
def cancel(workspace, actor, request_id, data, request=None, now=None):
    from . import workflow_actions as actions

    now = now or timezone.now()
    row = get_request(workspace, request_id, lock=True)
    _require_owner(actor, row)
    _check_revision(row, data)
    if not can_cancel_request(actor, row, now):
        raise ValidationError(
            "این درخواست در وضعیت فعلی قابل لغو نیست (مرخصیِ آغازشده یا پایان‌یافته را نمی‌توان لغو کرد)."
        )
    reason = str(data.get("reason") or "").strip()[:2000]
    instance = instance_of(row)
    if instance is not None and instance.status in {WorkflowInstance.Status.RUNNING, WorkflowInstance.Status.ERROR}:
        actions.cancel(workspace, actor, instance.id, {"revision": instance.revision, "reason": reason}, request, now)
        row.refresh_from_db()
        return row
    if row.status == STATUS.APPROVED and instance is not None:
        instance = WorkflowInstance.objects.select_for_update().select_related("version").get(id=instance.id)
        actions._decide(instance, None, "cancel", actor, reason=reason, from_step=instance.current_step)
        instance.status = WorkflowInstance.Status.CANCELLED
        instance.revision += 1
        instance.save()
    _mark_cancelled(row, actor, reason, now)
    return row


def _mark_cancelled(row, actor, reason, now):
    before = row.status
    row.status = STATUS.CANCELLED
    row.cancelled_at, row.cancelled_by, row.cancel_reason = now, actor, reason
    _bump(row)
    released = release_absence(row, actor, now)
    _audit(row, actor, "leave.cancelled", {"status": before}, {"status": row.status}, reason, absence_released=released)


# ---------------------------------------------------------------- absence


def ensure_absence(row, actor):
    """Create (or re-activate) the one absence of an approved request. Safe to call repeatedly."""
    version = current_version(row)
    if row.absence_id:
        absence = UserAbsence.objects.select_for_update().get(id=row.absence_id)
        if absence.status == UserAbsence.Status.SCHEDULED:
            return absence, False
        absence.status = UserAbsence.Status.SCHEDULED
    else:
        absence = UserAbsence(
            workspace=row.workspace,
            user=row.requester,
            starts_at=version.starts_at,
            ends_at=version.ends_at,
            reason=f"مرخصی {row.number}" + (f": {version.reason}" if version.reason else ""),
            status=UserAbsence.Status.SCHEDULED,
            substitute=version.substitute,
            created_by=actor,
        )
    try:
        absence.full_clean(exclude=["created_by", "updated_by", "substitute"])
    except DjangoValidationError as exc:
        if "starts_at" in getattr(exc, "message_dict", {}):
            raise ValidationError("این مرخصی با عدم حضور ثبت‌شدهٔ دیگری هم‌پوشانی دارد و قابل تأیید نهایی نیست.")
        raise ValidationError("ثبت عدم حضور برای این درخواست ممکن نشد.")
    absence.save()
    if row.absence_id != absence.id:
        row.absence = absence
        row.save(update_fields=["absence", "updated_at"])
    _audit(
        row,
        actor,
        "leave.absence_recorded",
        None,
        {"absence_id": str(absence.id), "starts_at": absence.starts_at, "ends_at": absence.ends_at},
        substitute=str(absence.substitute_id) if absence.substitute_id else None,
    )
    return absence, True


def release_absence(row, actor, now=None):
    """Cancel the absence of a rejected/cancelled request (idempotent). Returns True when something changed."""
    if not row.absence_id:
        return False
    absence = UserAbsence.objects.select_for_update().get(id=row.absence_id)
    if absence.status != UserAbsence.Status.SCHEDULED:
        return False
    absence.status = UserAbsence.Status.CANCELLED
    absence.save(update_fields=["status", "updated_at"])
    _audit(row, actor, "leave.absence_cancelled", {"absence_id": str(absence.id)}, {"status": absence.status})
    return True


# ---------------------------------------------------------------- notifications


def _notify(row, receivers, actor, title, message):
    notify_members(
        row.workspace_id,
        [item for item in receivers if item],
        actor_id=actor.id if actor else None,
        sender="crm:leave",
        entity_name="leave_request",
        entity_id=row.id,
        title=title,
        message=message,
        data={"crm_event": {"kind": "leave_request", "request_id": str(row.id), "number": row.number}},
    )


def notify_progress(row, instance, actor, kind, reason=""):
    """Next person on the route, and the requester when someone decides."""
    run = engine.active_run(instance) if instance.status == WorkflowInstance.Status.RUNNING else None
    name = engine.user_name(row.requester)
    if run is not None and run.step_code != engine.start_step(instance.version.graph)["code"]:
        receivers = [run.assignee_id] if run.assignee_id else list(run.candidate_ids or [])
        _notify(
            row,
            receivers,
            actor,
            "درخواست مرخصی منتظر اقدام شماست",
            f"درخواست مرخصی {row.number} ({name}) در مرحلهٔ «{run.step_title}» منتظر تصمیم شماست.",
        )
    if actor.id == row.requester_id:
        return
    titles = {
        STATUS.APPROVED: ("درخواست مرخصی شما تأیید شد", f"درخواست {row.number} تأیید نهایی شد و عدم حضور ثبت شد."),
        STATUS.REJECTED: ("درخواست مرخصی شما رد شد", f"درخواست {row.number} رد شد. دلیل: {reason}"),
        STATUS.RETURNED: (
            "درخواست مرخصی برای اصلاح بازگشت",
            f"درخواست {row.number} برای اصلاح بازگشت. دلیل: {reason}. نسخهٔ تازه بسازید و دوباره امضا کنید.",
        ),
    }
    if row.status in titles:
        title, message = titles[row.status]
    elif kind in {"approve", "advance", "refer", "reassign"}:
        step = run.step_title if run else ""
        title, message = "درخواست مرخصی شما در جریان است", f"درخواست {row.number} به مرحلهٔ «{step}» رسید."
    else:
        return
    _notify(row, [row.requester_id], actor, title, message)


# ---------------------------------------------------------------- record source


class LeaveRequestSource:
    """How the workflow engine reads and writes a leave request."""

    def get(self, workspace, record_id):
        try:
            return LeaveRequest.objects.select_related("requester").filter(workspace=workspace, id=record_id).first()
        except (ValueError, TypeError, DjangoValidationError):
            return None

    def status_options(self, entity):
        return [{"code": code, "title": STATUS_TITLES[code]} for code in WORKFLOW_STATUSES]

    def status(self, native):
        return native.status

    def subject(self, native):
        return native.requester

    def title(self, native):
        return f"مرخصی {native.number} — {engine.user_name(native.requester)}"

    def values(self, native):
        version = current_version(native)
        return {
            "mode": version.mode if version else "",
            "duration_days": version.duration_days if version else None,
            "duration_minutes": version.duration_minutes if version else None,
        }

    def can_view(self, actor, native, request=None):
        return can_view(actor, native, request)

    def blocks_transition(self, instance, row):
        start = engine.start_step(instance.version.graph) or {}
        if instance.current_step == start.get("code") and row.get("kind") in engine.FORWARD_KINDS:
            return SUBMIT_BLOCKED
        return None

    def can_cancel(self, actor, instance, native):
        return actor.id == native.requester_id and native.status in {STATUS.PENDING, STATUS.RETURNED, STATUS.DRAFT}

    def on_cancel(self, instance, actor, reason, now):
        row = LeaveRequest.objects.select_for_update().get(id=instance.record_id)
        _mark_cancelled(row, actor, reason, now)

    def after_transition(self, instance, actor, row, reason):
        request_row = LeaveRequest.objects.select_related("requester").get(id=instance.record_id)
        notify_progress(request_row, instance, actor, row.get("kind", ""), reason)

    def apply_status(self, entity, actor, record_id, status_code, metadata):
        row = (
            LeaveRequest.objects.select_for_update()
            .select_related("requester", "workspace")
            .get(workspace=entity.workspace, id=record_id)
        )
        if status_code not in WORKFLOW_STATUSES:
            raise ValidationError("وضعیت مرحله برای درخواست مرخصی معتبر نیست.")
        instance_id = metadata.get("workflow_instance")
        if status_code == STATUS.PENDING and instance_id:
            # Coming back to the start step after it was submitted means "returned for correction".
            instance = WorkflowInstance.objects.select_related("version").get(id=instance_id)
            start = engine.start_step(instance.version.graph) or {}
            if (
                metadata.get("workflow_step") == start.get("code")
                and WorkflowStepRun.objects.filter(instance_id=instance_id).exists()
            ):
                status_code = STATUS.RETURNED
        before = row.status
        if before == status_code:
            return False
        row.status = status_code
        _bump(row)
        _audit(
            row,
            actor,
            "record.status_changed",
            {"status": before},
            {"status": status_code},
            workflow_step=metadata.get("workflow_step", ""),
            workflow_version=metadata.get("workflow_version"),
        )
        if status_code == STATUS.APPROVED:
            ensure_absence(row, actor)
        elif status_code in {STATUS.REJECTED, STATUS.RETURNED}:
            release_absence(row, actor)
        return True

    def default_graph(self, definition):
        """Starting point for the admin: requester → direct manager → approved, with reject/return."""
        return {
            "steps": [
                {
                    "code": "request",
                    "title": "ثبت و امضای درخواست",
                    "type": "start",
                    "status_code": STATUS.PENDING,
                    "assignee": {"type": "subject"},
                },
                {
                    "code": "manager",
                    "title": "تأیید مدیر مستقیم",
                    "type": "approval",
                    "status_code": STATUS.PENDING,
                    "assignee": {"type": "direct_manager"},
                },
                {
                    "code": "approved",
                    "title": "تأییدشده",
                    "type": "end",
                    "status_code": STATUS.APPROVED,
                    "assignee": {"type": "none"},
                },
                {
                    "code": "rejected",
                    "title": "ردشده",
                    "type": "end",
                    "status_code": STATUS.REJECTED,
                    "assignee": {"type": "none"},
                },
            ],
            "transitions": [
                {"code": "submit", "from": "request", "to": "manager", "kind": "advance", "label": "ارسال برای تأیید"},
                {"code": "approve", "from": "manager", "to": "approved", "kind": "approve", "label": "تأیید"},
                {"code": "reject", "from": "manager", "to": "rejected", "kind": "reject", "label": "رد"},
                {
                    "code": "return",
                    "from": "manager",
                    "to": "request",
                    "kind": "return",
                    "label": "بازگشت برای اصلاح",
                    "reason_required": True,
                },
            ],
        }


engine.register_record_source(ADAPTER, LeaveRequestSource())


# ---------------------------------------------------------------- attachments


def upload_attachment(workspace, actor, upload_file, request=None):
    from pathlib import PurePath

    from .entity_files import validate_file

    require_creator(actor, workspace, request)
    if upload_file is None:
        raise ValidationError({"file": "فایل پیوست را انتخاب کنید."})
    validate_file(ATTACHMENT_CONFIG, upload_file.name or "", upload_file.size)
    name = PurePath(upload_file.name).name
    asset = FileAsset.objects.create(
        workspace=workspace,
        user=actor,
        asset=upload_file,
        entity_type=LEAVE_ATTACHMENT,
        entity_identifier="",
        size=upload_file.size,
        is_uploaded=True,
        attributes={"name": name, "content_type": getattr(upload_file, "content_type", "") or ""},
    )
    return {"id": str(asset.id), "name": name, "size": asset.size}


def attachment_file(workspace, actor, request_id, asset_id, request=None):
    row = get_request(workspace, request_id)
    require_view(actor, row, request)
    ids = set()
    for version in row.versions.all():
        ids.update(version.attachment_ids or [])
    if str(asset_id) not in ids:
        raise NotFound("پیوست در این درخواست پیدا نشد.")
    asset = FileAsset.objects.filter(workspace=workspace, id=asset_id, entity_type=LEAVE_ATTACHMENT).first()
    if asset is None:
        raise NotFound("پیوست پیدا نشد.")
    return asset
