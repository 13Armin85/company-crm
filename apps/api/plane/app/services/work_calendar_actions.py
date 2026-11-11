"""Mutations and access rules for schedules, work events and self-reported presence.

Invariants:
- every write runs in a transaction, locks the person's row (and their
  schedule versions) and records an ``EntityEvent`` with actor, before, after
  and reason;
- old versions are closed, never edited or deleted;
- nothing here creates ``UserAbsence`` rows, notifications, lateness, overtime
  or "done" confirmations on someone else's behalf.
"""

from datetime import date, datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from plane.db.models import (
    ActivityConfirmation,
    OrganizationUnit,
    PresenceDeclaration,
    User,
    WorkEvent,
    WorkEventParticipant,
    WorkSchedule,
    WorkScheduleDay,
    WorkScheduleException,
)
from .access_control import has_permission, management_relation
from .entity_records import emit_definition
from .entity_view_export import jalali
from .work_calendar import calendar_zone, is_outside_working_hours, local_today, schedule_for

WEEKDAY_NAMES = ["دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه", "یکشنبه"]
WORK_MODES = {"", "onsite", "remote", "hybrid"}
MAX_RANGE_DAYS = 62


# ---------------------------------------------------------------- access


def member_user(workspace, user_id):
    try:
        user_id = UUID(str(user_id))
    except (TypeError, ValueError):
        raise NotFound("این فرد در این شرکت پیدا نشد.")
    user = (
        User.objects.filter(
            id=user_id,
            is_active=True,
            member_workspace__workspace=workspace,
            member_workspace__is_active=True,
            member_workspace__deleted_at__isnull=True,
        )
        .distinct()
        .first()
    )
    if user is None:
        raise NotFound("این فرد در این شرکت پیدا نشد.")
    return user


def schedule_access(actor, target, workspace, mode, request=None):
    """``mode`` is "view" or "edit". Uses the same manager scope as absences."""
    if actor.id == target.id:
        code = "WorkSchedule.ViewOwn" if mode == "view" else "WorkSchedule.EditOwn"
        return has_permission(actor, workspace, code, request=request)
    relation = management_relation(actor, target, workspace, request=request)
    if relation == "direct":
        code = "WorkSchedule.ViewTeam" if mode == "view" else "WorkSchedule.EditTeam"
        return has_permission(actor, workspace, code, request=request)
    if relation == "ancestor" and mode == "view":
        return has_permission(actor, workspace, "WorkSchedule.ViewHierarchy", request=request)
    return False


def require_schedule_access(actor, target, workspace, mode, request=None):
    if not schedule_access(actor, target, workspace, mode, request):
        if mode == "view":
            raise PermissionDenied("اجازهٔ مشاهدهٔ برنامهٔ کاری این فرد را ندارید.")
        raise PermissionDenied("اجازهٔ ویرایش برنامهٔ کاری این فرد را ندارید.")


def can_schedule_for(actor, target, workspace, request=None):
    if not has_permission(actor, workspace, "WorkEvent.Create", request=request):
        return False
    return actor.id == target.id or management_relation(actor, target, workspace, request=request) is not None


def can_view_event_details(viewer, event, workspace, request=None, participant_ids=None):
    participant_ids = participant_ids if participant_ids is not None else event_participant_ids(event)
    if viewer.id in participant_ids or event.created_by_id == viewer.id:
        return True
    return any(
        schedule_access(viewer, User(id=uid), workspace, "view", request) for uid in participant_ids if uid != viewer.id
    )


def can_manage_event(actor, event, workspace, request=None):
    if event.created_by_id == actor.id and has_permission(actor, workspace, "WorkEvent.Create", request=request):
        return True
    if not has_permission(actor, workspace, "WorkEvent.Manage", request=request):
        return False
    return any(
        management_relation(actor, User(id=uid), workspace, request=request) is not None
        for uid in event_participant_ids(event)
    )


