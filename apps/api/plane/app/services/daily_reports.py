"""Ticket 8 — daily work reports: single source of truth for a person's report of one day.

Reuse, not parallel machinery (decisions 8.1–8.5):

- leave is read live from ``LeaveRequest``/``LeaveRequestVersion`` (approved, current
  version) every time a day is opened; nothing about leave is stored in a report, so a
  cancelled, rejected or moved leave is reflected immediately. There is no leave category
  anywhere and no endpoint here writes to leave;
- schedule, holidays and working days: ``work_calendar`` (``schedule_for`` /
  ``bulk_resolvers``); meetings/missions: ``WorkEvent``; self-reported presence:
  ``PresenceDeclaration`` (always labelled "self-reported, not verified presence");
  "done/not done" of an event: the existing ``ActivityConfirmation`` row;
- policy (edit window, lateness deadline, reminder defaults, report limits) lives in the
  existing per-workspace ``SurfaceConfiguration`` (code ``daily-report``); unit and
  personal settings (reminder, personal templates) in ``SurfaceValues``;
- history: append-only ``EntityEvent`` rows ``daily_report.*`` with a diff of the items.

``effort_minutes`` is an estimate of effort only: it is never added up as working time,
attendance, lateness or overtime anywhere.
"""

from copy import deepcopy
from datetime import date, datetime, time, timedelta
from uuid import UUID

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from plane.db.models import (
    ActivityConfirmation,
    DailyReport,
    DailyReportItem,
    EntityEvent,
    Issue,
    LeaveRequest,
    PresenceDeclaration,
    Project,
    SurfaceConfiguration,
    SurfaceValues,
    User,
    WorkEvent,
    WorkspaceMember,
)
from .access_control import has_permission
from .work_calendar import bulk_resolvers, calendar_zone, local_today
from .work_calendar_actions import fa_date
from .workflow_engine import Conflict

CODE = "daily-report"
UNIT_CODE = "daily-report-unit"
USER_CODE = "daily-report-user"
FA_DIGITS = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")
WEEKDAY_TITLES = ("دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه", "یکشنبه")
KIND_TITLES = dict(DailyReportItem.Kind.choices)
STATUS_TITLES = dict(DailyReport.Status.choices)
SOURCE_KINDS = ("issue", "comment", "event", "decision", "activity", "previous", "template")
MAX_ITEMS = 100
MAX_TEXT = 2000
MAX_TEMPLATES = 30
PRESENCE_LABEL = "خوداظهاری — حضور تأییدشده نیست"
EFFORT_LABEL = "تخمین تلاش (نه ساعت کاری)"
DAY_STATUS_TITLES = {
    "submitted": "ثبت‌شده",
    "late": "ثبت‌شده (دیرهنگام)",
    "draft": "ثبت‌نشده (پیش‌نویس)",
    "missing": "ثبت‌نشده",
    "not_required": "لازم نیست (مرخصی تمام‌روز)",
    "off": "روز غیرکاری",
    "future": "هنوز نرسیده",
}

DEFAULTS = {
    # Reminder (decision 8.7): weekdays are Python weekdays (Monday=0 … Sunday=6); non-working
    # days of each person's calendar are always skipped, whatever this list says.
    "reminder": {"enabled": True, "time": "16:30", "weekdays": [0, 1, 2, 3, 4, 5, 6]},
    "allow_personal": True,
    # A report submitted after this local time of its own day is "late" (decision 8.5).
    "deadline_time": "23:59",
    # Corrections after submission: until the end of the Nth next working day, or the week end.
    "edit_window": {"mode": "working_days", "days": 1},
    # External channels stay off until a provider is configured (adapter is a no-op).
    "channels": {"email": False, "sms": False},
    "report_range_days": 366,
    "personal_report_limit": 50,
    "sync_row_limit": 5000,
}


def fa(value):
    return str(value).translate(FA_DIGITS)


def person(user):
    return {"id": str(user.id), "name": user.display_name or user.email or user.username} if user else None


def _hhmm(value, label):
    try:
        parsed = time.fromisoformat(str(value))
    except (TypeError, ValueError):
        raise ValidationError({label: "ساعت را به شکل HH:MM وارد کنید."})
    return parsed.strftime("%H:%M")


def _weekdays(value, label):
    if not isinstance(value, list) or not all(
        isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= 6 for v in value
    ):
        raise ValidationError({label: "روزهای هفته معتبر نیست."})
    return sorted(set(value))


def clean_reminder(raw, label="reminder"):
    if not isinstance(raw, dict):
        raise ValidationError({label: "تنظیمات یادآوری معتبر نیست."})
    unknown = set(raw) - {"enabled", "time", "weekdays"}
    if unknown:
        raise ValidationError({label: f"کلید ناشناخته: {', '.join(sorted(unknown))}"})
    result = {}
    if "enabled" in raw:
        if not isinstance(raw["enabled"], bool):
            raise ValidationError({label: "فعال یا غیرفعال بودن یادآوری معتبر نیست."})
        result["enabled"] = raw["enabled"]
    if "time" in raw:
        result["time"] = _hhmm(raw["time"], label)
    if "weekdays" in raw:
        result["weekdays"] = _weekdays(raw["weekdays"], label)
    return result


