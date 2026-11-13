"""Leave requests (ticket 6): request versions, Word templates and signature images.

A leave request is the first real record of the workflow engine (ticket 4): it
never carries its own approval logic. The working-time duration comes from the
existing work calendar; an approved request creates one ``UserAbsence``.

Files (templates, attachments, generated documents and signature images) are
regular ``FileAsset`` rows with a private ``entity_type``; they are served only
through permission-checked endpoints and are excluded from Plane's public asset
endpoints. There is deliberately no leave category/type anywhere in this module.
"""

from django.conf import settings
from django.db import models
from django.db.models import Q

from .base import BaseModel

# Private FileAsset.entity_type markers of this module.
LEAVE_ATTACHMENT = "CRM_LEAVE_ATTACHMENT"
LEAVE_DOCUMENT = "CRM_LEAVE_DOCUMENT"
LEAVE_TEMPLATE = "CRM_LEAVE_TEMPLATE"
SIGNATURE_IMAGE = "CRM_SIGNATURE"


class LeaveTemplateVersion(BaseModel):
    """One uploaded ``.docx`` template. Every upload is a new version; versions are never deleted."""

    class Status(models.TextChoices):
        INACTIVE = "inactive", "غیرفعال"
        ACTIVE = "active", "فعال"
        DEPRECATED = "deprecated", "منسوخ"

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="leave_templates")
    number = models.PositiveIntegerField()
    title = models.CharField(max_length=255)
    file = models.ForeignKey("db.FileAsset", on_delete=models.PROTECT, related_name="+")
    original_name = models.CharField(max_length=255)
    sha256 = models.CharField(max_length=64)
    size = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.INACTIVE)
    expires_at = models.DateField(null=True, blank=True)
    placeholders = models.JSONField(default=list)
    # Validation report at upload time: [{"code", "level", "message"}]. Errors block activation.
    issues = models.JSONField(default=list)
    note = models.TextField(blank=True)
    activated_at = models.DateTimeField(null=True, blank=True)
    activated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    deprecated_at = models.DateTimeField(null=True, blank=True)
    deprecated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        db_table = "crm_leave_template_versions"
        ordering = ("-number",)
        constraints = [
            models.UniqueConstraint(fields=["workspace", "number"], name="crm_leave_template_number"),
            models.UniqueConstraint(
                fields=["workspace"],
                condition=Q(status="active", deleted_at__isnull=True),
                name="crm_leave_template_one_active",
            ),
        ]


class SignatureImage(BaseModel):
    """A user's signature image (a picture, not a cryptographic signature).

    Consent belongs to one image: a replacement starts without consent, and a
    revoked consent stops new use without touching already signed documents.
    """

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="signature_images")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="signature_images")
    file = models.ForeignKey("db.FileAsset", on_delete=models.PROTECT, related_name="+")
    content_type = models.CharField(max_length=40)
    sha256 = models.CharField(max_length=64)
    size = models.PositiveIntegerField(default=0)
    is_current = models.BooleanField(default=True)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    replaced_at = models.DateTimeField(null=True, blank=True)
    consent_at = models.DateTimeField(null=True, blank=True)
    consent_revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "crm_signature_images"
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "user"],
                condition=Q(is_current=True, deleted_at__isnull=True),
                name="crm_signature_one_current",
            )
        ]

    @property
    def has_consent(self):
        return bool(self.consent_at and not self.consent_revoked_at)


class LeaveRequest(BaseModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "پیش‌نویس"
        PENDING = "pending", "در انتظار تأیید"
        RETURNED = "returned", "بازگشت برای اصلاح"
        APPROVED = "approved", "تأییدشده"
        REJECTED = "rejected", "ردشده"
        CANCELLED = "cancelled", "لغوشده"

    # A request in one of these statuses blocks an overlapping request of the same person.
    ACTIVE_STATUSES = ("draft", "pending", "returned", "approved")

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="leave_requests")
    requester = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="leave_requests")
    number = models.CharField(max_length=40)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    revision = models.PositiveIntegerField(default=1)
    absence = models.OneToOneField(
        "db.UserAbsence", null=True, blank=True, on_delete=models.SET_NULL, related_name="leave_request"
    )
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    cancel_reason = models.TextField(blank=True)

    class Meta:
        db_table = "crm_leave_requests"
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["workspace", "requester", "status"], name="crm_leave_request_user_idx")]
        constraints = [models.UniqueConstraint(fields=["workspace", "number"], name="crm_leave_request_number")]


class LeaveRequestVersion(BaseModel):
    """The request data. A signed version is locked forever; a correction is a new version."""

    class Mode(models.TextChoices):
        DAILY = "daily", "روزانه"
        HOURLY = "hourly", "ساعتی"

    request = models.ForeignKey(LeaveRequest, on_delete=models.CASCADE, related_name="versions")
    number = models.PositiveIntegerField()
    mode = models.CharField(max_length=6, choices=Mode.choices)
    # Daily: inclusive local dates. Hourly: one local date with times. starts_at/ends_at are
    # always the resolved aware period (daily: local midnight to the midnight after end_date).
    start_date = models.DateField()
    end_date = models.DateField()
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    reason = models.TextField(blank=True)
    substitute = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    attachment_ids = models.JSONField(default=list)
    duration_days = models.PositiveIntegerField(null=True, blank=True)
    duration_minutes = models.PositiveIntegerField(null=True, blank=True)
    is_locked = models.BooleanField(default=False)
    locked_at = models.DateTimeField(null=True, blank=True)
    signed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    signed_at = models.DateTimeField(null=True, blank=True)
    signature = models.ForeignKey(
        SignatureImage, null=True, blank=True, on_delete=models.PROTECT, related_name="used_in"
    )
    template_version = models.ForeignKey(
        LeaveTemplateVersion, null=True, blank=True, on_delete=models.PROTECT, related_name="used_in"
    )
    document = models.ForeignKey("db.FileAsset", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    document_sha256 = models.CharField(max_length=64, blank=True)
    # The exact values written into the signed document (frozen with the version).
    document_values = models.JSONField(default=dict)

    class Meta:
        db_table = "crm_leave_request_versions"
        ordering = ("-number",)
        constraints = [
            models.UniqueConstraint(fields=["request", "number"], name="crm_leave_version_number"),
            models.CheckConstraint(condition=Q(ends_at__gt=models.F("starts_at")), name="crm_leave_version_period"),
            models.CheckConstraint(condition=Q(end_date__gte=models.F("start_date")), name="crm_leave_version_dates"),
        ]
