# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.conf import settings
from django.db import models
from django.utils import timezone

from .base import BaseModel


class WorkspaceTask(BaseModel):
    """A task that belongs to a workspace but is not tied to a project."""

    class Status(models.TextChoices):
        TODO = "todo", "Todo"
        IN_PROGRESS = "in_progress", "In Progress"
        REVIEW = "review", "Review"
        DONE = "done", "Done"
        BLOCKED = "blocked", "Blocked"

    class Priority(models.TextChoices):
        URGENT = "urgent", "Urgent"
        HIGH = "high", "High"
        MEDIUM = "medium", "Medium"
        LOW = "low", "Low"
        NONE = "none", "None"

    workspace = models.ForeignKey(
        "db.Workspace",
        on_delete=models.CASCADE,
        related_name="workspace_tasks",
    )
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="assigned_workspace_tasks",
    )
    name = models.CharField(max_length=255)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.TODO)
    priority = models.CharField(max_length=20, choices=Priority.choices, default=Priority.NONE)
    sequence_id = models.PositiveIntegerField()
    target_date = models.DateField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "workspace_tasks"
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "sequence_id"],
                name="workspace_task_unique_sequence",
            )
        ]

    def save(self, *args, **kwargs):
        if self.status == self.Status.DONE and self.completed_at is None:
            self.completed_at = timezone.now()
        elif self.status != self.Status.DONE:
            self.completed_at = None
        super().save(*args, **kwargs)

