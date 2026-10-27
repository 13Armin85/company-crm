"""Compatibility API for standalone work; all rows live in the Issue model."""

from django.db import models, transaction
from plane.db.mixins import SoftDeletionManager
from .issue import Issue, IssueAssignee


class StandaloneWorkManager(SoftDeletionManager):
    def get_queryset(self):
        return super().get_queryset().filter(project__isnull=True)


class AllStandaloneWorkManager(models.Manager):
    def get_queryset(self):
        return super().get_queryset().filter(project__isnull=True)


class WorkspaceTask(Issue):
    """An import/URL alias retained for old clients, without a second table."""

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

    objects = StandaloneWorkManager()
    all_objects = AllStandaloneWorkManager()

    class Meta:
        proxy = True
        ordering = ("-created_at",)

    def save(self, *args, **kwargs):
        if self.project_id is not None:
            raise ValueError("The legacy standalone API cannot change project work.")
        with transaction.atomic():
            super().save(*args, **kwargs)
            IssueAssignee.objects.filter(issue_id=self.id).exclude(
                assignee_id=self.assignee_id
            ).delete()
            if self.assignee_id:
                IssueAssignee.objects.get_or_create(
                    issue_id=self.id,
                    assignee_id=self.assignee_id,
                    defaults={"workspace_id": self.workspace_id, "project_id": None},
                )
