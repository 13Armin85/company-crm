"""Workspace organization administration endpoints."""

import re

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions.crm import require_permission, require_any_permission
from plane.app.services.access_control import has_permission, sync_plane_membership
from plane.app.services.access_mutations import (
    normalize_ids,
    access_transaction,
    audit_access,
    require_field_permission,
    sync_user_roles,
)
from django.core.validators import validate_email
from plane.app.serializers import (
    OrganizationPermissionSerializer,
    OrganizationRoleSerializer,
    OrganizationUnitSerializer,
    TicketRoleQueueEntrySerializer,
    TicketRoutingDecisionSerializer,
    TicketRoutingRuleSerializer,
)
from plane.app.services import TicketRoutingService
from plane.app.views.base import BaseAPIView
from plane.db.models import (
    Issue,
    IssueAssignee,
    OrganizationPermission,
    OrganizationRole,
    OrganizationUnit,
    OrganizationUnitMember,
    TicketRoleQueueEntry,
    TicketRoutingRule,
    User,
    UserOrganizationRole,
    Workspace,
    WorkspaceMember,
    ProjectMember,
)


def _validation_error(exc):
    if hasattr(exc, "message_dict"):
        return exc.message_dict
    return {"error": exc.messages if hasattr(exc, "messages") else str(exc)}


def _sync_user_units(workspace, user, unit_ids):
    unit_ids = normalize_ids(unit_ids, "unit_ids")
    if unit_ids:
        from plane.db.models.organization import validate_workspace_user

        validate_workspace_user(workspace.id, user.id)
    units = list(OrganizationUnit.objects.filter(workspace=workspace, id__in=unit_ids, is_active=True))
    if len(units) != len(set(unit_ids)):
        raise ValidationError({"unit_ids": "One or more teams are invalid or inactive."})
    OrganizationUnitMember.objects.filter(unit__workspace=workspace, user=user).exclude(unit_id__in=unit_ids).update(
        is_active=False
    )
    for unit in units:
        relation, _ = OrganizationUnitMember.objects.get_or_create(unit=unit, user=user)
        if not relation.is_active:
            relation.is_active = True
            relation.save(update_fields=["is_active", "updated_at"])


def _user_profile_data(workspace, user):
    membership = WorkspaceMember.objects.get(workspace=workspace, member=user)
    return {
        "id": user.id,
        "membership_id": membership.id,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "display_name": user.display_name,
        "username": user.username,
        "email": user.email,
        "is_active": user.is_active and membership.is_active,
        "role_ids": list(
            UserOrganizationRole.objects.filter(workspace=workspace, user=user, is_active=True, role__is_active=True)
            .order_by("role__name")
            .values_list("role_id", flat=True)
        ),
        "unit_ids": list(
            OrganizationUnitMember.objects.filter(unit__workspace=workspace, user=user, is_active=True)
            .order_by("unit__title")
            .values_list("unit_id", flat=True)
        ),
    }


class OrganizationPermissionListEndpoint(BaseAPIView):
    @require_permission("Permission.View")
    def get(self, request, slug):
        rows = OrganizationPermission.objects.filter(workspace__slug=slug, is_active=True).order_by("category", "code")
        return Response(OrganizationPermissionSerializer(rows, many=True).data)


class OrganizationPermissionDetailEndpoint(BaseAPIView):
    @require_permission("Permission.View")
    def get(self, request, slug, permission_id):
        return Response(
            OrganizationPermissionSerializer(
                get_object_or_404(OrganizationPermission, workspace__slug=slug, id=permission_id)
            ).data
        )


