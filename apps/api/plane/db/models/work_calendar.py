"""Work schedules, work events and self-reported presence.

None of these models represent attendance: they never create absences, lateness,
overtime or leave-balance changes. ``plane.app.services.work_calendar`` is the
only reader that turns them into "working time at a given moment".
"""

from django.conf import settings
from django.db import models
from django.db.models import Q

from .base import BaseModel


class WorkMode(models.TextChoices):
    NONE = "", "نامشخص"
    ONSITE = "onsite", "حضوری"
    REMOTE = "remote", "دورکاری"
    HYBRID = "hybrid", "ترکیبی"


class WorkSchedule(BaseModel):
    """One immutable, dated version of a weekly schedule.

    A new version closes the previous one by setting ``effective_to``; no other
    field of an existing version is ever changed or deleted.
    """

    class Scope(models.TextChoices):
        COMPANY = "company", "شرکت"
        UNIT = "unit", "واحد"
        PERSON = "person", "فرد"

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="work_schedules")
    scope = models.CharField(max_length=10, choices=Scope.choices)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.CASCADE, related_name="work_schedules"
    )
    unit = models.ForeignKey(
        "db.OrganizationUnit", null=True, blank=True, on_delete=models.CASCADE, related_name="work_schedules"
    )
    effective_from = models.DateField()
    # Inclusive last day; null means open-ended.
    effective_to = models.DateField(null=True, blank=True)
    reason = models.TextField()
    closed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        db_table = "crm_work_schedules"
        ordering = ("-effective_from",)
        indexes = [models.Index(fields=["workspace", "scope", "user", "effective_from"], name="crm_work_schedule_idx")]
        constraints = [
            models.CheckConstraint(
                condition=Q(effective_to__isnull=True) | Q(effective_to__gte=models.F("effective_from")),
                name="crm_work_schedule_valid_period",
            ),
            models.CheckConstraint(
                condition=(
                    Q(scope="company", user__isnull=True, unit__isnull=True)
                    | Q(scope="unit", user__isnull=True, unit__isnull=False)
                    | Q(scope="person", user__isnull=False, unit__isnull=True)
                ),
                name="crm_work_schedule_owner",
            ),
            # One version per owner and start date (NULL owners need per-scope constraints).
            models.UniqueConstraint(
                fields=["workspace", "user", "effective_from"],
                condition=Q(scope="person", deleted_at__isnull=True),
                name="crm_work_schedule_person_start",
            ),
            models.UniqueConstraint(
                fields=["workspace", "unit", "effective_from"],
                condition=Q(scope="unit", deleted_at__isnull=True),
                name="crm_work_schedule_unit_start",
            ),
            models.UniqueConstraint(
                fields=["workspace", "effective_from"],
                condition=Q(scope="company", deleted_at__isnull=True),
                name="crm_work_schedule_company_start",
            ),
        ]


class WorkScheduleDay(BaseModel):
    schedule = models.ForeignKey(WorkSchedule, on_delete=models.CASCADE, related_name="days")
    # Python weekday: Monday=0 … Sunday=6.
    weekday = models.PositiveSmallIntegerField()
    is_working = models.BooleanField(default=True)
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)
    # [{"start": "12:00", "end": "12:30"}, …]
    breaks = models.JSONField(default=list)
    work_mode = models.CharField(max_length=10, choices=WorkMode.choices, default="", blank=True)

    class Meta:
        db_table = "crm_work_schedule_days"
        ordering = ("weekday",)
        constraints = [
            models.UniqueConstraint(fields=["schedule", "weekday"], name="crm_work_schedule_day_unique"),
            models.CheckConstraint(condition=Q(weekday__lte=6), name="crm_work_schedule_day_weekday"),
        ]


