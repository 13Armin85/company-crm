# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Workspace-scoped organization, role, and ticket-routing models."""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q

from .base import BaseModel


class OrganizationPermission(BaseModel):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="organization_permissions")
    code = models.CharField(max_length=100)
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    category = models.CharField(max_length=80, blank=True)
    is_delegatable = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "organization_permissions"
        ordering = ("code",)
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "code"],
                condition=Q(deleted_at__isnull=True),
                name="org_permission_unique_active_code",
            )
        ]


class OrganizationRole(BaseModel):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="organization_roles")
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    system_key = models.CharField(max_length=32, null=True, blank=True)
    is_active = models.BooleanField(default=True)
    permissions = models.ManyToManyField(
        OrganizationPermission,
        through="RolePermission",
        related_name="roles",
        blank=True,
    )

    class Meta:
        db_table = "organization_roles"
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "name"],
                condition=Q(deleted_at__isnull=True),
                name="org_role_unique_active_name",
            ),
            models.UniqueConstraint(
                fields=["workspace", "system_key"],
                condition=Q(deleted_at__isnull=True, system_key__isnull=False),
                name="org_role_unique_system_key",
            ),
        ]


class RolePermission(BaseModel):
    role = models.ForeignKey(OrganizationRole, on_delete=models.CASCADE, related_name="role_permissions")
    permission = models.ForeignKey(
        OrganizationPermission,
        on_delete=models.CASCADE,
        related_name="permission_roles",
    )

    class Meta:
        db_table = "organization_role_permissions"
        constraints = [
            models.UniqueConstraint(
                fields=["role", "permission"],
                condition=Q(deleted_at__isnull=True),
                name="org_role_permission_unique_active",
            )
        ]

    def clean(self):
        if self.role_id and self.permission_id and self.role.workspace_id != self.permission.workspace_id:
            raise ValidationError("Role and permission must belong to the same workspace.")


class UserOrganizationRole(BaseModel):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="user_organization_roles")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="organization_roles")
    role = models.ForeignKey(OrganizationRole, on_delete=models.CASCADE, related_name="user_roles")
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "user_organization_roles"
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "user", "role"],
                condition=Q(deleted_at__isnull=True),
                name="user_org_role_unique_active",
            )
        ]

    def clean(self):
        if self.role_id and self.workspace_id != self.role.workspace_id:
            raise ValidationError("Role must belong to the selected workspace.")
        if self.is_active:
            validate_workspace_user(self.workspace_id, self.user_id)
            if not self.role.is_active or self.role.deleted_at:
                raise ValidationError({"role": "Role must be active."})


class OrganizationUnit(BaseModel):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="organization_units")
    title = models.CharField(max_length=200)
    parent = models.ForeignKey(
        "self",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="children",
    )
    manager = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="managed_organization_units",
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "organization_units"
        ordering = ("title",)
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "parent", "title"],
                condition=Q(deleted_at__isnull=True),
                name="org_unit_unique_active_sibling",
            )
        ]

    def clean(self):
        if self.parent_id:
            if self.parent_id == self.id:
                raise ValidationError({"parent": "A unit cannot be its own parent."})
            if self.parent.workspace_id != self.workspace_id:
                raise ValidationError({"parent": "Parent unit must belong to the same workspace."})
            ancestor = self.parent
            visited = set()
            while ancestor:
                if ancestor.id == self.id or ancestor.id in visited:
                    raise ValidationError({"parent": "Organization hierarchy cannot contain a cycle."})
                visited.add(ancestor.id)
                ancestor = ancestor.parent

        if (
            self.manager_id
            and not self.workspace.workspace_member.filter(
                member_id=self.manager_id, is_active=True, member__is_active=True
            ).exists()
        ):
            raise ValidationError({"manager": "Manager must be an active workspace member."})
        if self.manager_id and self.delegates.filter(user_id=self.manager_id, is_active=True).exists():
            raise ValidationError({"manager": "Remove this user from the delegates before assigning them as manager."})


