"""Ticket 8 — in-app daily-report reminders (decision 8.7). Single source of truth.

Settings and precedence (documented in the delivery report):

    personal (only while allowed)  >  nearest unit with its own setting  >  workspace default

- the workspace default lives in the ``daily-report`` policy (``daily_reports.policy``);
- a unit setting is ``SurfaceValues(code="daily-report-unit", object_id=unit.id)`` and may
  also say whether its people may override personally (``allow_personal``);
- a personal setting is ``SurfaceValues(code="daily-report-user", object_id=user.id)``.

Every change is an ``EntityEvent`` (``daily_report.reminder_changed``).

Sending (periodic Celery task, every 15 minutes): a reminder goes to a person whose
reminder time of today has passed and whose day status (``daily_reports.day_statuses``)
is still "missing" or "draft". Nothing is sent on a non-working day or holiday of the
person's own calendar, on a day fully covered by approved leave, or once the report is
submitted; hourly leave does not stop it. At most one reminder per person and day: the
partial unique constraint ``crm_daily_report_one_reminder`` on a deterministic key makes a
second run a no-op. E-mail/SMS go through a disabled adapter only (no network call).
"""

import uuid
from datetime import time

from django.conf import settings as django_settings
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from plane.db.models import OrganizationUnit, OrganizationUnitMember, SurfaceValues, Workspace, WorkspaceMember
from . import daily_reports as reports
from .access_control import has_permission
from .crm_notifications import notify_members
from .work_calendar import _chain_of, calendar_zone, local_today

NAMESPACE = uuid.UUID("6f1b0d3e-8c1f-4a59-9a63-3d6f5b2f8e08")


class DisabledAdapter:
    """Placeholder for a provider that has not been chosen. Never talks to the network."""

    def __init__(self, channel):
        self.channel = channel

    def send(self, user, subject, body):
        return False


ADAPTERS = {"email": DisabledAdapter("email"), "sms": DisabledAdapter("sms")}


def reminder_key(workspace_id, user_id, day):
    return uuid.uuid5(NAMESPACE, f"{workspace_id}:{user_id}:{day.isoformat()}")


def _unit_values(workspace):
    return {
        row.object_id: row.values for row in SurfaceValues.objects.filter(workspace=workspace, code=reports.UNIT_CODE)
    }


def _chains(workspace, user_ids):
    units = {
        row["id"]: row
        for row in OrganizationUnit.objects.filter(workspace=workspace, is_active=True).values(
            "id", "parent_id", "title"
        )
    }
    direct = {}
    for user_id, unit_id in OrganizationUnitMember.objects.filter(
        unit__workspace=workspace, unit__is_active=True, user_id__in=list(user_ids), is_active=True
    ).values_list("user_id", "unit_id"):
        direct.setdefault(user_id, []).append(unit_id)
    return {user_id: _chain_of(units, direct.get(user_id, [])) for user_id in user_ids}, units


def effective(policy, chain, unit_values, personal):
    """(reminder, source, allow_personal) for one person."""
    reminder, source = dict(policy["reminder"]), "workspace"
    allow = policy["allow_personal"]
    unit_reminder = next(
        (unit_values[u]["reminder"] for u in chain if (unit_values.get(u) or {}).get("reminder")), None
    )
    unit_allow = next(
        (
            unit_values[u]["allow_personal"]
            for u in chain
            if isinstance((unit_values.get(u) or {}).get("allow_personal"), bool)
        ),
        None,
    )
    if unit_reminder:
        reminder, source = {**reminder, **unit_reminder}, "unit"
    if unit_allow is not None:
        allow = unit_allow
    if allow and (personal or {}).get("reminder"):
        reminder, source = {**reminder, **personal["reminder"]}, "personal"
    return reminder, source, allow


SOURCE_TITLES = {"workspace": "پیش‌فرض شرکت", "unit": "تنظیم واحد", "personal": "تنظیم شخصی"}