class OrganizationRoleListEndpoint(BaseAPIView):
    @require_any_permission("Role.View", "User.Role.Assign", "Routing.Manage")
    def get(self, request, slug):
        rows = (
            OrganizationRole.objects.filter(workspace__slug=slug)
            .prefetch_related("permissions")
            .annotate(
                user_count=Count(
                    "user_roles__user_id",
                    filter=Q(user_roles__is_active=True, user_roles__deleted_at__isnull=True),
                    distinct=True,
                )
            )
        )
        return Response(OrganizationRoleSerializer(rows, many=True).data)

    @require_permission("Role.Create")
    def post(self, request, slug):
        workspace = get_object_or_404(Workspace, slug=slug)
        serializer = OrganizationRoleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        require_field_permission(request, workspace, "permission_ids", "Role.Permission.Assign")
        try:
            permission_ids = normalize_ids(request.data.get("permission_ids", []), "permission_ids")
        except ValidationError as exc:
            return Response(_validation_error(exc), status=400)
        permissions = OrganizationPermission.objects.filter(workspace=workspace, id__in=permission_ids, is_active=True)
        if permissions.count() != len(set(permission_ids)):
            return Response({"permission_ids": ["Invalid permission selection."]}, status=status.HTTP_400_BAD_REQUEST)
        try:
            with access_transaction(workspace):
                role = serializer.save(workspace=workspace)
                role.permissions.set(permissions)
                audit_access(
                    request,
                    role.workspace,
                    "role.permissions",
                    role.id,
                    changes={
                        "permission_ids": list(role.permissions.values_list("id", flat=True)),
                        "is_active": role.is_active,
                    },
                )
        except (IntegrityError, ValidationError) as exc:
            return Response(_validation_error(exc), status=status.HTTP_400_BAD_REQUEST)
        return Response(OrganizationRoleSerializer(role).data, status=status.HTTP_201_CREATED)