def visible_people(actor, workspace, request=None):
    """Everyone in the workspace; ``can_view`` says whether details or only busy blocks are shown."""
    people = []
    for user in (
        User.objects.filter(
            is_active=True,
            member_workspace__workspace=workspace,
            member_workspace__is_active=True,
            member_workspace__deleted_at__isnull=True,
        )
        .distinct()
        .order_by("display_name")
    ):
        can_view = schedule_access(actor, user, workspace, "view", request)
        relation = "self" if user.id == actor.id else management_relation(actor, user, workspace, request=request)
        people.append(
            {
                "id": str(user.id),
                "name": user.display_name or user.email,
                "relation": relation,
                "can_view": can_view,
                "can_edit": can_view and schedule_access(actor, user, workspace, "edit", request),
                "can_schedule": can_schedule_for(actor, user, workspace, request),
            }
        )
    return people


# ---------------------------------------------------------------- parsing


def fa_date(value):
    """Solar Hijri date with Persian digits for user-facing messages."""
    return jalali(value).translate(str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹"))


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


def _datetime(value, label, zone):
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        raise ValidationError({label: "زمان معتبر نیست."})
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=zone)


def _reason(data, required=True):
    reason = str(data.get("reason") or "").strip()
    if required and not reason:
        raise ValidationError({"reason": "دلیل یا توضیح تغییر را بنویسید."})
    if len(reason) > 2000:
        raise ValidationError({"reason": "دلیل نباید بیش از ۲۰۰۰ نویسه باشد."})
    return reason


def clean_day(raw, label="روز"):
    """Validate one day's hours; raises Persian messages."""
    is_working = raw.get("is_working", True)
    if not isinstance(is_working, bool):
        raise ValidationError({"days": f"{label}: وضعیت روز کاری معتبر نیست."})
    work_mode = raw.get("work_mode") or ""
    if work_mode not in WORK_MODES:
        raise ValidationError({"days": f"{label}: شیوهٔ کار معتبر نیست."})
    if not is_working:
        return {"is_working": False, "start_time": None, "end_time": None, "breaks": [], "work_mode": ""}
    start, end = _time(raw.get("start"), "days"), _time(raw.get("end"), "days")
    if end <= start:
        raise ValidationError({"days": f"{label}: ساعت پایان باید بعد از ساعت شروع باشد."})
    breaks = []
    for item in raw.get("breaks") or []:
        if not isinstance(item, dict):
            raise ValidationError({"days": f"{label}: استراحت معتبر نیست."})
        b_start, b_end = _time(item.get("start"), "days"), _time(item.get("end"), "days")
        if b_end <= b_start:
            raise ValidationError({"days": f"{label}: پایان استراحت باید بعد از شروع آن باشد."})
        if b_start < start or b_end > end:
            raise ValidationError({"days": f"{label}: استراحت باید داخل بازهٔ کاری باشد."})
        breaks.append((b_start, b_end))
    breaks.sort()
    for (_, previous_end), (next_start, _) in zip(breaks, breaks[1:]):
        if next_start < previous_end:
            raise ValidationError({"days": f"{label}: بازه‌های استراحت نباید با هم هم‌پوشانی داشته باشند."})
    if len(breaks) > 6:
        raise ValidationError({"days": f"{label}: حداکثر شش استراحت در روز مجاز است."})
    return {
        "is_working": True,
        "start_time": start,
        "end_time": end,
        "breaks": [{"start": a.strftime("%H:%M"), "end": b.strftime("%H:%M")} for a, b in breaks],
        "work_mode": work_mode,
    }


def clean_week(days):
    if not isinstance(days, list) or len(days) != 7:
        raise ValidationError({"days": "برنامه باید هر هفت روز هفته را مشخص کند."})
    week = {}
    for raw in days:
        weekday = raw.get("weekday") if isinstance(raw, dict) else None
        if not isinstance(weekday, int) or isinstance(weekday, bool) or not 0 <= weekday <= 6 or weekday in week:
            raise ValidationError({"days": "روز هفته معتبر نیست یا تکراری است."})
        week[weekday] = clean_day(raw, WEEKDAY_NAMES[weekday])
    return week


# ---------------------------------------------------------------- serialization


def _time_text(value):
    return value.strftime("%H:%M") if value else None