def _bounded(value, label, low, high):
    if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
        raise ValidationError({label: f"مقدار باید عددی بین {fa(low)} و {fa(high)} باشد."})
    return value


def validate_policy(raw):
    if not isinstance(raw, dict):
        raise ValidationError("ساختار تنظیمات گزارش روزانه معتبر نیست.")
    unknown = set(raw) - set(DEFAULTS)
    if unknown:
        raise ValidationError(f"کلید ناشناخته در تنظیمات گزارش روزانه: {', '.join(sorted(unknown))}")
    data = {**deepcopy(DEFAULTS), **deepcopy(raw)}
    data["reminder"] = {**DEFAULTS["reminder"], **clean_reminder(data["reminder"])}
    if not isinstance(data["allow_personal"], bool):
        raise ValidationError({"allow_personal": "مقدار اجازهٔ تنظیم شخصی معتبر نیست."})
    data["deadline_time"] = _hhmm(data["deadline_time"], "deadline_time")
    window = data["edit_window"] if isinstance(data["edit_window"], dict) else {}
    if window.get("mode") not in ("working_days", "week_end"):
        raise ValidationError({"edit_window": "نوع دورهٔ اصلاح معتبر نیست."})
    data["edit_window"] = {
        "mode": window["mode"],
        "days": _bounded(window.get("days", 1), "edit_window", 0, 30) if window["mode"] == "working_days" else 0,
    }
    channels = data["channels"] if isinstance(data["channels"], dict) else {}
    data["channels"] = {key: bool(channels.get(key)) for key in ("email", "sms")}
    data["report_range_days"] = _bounded(data["report_range_days"], "report_range_days", 1, 731)
    data["personal_report_limit"] = _bounded(data["personal_report_limit"], "personal_report_limit", 1, 500)
    data["sync_row_limit"] = _bounded(data["sync_row_limit"], "sync_row_limit", 100, 50000)
    return data


def policy(workspace):
    row = SurfaceConfiguration.objects.filter(workspace=workspace, code=CODE).first()
    try:
        return validate_policy(row.definition if row else {})
    except ValidationError:
        return deepcopy(DEFAULTS)


def save_policy(workspace, actor, data, request=None):
    if not has_permission(actor, workspace, "DailyReport.Reminder.Manage", request=request):
        raise PermissionDenied("مجوز مدیریت تنظیمات گزارش روزانه را ندارید.")
    with transaction.atomic():
        row, _ = SurfaceConfiguration.objects.select_for_update().get_or_create(workspace=workspace, code=CODE)
        before = policy(workspace) if row.definition else deepcopy(DEFAULTS)
        after = validate_policy({**before, **(data or {})})
        row.definition = after
        row.revision += 1
        row.save()
        audit(workspace, actor, "daily_report.settings_changed", None, before=before, after=after, level="workspace")
    return after


def user_values(workspace, user_id):
    row = SurfaceValues.objects.filter(workspace=workspace, code=USER_CODE, object_id=user_id).first()
    return deepcopy(row.values) if row else {}


def _set_user_values(workspace, user_id, values):
    SurfaceValues.objects.update_or_create(
        workspace=workspace, code=USER_CODE, object_id=user_id, defaults={"values": values}
    )


# ---------------------------------------------------------------- audit


def audit(workspace, actor, event_type, record_id, before=None, after=None, **metadata):
    """Append one history row (never updated or deleted)."""
    from .entity_records import json_value

    event = EntityEvent(
        workspace=workspace,
        entity=None,
        record_id=record_id,
        event_type=event_type,
        before=json_value(before),
        after=json_value(after),
        metadata={"subject": event_type.split(".")[0], **{k: json_value(v) for k, v in metadata.items()}},
        created_by_id=getattr(actor, "id", actor),
    )
    event.save(created_by_id=getattr(actor, "id", actor))
    return event


# ---------------------------------------------------------------- live context (read-only)


def _day_bounds(day, zone):
    start = datetime.combine(day, time(0), tzinfo=zone)
    return start, start + timedelta(days=1)


def approved_leaves(workspace, user_ids, date_from, date_to):
    """{user_id: [(request, current_version), …]} for approved requests overlapping the range.

    Read live: the current version is the highest-numbered one, so a correction, cancellation
    or rejection is reflected on the next read without any synchronization.
    """
    rows = (
        LeaveRequest.objects.filter(
            workspace=workspace, requester_id__in=list(user_ids), status=LeaveRequest.Status.APPROVED
        )
        .prefetch_related("versions")
        .order_by("created_at")
    )
    result = {}
    for row in rows:
        versions = sorted(row.versions.all(), key=lambda v: v.number)
        if not versions:
            continue
        version = versions[-1]
        if version.start_date <= date_to and version.end_date >= date_from:
            result.setdefault(row.requester_id, []).append((row, version))
    return result


