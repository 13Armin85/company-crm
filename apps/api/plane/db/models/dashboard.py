"""Server-owned dashboard layouts and team monitoring preferences."""

from django.conf import settings
from django.db import models

from .base import BaseModel


class DashboardConfiguration(BaseModel):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.CASCADE)
    role = models.ForeignKey("db.OrganizationRole", null=True, blank=True, on_delete=models.CASCADE)
    tabs = models.JSONField(default=list)
    revision = models.PositiveIntegerField(default=1)
    inherited_revision = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "crm_dashboard_configurations"
        constraints = [
            models.UniqueConstraint(fields=["workspace", "user"], condition=models.Q(user__isnull=False), name="crm_dashboard_one_user"),
            models.UniqueConstraint(fields=["workspace", "role"], condition=models.Q(role__isnull=False), name="crm_dashboard_one_role"),
            models.CheckConstraint(condition=(models.Q(user__isnull=False, role__isnull=True) | models.Q(user__isnull=True, role__isnull=False)), name="crm_dashboard_one_owner"),
        ]


class DashboardTeamSettings(BaseModel):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    rules = models.JSONField(default=list)
    alert_enabled = models.BooleanField(default=True)
    alert_minutes = models.PositiveIntegerField(default=30)
    workday_start = models.TimeField(default="08:00")
    workday_end = models.TimeField(default="16:00")
    capacity = models.PositiveIntegerField(default=8)
    last_alerted = models.JSONField(default=dict)

    class Meta:
        db_table = "crm_dashboard_team_settings"
        constraints = [models.UniqueConstraint(fields=["workspace", "user"], name="crm_dashboard_team_owner")]
