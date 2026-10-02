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
    code = models.SlugField(max_length=100)
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
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
    level = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    permissions = models.ManyToManyField(
        OrganizationPermission,
        through="RolePermission",
        related_name="roles",
        blank=True,
    )

    class Meta:
        db_table = "organization_roles"
        ordering = ("-level", "name")
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "name"],
                condition=Q(deleted_at__isnull=True),
                name="org_role_unique_active_name",
            )
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
            and not self.workspace.workspace_member.filter(member_id=self.manager_id, is_active=True).exists()
        ):
            raise ValidationError({"manager": "Manager must be an active workspace member."})


class OrganizationUnitMember(BaseModel):
    unit = models.ForeignKey(OrganizationUnit, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="organization_units")
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "organization_unit_members"
        constraints = [
            models.UniqueConstraint(
                fields=["unit", "user"],
                condition=Q(deleted_at__isnull=True),
                name="org_unit_member_unique_active",
            )
        ]


class TicketRoutingRule(BaseModel):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="ticket_routing_rules")
    name = models.CharField(max_length=150)
    unit = models.ForeignKey(OrganizationUnit, on_delete=models.CASCADE, related_name="routing_rules")
    required_role = models.ForeignKey(OrganizationRole, on_delete=models.PROTECT, related_name="routing_rules")
    required_level = models.PositiveIntegerField(default=0)
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
    required_level = models.PositiveIntegerField(default=0)
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