def serialize_version(row):
    return {
        "id": str(row.id),
        "scope": row.scope,
        "user_id": str(row.user_id) if row.user_id else None,
        "unit_id": str(row.unit_id) if row.unit_id else None,
        "effective_from": row.effective_from.isoformat(),
        "effective_to": row.effective_to.isoformat() if row.effective_to else None,
        "reason": row.reason,
        "created_by": str(row.created_by_id) if row.created_by_id else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "days": [
            {
                "weekday": day.weekday,
                "is_working": day.is_working,
                "start": _time_text(day.start_time),
                "end": _time_text(day.end_time),
                "breaks": day.breaks,
                "work_mode": day.work_mode,
            }
            for day in sorted(row.days.all(), key=lambda item: item.weekday)
        ],
    }


def serialize_exception(row):
    return {
        "id": str(row.id),
        "user_id": str(row.user_id),
        "date_from": row.date_from.isoformat(),
        "date_to": row.date_to.isoformat(),
        "is_working": row.is_working,
        "start": _time_text(row.start_time),
        "end": _time_text(row.end_time),
        "breaks": row.breaks,
        "work_mode": row.work_mode,
        "reason": row.reason,
        "status": row.status,
        "cancel_reason": row.cancel_reason,
        "created_by": str(row.created_by_id) if row.created_by_id else None,
    }


def event_participant_ids(event):
    cached = getattr(event, "_participant_ids", None)
    if cached is None:
        cached = set(
            WorkEventParticipant.objects.filter(event=event, deleted_at__isnull=True).values_list("user_id", flat=True)
        )
        event._participant_ids = cached
    return cached


def serialize_event(event, viewer, workspace, request=None, *, for_user=None):
    """Full details for participants, the creator and authorized managers; busy-only otherwise."""
    participants = event_participant_ids(event)
    zone = calendar_zone(workspace)
    base = {
        "id": str(event.id),
        "starts_at": event.starts_at.astimezone(zone).isoformat(),
        "ends_at": event.ends_at.astimezone(zone).isoformat(),
        "all_day": event.all_day,
        "status": event.status,
        "available": False,
        "label": "در دسترس نیست",
    }
    if not can_view_event_details(viewer, event, workspace, request, participants):
        base["restricted"] = True
        return base
    names = dict(User.objects.filter(id__in=participants).values_list("id", "display_name"))
    base.update(
        {
            "restricted": False,
            "kind": event.kind,
            "title": event.title,
            "description": event.description,
            "private_note": event.private_note,
            "cancel_reason": event.cancel_reason,
            "created_by": str(event.created_by_id) if event.created_by_id else None,
            "participants": [{"id": str(uid), "name": names.get(uid, "")} for uid in sorted(participants, key=str)],
            "can_manage": can_manage_event(viewer, event, workspace, request),
        }
    )
    if for_user is not None:
        base["outside_working_hours"] = is_outside_working_hours(for_user, event.starts_at, event.ends_at, workspace)
    return base


def serialize_presence(row):
    return {
        "id": str(row.id),
        "user_id": str(row.user_id),
        "date": row.date.isoformat(),
        "declared_at": row.declared_at.astimezone(ZoneInfo(row.time_zone)).isoformat(),
        "time_zone": row.time_zone,
        "status": row.status,
        "cancelled_at": row.cancelled_at.isoformat() if row.cancelled_at else None,
        "label": "اعلام‌شده توسط خود فرد",
        "notice": "این اعلام توسط خود فرد ثبت شده و حضور فیزیکی را اثبات نمی‌کند.",
    }


def _audit(workspace, actor, event_type, row, before, after, reason):
    event = emit_definition(workspace, actor, event_type, row, before, after)
    event.metadata = {**event.metadata, "reason": reason, "actor_id": str(actor.id)}
    event.save(update_fields=["metadata"])
    return event


# ---------------------------------------------------------------- schedule versions


def _lock_owner(workspace, scope, user=None, unit=None):
    if scope == "person":
        User.objects.select_for_update().get(pk=user.id)
    elif scope == "unit":
        OrganizationUnit.objects.select_for_update().get(pk=unit.id)
    else:
        type(workspace).objects.select_for_update().get(pk=workspace.pk)
    return list(
        WorkSchedule.objects.select_for_update()
        .filter(workspace=workspace, scope=scope, user=user, unit=unit)
        .prefetch_related("days")
        .order_by("effective_from")
    )