def _covers_working_day(schedule, leaves, zone):
    intervals = schedule.intervals(zone)
    if not schedule.working or not intervals:
        return False
    spans = sorted((version.starts_at, version.ends_at) for _, version in leaves)
    for start, end in intervals:
        cursor = start
        for leave_start, leave_end in spans:
            if leave_start <= cursor < leave_end:
                cursor = max(cursor, leave_end)
        if cursor < end:
            return False
    return True


def leave_payload(row, version, workspace, schedule):
    from .leave_requests import duration_text, period_text

    zone = calendar_zone(workspace)
    return {
        "id": str(row.id),
        "number": row.number,
        "mode": version.mode,
        "mode_label": "روزانه" if version.mode == "daily" else "ساعتی",
        "period_text": period_text(version, workspace),
        "duration_text": duration_text(version.mode, version.duration_days, version.duration_minutes),
        "full_day": _covers_working_day(schedule, [(row, version)], zone),
        "url": f"/leave-requests/{row.id}",
    }


def day_leaves(workspace, leaves, day, schedule):
    zone = calendar_zone(workspace)
    start, end = _day_bounds(day, zone)
    return [(row, version) for row, version in leaves if version.starts_at < end and version.ends_at > start]


def editable_until(workspace, user, work_date, settings=None, resolver=None):
    """End of the correction period (decision 8.5), as an aware moment in the calendar zone."""
    settings = settings or policy(workspace)
    zone = calendar_zone(workspace)
    window = settings["edit_window"]
    if window["mode"] == "week_end":
        # Persian week: Saturday … Friday (Python weekday 4).
        last = work_date + timedelta(days=(4 - work_date.weekday()) % 7)
    else:
        needed, last = window["days"], work_date
        if needed:
            resolver = resolver or bulk_resolvers(workspace, [user], work_date, work_date + timedelta(days=60))[user.id]
            found, day = 0, work_date
            for _ in range(60):
                day += timedelta(days=1)
                if resolver.day(day).working:
                    found += 1
                    if found == needed:
                        break
            last = day if found == needed else work_date + timedelta(days=needed)
    return datetime.combine(last + timedelta(days=1), time(0), tzinfo=zone)


def deadline_of(workspace, work_date, settings=None):
    settings = settings or policy(workspace)
    zone = calendar_zone(workspace)
    hour, minute = map(int, settings["deadline_time"].split(":"))
    return datetime.combine(work_date, time(hour, minute), tzinfo=zone) + timedelta(seconds=59)


def get_report(workspace, user, work_date, lock=False):
    rows = DailyReport.objects.filter(workspace=workspace, user=user, work_date=work_date)
    if lock:
        rows = rows.select_for_update()
    return rows.first()


def _ticket_labels(viewer, workspace, issue_ids, request=None):
    """Only tickets the viewer may see keep their title; others are shown as hidden."""
    from .report_scope import visible_ticket_ids
    from plane.db.models import EntityRecord

    ids = [i for i in issue_ids if i]
    if not ids:
        return {}
    visible = Issue.objects.filter(id__in=ids, workspace=workspace).filter(
        id__in=visible_ticket_ids(viewer, workspace, request)
    )
    numbers = dict(
        EntityRecord.objects.filter(workspace=workspace, source_id__in=ids, entity__code="ticket").values_list(
            "source_id", "number"
        )
    )
    return {
        row.id: {"id": str(row.id), "title": row.name, "number": numbers.get(row.id) or f"#{row.sequence_id}"}
        for row in visible
    }


def item_payload(item, labels):
    issue = None
    if item.issue_id:
        issue = labels.get(item.issue_id) or {"id": None, "title": "تیکت خارج از دسترسی شما", "hidden": True}
    return {
        "id": str(item.id),
        "kind": item.kind,
        "kind_label": KIND_TITLES[item.kind],
        "text": item.text,
        "needs_help": item.needs_help,
        "issue": issue,
        "project": {"id": str(item.project_id), "name": item.project.name} if item.project_id else None,
        "effort_minutes": item.effort_minutes,
        "source_kind": item.source_kind,
        "source_id": item.source_id,
        "position": item.position,
    }


def snapshot(report):
    """Comparable form of the items (for history diffs)."""
    return (
        [
            {
                "kind": item.kind,
                "text": item.text,
                "needs_help": item.needs_help,
                "issue_id": str(item.issue_id) if item.issue_id else None,
                "project_id": str(item.project_id) if item.project_id else None,
                "effort_minutes": item.effort_minutes,
                "source_kind": item.source_kind,
                "source_id": item.source_id,
            }
            for item in report.items.all().order_by("kind", "position", "created_at")
        ]
        if report
        else []
    )