def manageable_units(workspace, actor, request=None):
    """Units whose reminder this person may set: their own units (and below), or all with Workspace.Edit."""
    if not has_permission(actor, workspace, "DailyReport.Reminder.Manage", request=request):
        return []
    rows = list(OrganizationUnit.objects.filter(workspace=workspace, is_active=True).order_by("title"))
    if has_permission(actor, workspace, "Workspace.Edit", request=request):
        return rows
    allowed = {row.id for row in rows if row.manager_id == actor.id}
    while True:
        added = {row.id for row in rows if row.parent_id in allowed} - allowed
        if not added:
            break
        allowed |= added
    return [row for row in rows if row.id in allowed]


def settings_payload(workspace, actor, request=None):
    policy = reports.policy(workspace)
    chains, _ = _chains(workspace, [actor.id])
    unit_values = _unit_values(workspace)
    personal = reports.user_values(workspace, actor.id)
    reminder, source, allow = effective(policy, chains[actor.id], unit_values, personal)
    units = manageable_units(workspace, actor, request)
    return {
        "effective": reminder,
        "source": source,
        "source_label": SOURCE_TITLES[source],
        "allow_personal": allow,
        "personal": personal.get("reminder"),
        "workspace": policy if has_permission(actor, workspace, "Workspace.Edit", request=request) else None,
        "can_manage_workspace": has_permission(actor, workspace, "DailyReport.Reminder.Manage", request=request)
        and has_permission(actor, workspace, "Workspace.Edit", request=request),
        "units": [
            {
                "id": str(unit.id),
                "title": unit.title,
                "reminder": (unit_values.get(unit.id) or {}).get("reminder"),
                "allow_personal": (unit_values.get(unit.id) or {}).get("allow_personal"),
            }
            for unit in units
        ],
        "channels": [
            {"code": "in_app", "title": "اعلان درون‌برنامه‌ای", "enabled": True, "note": ""},
            {"code": "email", "title": "ایمیل", "enabled": False, "note": "غیرفعال تا تنظیم سرویس"},
            {"code": "sms", "title": "پیامک", "enabled": False, "note": "غیرفعال تا تنظیم سرویس"},
        ],
    }


def save_personal(workspace, actor, raw, request=None):
    if not has_permission(actor, workspace, "DailyReport.Submit", request=request):
        raise PermissionDenied("مجوز ثبت گزارش روزانه را ندارید.")
    policy = reports.policy(workspace)
    chains, _ = _chains(workspace, [actor.id])
    _, _, allow = effective(policy, chains[actor.id], _unit_values(workspace), {})
    if not allow:
        raise PermissionDenied("تغییر یادآوری شخصی توسط مدیر مجاز نشده است.")
    cleaned = reports.clean_reminder(raw) if raw is not None else None
    with transaction.atomic():
        values = reports.user_values(workspace, actor.id)
        before = values.get("reminder")
        if cleaned:
            values["reminder"] = cleaned
        else:
            values.pop("reminder", None)
        reports._set_user_values(workspace, actor.id, values)
        reports.audit(
            workspace, actor, "daily_report.reminder_changed", actor.id, before=before, after=cleaned, level="personal"
        )
    return cleaned


def save_unit(workspace, actor, unit_id, data, request=None):
    unit = next((row for row in manageable_units(workspace, actor, request) if str(row.id) == str(unit_id)), None)
    if unit is None:
        raise NotFound("واحد پیدا نشد یا مدیریت یادآوری آن با شما نیست.")
    if not isinstance(data, dict):
        raise ValidationError("تنظیمات واحد معتبر نیست.")
    values = {}
    if data.get("reminder"):
        values["reminder"] = reports.clean_reminder(data["reminder"])
    if data.get("allow_personal") is not None:
        if not isinstance(data["allow_personal"], bool):
            raise ValidationError({"allow_personal": "مقدار اجازهٔ تنظیم شخصی معتبر نیست."})
        values["allow_personal"] = data["allow_personal"]
    with transaction.atomic():
        row = SurfaceValues.objects.filter(workspace=workspace, code=reports.UNIT_CODE, object_id=unit.id).first()
        before = row.values if row else None
        SurfaceValues.objects.update_or_create(
            workspace=workspace, code=reports.UNIT_CODE, object_id=unit.id, defaults={"values": values}
        )
        reports.audit(
            workspace, actor, "daily_report.reminder_changed", unit.id, before=before, after=values, level="unit"
        )
    return values