def create_version(workspace, actor, data, *, scope="person", target=None, unit=None, request=None):
    """Create a new dated version; the open previous version is closed, never edited or deleted."""
    if scope == "person":
        require_schedule_access(actor, target, workspace, "edit", request)
    elif not has_permission(actor, workspace, "WorkSchedule.ManageDefaults", request=request):
        raise PermissionDenied("اجازهٔ تعیین برنامهٔ پیش‌فرض شرکت یا واحد را ندارید.")
    if not data.get("effective_from"):
        raise ValidationError({"effective_from": "تاریخ شروع اعتبار برنامه الزامی است."})
    effective_from = _date(data.get("effective_from"), "effective_from")
    effective_to = _date(data["effective_to"], "effective_to") if data.get("effective_to") else None
    if effective_to and effective_to < effective_from:
        raise ValidationError({"effective_to": "تاریخ پایان اعتبار باید بعد از تاریخ شروع باشد."})
    if effective_from < local_today(workspace) and not has_permission(
        actor, workspace, "WorkSchedule.EditPast", request=request
    ):
        raise PermissionDenied("ثبت تغییر برنامه با تاریخ گذشته به مجوز جداگانه نیاز دارد.")
    reason = _reason(data)
    week = clean_week(data.get("days"))
    owner = {"user": target if scope == "person" else None, "unit": unit if scope == "unit" else None}
    with transaction.atomic():
        versions = _lock_owner(workspace, scope, **owner)
        to_close = None
        for version in versions:
            new_end = effective_to or date.max
            old_end = version.effective_to or date.max
            if version.effective_from >= effective_from:
                if version.effective_from <= new_end:
                    start_text = fa_date(version.effective_from)
                    message = f"این بازه با نسخهٔ دیگری از برنامه که از {start_text} معتبر است تداخل دارد."
                    raise ValidationError({"effective_from": message})
            elif old_end >= effective_from:
                if version.effective_to is not None:
                    message = (
                        f"این بازه با نسخهٔ دیگری از برنامه که تا {fa_date(version.effective_to)} معتبر است تداخل دارد."
                    )
                    raise ValidationError({"effective_from": message})
                to_close = version
        before = serialize_version(to_close) if to_close else None
        if to_close:
            to_close.effective_to = effective_from - timedelta(days=1)
            to_close.closed_by = actor
            to_close.save(update_fields=["effective_to", "closed_by", "updated_at"])
            _audit(workspace, actor, "work_schedule.closed", to_close, before, serialize_version(to_close), reason)
        row = WorkSchedule(
            workspace=workspace,
            scope=scope,
            effective_from=effective_from,
            effective_to=effective_to,
            reason=reason,
            **owner,
        )
        row.save(created_by_id=actor.id)
        for weekday, values in week.items():
            WorkScheduleDay(schedule=row, weekday=weekday, **values).save(created_by_id=actor.id)
        row = WorkSchedule.objects.prefetch_related("days").get(pk=row.pk)
        _audit(workspace, actor, "work_schedule.created", row, before, serialize_version(row), reason)
    return row


def list_versions(workspace, actor, target, request=None):
    require_schedule_access(actor, target, workspace, "view", request)
    return WorkSchedule.objects.filter(workspace=workspace, scope="person", user=target).prefetch_related("days")


# ---------------------------------------------------------------- dated exceptions


def create_exception(workspace, actor, target, data, request=None):
    require_schedule_access(actor, target, workspace, "edit", request)
    date_from = _date(data.get("date_from"), "date_from")
    date_to = _date(data.get("date_to") or data.get("date_from"), "date_to")
    if date_to < date_from:
        raise ValidationError({"date_to": "تاریخ پایان استثنا باید بعد از تاریخ شروع باشد."})
    if (date_to - date_from).days > 366:
        raise ValidationError({"date_to": "بازهٔ استثنا نباید بیش از یک سال باشد."})
    if date_from < local_today(workspace) and not has_permission(
        actor, workspace, "WorkSchedule.EditPast", request=request
    ):
        raise PermissionDenied("ثبت تغییر برنامه با تاریخ گذشته به مجوز جداگانه نیاز دارد.")
    reason = _reason(data)
    values = clean_day(data, "استثنا")
    with transaction.atomic():
        _lock_owner(workspace, "person", user=target)
        if WorkScheduleException.objects.filter(
            workspace=workspace,
            user=target,
            status=WorkScheduleException.Status.ACTIVE,
            date_from__lte=date_to,
            date_to__gte=date_from,
        ).exists():
            raise ValidationError(
                {"date_from": "برای این تاریخ‌ها قبلاً استثنای فعالی ثبت شده است؛ ابتدا آن را لغو کنید."}
            )
        row = WorkScheduleException(
            workspace=workspace, user=target, date_from=date_from, date_to=date_to, reason=reason, **values
        )
        row.save(created_by_id=actor.id)
        _audit(workspace, actor, "work_schedule_exception.created", row, None, serialize_exception(row), reason)
    return row