class OrganizationRoleDetailEndpoint(BaseAPIView):
    @require_any_permission("Role.Edit", "Role.Disable", "Role.Permission.Assign")
    def patch(self, request, slug, role_id):
        role = get_object_or_404(OrganizationRole, workspace__slug=slug, id=role_id)
        for field in ("name", "description"):
            require_field_permission(request, role.workspace, field, "Role.Edit")
        require_field_permission(request, role.workspace, "permission_ids", "Role.Permission.Assign")
        require_field_permission(request, role.workspace, "is_active", "Role.Disable")
        serializer = OrganizationRoleSerializer(role, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        try:
            with access_transaction(role.workspace):
                role = serializer.save()
                if "permission_ids" in request.data:
                    ids = normalize_ids(request.data.get("permission_ids", []), "permission_ids")
                    permissions = OrganizationPermission.objects.filter(
                        workspace=role.workspace, id__in=ids, is_active=True
                    )
                    if permissions.count() != len(set(ids)):
                        raise ValidationError({"permission_ids": "Invalid permission selection."})
                    role.permissions.set(permissions)
                if "is_active" in request.data:
                    for assignment in UserOrganizationRole.objects.filter(role=role).select_related("user"):
                        sync_plane_membership(role.workspace, assignment.user)
                audit_access(
                    request,
                    role.workspace,
                    "role.permissions",
                    role.id,
                    changes={
                        "permission_ids": list(role.permissions.values_list("id", flat=True)),
                        "is_active": role.is_active,
                    },
                )
        except (IntegrityError, ValidationError) as exc:
            return Response(_validation_error(exc), status=status.HTTP_400_BAD_REQUEST)
        return Response(OrganizationRoleSerializer(role).data)

    @require_permission("Role.Disable")
    def delete(self, request, slug, role_id):
        role = get_object_or_404(OrganizationRole, workspace__slug=slug, id=role_id)
        try:
            with access_transaction(role.workspace):
                role.is_active = False
                role.save(update_fields=["is_active", "updated_at"])
                for assignment in UserOrganizationRole.objects.filter(role=role).select_related("user"):
                    sync_plane_membership(role.workspace, assignment.user)
                audit_access(request, role.workspace, "role.disable", role.id)
        except ValidationError as exc:
            return Response(_validation_error(exc), status=400)
        return Response(status=status.HTTP_204_NO_CONTENT)


class OrganizationUnitListEndpoint(BaseAPIView):
    @require_any_permission("OrganizationUnit.View", "OrganizationUnit.Member.Manage", "Routing.Manage")
    def get(self, request, slug):
        rows = (
            OrganizationUnit.objects.filter(workspace__slug=slug)
            .select_related("manager")
            .prefetch_related("memberships", "delegates__user")
        )
        return Response(OrganizationUnitSerializer(rows, many=True).data)

    @require_permission("OrganizationUnit.Create")
    def post(self, request, slug):
        workspace = get_object_or_404(Workspace, slug=slug)
        require_field_permission(request, workspace, "manager_id", "OrganizationUnit.Manager.Assign")
        require_field_permission(request, workspace, "member_ids", "OrganizationUnit.Member.Manage")
        serializer = OrganizationUnitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        unit = OrganizationUnit(
            workspace=workspace,
            title=serializer.validated_data["title"],
            parent=serializer.validated_data.get("parent"),
            manager=serializer.validated_data.get("manager"),
            is_active=serializer.validated_data.get("is_active", True),
        )
        try:
            with transaction.atomic():
                Workspace.objects.select_for_update().get(pk=workspace.pk)
                unit.full_clean(exclude=["created_by", "updated_by"])
                unit.save()
                _sync_unit_members(unit, request.data.get("member_ids", []))
                audit_access(request, workspace, "unit.create", unit.id)
        except (ValidationError, IntegrityError) as exc:
            return Response(_validation_error(exc), status=status.HTTP_400_BAD_REQUEST)
        return Response(OrganizationUnitSerializer(unit).data, status=status.HTTP_201_CREATED)


def _sync_unit_members(unit, member_ids):
    member_ids = normalize_ids(member_ids, "member_ids")
    users = User.objects.filter(
        id__in=member_ids, is_active=True, member_workspace__workspace=unit.workspace, member_workspace__is_active=True
    )
    if users.count() != len(set(member_ids)):
        raise ValidationError({"member_ids": "Members must be active in this workspace."})
    OrganizationUnitMember.objects.filter(unit=unit).exclude(user_id__in=member_ids).update(is_active=False)
    for user in users:
        relation, _ = OrganizationUnitMember.objects.get_or_create(unit=unit, user=user)
        if not relation.is_active:
            relation.is_active = True
            relation.save(update_fields=["is_active", "updated_at"])


class OrganizationUnitDetailEndpoint(BaseAPIView):
    @require_any_permission(
        "OrganizationUnit.Edit",
        "OrganizationUnit.Manager.Assign",
        "OrganizationUnit.Member.Manage",
        "OrganizationUnit.Disable",
    )
    def patch(self, request, slug, unit_id):
        unit = get_object_or_404(OrganizationUnit, workspace__slug=slug, id=unit_id)
        for field in ("title", "parent_id"):
            require_field_permission(request, unit.workspace, field, "OrganizationUnit.Edit")
        require_field_permission(request, unit.workspace, "manager_id", "OrganizationUnit.Manager.Assign")
        require_field_permission(request, unit.workspace, "member_ids", "OrganizationUnit.Member.Manage")
        require_field_permission(request, unit.workspace, "is_active", "OrganizationUnit.Disable")
        serializer = OrganizationUnitSerializer(unit, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        for field in ("title", "parent", "manager", "is_active"):
            if field in serializer.validated_data:
                setattr(unit, field, serializer.validated_data[field])
        try:
            with transaction.atomic():
                Workspace.objects.select_for_update().get(pk=unit.workspace_id)
                unit.full_clean(exclude=["created_by", "updated_by"])
                unit.save()
                if "member_ids" in request.data:
                    _sync_unit_members(unit, request.data.get("member_ids", []))
                audit_access(request, unit.workspace, "unit.edit", unit.id)
        except (ValidationError, IntegrityError) as exc:
            return Response(_validation_error(exc), status=status.HTTP_400_BAD_REQUEST)
        return Response(OrganizationUnitSerializer(unit).data)

    @require_permission("OrganizationUnit.Disable")
    def delete(self, request, slug, unit_id):
        unit = get_object_or_404(OrganizationUnit, workspace__slug=slug, id=unit_id)
        unit.is_active = False
        unit.save(update_fields=["is_active", "updated_at"])
        audit_access(request, unit.workspace, "unit.disable", unit.id)
        return Response(status=status.HTTP_204_NO_CONTENT)


class OrganizationUserProfileEndpoint(BaseAPIView):
    @require_permission("User.View")
    def get(self, request, slug, user_id):
        workspace = get_object_or_404(Workspace, slug=slug)
        user = get_object_or_404(User, id=user_id, member_workspace__workspace=workspace)
        return Response(_user_profile_data(workspace, user))

    @require_any_permission("User.Edit", "User.Role.Assign", "OrganizationUnit.Member.Manage")
    def patch(self, request, slug, user_id):
        workspace = get_object_or_404(Workspace, slug=slug)
        user = get_object_or_404(User, id=user_id, member_workspace__workspace=workspace)
        for field in ("first_name", "last_name", "display_name", "username", "email", "is_active"):
            require_field_permission(request, workspace, field, "User.Edit")
        if (
            "role_ids" in request.data
            and not WorkspaceMember.objects.filter(
                workspace=workspace, member=user, is_active=True, member__is_active=True
            ).exists()
        ):
            return Response({"role_ids": ["Activate and save the membership before assigning roles."]}, status=400)
        username = str(request.data.get("username", user.username)).strip().lower()
        email = str(request.data.get("email", user.email)).strip().lower()
        if "username" in request.data and not re.fullmatch(r"[a-z0-9_.-]{3,32}", username):
            return Response(
                {"username": ["Username must be 3-32 characters using letters, digits, ._- only."]}, status=400
            )
        if "username" in request.data and User.objects.exclude(id=user.id).filter(username__iexact=username).exists():
            return Response({"username": ["This username is already in use."]}, status=400)
        if "email" in request.data and User.objects.exclude(id=user.id).filter(email__iexact=email).exists():
            return Response({"email": ["This email is already in use."]}, status=400)
        if "password" in request.data:
            return Response({"password": ["Use the dedicated password endpoint."]}, status=400)
        require_field_permission(request, workspace, "role_ids", "User.Role.Assign")
        require_field_permission(request, workspace, "unit_ids", "OrganizationUnit.Member.Manage")
        if "email" in request.data:
            try:
                validate_email(email)
            except ValidationError as exc:
                return Response({"email": exc.messages}, status=400)
        try:
            with access_transaction(workspace):
                identity_fields = [
                    field
                    for field in ("first_name", "last_name", "display_name", "username", "email")
                    if field in request.data
                ]
                if identity_fields:
                    for field in identity_fields:
                        value = (
                            username
                            if field == "username"
                            else email
                            if field == "email"
                            else str(request.data[field]).strip()
                        )
                        setattr(user, field, value)
                    # A profile save must never overwrite a concurrent password reset.
                    user.save(update_fields=[*identity_fields, "updated_at"])
                if "is_active" in request.data:
                    if not isinstance(request.data["is_active"], bool):
                        raise ValidationError({"is_active": "Expected a boolean."})
                    membership = WorkspaceMember.objects.get(workspace=workspace, member=user)
                    membership.is_active = request.data["is_active"]
                    membership.save(update_fields=["is_active", "updated_at"])
                    if not membership.is_active:
                        ProjectMember.objects.filter(workspace=workspace, member=user).update(is_active=False)
                if "role_ids" in request.data:
                    sync_user_roles(workspace, user, request.data.get("role_ids", []))
                if "unit_ids" in request.data:
                    _sync_user_units(workspace, user, request.data.get("unit_ids", []))
                audit_access(
                    request,
                    workspace,
                    "user.profile",
                    user.id,
                    changes={
                        "role_ids": list(
                            UserOrganizationRole.objects.filter(
                                workspace=workspace, user=user, is_active=True
                            ).values_list("role_id", flat=True)
                        ),
                        "unit_ids": list(
                            OrganizationUnitMember.objects.filter(
                                unit__workspace=workspace, user=user, is_active=True
                            ).values_list("unit_id", flat=True)
                        ),
                        "membership_active": WorkspaceMember.objects.get(workspace=workspace, member=user).is_active,
                    },
                )
        except (ValidationError, IntegrityError) as exc:
            return Response(_validation_error(exc), status=status.HTTP_400_BAD_REQUEST)
        return Response(_user_profile_data(workspace, user))


class TicketRoutingRuleListEndpoint(BaseAPIView):
    @require_permission("Routing.View")
    def get(self, request, slug):
        rows = TicketRoutingRule.objects.filter(workspace__slug=slug).select_related("unit", "required_role")
        return Response(TicketRoutingRuleSerializer(rows, many=True).data)

    @require_permission("Routing.Manage")
    def post(self, request, slug):
        workspace = get_object_or_404(Workspace, slug=slug)
        serializer = TicketRoutingRuleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        rule = TicketRoutingRule(workspace=workspace, **serializer.validated_data)
        try:
            rule.full_clean(exclude=["created_by", "updated_by"])
            rule.save()
        except ValidationError as exc:
            return Response(_validation_error(exc), status=status.HTTP_400_BAD_REQUEST)
        return Response(TicketRoutingRuleSerializer(rule).data, status=status.HTTP_201_CREATED)


class TicketRoutingRuleDetailEndpoint(BaseAPIView):
    @require_permission("Routing.Manage")
    def patch(self, request, slug, rule_id):
        rule = get_object_or_404(TicketRoutingRule, workspace__slug=slug, id=rule_id)
        serializer = TicketRoutingRuleSerializer(rule, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        for field in ("name", "unit", "required_role", "is_active"):
            if field in serializer.validated_data:
                setattr(rule, field, serializer.validated_data[field])
        try:
            rule.full_clean(exclude=["created_by", "updated_by"])
            rule.save()
        except (ValidationError, IntegrityError) as exc:
            return Response(_validation_error(exc), status=status.HTTP_400_BAD_REQUEST)
        return Response(TicketRoutingRuleSerializer(rule).data)

    @require_permission("Routing.Manage")
    def delete(self, request, slug, rule_id):
        rule = get_object_or_404(TicketRoutingRule, workspace__slug=slug, id=rule_id)
        rule.is_active = False
        rule.save(update_fields=["is_active", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class TicketRouteEndpoint(BaseAPIView):
    @require_permission("Routing.Route")
    def post(self, request, slug, issue_id):
        issue = get_object_or_404(Issue, id=issue_id, workspace__slug=slug)
        rule = get_object_or_404(TicketRoutingRule, id=request.data.get("rule_id"), workspace__slug=slug)
        try:
            decision = TicketRoutingService.route(issue, rule)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(TicketRoutingDecisionSerializer(decision).data, status=status.HTTP_201_CREATED)


class TicketRoleQueueEndpoint(BaseAPIView):
    @require_permission("Routing.Queue.View")
    def get(self, request, slug):
        rows = TicketRoleQueueEntry.objects.filter(
            issue__workspace__slug=slug, status=TicketRoleQueueEntry.Status.OPEN
        ).select_related("issue", "issue__project", "rule", "required_role", "claimed_by")
        if not has_permission(request.user, slug, "Routing.Queue.ViewAll", request=request):
            active_roles = UserOrganizationRole.objects.filter(
                workspace__slug=slug,
                user=request.user,
                is_active=True,
                role__is_active=True,
            )
            rows = rows.filter(
                required_role_id__in=active_roles.values_list("role_id", flat=True),
            )
        return Response(TicketRoleQueueEntrySerializer(rows, many=True).data)


class TicketRoleQueueClaimEndpoint(BaseAPIView):
    @require_permission("Routing.Queue.Claim")
    @transaction.atomic
    def post(self, request, slug, queue_id):
        entry = get_object_or_404(
            TicketRoleQueueEntry.objects.select_for_update().select_related("issue", "required_role"),
            id=queue_id,
            issue__workspace__slug=slug,
        )
        if entry.status != TicketRoleQueueEntry.Status.OPEN:
            return Response({"error": "Queue entry is no longer open."}, status=status.HTTP_409_CONFLICT)

        is_active_member = WorkspaceMember.objects.filter(
            workspace__slug=slug,
            member=request.user,
            is_active=True,
        ).exists()
        active_roles = UserOrganizationRole.objects.filter(
            workspace__slug=slug,
            user=request.user,
            is_active=True,
            role__is_active=True,
        )
        if (
            not request.user.is_active
            or not is_active_member
            or not active_roles.filter(role=entry.required_role).exists()
        ):
            return Response(
                {"error": "You do not have the active role required for this queue."},
                status=status.HTTP_403_FORBIDDEN,
            )

        IssueAssignee.objects.get_or_create(
            issue=entry.issue,
            assignee=request.user,
            defaults={
                "workspace_id": entry.issue.workspace_id,
                "project_id": entry.issue.project_id,
            },
        )
        entry.claimed_by = request.user
        entry.status = TicketRoleQueueEntry.Status.CLAIMED
        entry.save(update_fields=["claimed_by", "status", "updated_at"])
        return Response(TicketRoleQueueEntrySerializer(entry).data)