def save_workspace(workspace, actor, data, request=None):
    if not has_permission(actor, workspace, "Workspace.Edit", request=request):
        raise PermissionDenied("تنظیم پیش‌فرض شرکت فقط با مجوز ویرایش شرکت ممکن است.")
    return reports.save_policy(workspace, actor, data, request)


# ---------------------------------------------------------------- sending


def _external(workspace, policy, user, day):
    """E-mail/SMS: only when the server and the workspace both enable a channel; adapters are no-ops."""
    server = set(getattr(django_settings, "DAILY_REPORT_NOTIFY_CHANNELS", ()) or ())
    sent = 0
    for channel in ("email", "sms"):
        if channel in server and policy["channels"].get(channel):
            sent += bool(
                ADAPTERS[channel].send(
                    user, "یادآوری گزارش روزانه", f"گزارش کار {reports.fa_date(day)} هنوز ثبت نشده است."
                )
            )
    return sent


def due_people(workspace, now):
    """People whose reminder time of today has passed and whose report is still missing or a draft."""
    policy = reports.policy(workspace)
    zone = calendar_zone(workspace)
    local_now = now.astimezone(zone)
    today = local_today(workspace, now)
    members = list(
        WorkspaceMember.objects.filter(
            workspace=workspace, is_active=True, member__is_active=True, member__is_bot=False
        ).values_list("member_id", flat=True)
    )
    if not members:
        return policy, today, []
    chains, _ = _chains(workspace, members)
    unit_values = _unit_values(workspace)
    personal = {
        row.object_id: row.values
        for row in SurfaceValues.objects.filter(workspace=workspace, code=reports.USER_CODE, object_id__in=members)
    }
    candidates = []
    for user_id in members:
        reminder, _, _ = effective(policy, chains[user_id], unit_values, personal.get(user_id))
        if not reminder.get("enabled", True) or today.weekday() not in reminder.get("weekdays", []):
            continue
        hour, minute = map(int, reminder["time"].split(":"))
        if local_now.time() >= time(hour, minute):
            candidates.append(user_id)
    if not candidates:
        return policy, today, []
    statuses = reports.day_statuses(workspace, candidates, today, today, now)
    return policy, today, [row["user"] for row in statuses if row["status"] in ("missing", "draft")]


def send_reminders(now=None):
    now = now or timezone.now()
    sent = skipped = 0
    for workspace in Workspace.objects.all():
        policy, today, people = due_people(workspace, now)
        for user in people:
            key = reminder_key(workspace.id, user.id, today)
            try:
                with transaction.atomic():
                    reports.audit(
                        workspace,
                        None,
                        "daily_report.reminder_sent",
                        key,
                        user_id=str(user.id),
                        work_date=today.isoformat(),
                    )
                    notify_members(
                        workspace.id,
                        [user.id],
                        actor_id=None,
                        sender="crm:daily_report:reminder",
                        entity_name="daily_report",
                        title="یادآوری گزارش روزانه",
                        message=f"گزارش کار امروز ({reports.fa_date(today)}) هنوز ثبت نشده است.",
                        data={
                            "crm_event": {
                                "kind": "daily_report_reminder",
                                "entity": "daily_report",
                                "date": today.isoformat(),
                                "link": f"/daily-report?date={today.isoformat()}",
                            }
                        },
                    )
                    _external(workspace, policy, user, today)
                sent += 1
            except IntegrityError:
                skipped += 1  # already reminded today (idempotent)
    return {"sent": sent, "skipped": skipped}