def cancel_exception(workspace, actor, exception_id, data, request=None):
    with transaction.atomic():
        try:
            row = WorkScheduleException.objects.select_for_update().get(workspace=workspace, id=exception_id)
        except (WorkScheduleException.DoesNotExist, ValueError):
            raise NotFound("استثنا پیدا نشد.")
        require_schedule_access(actor, row.user, workspace, "edit", request)
        if row.date_from < local_today(workspace) and not has_permission(
            actor, workspace, "WorkSchedule.EditPast", request=request
        ):
            raise PermissionDenied("ثبت تغییر برنامه با تاریخ گذشته به مجوز جداگانه نیاز دارد.")
        if row.status != WorkScheduleException.Status.ACTIVE:
            raise ValidationError({"status": "این استثنا قبلاً لغو شده است."})
        reason = _reason(data)
        before = serialize_exception(row)
        row.status, row.cancel_reason = WorkScheduleException.Status.CANCELLED, reason
        row.save(update_fields=["status", "cancel_reason", "updated_at"])
        _audit(workspace, actor, "work_schedule_exception.cancelled", row, before, serialize_exception(row), reason)
    return row


# ---------------------------------------------------------------- work events


def _event_period(data, zone, current=None):
    all_day = data.get("all_day", current.all_day if current else False)
    if not isinstance(all_day, bool):
        raise ValidationError({"all_day": "وضعیت تمام‌روز معتبر نیست."})
    if all_day:
        start_day = _date(str(data.get("starts_at") or current.starts_at.astimezone(zone).date())[:10], "starts_at")
        end_day = _date(str(data.get("ends_at") or data.get("starts_at") or start_day)[:10], "ends_at")
        if end_day < start_day:
            raise ValidationError({"ends_at": "پایان رویداد باید بعد از شروع آن باشد."})
        starts_at = datetime.combine(start_day, time.min, tzinfo=zone)
        ends_at = datetime.combine(end_day + timedelta(days=1), time.min, tzinfo=zone)
    else:
        starts_at = _datetime(data.get("starts_at") or (current and current.starts_at.isoformat()), "starts_at", zone)
        ends_at = _datetime(data.get("ends_at") or (current and current.ends_at.isoformat()), "ends_at", zone)
        if ends_at <= starts_at:
            raise ValidationError({"ends_at": "پایان رویداد باید بعد از شروع آن باشد."})
    if ends_at - starts_at > timedelta(days=62):
        raise ValidationError({"ends_at": "مدت رویداد نباید بیش از ۶۲ روز باشد."})
    return all_day, starts_at, ends_at


def _event_warnings(workspace, event, participants):
    warnings = []
    overlaps = (
        WorkEvent.objects.filter(
            workspace=workspace,
            status=WorkEvent.Status.PLANNED,
            starts_at__lt=event.ends_at,
            ends_at__gt=event.starts_at,
            participant_rows__user__in=participants,
            participant_rows__deleted_at__isnull=True,
        )
        .exclude(pk=event.pk)
        .distinct()
    )
    if overlaps.exists():
        warnings.append({"code": "overlap", "message": "این رویداد با رویداد دیگری از شرکت‌کنندگان هم‌زمان است."})
    outside = [
        user.display_name or user.email
        for user in participants
        if is_outside_working_hours(user, event.starts_at, event.ends_at, workspace)
    ]
    if outside:
        warnings.append(
            {"code": "outside_hours", "message": "این رویداد خارج از ساعت کاری این افراد است: " + "، ".join(outside)}
        )
    return warnings