def diff(before, after):
    key = lambda row: (row["kind"], row["text"], row["issue_id"], row["project_id"])  # noqa: E731
    before_keys = {key(row): row for row in before}
    after_keys = {key(row): row for row in after}
    return {
        "added": [row for k, row in after_keys.items() if k not in before_keys],
        "removed": [row for k, row in before_keys.items() if k not in after_keys],
        "changed": [
            {"before": before_keys[k], "after": row}
            for k, row in after_keys.items()
            if k in before_keys and before_keys[k] != row
        ],
    }


def can_view_person(viewer, workspace, target_id, request=None):
    if str(target_id) == str(viewer.id):
        return True
    from .report_scope import people_scope

    if not has_permission(viewer, workspace, "DailyReport.Team.View", request=request) and not has_permission(
        viewer, workspace, "Report.ViewAll", request=request
    ):
        return False
    return people_scope(viewer, workspace, source="daily_reports", request=request).allows(UUID(str(target_id)))


def resolve_person(viewer, workspace, user_id=None, request=None):
    if not user_id or str(user_id) == str(viewer.id):
        return viewer
    try:
        target = User.objects.get(id=UUID(str(user_id)))
    except (User.DoesNotExist, ValueError, TypeError):
        raise NotFound("گزارشی برای این فرد پیدا نشد.")
    if not can_view_person(viewer, workspace, target.id, request):
        # Same answer as a missing person: never confirms that someone outside the scope exists.
        raise NotFound("گزارشی برای این فرد پیدا نشد.")
    return target


def parse_day(value, workspace):
    if value in (None, "", "today"):
        return local_today(workspace)
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        raise ValidationError({"date": "تاریخ معتبر نیست."})


def requirement(schedule, leaves, day, today, zone):
    if day > today:
        return "future"
    if not schedule.working:
        return "off"
    if _covers_working_day(schedule, leaves, zone):
        return "not_required"
    return "required"


REQUIREMENT_TEXT = {
    "required": "گزارش این روز لازم است.",
    "not_required": "روز تمام‌مرخصی — گزارش لازم نیست؛ در صورت تمایل می‌توانید ثبت کنید.",
    "off": "روز غیرکاری یا تعطیل است — گزارش لازم نیست.",
    "future": "این روز هنوز نرسیده است؛ برای روز آینده گزارش ثبت نمی‌شود.",
}


def day_payload(workspace, viewer, target, day, request=None, now=None):
    now = now or timezone.now()
    zone = calendar_zone(workspace)
    today = local_today(workspace, now)
    settings = policy(workspace)
    resolver = bulk_resolvers(workspace, [target], day, day + timedelta(days=60))[target.id]
    schedule = resolver.day(day)
    leaves = day_leaves(workspace, approved_leaves(workspace, [target.id], day, day).get(target.id, []), day, schedule)
    start, end = _day_bounds(day, zone)
    events = list(
        WorkEvent.objects.filter(
            workspace=workspace,
            participant_rows__user=target,
            participant_rows__deleted_at__isnull=True,
            starts_at__lt=end,
            ends_at__gt=start,
        )
        .exclude(status=WorkEvent.Status.CANCELLED)
        .distinct()
        .order_by("starts_at")
    )
    confirmations = {
        str(row.source_id): row.outcome
        for row in ActivityConfirmation.objects.filter(
            workspace=workspace, user=target, source_type="event", source_id__in=[e.id for e in events]
        )
    }
    presence = PresenceDeclaration.objects.filter(
        workspace=workspace, user=target, date=day, status=PresenceDeclaration.Status.ACTIVE
    ).first()
    report = get_report(workspace, target, day)
    items = list(report.items.select_related("project").order_by("kind", "position", "created_at")) if report else []
    labels = _ticket_labels(viewer, workspace, [i.issue_id for i in items], request)
    until = editable_until(workspace, target, day, settings, resolver)
    mine = target.id == viewer.id
    need = requirement(schedule, leaves, day, today, zone)
    locked = now >= until
    can_submit = has_permission(viewer, workspace, "DailyReport.Submit", request=request)
    return {
        "date": day.isoformat(),
        "date_text": fa_date(day),
        "weekday": WEEKDAY_TITLES[day.weekday()],
        "today": today.isoformat(),
        "person": person(target),
        "is_mine": mine,
        "schedule": {
            **schedule.as_dict(zone, private=False),
            "label": "روز کاری" if schedule.working else "روز غیرکاری",
        },
        "leaves": [leave_payload(row, version, workspace, schedule) for row, version in leaves],
        "requirement": need,
        "requirement_text": REQUIREMENT_TEXT[need],
        "events": [
            {
                "id": str(event.id),
                "kind": event.kind,
                "kind_label": event.get_kind_display(),
                "title": event.title,
                "starts_at": event.starts_at.astimezone(zone).isoformat(),
                "ends_at": event.ends_at.astimezone(zone).isoformat(),
                "time_text": (
                    f"{fa(event.starts_at.astimezone(zone).strftime('%H:%M'))} تا "
                    f"{fa(event.ends_at.astimezone(zone).strftime('%H:%M'))}"
                ),
                "past": event.ends_at <= now,
                "confirmation": confirmations.get(str(event.id)),
            }
            for event in events
        ],
        "presence": (
            {
                "declared_at": presence.declared_at.astimezone(zone).isoformat(),
                "label": PRESENCE_LABEL,
                "kind": "self_reported",
            }
            if presence
            else None
        ),
        "report": (
            {
                "id": str(report.id),
                "status": report.status,
                "status_label": STATUS_TITLES[report.status],
                "revision": report.revision,
                "submitted_at": report.submitted_at.astimezone(zone).isoformat() if report.submitted_at else None,
                "first_submitted_at": (
                    report.first_submitted_at.astimezone(zone).isoformat() if report.first_submitted_at else None
                ),
                "is_late": report.is_late,
                "items": [item_payload(item, labels) for item in items],
            }
            if report
            else None
        ),
        "locked": locked,
        "lock_text": "دورهٔ اصلاح این گزارش پایان یافته و گزارش قفل است." if locked else "",
        "editable_until": until.isoformat(),
        "editable_until_text": fa_date((until - timedelta(seconds=1)).date()),
        "deadline_text": f"{fa_date(day)} ساعت {fa(settings['deadline_time'])}",
        "effort_label": EFFORT_LABEL,
        "can": {
            "edit": mine and can_submit and not locked and need != "future",
        },
    }


