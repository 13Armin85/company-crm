"""Single source of truth for "a person's working time at a given moment".

Every reader that needs a schedule, availability or working-time arithmetic must
go through this module. It is read-only: it never creates absences, lateness,
overtime, leave-balance changes or notifications.

Precedence for one date: dated person exception > person weekly version >
unit (nearest unit, then ancestors) > company version > built-in default.
All wall-clock times are interpreted in ``calendar_zone(workspace)``.
"""

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.db.models import Q
from django.utils import timezone

from plane.db.models import (
    OrganizationUnit,
    OrganizationUnitMember,
    UserAbsence,
    WorkEvent,
    WorkSchedule,
    WorkScheduleException,
)

DEFAULT_ZONE = "Asia/Tehran"
FRIDAY = 4
# Built-in company default when a workspace has not defined one: Saturday to
# Thursday 08:00–16:00 (the owner-approved team workday), Friday off.
BUILTIN_DAY = {"start": time(8), "end": time(16)}
MAX_SEARCH_DAYS = 400


def calendar_zone(workspace):
    name = getattr(workspace, "timezone", "") or ""
    if name and name != "UTC":
        try:
            return ZoneInfo(name)
        except (ValueError, ZoneInfoNotFoundError):
            pass
    return ZoneInfo(DEFAULT_ZONE)


def local_today(workspace, now=None):
    return (now or timezone.now()).astimezone(calendar_zone(workspace)).date()


@dataclass
class DaySchedule:
    date: date
    working: bool
    start: time | None = None
    end: time | None = None
    breaks: list = field(default_factory=list)
    work_mode: str = ""
    source: str = "company"
    source_id: str | None = None
    reason: str = ""
    builtin: bool = False

    def intervals(self, zone):
        """Aware working intervals for this day with breaks removed."""
        if not self.working or not self.start or not self.end:
            return []
        result, cursor = [], datetime.combine(self.date, self.start, tzinfo=zone)
        for item in sorted(self.breaks, key=lambda row: row[0]):
            break_start = datetime.combine(self.date, item[0], tzinfo=zone)
            if break_start > cursor:
                result.append((cursor, break_start))
            cursor = max(cursor, datetime.combine(self.date, item[1], tzinfo=zone))
        end = datetime.combine(self.date, self.end, tzinfo=zone)
        if end > cursor:
            result.append((cursor, end))
        return result

    def as_dict(self, zone, *, private=True):
        data = {
            "date": self.date.isoformat(),
            "is_working": self.working,
            "start": self.start.strftime("%H:%M") if self.working and self.start else None,
            "end": self.end.strftime("%H:%M") if self.working and self.end else None,
            "breaks": [{"start": a.strftime("%H:%M"), "end": b.strftime("%H:%M")} for a, b in self.breaks]
            if self.working
            else [],
            "work_mode": self.work_mode,
            "source": self.source,
            "intervals": [{"start": a.isoformat(), "end": b.isoformat()} for a, b in self.intervals(zone)],
        }
        if private:
            data.update({"source_id": self.source_id, "reason": self.reason, "builtin": self.builtin})
        return data


def _times(rows):
    return [(time.fromisoformat(row["start"]), time.fromisoformat(row["end"])) for row in rows or []]


def _from_row(day, row, source, source_id, reason):
    return DaySchedule(
        date=day,
        working=row.is_working,
        start=row.start_time,
        end=row.end_time,
        breaks=_times(row.breaks),
        work_mode=row.work_mode,
        source=source,
        source_id=str(source_id),
        reason=reason,
    )


def _covers(version, day):
    return version.effective_from <= day and (version.effective_to is None or version.effective_to >= day)


class ScheduleResolver:
    """Loads everything for one person and date range once, then resolves days in memory."""

    def __init__(self, workspace, user, date_from, date_to):
        self.workspace, self.user = workspace, user
        self.zone = calendar_zone(workspace)
        self.exceptions = list(
            WorkScheduleException.objects.filter(
                workspace=workspace,
                user=user,
                status=WorkScheduleException.Status.ACTIVE,
                date_from__lte=date_to,
                date_to__gte=date_from,
            ).order_by("-created_at")
        )
        period = Q(effective_from__lte=date_to) & (Q(effective_to__isnull=True) | Q(effective_to__gte=date_from))
        self.unit_chain = self._unit_chain()
        versions = list(
            WorkSchedule.objects.filter(workspace=workspace)
            .filter(period)
            .filter(Q(scope="person", user=user) | Q(scope="unit", unit_id__in=self.unit_chain) | Q(scope="company"))
            .prefetch_related("days")
        )
        self.person = [row for row in versions if row.scope == "person"]
        self.units = {}
        for row in versions:
            if row.scope == "unit":
                self.units.setdefault(row.unit_id, []).append(row)
        self.company = [row for row in versions if row.scope == "company"]

    def _unit_chain(self):
        units = {
            row["id"]: row
            for row in OrganizationUnit.objects.filter(workspace=self.workspace, is_active=True).values(
                "id", "parent_id", "title"
            )
        }
        direct = sorted(
            OrganizationUnitMember.objects.filter(
                unit__workspace=self.workspace, unit__is_active=True, user=self.user, is_active=True
            ).values_list("unit_id", flat=True),
            key=lambda unit_id: units.get(unit_id, {}).get("title", ""),
        )
        chain, frontier = [], [unit_id for unit_id in direct if unit_id in units]
        # Breadth-first: every direct unit before any ancestor.
        while frontier:
            next_frontier = []
            for unit_id in frontier:
                if unit_id not in chain:
                    chain.append(unit_id)
                    parent = units[unit_id]["parent_id"]
                    if parent in units:
                        next_frontier.append(parent)
            frontier = next_frontier
        return chain

    @staticmethod
    def _version_day(versions, day, source):
        for version in versions:
            if _covers(version, day):
                row = next((item for item in version.days.all() if item.weekday == day.weekday()), None)
                if row is not None:
                    return _from_row(day, row, source, version.id, version.reason)
        return None

    def day(self, day):
        for row in self.exceptions:
            if row.date_from <= day <= row.date_to:
                return _from_row(day, row, "exception", row.id, row.reason)
        found = self._version_day(self.person, day, "person")
        if found:
            return found
        for unit_id in self.unit_chain:
            found = self._version_day(self.units.get(unit_id, []), day, "team")
            if found:
                return found
        found = self._version_day(self.company, day, "company")
        if found:
            return found
        working = day.weekday() != FRIDAY
        return DaySchedule(
            date=day,
            working=working,
            start=BUILTIN_DAY["start"] if working else None,
            end=BUILTIN_DAY["end"] if working else None,
            source="company",
            builtin=True,
        )

    def working_intervals(self, start, end):
        result = []
        day, last = start.astimezone(self.zone).date(), end.astimezone(self.zone).date()
        while day <= last:
            for a, b in self.day(day).intervals(self.zone):
                a, b = max(a, start), min(b, end)
                if b > a:
                    result.append((a, b))
            day += timedelta(days=1)
        return result