class OrganizationUnitMember(BaseModel):
    unit = models.ForeignKey(OrganizationUnit, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="organization_units")
    is_active = models.BooleanField(default=True)

    def clean(self):
        if self.is_active:
            validate_workspace_user(self.unit.workspace_id, self.user_id)
            if not self.unit.is_active:
                raise ValidationError({"unit": "Unit must be active."})

    class Meta:
        db_table = "organization_unit_members"
        constraints = [
            models.UniqueConstraint(
                fields=["unit", "user"],
                condition=Q(deleted_at__isnull=True),
                name="org_unit_member_unique_active",
            )
        ]


def validate_workspace_user(workspace_id, user_id):
    from .workspace import WorkspaceMember

    if not WorkspaceMember.objects.filter(
        workspace_id=workspace_id, member_id=user_id, is_active=True, member__is_active=True
    ).exists():
        raise ValidationError({"user": "User must be an active member of this workspace."})


class UserPermissionException(BaseModel):
    class Effect(models.TextChoices):
        ALLOW = "ALLOW", "Allow"
        DENY = "DENY", "Deny"

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="permission_exceptions")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="permission_exceptions")
    permission = models.ForeignKey(OrganizationPermission, on_delete=models.PROTECT, related_name="user_exceptions")
    effect = models.CharField(max_length=5, choices=Effect.choices)
    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "user_permission_exceptions"
        indexes = [models.Index(fields=["workspace", "user", "is_active"], name="org_exception_user_idx")]
        constraints = [
            models.CheckConstraint(
                condition=Q(starts_at__isnull=True) | Q(ends_at__isnull=True) | Q(ends_at__gt=models.F("starts_at")),
                name="org_exception_valid_period",
            ),
            models.CheckConstraint(condition=Q(effect__in=["ALLOW", "DENY"]), name="org_exception_valid_effect"),
            *[
                models.UniqueConstraint(
                    fields=["workspace", "user", "permission", "effect", *period_fields],
                    condition=Q(is_active=True, deleted_at__isnull=True, **period_condition),
                    name=f"org_exception_unique_{period_name}",
                )
                for period_name, period_fields, period_condition in (
                    ("unbounded", [], {"starts_at__isnull": True, "ends_at__isnull": True}),
                    ("start", ["starts_at"], {"starts_at__isnull": False, "ends_at__isnull": True}),
                    ("end", ["ends_at"], {"starts_at__isnull": True, "ends_at__isnull": False}),
                    ("bounded", ["starts_at", "ends_at"], {"starts_at__isnull": False, "ends_at__isnull": False}),
                )
            ],
        ]

    def clean(self):
        validate_workspace_user(self.workspace_id, self.user_id)
        if self.permission.workspace_id != self.workspace_id or not self.permission.is_active:
            raise ValidationError({"permission": "Permission must be active in the same workspace."})
        if self.starts_at and self.ends_at and self.ends_at <= self.starts_at:
            raise ValidationError({"ends_at": "End must be after start."})
        if self.is_active and self.deleted_at is None:
            overlapping = UserPermissionException.objects.filter(
                workspace_id=self.workspace_id,
                user_id=self.user_id,
                permission_id=self.permission_id,
                effect=self.effect,
                is_active=True,
            ).exclude(pk=self.pk)
            if self.starts_at:
                overlapping = overlapping.filter(Q(ends_at__isnull=True) | Q(ends_at__gt=self.starts_at))
            if self.ends_at:
                overlapping = overlapping.filter(Q(starts_at__isnull=True) | Q(starts_at__lt=self.ends_at))
            if overlapping.exists():
                raise ValidationError({"permission": "An exception with the same effect already covers this period."})