# ---------------------------------------------------------------- writing


def _lock_person(workspace, user):
    list(WorkspaceMember.objects.select_for_update().filter(workspace=workspace, member=user).values_list("id"))


def _clean_items(workspace, actor, day, raw_items, request=None, now=None):
    from .project_visibility import visible_projects
    from .report_scope import visible_ticket_ids

    now = now or timezone.now()
    if not isinstance(raw_items, list):
        raise ValidationError({"items": "فهرست موارد گزارش معتبر نیست."})
    if len(raw_items) > MAX_ITEMS:
        raise ValidationError({"items": f"حداکثر {fa(MAX_ITEMS)} مورد در یک گزارش مجاز است."})
    issue_ids, project_ids, event_ids = set(), set(), set()
    cleaned = []
    positions = {}
    for index, raw in enumerate(raw_items):
        if not isinstance(raw, dict):
            raise ValidationError({"items": "ساختار یکی از موارد معتبر نیست."})
        kind = raw.get("kind")
        if kind not in KIND_TITLES:
            raise ValidationError({"items": f"نوع مورد {fa(index + 1)} معتبر نیست."})
        text = raw.get("text")
        text = text.strip() if isinstance(text, str) else ""
        if not text:
            raise ValidationError({"items": f"متن مورد {fa(index + 1)} خالی است."})
        if len(text) > MAX_TEXT:
            raise ValidationError({"items": f"متن هر مورد حداکثر {fa(MAX_TEXT)} نویسه است."})
        source_kind = raw.get("source_kind") or ""
        source_id = str(raw.get("source_id") or "")[:64]
        if source_kind == "leave":
            raise ValidationError({"items": "مرخصی به‌صورت خودکار نمایش داده می‌شود و مورد گزارش نیست."})
        if source_kind not in ("", *SOURCE_KINDS):
            raise ValidationError({"items": "منبع مورد پیشنهادی معتبر نیست."})
        effort = raw.get("effort_minutes")
        if effort in ("", None):
            effort = None
        elif not isinstance(effort, int) or isinstance(effort, bool) or not 1 <= effort <= 24 * 60:
            raise ValidationError({"items": f"{EFFORT_LABEL} باید بین ۱ و ۱۴۴۰ دقیقه باشد."})
        needs_help = bool(raw.get("needs_help")) and kind == DailyReportItem.Kind.BLOCKER
        item = {
            "kind": kind,
            "text": text,
            "needs_help": needs_help,
            "issue_id": None,
            "project_id": None,
            "effort_minutes": effort,
            "source_kind": source_kind,
            "source_id": source_id,
            "position": positions.setdefault(kind, 0),
        }
        positions[kind] += 1
        for key, bucket in (("issue", issue_ids), ("project", project_ids)):
            nested = raw.get(key)
            value = raw.get(f"{key}_id") or (nested.get("id") if isinstance(nested, dict) else None)
            if value:
                try:
                    item[f"{key}_id"] = UUID(str(value))
                except ValueError:
                    raise ValidationError({"items": "شناسهٔ تیکت یا پروژهٔ مرتبط معتبر نیست."})
                bucket.add(item[f"{key}_id"])
        if source_kind == "event":
            try:
                event_ids.add(UUID(source_id))
            except ValueError:
                raise ValidationError({"items": "رویداد تقویمی معتبر نیست."})
        cleaned.append(item)
    if issue_ids:
        allowed = set(
            Issue.objects.filter(id__in=issue_ids, workspace=workspace)
            .filter(id__in=visible_ticket_ids(actor, workspace, request))
            .values_list("id", flat=True)
        )
        if issue_ids - allowed:
            raise ValidationError({"items": "تیکت انتخاب‌شده پیدا نشد یا اجازهٔ دیدن آن را ندارید."})
    if project_ids:
        allowed = set(
            visible_projects(Project.objects.filter(workspace=workspace), actor, workspace.slug)
            .filter(id__in=project_ids)
            .values_list("id", flat=True)
        )
        if project_ids - allowed:
            raise ValidationError({"items": "پروژهٔ انتخاب‌شده پیدا نشد یا عضو آن نیستید."})
    if event_ids:
        zone = calendar_zone(workspace)
        start, end = _day_bounds(day, zone)
        events = {
            row.id: row
            for row in WorkEvent.objects.filter(
                workspace=workspace,
                id__in=event_ids,
                participant_rows__user=actor,
                participant_rows__deleted_at__isnull=True,
            ).distinct()
        }
        for item in cleaned:
            if item["source_kind"] != "event":
                continue
            event = events.get(UUID(item["source_id"]))
            if event is None or event.status == WorkEvent.Status.CANCELLED:
                raise ValidationError({"items": "رویداد تقویمی پیدا نشد یا لغو شده است."})
            if not (event.starts_at < end and event.ends_at > start):
                raise ValidationError({"items": "رویداد تقویمی به روز این گزارش تعلق ندارد."})
            # Decision 8.3: planned never means done; a future event cannot be reported as done.
            if item["kind"] == DailyReportItem.Kind.DONE and event.ends_at > now:
                raise ValidationError({"items": "رویداد آینده یا در حال انجام را نمی‌توان «انجام‌شده» ثبت کرد."})
    return cleaned


