"""Daily work reports and saved reports (ticket 8).

Deliberately minimal (decision 8.1/8.10, see docs/TICKET-8-DELIVERY.fa.md):

- ``DailyReport`` is one person's report of one local working day; ``DailyReportItem``
  holds its lines. Leave, schedule, meetings/missions and self-reported presence are
  *never* copied here: they are read live from their own tables whenever a report is
  opened, so a cancelled or moved leave shows up without any synchronization.
- ``effort_minutes`` is an optional effort estimate. It is not working time and is never
  summed into attendance, lateness or overtime (which do not exist in this project).
- ``SavedReport`` keeps a report definition (source, columns, filters, range, sort,
  grouping, aggregates). Saving or sharing never grants data: every run recomputes the
  viewer's own scope (``app.services.report_scope``).

History is append-only on ``crm_entity_events`` (``daily_report.*`` / ``saved_report.*``).
"""

from django.conf import settings
from django.db import models
from django.db.models import Q

from .base import BaseModel


class DailyReport(BaseModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "پیش‌نویس"
        SUBMITTED = "submitted", "ثبت‌شده"

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="daily_reports")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="daily_reports")
    # Local date in the workspace calendar zone (work_calendar.calendar_zone).
    work_date = models.DateField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    submitted_at = models.DateTimeField(null=True, blank=True)
    first_submitted_at = models.DateTimeField(null=True, blank=True)
    # Computed once, at the first submission, against the configured deadline of that day.
    is_late = models.BooleanField(default=False)
    # Optimistic concurrency (same contract as LeaveRequest.revision).
    revision = models.PositiveIntegerField(default=1)

    class Meta:
        db_table = "crm_daily_reports"
        ordering = ("-work_date",)
        indexes = [models.Index(fields=["workspace", "work_date", "status"], name="crm_daily_report_day_idx")]
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "user", "work_date"],
                condition=Q(deleted_at__isnull=True),
                name="crm_daily_report_person_day",
            )
        ]


class DailyReportItem(BaseModel):
    class Kind(models.TextChoices):
        DONE = "done", "انجام‌شده"
        IN_PROGRESS = "in_progress", "در حال انجام"
        BLOCKER = "blocker", "مانع یا نیاز به کمک"
        NEXT_STEP = "next_step", "گام بعدی"

    report = models.ForeignKey(DailyReport, on_delete=models.CASCADE, related_name="items")
    kind = models.CharField(max_length=12, choices=Kind.choices)
    text = models.TextField()
    # A blocker can explicitly ask for help (shown separately to the manager).
    needs_help = models.BooleanField(default=False)
    issue = models.ForeignKey("db.Issue", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    project = models.ForeignKey("db.Project", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    # Effort estimate only (not working hours).
    effort_minutes = models.PositiveIntegerField(null=True, blank=True)
    # Accepted draft suggestion: where the line came from (decision 8.6).
    source_kind = models.CharField(max_length=24, blank=True, default="")
    source_id = models.CharField(max_length=64, blank=True, default="")
    position = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "crm_daily_report_items"
        ordering = ("kind", "position")


class SavedReport(BaseModel):
    class Visibility(models.TextChoices):
        PERSONAL = "personal", "شخصی"
        SHARED = "shared", "اشتراکی"

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="saved_reports")
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="saved_reports")
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    source = models.CharField(max_length=40)
    definition = models.JSONField(default=dict)
    # Source schema version the definition was validated against (report_sources.Source.version).
    schema_version = models.PositiveIntegerField(default=1)
    visibility = models.CharField(max_length=10, choices=Visibility.choices, default=Visibility.PERSONAL)
    shared_roles = models.JSONField(default=list)
    shared_units = models.JSONField(default=list)
    revision = models.PositiveIntegerField(default=1)

    class Meta:
        db_table = "crm_saved_reports"
        ordering = ("name", "id")
        indexes = [models.Index(fields=["workspace", "owner"], name="crm_saved_report_owner_idx")]
