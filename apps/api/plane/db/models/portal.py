"""Customer portal identity, sessions and audit log (ticket 7).

Plane has no notion of an external customer identity: every ``User`` row is a
potential workspace member and every internal endpoint trusts the Django session.
A customer therefore gets its own account row, linked to an existing CRM
``customer`` record (and optionally a ``contact`` record) of the entity engine.
A portal account is never a ``User``, never a ``WorkspaceMember`` and never holds an
``UserOrganizationRole``; internal endpoints cannot see it because they only accept
the Django session cookie, while the portal uses its own cookie and session table.

Everything else (requests, messages, files, quotes, feedback, history) lives on the
existing tables: ``Issue``, ``IssueComment`` (``access``), ``FileAsset``,
``EntityRecord`` and ``EntityEvent``.
"""

from django.conf import settings
from django.db import models
from django.db.models import Q

from .base import BaseModel

PORTAL_ATTACHMENT = "CRM_PORTAL_ATTACHMENT"


class PortalAccount(BaseModel):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="portal_accounts")
    customer_record = models.ForeignKey("db.EntityRecord", on_delete=models.PROTECT, related_name="+")
    contact_record = models.ForeignKey(
        "db.EntityRecord", on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    username = models.CharField(max_length=150)
    display_name = models.CharField(max_length=255)
    email = models.CharField(max_length=255, blank=True)
    phone = models.CharField(max_length=32, blank=True)
    password = models.CharField(max_length=255, blank=True)
    is_active = models.BooleanField(default=True)
    # Bumped on deactivation and password change: every session carrying an older value is dead.
    session_version = models.PositiveIntegerField(default=1)
    failed_attempts = models.PositiveSmallIntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)
    last_login_at = models.DateTimeField(null=True, blank=True)
    password_changed_at = models.DateTimeField(null=True, blank=True)
    # One-time password set-up / reset link (only its hash is stored).
    setup_token_hash = models.CharField(max_length=64, blank=True)
    setup_expires_at = models.DateTimeField(null=True, blank=True)
    # The customer's own notification choices; external channels also need server settings.
    notify_portal = models.BooleanField(default=True)
    notify_email = models.BooleanField(default=False)
    notify_sms = models.BooleanField(default=False)
    # {issue_id: iso moment} of the last time this account opened each request (in-portal badge).
    seen = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "crm_portal_accounts"
        ordering = ("display_name",)
        constraints = [
            models.UniqueConstraint(
                fields=["username"], condition=Q(deleted_at__isnull=True), name="crm_portal_username_unique"
            )
        ]

    # DRF reads these on ``request.user``; a portal account is authenticated only inside the portal API.
    is_authenticated = True
    is_anonymous = False

    def __str__(self):
        return self.username


class PortalSession(BaseModel):
    account = models.ForeignKey(PortalAccount, on_delete=models.CASCADE, related_name="sessions")
    key_hash = models.CharField(max_length=64, unique=True)
    csrf_hash = models.CharField(max_length=64)
    session_version = models.PositiveIntegerField()
    last_seen_at = models.DateTimeField()
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_reason = models.CharField(max_length=32, blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = "crm_portal_sessions"
        ordering = ("-created_at",)


class PortalAuditLog(models.Model):
    """One row per portal API call. Append-only: rows are never updated or deleted.

    Request bodies, passwords and file contents are never stored.
    """

    id = models.BigAutoField(primary_key=True)
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, null=True, related_name="+")
    account = models.ForeignKey(PortalAccount, on_delete=models.SET_NULL, null=True, related_name="+")
    username = models.CharField(max_length=150, blank=True)
    endpoint = models.CharField(max_length=80)
    method = models.CharField(max_length=8)
    object_id = models.CharField(max_length=64, blank=True)
    status_code = models.PositiveSmallIntegerField()
    outcome = models.CharField(max_length=32, blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "crm_portal_audit_logs"
        ordering = ("-created_at",)

    def save(self, *args, **kwargs):
        if self.pk is not None and not self._state.adding:
            raise ValueError("Portal audit rows are append-only.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValueError("Portal audit rows are append-only.")


# Kept here so settings and tests read one value.
PORTAL_SESSION_COOKIE = getattr(settings, "PORTAL_SESSION_COOKIE_NAME", "portal-session")