def save_day(workspace, actor, day, data, request=None, now=None):
    """Create or update the actor's own report of ``day``; ``submit`` moves draft → submitted."""
    now = now or timezone.now()
    if not has_permission(actor, workspace, "DailyReport.Submit", request=request):
        raise PermissionDenied("مجوز ثبت گزارش روزانه را ندارید.")
    data = data or {}
    today = local_today(workspace, now)
    if day > today:
        raise ValidationError({"date": "برای روز آینده گزارش ثبت نمی‌شود."})
    settings = policy(workspace)
    if now >= editable_until(workspace, actor, day, settings):
        raise ValidationError({"date": "دورهٔ اصلاح این گزارش پایان یافته و گزارش قفل است."})
    submit = data.get("submit") is True
    items = _clean_items(workspace, actor, day, data.get("items", []), request, now)
    if submit and not items:
        raise ValidationError({"items": "برای ثبت گزارش دست‌کم یک مورد بنویسید."})
    try:
        with transaction.atomic():
            _lock_person(workspace, actor)
            report = get_report(workspace, actor, day, lock=True)
            created = report is None
            if created:
                if data.get("revision") not in (None, 0):
                    raise Conflict("این گزارش هم‌زمان تغییر کرده است؛ صفحه را تازه کنید.")
                report = DailyReport(workspace=workspace, user=actor, work_date=day)
                report.save(created_by_id=actor.id)
            else:
                revision = data.get("revision")
                if not isinstance(revision, int) or isinstance(revision, bool):
                    raise ValidationError({"revision": "شمارهٔ نسخهٔ گزارش ارسال نشده است؛ صفحه را تازه کنید."})
                if revision != report.revision:
                    raise Conflict("این گزارش هم‌زمان در جای دیگری تغییر کرده است؛ صفحه را تازه کنید.")
            before = snapshot(None if created else report)
            was_submitted = report.status == DailyReport.Status.SUBMITTED
            report.items.all().delete()
            DailyReportItem.objects.bulk_create(
                [DailyReportItem(report=report, created_by_id=actor.id, **item) for item in items]
            )
            after = snapshot(report)
            if not created:
                report.revision += 1
            if submit or was_submitted:
                if not report.first_submitted_at:
                    report.first_submitted_at = now
                    report.is_late = now > deadline_of(workspace, day, settings)
                report.status = DailyReport.Status.SUBMITTED
                report.submitted_at = now
            report.save()
            if created and not submit:
                event_type = "daily_report.created"
            elif not was_submitted and submit:
                event_type = "daily_report.submitted"
            elif was_submitted:
                event_type = "daily_report.revised"
            else:
                event_type = "daily_report.draft_saved"
            audit(
                workspace,
                actor,
                event_type,
                report.id,
                before=before,
                after=after,
                work_date=day.isoformat(),
                user_id=str(actor.id),
                revision=report.revision,
                is_late=report.is_late,
                diff=diff(before, after),
            )
    except IntegrityError:
        raise Conflict("این گزارش هم‌زمان در جای دیگری ساخته شد؛ صفحه را تازه کنید.")
    return report


