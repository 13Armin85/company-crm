"""Configuration and extra values for forms backed by existing CRM endpoints."""

from django.db import models
from .base import BaseModel


class SurfaceConfiguration(BaseModel):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE)
    code = models.SlugField(max_length=80)
    definition = models.JSONField(default=dict)
    revision = models.PositiveIntegerField(default=1)

    class Meta:
        db_table = "crm_surface_configurations"
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "code"], name="crm_surface_scope_unique"
            )
        ]


class SurfaceValues(BaseModel):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE)
    code = models.SlugField(max_length=80)
    object_id = models.UUIDField()
    values = models.JSONField(default=dict)

    class Meta:
        db_table = "crm_surface_values"
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "code", "object_id"],
                name="crm_surface_values_unique",
            )
        ]
