"""Confirmed customer support and telephone intervals, independent of attendance."""

from django.conf import settings
from django.db import models
from django.db.models import Q

from .base import BaseModel


class SupportActivity(BaseModel):
    class Kind(models.TextChoices):
        SUPPORT = "support", "پشتیبانی/رسیدگی"
        PHONE = "phone", "تماس تلفنی"

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="support_activities")
    customer = models.ForeignKey("db.EntityRecord", on_delete=models.PROTECT, related_name="support_activities")
    issue = models.ForeignKey("db.Issue", null=True, blank=True, on_delete=models.PROTECT, related_name="support_activities")
    supporter = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="support_activities")
    kind = models.CharField(max_length=12, choices=Kind.choices)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    duration_minutes = models.PositiveIntegerField()
    summary = models.TextField(blank=True)
    confirmed_at = models.DateTimeField()
    revision = models.PositiveIntegerField(default=1)

    class Meta:
        db_table = "crm_support_activities"
        ordering = ("-starts_at", "-created_at")
        indexes = [models.Index(fields=["workspace", "supporter", "starts_at"], name="crm_support_person_time_idx")]
        constraints = [
            models.CheckConstraint(condition=Q(ends_at__gt=models.F("starts_at")), name="crm_support_activity_period")
        ]