def schedule_for(user, day, workspace):
    """Resolved schedule of one person on one local date."""
    return ScheduleResolver(workspace, user, day, day).day(day)


def schedule_range(user, date_from, date_to, workspace):
    resolver = ScheduleResolver(workspace, user, date_from, date_to)
    days, day = [], date_from
    while day <= date_to:
        days.append(resolver.day(day))
        day += timedelta(days=1)
    return days


def working_minutes_between(user, start, end, workspace):
    if end <= start:
        return 0
    resolver = ScheduleResolver(
        workspace,
        user,
        start.astimezone(calendar_zone(workspace)).date(),
        end.astimezone(calendar_zone(workspace)).date(),
    )
    seconds = sum((b - a).total_seconds() for a, b in resolver.working_intervals(start, end))
    return int(seconds // 60)


def add_working_time(user, start, minutes, workspace):
    """The moment ``minutes`` of working time after ``start``; non-working days and breaks are skipped."""
    if minutes < 0:
        raise ValueError("مدت زمان کاری نمی‌تواند منفی باشد.")
    zone = calendar_zone(workspace)
    first = start.astimezone(zone).date()
    resolver = ScheduleResolver(workspace, user, first, first + timedelta(days=MAX_SEARCH_DAYS))
    remaining = timedelta(minutes=minutes)
    if not remaining:
        return start
    for offset in range(MAX_SEARCH_DAYS + 1):
        for a, b in resolver.day(first + timedelta(days=offset)).intervals(zone):
            a = max(a, start)
            if b <= a:
                continue
            if b - a >= remaining:
                return a + remaining
            remaining -= b - a
    raise ValueError("در بازهٔ یک‌ساله زمان کاری کافی برای این محاسبه وجود ندارد.")


def _merge(segments):
    merged = []
    for segment in segments:
        if (
            merged
            and merged[-1]["end"] == segment["start"]
            and merged[-1]["available"] == segment["available"]
            and merged[-1]["reason"] == segment["reason"]
        ):
            merged[-1]["end"] = segment["end"]
        else:
            merged.append(dict(segment))
    return merged


def busy_blocks(workspace, user, start, end):
    events = [
        (max(row.starts_at, start), min(row.ends_at, end), "event")
        for row in WorkEvent.objects.filter(
            workspace=workspace,
            status=WorkEvent.Status.PLANNED,
            participant_rows__user=user,
            participant_rows__deleted_at__isnull=True,
            starts_at__lt=end,
            ends_at__gt=start,
        ).distinct()
    ]
    absences = [
        (max(row.starts_at, start), min(row.ends_at, end), "absence")
        for row in UserAbsence.objects.filter(
            workspace=workspace,
            user=user,
            status=UserAbsence.Status.SCHEDULED,
            starts_at__lt=end,
            ends_at__gt=start,
        )
    ]
    return events + absences


def availability(user, start, end, workspace):
    """Available / unavailable segments with a general reason.

    reason is one of: ``schedule`` (working time), ``off_schedule`` (non-working
    day, break or outside hours), ``event`` (meeting/mission/event) or
    ``absence`` (recorded leave). "event" is not leave and is never counted as
    absence anywhere.
    """
    if end <= start:
        return []
    zone = calendar_zone(workspace)
    resolver = ScheduleResolver(workspace, user, start.astimezone(zone).date(), end.astimezone(zone).date())
    working = resolver.working_intervals(start, end)
    busy = busy_blocks(workspace, user, start, end)
    points = sorted({start, end, *[p for row in working for p in row], *[p for row in busy for p in row[:2]]})
    segments = []
    for a, b in zip(points, points[1:]):
        if b <= a:
            continue
        reasons = {kind for s, e, kind in busy if s <= a and e >= b}
        if "absence" in reasons:
            state = (False, "absence")
        elif "event" in reasons:
            state = (False, "event")
        elif any(s <= a and e >= b for s, e in working):
            state = (True, "schedule")
        else:
            state = (False, "off_schedule")
        segments.append(
            {"start": a.astimezone(zone), "end": b.astimezone(zone), "available": state[0], "reason": state[1]}
        )
    return _merge(segments)


def is_outside_working_hours(user, start, end, workspace):
    """True when any part of [start, end) is outside the person's working time."""
    total = int((end - start).total_seconds() // 60)
    return working_minutes_between(user, start, end, workspace) < total
