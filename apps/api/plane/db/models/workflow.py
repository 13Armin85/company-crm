"""Configurable workflow engine: definitions, immutable versions and running instances.

The step/transition graph of a version is a validated JSON snapshot
(``WorkflowVersion.graph``). A published version is never edited; a running
instance stays on the version it started with until an explicit, audited
migration. Statuses are never stored here: each step points at an existing
status of the record (``task-status`` lookup for tickets, ``UserAbsence.Status``
for leave) and the record keeps owning its status.
"""

from django.conf import settings
from django.db import models
from django.db.models import Q

from .base import BaseModel


class WorkflowDefinition(BaseModel):
    class Kind(models.TextChoices):
        STANDARD = "standard", "مسیر عادی"
        FAST_PATH = "fast_path", "مسیر کوتاه"

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="workflow_definitions")
    entity = models.ForeignKey("db.EntityType", on_delete=models.PROTECT, related_name="workflow_definitions")
    subtype = models.ForeignKey(
        "db.EntityType", null=True, blank=True, on_delete=models.PROTECT, related_name="subtype_workflow_definitions"
    )
    title = models.CharField(max_length=255)
    kind = models.CharField(max_length=12, choices=Kind.choices, default=Kind.STANDARD)
    is_active = models.BooleanField(default=True)
    # {"require_manager_close": bool, "instance_target_minutes": int|null, "status_field": code}
    settings = models.JSONField(default=dict)

    class Meta:
        db_table = "crm_workflow_definitions"
        ordering = ("title", "created_at")
        constraints = [
            # One definition of each kind per entity (without subtype) and per subtype.
            models.UniqueConstraint(
                fields=["entity", "kind"],
                condition=Q(subtype__isnull=True, deleted_at__isnull=True),
                name="crm_workflow_def_entity_kind",
            ),
            models.UniqueConstraint(
                fields=["entity", "subtype", "kind"],
                condition=Q(subtype__isnull=False, deleted_at__isnull=True),
                name="crm_workflow_def_subtype_kind",
            ),
        ]


class WorkflowVersion(BaseModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "پیش‌نویس"
        PUBLISHED = "published", "منتشرشده"
        RETIRED = "retired", "بازنشسته"

    definition = models.ForeignKey(WorkflowDefinition, on_delete=models.PROTECT, related_name="versions")
    number = models.PositiveIntegerField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    graph = models.JSONField(default=dict)
    change_note = models.TextField(blank=True)
    published_at = models.DateTimeField(null=True, blank=True)
    published_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        db_table = "crm_workflow_versions"
        ordering = ("-number",)
        constraints = [
            models.UniqueConstraint(fields=["definition", "number"], name="crm_workflow_version_number"),
            models.UniqueConstraint(
                fields=["definition"],
                condition=Q(status="published", deleted_at__isnull=True),
                name="crm_workflow_one_published",
            ),
            models.UniqueConstraint(
                fields=["definition"],
                condition=Q(status="draft", deleted_at__isnull=True),
                name="crm_workflow_one_draft",
            ),
        ]


class WorkflowInstance(BaseModel):
    class Status(models.TextChoices):
        RUNNING = "running", "در جریان"
        COMPLETED = "completed", "پایان‌یافته"
        CANCELLED = "cancelled", "لغوشده"
        ERROR = "error", "خطا"

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="workflow_instances")
    entity = models.ForeignKey("db.EntityType", on_delete=models.PROTECT, related_name="workflow_instances")
    # Public record id: the native row id for adapters, the EntityRecord id otherwise
    # (the same id EntityEvent.record_id uses), so tickets without a sidecar work too.
    record_id = models.UUIDField()
    definition = models.ForeignKey(WorkflowDefinition, on_delete=models.PROTECT, related_name="instances")
    version = models.ForeignKey(WorkflowVersion, on_delete=models.PROTECT, related_name="instances")
    current_step = models.CharField(max_length=80)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.RUNNING)
    revision = models.PositiveIntegerField(default=1)
    error_message = models.TextField(blank=True)
    auto_steps_in_row = models.PositiveIntegerField(default=0)
    subject = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    target_minutes = models.PositiveIntegerField(null=True, blank=True)
    target_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "crm_workflow_instances"
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["workspace", "status"], name="crm_workflow_inst_status")]
        constraints = [
            models.UniqueConstraint(
                fields=["entity", "record_id"],
                condition=Q(status__in=["running", "error"], deleted_at__isnull=True),
                name="crm_workflow_one_active_instance",
            )
        ]