EVENT_TITLES = {
    "daily_report.created": "ساخت پیش‌نویس",
    "daily_report.draft_saved": "ذخیرهٔ پیش‌نویس",
    "daily_report.submitted": "ثبت گزارش",
    "daily_report.revised": "اصلاح پس از ثبت",
}


def history(workspace, viewer, target, day, request=None):
    report = get_report(workspace, target, day)
    if report is None:
        return []
    zone = calendar_zone(workspace)
    rows = EntityEvent.objects.filter(workspace=workspace, record_id=report.id, event_type__in=EVENT_TITLES).order_by(
        "created_at", "id"
    )
    actors = {u.id: u for u in User.objects.filter(id__in={r.created_by_id for r in rows if r.created_by_id})}
    result = []
    for row in rows:
        meta = row.metadata or {}
        change = meta.get("diff") or {}
        result.append(
            {
                "id": str(row.id),
                "type": row.event_type,
                "title": EVENT_TITLES[row.event_type],
                "actor": person(actors.get(row.created_by_id)),
                "at": row.created_at.astimezone(zone).isoformat(),
                "revision": meta.get("revision"),
                "is_late": meta.get("is_late", False),
                "added": [item["text"] for item in change.get("added", [])],
                "removed": [item["text"] for item in change.get("removed", [])],
                "changed": len(change.get("changed", [])),
            }
        )
    return result


# ---------------------------------------------------------------- helpers for the form


def work_options(workspace, actor, query="", request=None, now=None):
    """ "My work" picker: open or recently updated tickets the actor owns or takes part in, and projects."""
    from django.db.models import Q

    from .project_visibility import visible_projects
    from .report_scope import owner_q, visible_ticket_ids
    from .ticket_core import open_q, participant_q
    from plane.db.models import EntityRecord

    now = now or timezone.now()
    rows = (
        Issue.objects.filter(workspace=workspace, is_draft=False, id__in=visible_ticket_ids(actor, workspace, request))
        .filter(owner_q([actor.id]) | participant_q(actor, workspace))
        .filter(open_q() | Q(updated_at__gte=now - timedelta(days=14)))
        .select_related("state", "project")
        .distinct()
    )
    term = str(query or "").strip()[:100]
    if term:
        rows = rows.filter(name__icontains=term)
    rows = list(rows.order_by("-updated_at")[:30])
    numbers = dict(
        EntityRecord.objects.filter(
            workspace=workspace, source_id__in=[r.id for r in rows], entity__code="ticket"
        ).values_list("source_id", "number")
    )
    from .ticket_core import CATEGORY_TITLES, category_of

    projects = visible_projects(
        Project.objects.filter(workspace=workspace, archived_at__isnull=True), actor, workspace.slug
    )
    if term:
        projects = projects.filter(name__icontains=term)
    return {
        "tickets": [
            {
                "id": str(row.id),
                "number": numbers.get(row.id) or f"#{row.sequence_id}",
                "title": row.name,
                "status": CATEGORY_TITLES[category_of(row)],
                "project": {"id": str(row.project_id), "name": row.project.name} if row.project_id else None,
            }
            for row in rows
        ],
        "projects": [{"id": str(p.id), "name": p.name} for p in projects.order_by("name")[:30]],
    }


def previous_report(workspace, actor, before_day, request=None):
    report = (
        DailyReport.objects.filter(
            workspace=workspace, user=actor, status=DailyReport.Status.SUBMITTED, work_date__lt=before_day
        )
        .order_by("-work_date")
        .first()
    )
    if report is None:
        return None
    items = list(report.items.select_related("project").order_by("kind", "position"))
    labels = _ticket_labels(actor, workspace, [i.issue_id for i in items], request)
    return {
        "date": report.work_date.isoformat(),
        "date_text": fa_date(report.work_date),
        "items": [
            {**item_payload(item, labels), "source_kind": "previous", "source_id": str(report.id)}
            for item in items
            if not (item.issue_id and item.issue_id not in labels)
        ],
    }


def templates(workspace, actor):
    return user_values(workspace, actor.id).get("templates", [])