def _participants(workspace, actor, ids, request):
    ids = ids if isinstance(ids, list) and ids else [str(actor.id)]
    if len(ids) > 100:
        raise ValidationError({"participant_ids": "حداکثر ۱۰۰ شرکت‌کننده مجاز است."})
    users = []
    for user_id in dict.fromkeys(str(value) for value in ids):
        user = member_user(workspace, user_id)
        if not can_schedule_for(actor, user, workspace, request):
            raise PermissionDenied(f"اجازهٔ زمان‌بندی برای «{user.display_name or user.email}» را ندارید.")
        users.append(user)
    return users


def _event_snapshot(event):
    return {
        "kind": event.kind,
        "title": event.title,
        "description": event.description,
        "private_note": event.private_note,
        "starts_at": event.starts_at,
        "ends_at": event.ends_at,
        "all_day": event.all_day,
        "status": event.status,
        "participants": sorted(str(uid) for uid in event_participant_ids(event)),
    }


def create_event(workspace, actor, data, request=None):
    zone = calendar_zone(workspace)
    kind = data.get("kind")
    if kind not in WorkEvent.Kind.values:
        raise ValidationError({"kind": "نوع رویداد باید جلسه، مأموریت یا رویداد کاری باشد."})
    title = str(data.get("title") or "").strip()
    if not title:
        raise ValidationError({"title": "عنوان رویداد الزامی است."})
    if len(title) > 200:
        raise ValidationError({"title": "عنوان نباید بیش از ۲۰۰ نویسه باشد."})
    all_day, starts_at, ends_at = _event_period(data, zone)
    participants = _participants(workspace, actor, data.get("participant_ids"), request)
    with transaction.atomic():
        for user in sorted(participants, key=lambda item: str(item.id)):
            User.objects.select_for_update().get(pk=user.id)
        event = WorkEvent(
            workspace=workspace,
            kind=kind,
            title=title,
            description=str(data.get("description") or ""),
            private_note=str(data.get("private_note") or ""),
            starts_at=starts_at,
            ends_at=ends_at,
            all_day=all_day,
        )
        event.save(created_by_id=actor.id)
        for user in participants:
            WorkEventParticipant(event=event, user=user).save(created_by_id=actor.id)
        event._participant_ids = {user.id for user in participants}
        _audit(
            workspace,
            actor,
            "work_event.created",
            event,
            None,
            _event_snapshot(event),
            _reason(data, False) or "ایجاد رویداد",
        )
    return event, _event_warnings(workspace, event, participants)


def _locked_event(workspace, event_id):
    try:
        return WorkEvent.objects.select_for_update().get(workspace=workspace, id=event_id)
    except (WorkEvent.DoesNotExist, ValueError):
        raise NotFound("رویداد پیدا نشد.")


def update_event(workspace, actor, event_id, data, request=None):
    zone = calendar_zone(workspace)
    with transaction.atomic():
        event = _locked_event(workspace, event_id)
        if not can_manage_event(actor, event, workspace, request):
            raise PermissionDenied("اجازهٔ ویرایش این رویداد را ندارید.")
        if event.status != WorkEvent.Status.PLANNED:
            raise ValidationError({"status": "رویداد لغوشده قابل ویرایش نیست."})
        reason = _reason(data)
        before = _event_snapshot(event)
        if "kind" in data:
            if data["kind"] not in WorkEvent.Kind.values:
                raise ValidationError({"kind": "نوع رویداد معتبر نیست."})
            event.kind = data["kind"]
        if "title" in data:
            title = str(data["title"] or "").strip()
            if not title or len(title) > 200:
                raise ValidationError({"title": "عنوان رویداد الزامی است و حداکثر ۲۰۰ نویسه دارد."})
            event.title = title
        for key in ("description", "private_note"):
            if key in data:
                setattr(event, key, str(data[key] or ""))
        if {"starts_at", "ends_at", "all_day"} & set(data):
            event.all_day, event.starts_at, event.ends_at = _event_period(data, zone, event)
        participants = None
        if "participant_ids" in data:
            participants = _participants(workspace, actor, data["participant_ids"], request)
            keep = {user.id for user in participants}
            WorkEventParticipant.objects.filter(event=event).exclude(user_id__in=keep).delete()
            existing = set(WorkEventParticipant.objects.filter(event=event).values_list("user_id", flat=True))
            for user in participants:
                if user.id not in existing:
                    WorkEventParticipant(event=event, user=user).save(created_by_id=actor.id)
            event._participant_ids = keep
        event.save()
        _audit(workspace, actor, "work_event.updated", event, before, _event_snapshot(event), reason)
    users = participants or list(User.objects.filter(id__in=event_participant_ids(event)))
    return event, _event_warnings(workspace, event, users)