class WorkflowStepRun(BaseModel):
    class Status(models.TextChoices):
        ACTIVE = "active", "جاری"
        COMPLETED = "completed", "پایان‌یافته"

    instance = models.ForeignKey(WorkflowInstance, on_delete=models.CASCADE, related_name="step_runs")
    version = models.ForeignKey(WorkflowVersion, on_delete=models.PROTECT, related_name="step_runs")
    step_code = models.CharField(max_length=80)
    step_title = models.CharField(max_length=255)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="workflow_steps"
    )
    candidate_ids = models.JSONField(default=list)
    assignment_reason = models.TextField(blank=True)
    entered_at = models.DateTimeField()
    target_minutes = models.PositiveIntegerField(null=True, blank=True)
    target_at = models.DateTimeField(null=True, blank=True)
    paused_at = models.DateTimeField(null=True, blank=True)
    pause_kind = models.CharField(max_length=12, blank=True)
    reminded_at = models.DateTimeField(null=True, blank=True)
    entry_values = models.JSONField(default=dict)
    completed_at = models.DateTimeField(null=True, blank=True)
    decision = models.CharField(max_length=12, blank=True)

    class Meta:
        db_table = "crm_workflow_step_runs"
        ordering = ("entered_at", "created_at")
        constraints = [
            models.UniqueConstraint(
                fields=["instance"],
                condition=Q(status="active", deleted_at__isnull=True),
                name="crm_workflow_one_active_step",
            )
        ]


class WorkflowDecision(BaseModel):
    """One recorded decision or engine action; never edited."""

    instance = models.ForeignKey(WorkflowInstance, on_delete=models.CASCADE, related_name="decisions")
    step_run = models.ForeignKey(
        WorkflowStepRun, null=True, blank=True, on_delete=models.CASCADE, related_name="decisions"
    )
    kind = models.CharField(max_length=32)
    transition_code = models.CharField(max_length=80, blank=True)
    from_step = models.CharField(max_length=80, blank=True)
    to_step = models.CharField(max_length=80, blank=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    version_number = models.PositiveIntegerField()
    reason = models.TextField(blank=True)
    changed_values = models.JSONField(default=dict)
    data = models.JSONField(default=dict)

    class Meta:
        db_table = "crm_workflow_decisions"
        ordering = ("created_at", "id")


class WorkflowPause(BaseModel):
    class Kind(models.TextChoices):
        CUSTOMER = "customer", "در انتظار پاسخ مشتری"
        FORMAL = "formal", "توقف رسمی"

    step_run = models.ForeignKey(WorkflowStepRun, on_delete=models.CASCADE, related_name="pauses")
    kind = models.CharField(max_length=10, choices=Kind.choices)
    paused_at = models.DateTimeField()
    paused_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    reason = models.TextField()
    resumed_at = models.DateTimeField(null=True, blank=True)
    resumed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    resume_reason = models.TextField(blank=True)
    remaining_minutes = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        db_table = "crm_workflow_pauses"
        ordering = ("paused_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["step_run"],
                condition=Q(resumed_at__isnull=True, deleted_at__isnull=True),
                name="crm_workflow_one_open_pause",
            )
        ]


class WorkflowDelayReport(BaseModel):
    """Overdue report by the assignee. Append-only: a correction is a new report."""

    step_run = models.ForeignKey(
        WorkflowStepRun, null=True, blank=True, on_delete=models.CASCADE, related_name="delay_reports"
    )
    # Ticket-level report (ticket 5): the ticket's own deadline, without a workflow step.
    issue = models.ForeignKey(
        "db.Issue", null=True, blank=True, on_delete=models.CASCADE, related_name="delay_reports"
    )
    reporter = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    reason = models.TextField()
    progress = models.TextField()
    expected_at = models.DateTimeField()
    # The deadline this report explains; a later deadline (extension) needs a new report.
    target_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "crm_workflow_delay_reports"
        ordering = ("created_at",)


class WorkflowExtension(BaseModel):
    class Status(models.TextChoices):
        PENDING = "pending", "در انتظار تأیید"
        APPROVED = "approved", "تأییدشده"
        REJECTED = "rejected", "ردشده"

    class Scope(models.TextChoices):
        STEP = "step", "مرحله"
        INSTANCE = "instance", "کل فرایند"
        TICKET = "ticket", "موعد تیکت"

    step_run = models.ForeignKey(
        WorkflowStepRun, null=True, blank=True, on_delete=models.CASCADE, related_name="extensions"
    )
    # Ticket-level extension (ticket 5); the deadline lives on Issue.target_at.
    issue = models.ForeignKey(
        "db.Issue", null=True, blank=True, on_delete=models.CASCADE, related_name="deadline_extensions"
    )
    minutes = models.PositiveIntegerField(null=True, blank=True)
    approver = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    scope = models.CharField(max_length=10, choices=Scope.choices, default=Scope.STEP)
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    previous_target_at = models.DateTimeField(null=True, blank=True)
    requested_target_at = models.DateTimeField()
    reason = models.TextField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_reason = models.TextField(blank=True)

    class Meta:
        db_table = "crm_workflow_extensions"
        ordering = ("created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["step_run"],
                condition=Q(status="pending", deleted_at__isnull=True),
                name="crm_workflow_one_open_extension",
            ),
            models.UniqueConstraint(
                fields=["issue"],
                condition=Q(status="pending", deleted_at__isnull=True, issue__isnull=False),
                name="crm_ticket_one_open_extension",
            ),
        ]