class OrganizationUnitDelegate(BaseModel):
    unit = models.ForeignKey(OrganizationUnit, on_delete=models.CASCADE, related_name="delegates")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="unit_delegations")
    priority = models.PositiveIntegerField(default=1)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "organization_unit_delegates"
        ordering = ("priority", "created_at")
        constraints = [
            models.UniqueConstraint(
                fields=["unit", "user"],
                condition=Q(deleted_at__isnull=True, is_active=True),
                name="org_delegate_unique_user",
            ),
            models.UniqueConstraint(
                fields=["unit", "priority"],
                condition=Q(deleted_at__isnull=True, is_active=True),
                name="org_delegate_unique_priority",
            ),
            models.CheckConstraint(condition=Q(priority__gte=1), name="org_delegate_positive_priority"),
        ]

    def clean(self):
        validate_workspace_user(self.unit.workspace_id, self.user_id)
        if self.unit.manager_id == self.user_id:
            raise ValidationError({"user": "The primary manager cannot be their own delegate."})


class UserAbsence(BaseModel):
    class Status(models.TextChoices):
        SCHEDULED = "scheduled", "Scheduled"
        CANCELLED = "cancelled", "Cancelled"
        ENDED = "ended", "Ended"

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="user_absences")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="absences")
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    reason = models.TextField(blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.SCHEDULED)

    class Meta:
        db_table = "user_absences"
        ordering = ("-starts_at",)
        indexes = [models.Index(fields=["workspace", "user", "status"], name="org_absence_user_idx")]
        constraints = [
            models.CheckConstraint(condition=Q(ends_at__gt=models.F("starts_at")), name="org_absence_valid_period")
        ]

    def clean(self):
        validate_workspace_user(self.workspace_id, self.user_id)
        if self.ends_at <= self.starts_at:
            raise ValidationError({"ends_at": "End must be after start."})
        if (
            self.status == self.Status.SCHEDULED
            and UserAbsence.objects.filter(
                workspace_id=self.workspace_id,
                user_id=self.user_id,
                status=self.Status.SCHEDULED,
                starts_at__lt=self.ends_at,
                ends_at__gt=self.starts_at,
            )
            .exclude(pk=self.pk)
            .exists()
        ):
            raise ValidationError({"starts_at": "Absence periods cannot overlap."})


class TicketRoutingRule(BaseModel):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="ticket_routing_rules")
    name = models.CharField(max_length=150)
    unit = models.ForeignKey(OrganizationUnit, on_delete=models.CASCADE, related_name="routing_rules")
    required_role = models.ForeignKey(OrganizationRole, on_delete=models.PROTECT, related_name="routing_rules")
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "ticket_routing_rules"
        ordering = ("name",)

    def clean(self):
        if self.unit_id and self.unit.workspace_id != self.workspace_id:
            raise ValidationError({"unit": "Unit must belong to the selected workspace."})
        if self.required_role_id and self.required_role.workspace_id != self.workspace_id:
            raise ValidationError({"required_role": "Role must belong to the selected workspace."})


class TicketRoutingDecision(BaseModel):
    class Outcome(models.TextChoices):
        ASSIGNED = "assigned", "Assigned"
        QUEUED = "queued", "Role queue"

    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="routing_decisions")
    rule = models.ForeignKey(TicketRoutingRule, on_delete=models.PROTECT, related_name="decisions")
    resolved_unit = models.ForeignKey(
        OrganizationUnit,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="routing_decisions",
    )
    assigned_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="ticket_routing_decisions",
    )
    outcome = models.CharField(max_length=20, choices=Outcome.choices)

    class Meta:
        db_table = "ticket_routing_decisions"
        ordering = ("-created_at",)


class TicketRoleQueueEntry(BaseModel):
    class Status(models.TextChoices):
        OPEN = "open", "Open"
        CLAIMED = "claimed", "Claimed"
        CLOSED = "closed", "Closed"

    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="role_queue_entries")
    rule = models.ForeignKey(TicketRoutingRule, on_delete=models.PROTECT, related_name="queue_entries")
    required_role = models.ForeignKey(OrganizationRole, on_delete=models.PROTECT, related_name="queue_entries")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    claimed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="claimed_ticket_queue_entries",
    )

    class Meta:
        db_table = "ticket_role_queue_entries"
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["issue", "rule"],
                condition=Q(status="open", deleted_at__isnull=True),
                name="ticket_queue_unique_open_issue_rule",
            )
        ]
