"""Workspace organization administration endpoints."""

import re

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Max
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
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
)


def _validation_error(exc):
    if hasattr(exc, "message_dict"):
        return exc.message_dict
    return {"error": exc.messages if hasattr(exc, "messages") else str(exc)}


def _sync_user_roles(workspace, user, role_ids):
    roles = list(OrganizationRole.objects.filter(workspace=workspace, id__in=role_ids, is_active=True))
    if len(roles) != len(set(role_ids)):
        raise ValidationError({"role_ids": "One or more roles are invalid or inactive."})
    UserOrganizationRole.objects.filter(workspace=workspace, user=user).exclude(role_id__in=role_ids).update(
        is_active=False
    )
    for role in roles:
        relation, _ = UserOrganizationRole.objects.get_or_create(workspace=workspace, user=user, role=role)
        if not relation.is_active:
            relation.is_active = True
            relation.save(update_fields=["is_active", "updated_at"])


def _sync_user_units(workspace, user, unit_ids):
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
        "is_active": user.is_active,
        "workspace_role": membership.role,
        "role_ids": list(
            UserOrganizationRole.objects.filter(workspace=workspace, user=user, is_active=True, role__is_active=True)
            .order_by("-role__level")
            .values_list("role_id", flat=True)
        ),
        "unit_ids": list(
            OrganizationUnitMember.objects.filter(unit__workspace=workspace, user=user, is_active=True)
            .order_by("unit__title")
            .values_list("unit_id", flat=True)
        ),
        "maximum_role_level": (
            UserOrganizationRole.objects.filter(workspace=workspace, user=user, is_active=True, role__is_active=True)
            .order_by("-role__level")
            .values_list("role__level", flat=True)
            .first()
            or 0
        ),
    }


class OrganizationPermissionListEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def get(self, request, slug):
        rows = OrganizationPermission.objects.filter(workspace__slug=slug).order_by("code")
        return Response(OrganizationPermissionSerializer(rows, many=True).data)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def post(self, request, slug):
        workspace = get_object_or_404(Workspace, slug=slug)
        serializer = OrganizationPermissionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            permission = serializer.save(workspace=workspace)
        except IntegrityError:
            return Response({"code": ["Permission code already exists."]}, status=status.HTTP_400_BAD_REQUEST)
        return Response(OrganizationPermissionSerializer(permission).data, status=status.HTTP_201_CREATED)


class OrganizationPermissionDetailEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def patch(self, request, slug, permission_id):
        permission = get_object_or_404(OrganizationPermission, workspace__slug=slug, id=permission_id)
        serializer = OrganizationPermissionSerializer(permission, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        try:
            permission = serializer.save()
        except IntegrityError:
            return Response({"code": ["Permission code already exists."]}, status=status.HTTP_400_BAD_REQUEST)
        return Response(OrganizationPermissionSerializer(permission).data)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def delete(self, request, slug, permission_id):
        permission = get_object_or_404(OrganizationPermission, workspace__slug=slug, id=permission_id)
        permission.is_active = False
        permission.save(update_fields=["is_active", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class OrganizationRoleListEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def get(self, request, slug):
        rows = OrganizationRole.objects.filter(workspace__slug=slug).prefetch_related("permissions")
        return Response(OrganizationRoleSerializer(rows, many=True).data)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def post(self, request, slug):
        workspace = get_object_or_404(Workspace, slug=slug)
        serializer = OrganizationRoleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        permission_ids = request.data.get("permission_ids", [])
        permissions = OrganizationPermission.objects.filter(workspace=workspace, id__in=permission_ids, is_active=True)
        if permissions.count() != len(set(permission_ids)):
            return Response({"permission_ids": ["Invalid permission selection."]}, status=status.HTTP_400_BAD_REQUEST)
        try:
            with transaction.atomic():
                role = serializer.save(workspace=workspace)
                role.permissions.set(permissions)
        except IntegrityError:
            return Response({"name": ["Role name already exists."]}, status=status.HTTP_400_BAD_REQUEST)
        return Response(OrganizationRoleSerializer(role).data, status=status.HTTP_201_CREATED)


class OrganizationRoleDetailEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def patch(self, request, slug, role_id):
        role = get_object_or_404(OrganizationRole, workspace__slug=slug, id=role_id)
        serializer = OrganizationRoleSerializer(role, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                role = serializer.save()
                if "permission_ids" in request.data:
                    ids = request.data.get("permission_ids", [])
                    permissions = OrganizationPermission.objects.filter(
                        workspace=role.workspace, id__in=ids, is_active=True
                    )
                    if permissions.count() != len(set(ids)):
                        raise ValidationError({"permission_ids": "Invalid permission selection."})
                    role.permissions.set(permissions)
        except (IntegrityError, ValidationError) as exc:
            return Response(_validation_error(exc), status=status.HTTP_400_BAD_REQUEST)
        return Response(OrganizationRoleSerializer(role).data)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def delete(self, request, slug, role_id):
        role = get_object_or_404(OrganizationRole, workspace__slug=slug, id=role_id)
        role.is_active = False
        role.save(update_fields=["is_active", "updated_at"])
        UserOrganizationRole.objects.filter(role=role).update(is_active=False)
        return Response(status=status.HTTP_204_NO_CONTENT)


class OrganizationUnitListEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def get(self, request, slug):
        rows = (
            OrganizationUnit.objects.filter(workspace__slug=slug)
            .select_related("manager")
            .prefetch_related("memberships")
        )
        return Response(OrganizationUnitSerializer(rows, many=True).data)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def post(self, request, slug):
        workspace = get_object_or_404(Workspace, slug=slug)
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
                unit.full_clean()
                unit.save()
                _sync_unit_members(unit, request.data.get("member_ids", []))
        except (ValidationError, IntegrityError) as exc:
            return Response(_validation_error(exc), status=status.HTTP_400_BAD_REQUEST)
        return Response(OrganizationUnitSerializer(unit).data, status=status.HTTP_201_CREATED)


def _sync_unit_members(unit, member_ids):
    users = User.objects.filter(
        id__in=member_ids, member_workspace__workspace=unit.workspace, member_workspace__is_active=True
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
    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def patch(self, request, slug, unit_id):
        unit = get_object_or_404(OrganizationUnit, workspace__slug=slug, id=unit_id)
        serializer = OrganizationUnitSerializer(unit, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        for field in ("title", "parent", "manager", "is_active"):
            if field in serializer.validated_data:
                setattr(unit, field, serializer.validated_data[field])
        try:
            with transaction.atomic():
                unit.full_clean()
                unit.save()
                if "member_ids" in request.data:
                    _sync_unit_members(unit, request.data.get("member_ids", []))
        except (ValidationError, IntegrityError) as exc:
            return Response(_validation_error(exc), status=status.HTTP_400_BAD_REQUEST)
        return Response(OrganizationUnitSerializer(unit).data)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def delete(self, request, slug, unit_id):
        unit = get_object_or_404(OrganizationUnit, workspace__slug=slug, id=unit_id)
        unit.is_active = False
        unit.save(update_fields=["is_active", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class OrganizationUserProfileEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def get(self, request, slug, user_id):
        workspace = get_object_or_404(Workspace, slug=slug)
        user = get_object_or_404(User, id=user_id, member_workspace__workspace=workspace)
        return Response(_user_profile_data(workspace, user))

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def patch(self, request, slug, user_id):
        workspace = get_object_or_404(Workspace, slug=slug)
        user = get_object_or_404(User, id=user_id, member_workspace__workspace=workspace)
        username = str(request.data.get("username", user.username)).strip().lower()
        email = str(request.data.get("email", user.email)).strip().lower()
        if not re.fullmatch(r"[a-z0-9_.-]{3,32}", username):
            return Response(
                {"username": ["Username must be 3-32 characters using letters, digits, ._- only."]}, status=400
            )
        if User.objects.exclude(id=user.id).filter(username__iexact=username).exists():
            return Response({"username": ["This username is already in use."]}, status=400)
        if User.objects.exclude(id=user.id).filter(email__iexact=email).exists():
            return Response({"email": ["This email is already in use."]}, status=400)
        password = request.data.get("password")
        if password:
            try:
                validate_password(password, user=user)
            except ValidationError as exc:
                return Response({"password": exc.messages}, status=400)
        try:
            with transaction.atomic():
                user.first_name = str(request.data.get("first_name", user.first_name)).strip()
                user.last_name = str(request.data.get("last_name", user.last_name)).strip()
                user.display_name = str(
                    request.data.get("display_name", f"{user.first_name} {user.last_name}".strip() or user.display_name)
                ).strip()
                user.username = username
                user.email = email
                if "is_active" in request.data:
                    user.is_active = bool(request.data["is_active"])
                if password:
                    user.set_password(password)
                user.save()
                if "role_ids" in request.data:
                    _sync_user_roles(workspace, user, request.data.get("role_ids", []))
                if "unit_ids" in request.data:
                    _sync_user_units(workspace, user, request.data.get("unit_ids", []))
        except (ValidationError, IntegrityError) as exc:
            return Response(_validation_error(exc), status=status.HTTP_400_BAD_REQUEST)
        return Response(_user_profile_data(workspace, user))


class TicketRoutingRuleListEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def get(self, request, slug):
        rows = TicketRoutingRule.objects.filter(workspace__slug=slug).select_related("unit", "required_role")
        return Response(TicketRoutingRuleSerializer(rows, many=True).data)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def post(self, request, slug):
        workspace = get_object_or_404(Workspace, slug=slug)
        serializer = TicketRoutingRuleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        rule = TicketRoutingRule(workspace=workspace, **serializer.validated_data)
        try:
            rule.full_clean()
            rule.save()
        except ValidationError as exc:
            return Response(_validation_error(exc), status=status.HTTP_400_BAD_REQUEST)
        return Response(TicketRoutingRuleSerializer(rule).data, status=status.HTTP_201_CREATED)


class TicketRoutingRuleDetailEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def patch(self, request, slug, rule_id):
        rule = get_object_or_404(TicketRoutingRule, workspace__slug=slug, id=rule_id)
        serializer = TicketRoutingRuleSerializer(rule, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        for field in ("name", "unit", "required_role", "required_level", "is_active"):
            if field in serializer.validated_data:
                setattr(rule, field, serializer.validated_data[field])
        try:
            rule.full_clean()
            rule.save()
        except (ValidationError, IntegrityError) as exc:
            return Response(_validation_error(exc), status=status.HTTP_400_BAD_REQUEST)
        return Response(TicketRoutingRuleSerializer(rule).data)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def delete(self, request, slug, rule_id):
        rule = get_object_or_404(TicketRoutingRule, workspace__slug=slug, id=rule_id)
        rule.is_active = False
        rule.save(update_fields=["is_active", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class TicketRouteEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug, issue_id):
        issue = get_object_or_404(Issue, id=issue_id, workspace__slug=slug)
        rule = get_object_or_404(TicketRoutingRule, id=request.data.get("rule_id"), workspace__slug=slug)
        try:
            decision = TicketRoutingService.route(issue, rule)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(TicketRoutingDecisionSerializer(decision).data, status=status.HTTP_201_CREATED)


class TicketRoleQueueEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug):
        rows = TicketRoleQueueEntry.objects.filter(
            issue__workspace__slug=slug, status=TicketRoleQueueEntry.Status.OPEN
        ).select_related("issue", "issue__project", "rule", "required_role", "claimed_by")
        membership = WorkspaceMember.objects.filter(workspace__slug=slug, member=request.user, is_active=True).first()
        if membership and membership.role != ROLE.ADMIN.value:
            active_roles = UserOrganizationRole.objects.filter(
                workspace__slug=slug,
                user=request.user,
                is_active=True,
                role__is_active=True,
            )
            maximum_level = active_roles.aggregate(level=Max("role__level"))["level"] or 0
            rows = rows.filter(
                required_role_id__in=active_roles.values_list("role_id", flat=True),
                required_level__lte=maximum_level,
            )
        return Response(TicketRoleQueueEntrySerializer(rows, many=True).data)


class TicketRoleQueueClaimEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
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
        maximum_level = active_roles.aggregate(level=Max("role__level"))["level"] or 0
        if (
            not request.user.is_active
            or not is_active_member
            or not active_roles.filter(role=entry.required_role).exists()
            or maximum_level < entry.required_level
        ):
            return Response(
                {"error": "You do not have the active role and level required for this queue."},
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
