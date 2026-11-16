"""Live absence periods shared by reports and daily-report requirements. Never writes data."""

from datetime import datetime, time, timedelta

from plane.db.models import User, UserAbsence
from .access_control import can_manage_absence, has_permission
from .work_calendar import calendar_zone
from .work_calendar_actions import fa_date

STATUS_TITLES = {"scheduled": "ثبت‌شده", "pending": "در انتظار تأیید", "ended": "پایان‌یافته", "cancelled": "لغوشده"}


def visible_absences(viewer, workspace, user_ids, request=None):
    """The same permission and organization boundary as the absence list endpoint."""
    rows = UserAbsence.objects.filter(workspace=workspace, user_id__in=list(user_ids))
    if not has_permission(viewer, workspace, "Absence.View", request=request):
        return rows.none()
    if has_permission(viewer, workspace, "Absence.ManageAll", request=request):
        return rows
    allowed = [
        user.id
        for user in User.objects.filter(id__in=list(user_ids))
        if user.id == viewer.id or can_manage_absence(viewer, user, workspace, "Absence.View", request=request)
    ]
    return rows.filter(user_id__in=allowed)


def effective_period(row):
    if row.status not in (UserAbsence.Status.SCHEDULED, UserAbsence.Status.ENDED):
        return None
    end = min(row.ends_at, row.updated_at) if row.status == UserAbsence.Status.ENDED else row.ends_at
    return (row.starts_at, end) if row.starts_at < end else None


def standalone_periods(workspace, user_ids, date_from, date_to):
    """Recorded absences without a leave request; linked absences are read through their request."""
    zone = calendar_zone(workspace)
    start = datetime.combine(date_from, time.min, tzinfo=zone)
    end = datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=zone)
    result = {}
    for row in UserAbsence.objects.filter(
        workspace=workspace,
        user_id__in=list(user_ids),
        leave_request__isnull=True,
        status__in=(UserAbsence.Status.SCHEDULED, UserAbsence.Status.ENDED),
        starts_at__lt=end,
        ends_at__gt=start,
    ).order_by("starts_at", "id"):
        period = effective_period(row)
        if period and period[0] < end and period[1] > start:
            result.setdefault(row.user_id, []).append((row, period))
    return result


def day_periods(periods, day, zone):
    start = datetime.combine(day, time.min, tzinfo=zone)
    end = start + timedelta(days=1)
    return [(row, period) for row, period in periods if period[0] < end and period[1] > start]


def period_text(start, end, zone):
    start, end = start.astimezone(zone), end.astimezone(zone)
    digits = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")
    return (f"از {fa_date(start.date())} ساعت {start:%H:%M} تا {fa_date(end.date())} ساعت {end:%H:%M}").translate(
        digits
    )