def save_templates(workspace, actor, raw, request=None):
    import uuid as _uuid

    if not has_permission(actor, workspace, "DailyReport.Submit", request=request):
        raise PermissionDenied("مجوز ثبت گزارش روزانه را ندارید.")
    if not isinstance(raw, list) or len(raw) > MAX_TEMPLATES:
        raise ValidationError({"templates": f"حداکثر {fa(MAX_TEMPLATES)} قالب شخصی مجاز است."})
    cleaned = []
    for item in raw:
        if not isinstance(item, dict) or item.get("kind") not in KIND_TITLES:
            raise ValidationError({"templates": "نوع قالب معتبر نیست."})
        text = item.get("text").strip() if isinstance(item.get("text"), str) else ""
        if not text or len(text) > MAX_TEXT:
            raise ValidationError({"templates": "متن قالب خالی یا بیش از حد طولانی است."})
        title = item.get("title").strip()[:80] if isinstance(item.get("title"), str) else ""
        identifier = str(item.get("id") or _uuid.uuid4())[:40]
        cleaned.append({"id": identifier, "title": title or text[:40], "kind": item["kind"], "text": text})
    with transaction.atomic():
        values = user_values(workspace, actor.id)
        before = values.get("templates", [])
        values["templates"] = cleaned
        _set_user_values(workspace, actor.id, values)
        audit(workspace, actor, "daily_report.templates_changed", actor.id, before=before, after=cleaned)
    return cleaned


# ---------------------------------------------------------------- team / range statuses (single source)


def day_statuses(workspace, user_ids, date_from, date_to, now=None):
    """Per person and day: status (submitted/late/draft/missing/not_required/off/future).

    The only implementation of "who has (not) reported": used by the manager's team view,
    the ``daily_reports`` report source and the reminder task. A constant number of queries
    whatever the number of people (bulk schedule, leaves and reports).
    """
    now = now or timezone.now()
    zone = calendar_zone(workspace)
    today = local_today(workspace, now)
    users = list(User.objects.filter(id__in=list(user_ids)).order_by("display_name", "id"))
    resolvers = bulk_resolvers(workspace, users, date_from, date_to)
    leaves = approved_leaves(workspace, [u.id for u in users], date_from, date_to)
    reports = {
        (row.user_id, row.work_date): row
        for row in DailyReport.objects.filter(
            workspace=workspace, user_id__in=[u.id for u in users], work_date__gte=date_from, work_date__lte=date_to
        ).prefetch_related("items")
    }
    rows = []
    for user in users:
        day = date_from
        while day <= date_to:
            schedule = resolvers[user.id].day(day)
            day_leave = day_leaves(workspace, leaves.get(user.id, []), day, schedule)
            report = reports.get((user.id, day))
            need = requirement(schedule, day_leave, day, today, zone)
            if report and report.status == DailyReport.Status.SUBMITTED:
                status = "late" if report.is_late else "submitted"
            elif need in ("off", "not_required", "future"):
                status = need
            else:
                status = "draft" if report else "missing"
            items = [i for i in report.items.all() if i.deleted_at is None] if report else []
            rows.append(
                {
                    "user": user,
                    "date": day,
                    "status": status,
                    "requirement": need,
                    "report": report,
                    "items": items,
                    "leaves": day_leave,
                    "schedule": schedule,
                }
            )
            day += timedelta(days=1)
    return rows


def team_day(workspace, viewer, day, request=None, now=None):
    from .report_scope import people_scope

    if not has_permission(viewer, workspace, "DailyReport.Team.View", request=request) and not has_permission(
        viewer, workspace, "Report.ViewAll", request=request
    ):
        raise PermissionDenied("مجوز مشاهدهٔ گزارش روزانهٔ تیم را ندارید.")
    scope = people_scope(viewer, workspace, source="daily_reports", request=request)
    zone = calendar_zone(workspace)
    rows = day_statuses(workspace, [uid for uid in scope.user_ids if uid != viewer.id], day, day, now)
    issue_ids = [i.issue_id for row in rows for i in row["items"]]
    labels = _ticket_labels(viewer, workspace, issue_ids, request)
    people = []
    summary = {key: 0 for key in DAY_STATUS_TITLES}
    for row in rows:
        summary[row["status"]] += 1
        report = row["report"]
        blockers = [i for i in row["items"] if i.kind == DailyReportItem.Kind.BLOCKER]
        people.append(
            {
                "person": person(row["user"]),
                "status": row["status"],
                "status_label": DAY_STATUS_TITLES[row["status"]],
                "submitted_at": report.submitted_at.astimezone(zone).isoformat()
                if report and report.submitted_at
                else None,
                "leaves": [leave_payload(r, v, workspace, row["schedule"]) for r, v in row["leaves"]],
                "blockers": [item_payload(i, labels) for i in blockers if not i.needs_help],
                "help": [item_payload(i, labels) for i in blockers if i.needs_help],
                "counts": {kind: sum(1 for i in row["items"] if i.kind == kind) for kind in KIND_TITLES},
            }
        )
    return {
        "date": day.isoformat(),
        "date_text": fa_date(day),
        "summary": summary,
        "titles": DAY_STATUS_TITLES,
        "people": people,
        "empty": "زیرمجموعه‌ای در دامنهٔ شما پیدا نشد." if not people else None,
    }