class WorkScheduleException(BaseModel):
    """Dated override for one person, e.g. "next Tuesday 12:00–18:00"."""

    class Status(models.TextChoices):
        ACTIVE = "active", "فعال"
        CANCELLED = "cancelled", "لغوشده"

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="work_schedule_exceptions")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="work_schedule_exceptions"
    )
    date_from = models.DateField()
    date_to = models.DateField()
    is_working = models.BooleanField(default=True)
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)
    breaks = models.JSONField(default=list)
    work_mode = models.CharField(max_length=10, choices=WorkMode.choices, default="", blank=True)
    reason = models.TextField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    cancel_reason = models.TextField(blank=True)

    class Meta:
        db_table = "crm_work_schedule_exceptions"
        ordering = ("-date_from",)
        indexes = [models.Index(fields=["workspace", "user", "status"], name="crm_work_exception_idx")]
        constraints = [
            models.CheckConstraint(condition=Q(date_to__gte=models.F("date_from")), name="crm_work_exception_period")
        ]


class WorkEvent(BaseModel):
    """Meeting, mission or work event. Planned never means done."""

    class Kind(models.TextChoices):
        MEETING = "meeting", "جلسه"
        MISSION = "mission", "مأموریت"
        EVENT = "event", "رویداد کاری"

    class Status(models.TextChoices):
        PLANNED = "planned", "برنامه‌ریزی‌شده"
        CANCELLED = "cancelled", "لغوشده"

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="work_events")
    kind = models.CharField(max_length=10, choices=Kind.choices)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    private_note = models.TextField(blank=True)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    all_day = models.BooleanField(default=False)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PLANNED)
    cancel_reason = models.TextField(blank=True)
    participants = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        through="WorkEventParticipant",
        through_fields=("event", "user"),
        related_name="work_events",
        blank=True,
    )

    class Meta:
        db_table = "crm_work_events"
        ordering = ("starts_at",)
        indexes = [models.Index(fields=["workspace", "starts_at", "ends_at"], name="crm_work_event_period_idx")]
        constraints = [
            models.CheckConstraint(condition=Q(ends_at__gt=models.F("starts_at")), name="crm_work_event_period")
        ]


class WorkEventParticipant(BaseModel):
    event = models.ForeignKey(WorkEvent, on_delete=models.CASCADE, related_name="participant_rows")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="work_event_rows")

    class Meta:
        db_table = "crm_work_event_participants"
        constraints = [models.UniqueConstraint(fields=["event", "user"], name="crm_work_event_participant_unique")]


class PresenceDeclaration(BaseModel):
    """Self-reported "I am at work today" on a non-working day. Proves nothing."""

    class Status(models.TextChoices):
        ACTIVE = "active", "فعال"
        CANCELLED = "cancelled", "لغوشده"

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="presence_declarations")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="presence_declarations")
    date = models.DateField()
    declared_at = models.DateTimeField()
    time_zone = models.CharField(max_length=64)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancel_reason = models.TextField(blank=True)

    class Meta:
        db_table = "crm_presence_declarations"
        ordering = ("-date",)
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "user", "date"],
                condition=Q(status="active", deleted_at__isnull=True),
                name="crm_presence_one_active_per_day",
            )
        ]


class ActivityConfirmation(BaseModel):
    """The person's own statement that a past event/declared day was done or not."""

    class Source(models.TextChoices):
        EVENT = "event", "رویداد"
        PRESENCE = "presence", "اعلام حضور"

    class Outcome(models.TextChoices):
        DONE = "done", "انجام شد"
        NOT_DONE = "not_done", "انجام نشد"

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="activity_confirmations")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="activity_confirmations")
    source_type = models.CharField(max_length=10, choices=Source.choices)
    source_id = models.UUIDField()
    outcome = models.CharField(max_length=10, choices=Outcome.choices)
    summary = models.TextField(blank=True)
    confirmed_at = models.DateTimeField()

    class Meta:
        db_table = "crm_activity_confirmations"
        ordering = ("-confirmed_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["user", "source_type", "source_id"],
                condition=Q(deleted_at__isnull=True),
                name="crm_activity_confirmation_unique",
            )
        ]