def cancel_event(workspace, actor, event_id, data, request=None):
    with transaction.atomic():
        event = _locked_event(workspace, event_id)
        if not can_manage_event(actor, event, workspace, request):
            raise PermissionDenied("اجازهٔ لغو این رویداد را ندارید.")
        if event.status == WorkEvent.Status.CANCELLED:
            raise ValidationError({"status": "این رویداد قبلاً لغو شده است."})
        reason = _reason(data)
        before = _event_snapshot(event)
        event.status, event.cancel_reason = WorkEvent.Status.CANCELLED, reason
        event.save(update_fields=["status", "cancel_reason", "updated_at"])
        _audit(workspace, actor, "work_event.cancelled", event, before, _event_snapshot(event), reason)
    return event


# ---------------------------------------------------------------- presence declarations


def declare_presence(workspace, actor, request=None):
    """Self-report presence on a non-working day; only for oneself, once a day."""
    zone = calendar_zone(workspace)
    now = timezone.now()
    today = now.astimezone(zone).date()
    if schedule_for(actor, today, workspace).working:
        raise ValidationError({"date": "امروز طبق برنامهٔ شما روز کاری است؛ اعلام حضور فقط برای روز غیرکاری است."})
    with transaction.atomic():
        User.objects.select_for_update().get(pk=actor.id)
        if PresenceDeclaration.objects.filter(
            workspace=workspace, user=actor, date=today, status=PresenceDeclaration.Status.ACTIVE
        ).exists():
            raise ValidationError({"date": "امروز قبلاً اعلام حضور کرده‌اید."})
        row = PresenceDeclaration(workspace=workspace, user=actor, date=today, declared_at=now, time_zone=str(zone))
        row.save(created_by_id=actor.id)
        _audit(
            workspace,
            actor,
            "presence_declaration.created",
            row,
            None,
            {**serialize_presence(row), "user_time_zone": getattr(actor, "user_timezone", "")},
            "اعلام حضور توسط خود فرد",
        )
    return row


def cancel_presence(workspace, actor, declaration_id, data, request=None):
    with transaction.atomic():
        try:
            row = PresenceDeclaration.objects.select_for_update().get(workspace=workspace, id=declaration_id)
        except (PresenceDeclaration.DoesNotExist, ValueError):
            raise NotFound("اعلام حضور پیدا نشد.")
        if row.user_id != actor.id:
            raise PermissionDenied("فقط خود فرد می‌تواند اعلام حضورش را لغو کند.")
        if row.status != PresenceDeclaration.Status.ACTIVE:
            raise ValidationError({"status": "این اعلام قبلاً لغو شده است."})
        reason = _reason(data, False) or "لغو توسط خود فرد"
        before = serialize_presence(row)
        row.status, row.cancelled_at, row.cancel_reason = PresenceDeclaration.Status.CANCELLED, timezone.now(), reason
        row.save(update_fields=["status", "cancelled_at", "cancel_reason", "updated_at"])
        _audit(workspace, actor, "presence_declaration.cancelled", row, before, serialize_presence(row), reason)
    return row


# ---------------------------------------------------------------- confirmations


PENDING_DAYS = 30


def pending_items(workspace, user):
    """Past events and declared days awaiting the person's own confirmation."""
    now = timezone.now()
    zone = calendar_zone(workspace)
    confirmed = set(
        ActivityConfirmation.objects.filter(workspace=workspace, user=user).values_list("source_type", "source_id")
    )
    items = []
    for event in WorkEvent.objects.filter(
        workspace=workspace,
        status=WorkEvent.Status.PLANNED,
        participant_rows__user=user,
        participant_rows__deleted_at__isnull=True,
        ends_at__lte=now,
        ends_at__gte=now - timedelta(days=PENDING_DAYS),
    ).distinct():
        if ("event", event.id) not in confirmed:
            items.append(
                {
                    "source_type": "event",
                    "source_id": str(event.id),
                    "kind": event.kind,
                    "title": event.title,
                    "starts_at": event.starts_at.astimezone(zone).isoformat(),
                    "ends_at": event.ends_at.astimezone(zone).isoformat(),
                }
            )
    today = now.astimezone(zone).date()
    for row in PresenceDeclaration.objects.filter(
        workspace=workspace,
        user=user,
        status=PresenceDeclaration.Status.ACTIVE,
        date__lt=today,
        date__gte=today - timedelta(days=PENDING_DAYS),
    ):
        if ("presence", row.id) not in confirmed:
            items.append(
                {
                    "source_type": "presence",
                    "source_id": str(row.id),
                    "kind": "presence",
                    "title": "اعلام حضور در روز غیرکاری",
                    "starts_at": datetime.combine(row.date, time.min, tzinfo=zone).isoformat(),
                    "ends_at": datetime.combine(row.date + timedelta(days=1), time.min, tzinfo=zone).isoformat(),
                }
            )
    items.sort(key=lambda item: item["starts_at"])
    return items


def confirm_activity(workspace, actor, data, request=None):
    """Only the person themself may mark an item done or not done — never a manager."""
    source_type = data.get("source_type")
    outcome = data.get("outcome")
    if source_type not in ActivityConfirmation.Source.values:
        raise ValidationError({"source_type": "نوع مورد معتبر نیست."})
    if outcome not in ActivityConfirmation.Outcome.values:
        raise ValidationError({"outcome": "نتیجه باید «انجام شد» یا «انجام نشد» باشد."})
    summary = str(data.get("summary") or "").strip()
    if len(summary) > 2000:
        raise ValidationError({"summary": "خلاصه نباید بیش از ۲۰۰۰ نویسه باشد."})
    now = timezone.now()
    with transaction.atomic():
        User.objects.select_for_update().get(pk=actor.id)
        if source_type == "event":
            try:
                source = WorkEvent.objects.get(workspace=workspace, id=data.get("source_id"))
            except (WorkEvent.DoesNotExist, ValueError, TypeError):
                raise NotFound("مورد پیدا نشد.")
            if actor.id not in event_participant_ids(source):
                raise PermissionDenied("فقط خود شرکت‌کننده می‌تواند انجام‌شدن این مورد را تأیید کند.")
            if source.status != WorkEvent.Status.PLANNED:
                raise ValidationError({"source_id": "رویداد لغوشده قابل تأیید نیست."})
            if source.ends_at > now:
                raise ValidationError({"source_id": "رویداد هنوز تمام نشده است."})
        else:
            try:
                source = PresenceDeclaration.objects.get(workspace=workspace, id=data.get("source_id"))
            except (PresenceDeclaration.DoesNotExist, ValueError, TypeError):
                raise NotFound("مورد پیدا نشد.")
            if source.user_id != actor.id:
                raise PermissionDenied("فقط خود فرد می‌تواند اعلام حضورش را تأیید کند.")
            if source.status != PresenceDeclaration.Status.ACTIVE:
                raise ValidationError({"source_id": "اعلام لغوشده قابل تأیید نیست."})
        if ActivityConfirmation.objects.filter(
            workspace=workspace, user=actor, source_type=source_type, source_id=source.id
        ).exists():
            raise ValidationError({"source_id": "این مورد قبلاً تأیید شده است."})
        row = ActivityConfirmation(
            workspace=workspace,
            user=actor,
            source_type=source_type,
            source_id=source.id,
            outcome=outcome,
            summary=summary,
            confirmed_at=now,
        )
        row.save(created_by_id=actor.id)
        _audit(
            workspace,
            actor,
            "activity_confirmation.created",
            row,
            None,
            {"source_type": source_type, "source_id": str(source.id), "outcome": outcome, "summary": summary},
            "تأیید توسط خود فرد",
        )
    return row
