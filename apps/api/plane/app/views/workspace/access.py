"""Workspace-scoped access, password, absence and delegate APIs."""

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from plane.app.permissions.crm import require_permission
from plane.app.services.access_control import (
    get_effective_permissions,
    delegation_context,
    can_manage_absence,
    has_permission,
)
from plane.app.services.access_mutations import access_transaction, audit_access, remove_workspace_user
from plane.app.views.base import BaseAPIView
from plane.db.models import (
    Workspace,
    WorkspaceMember,
    User,
    OrganizationUnit,
    OrganizationUnitDelegate,
    UserAbsence,
    UserPermissionException,
)


def workspace_user(slug, user_id):
    workspace = get_object_or_404(Workspace, slug=slug)
    user = get_object_or_404(User, id=user_id, member_workspace__workspace=workspace)
    return workspace, user


def bad_request(exc):
    return Response(
        getattr(exc, "message_dict", {"error": getattr(exc, "messages", ["Invalid or duplicate selection."])}),
        status=400,
    )


class AccessMeEndpoint(BaseAPIView):
    def get(self, request, slug):
        workspace = get_object_or_404(Workspace, slug=slug)
        if not WorkspaceMember.objects.filter(
            workspace=workspace, member=request.user, is_active=True, member__is_active=True
        ).exists():
            raise PermissionDenied("Active workspace membership is required.")
        return Response(
            get_effective_permissions(request.user, workspace), headers={"Cache-Control": "private, no-store"}
        )


class EffectivePermissionsEndpoint(BaseAPIView):
    @require_permission("Access.EffectivePermission.View")
    def get(self, request, slug, user_id):
        workspace, user = workspace_user(slug, user_id)
        return Response(get_effective_permissions(user, workspace))


class PasswordSerializer(serializers.Serializer):
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)
    confirm_password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate(self, attrs):
        if attrs["new_password"] != attrs["confirm_password"]:
            raise serializers.ValidationError({"confirm_password": "Passwords do not match."})
        validate_password(attrs["new_password"], user=self.context["user"])
        return attrs


class OrganizationPasswordEndpoint(BaseAPIView):
    @require_permission("User.ChangePassword")
    def post(self, request, slug, user_id):
        workspace, user = workspace_user(slug, user_id)
        serializer = PasswordSerializer(data=request.data, context={"user": user})
        try:
            serializer.is_valid(raise_exception=True)
        except ValidationError as exc:
            return bad_request(exc)
        with transaction.atomic():
            user.set_password(serializer.validated_data["new_password"])
            user.save(update_fields=["password", "updated_at"])
            audit_access(request, workspace, "user.password_reset", user.id)
        return Response({"detail": "Password changed."})


class OrganizationRemoveUserEndpoint(BaseAPIView):
    @require_permission("User.Delete")
    def delete(self, request, slug, user_id):
        workspace, user = workspace_user(slug, user_id)
        try:
            with access_transaction(workspace):
                remove_workspace_user(workspace, user)
                audit_access(request, workspace, "user.remove", user.id)
        except ValidationError as exc:
            return bad_request(exc)
        return Response(status=204)


class ExceptionSerializer(serializers.ModelSerializer):
    permission_code = serializers.CharField(source="permission.code", read_only=True)

    class Meta:
        model = UserPermissionException
        fields = ("id", "permission", "permission_code", "effect", "starts_at", "ends_at", "is_active")
        read_only_fields = ("id",)


class UserExceptionListEndpoint(BaseAPIView):
    @require_permission("Access.UserException.View")
    def get(self, request, slug, user_id):
        workspace, user = workspace_user(slug, user_id)
        return Response(
            ExceptionSerializer(
                UserPermissionException.objects.filter(workspace=workspace, user=user).select_related("permission"),
                many=True,
            ).data
        )

    @require_permission("Access.UserException.Manage")
    def post(self, request, slug, user_id):
        workspace, user = workspace_user(slug, user_id)
        serializer = ExceptionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        row = UserPermissionException(workspace=workspace, user=user, **serializer.validated_data)
        try:
            with access_transaction(workspace):
                row.full_clean(exclude=["created_by", "updated_by"])
                row.save()
                audit_access(
                    request,
                    workspace,
                    "user.exception",
                    row.id,
                    changes={
                        "user_id": user.id,
                        "permission": row.permission.code,
                        "effect": row.effect,
                        "starts_at": row.starts_at,
                        "ends_at": row.ends_at,
                    },
                )
        except (ValidationError, IntegrityError) as exc:
            return bad_request(exc)
        return Response(ExceptionSerializer(row).data, status=201)


class UserExceptionDetailEndpoint(BaseAPIView):
    @require_permission("Access.UserException.Manage")
    def patch(self, request, slug, user_id, exception_id):
        workspace, user = workspace_user(slug, user_id)
        row = get_object_or_404(UserPermissionException, workspace=workspace, user=user, id=exception_id)
        serializer = ExceptionSerializer(row, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        try:
            with access_transaction(workspace):
                for field, value in serializer.validated_data.items():
                    setattr(row, field, value)
                row.full_clean(exclude=["created_by", "updated_by"])
                row.save()
                audit_access(
                    request,
                    workspace,
                    "user.exception_edit",
                    row.id,
                    changes={
                        "user_id": user.id,
                        "permission": row.permission.code,
                        "effect": row.effect,
                        "starts_at": row.starts_at,
                        "ends_at": row.ends_at,
                        "is_active": row.is_active,
                    },
                )
        except (ValidationError, IntegrityError) as exc:
            return bad_request(exc)
        return Response(ExceptionSerializer(row).data)

    @require_permission("Access.UserException.Manage")
    def delete(self, request, slug, user_id, exception_id):
        workspace, user = workspace_user(slug, user_id)
        row = get_object_or_404(UserPermissionException, workspace=workspace, user=user, id=exception_id)
        try:
            with access_transaction(workspace):
                row.is_active = False
                row.save(update_fields=["is_active", "updated_at"])
                audit_access(request, workspace, "user.exception_remove", row.id)
        except ValidationError as exc:
            return bad_request(exc)
        return Response(status=204)


class DelegateListSerializer(serializers.Serializer):
    user_ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=True)

    def validate_user_ids(self, ids):
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError("Duplicate delegates are not allowed.")
        return ids


class UnitDelegateEndpoint(BaseAPIView):
    def response(self, unit):
        return Response(
            {
                "delegates": [
                    {"id": row.id, "user_id": row.user_id, "name": row.user.display_name, "priority": row.priority}
                    for row in unit.delegates.filter(is_active=True).select_related("user")
                ],
                "active_delegation": delegation_context(unit.workspace_id).get(unit.id),
            }
        )

    @require_permission("OrganizationUnit.View")
    def get(self, request, slug, unit_id):
        unit = get_object_or_404(OrganizationUnit, id=unit_id, workspace__slug=slug)
        return self.response(unit)

    @require_permission("OrganizationUnit.Delegate.Manage")
    def put(self, request, slug, unit_id):
        unit = get_object_or_404(OrganizationUnit, id=unit_id, workspace__slug=slug)
        serializer = DelegateListSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                Workspace.objects.select_for_update().get(pk=unit.workspace_id)
                unit.delegates.filter(is_active=True).update(is_active=False)
                for priority, user_id in enumerate(serializer.validated_data["user_ids"], 1):
                    row = OrganizationUnitDelegate(unit=unit, user_id=user_id, priority=priority)
                    row.full_clean(exclude=["created_by", "updated_by"])
                    row.save()
                audit_access(
                    request,
                    unit.workspace,
                    "unit.delegates",
                    unit.id,
                    changes={"user_ids": serializer.validated_data["user_ids"]},
                )
        except (ValidationError, IntegrityError) as exc:
            return bad_request(exc)
        return self.response(unit)


class AbsenceSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source="user.display_name", read_only=True)
    current_status = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    can_end = serializers.SerializerMethodField()

    class Meta:
        model = UserAbsence
        fields = (
            "id",
            "user",
            "user_name",
            "starts_at",
            "ends_at",
            "reason",
            "status",
            "current_status",
            "can_edit",
            "can_end",
        )
        read_only_fields = ("id", "status")

    def get_can_edit(self, row):
        request = self.context.get("request")
        return bool(
            request
            and row.status == "scheduled"
            and can_manage_absence(request.user, row.user, row.workspace, "Absence.Edit", request=request)
        )

    def get_can_end(self, row):
        request = self.context.get("request")
        return bool(
            request
            and row.status == "scheduled"
            and can_manage_absence(request.user, row.user, row.workspace, "Absence.End", request=request)
        )

    def get_current_status(self, row):
        if row.status != "scheduled":
            return row.status
        now = timezone.now()
        return "upcoming" if now < row.starts_at else "ended" if now >= row.ends_at else "active"


class AbsenceListEndpoint(BaseAPIView):
    @require_permission("Absence.View")
    def get(self, request, slug):
        workspace = get_object_or_404(Workspace, slug=slug)
        rows = UserAbsence.objects.filter(workspace=workspace).select_related("user", "workspace")
        if not has_permission(request.user, workspace, "Absence.ManageAll", request=request):
            rows = [
                row
                for row in rows
                if row.user_id == request.user.id
                or can_manage_absence(request.user, row.user, workspace, "Absence.View", request=request)
            ]
        return Response(
            {
                "absences": AbsenceSerializer(rows, many=True, context={"request": request}).data,
                "manageable_user_ids": [
                    user.id
                    for user in User.objects.filter(
                        is_active=True,
                        member_workspace__workspace=workspace,
                        member_workspace__is_active=True,
                        member_workspace__deleted_at__isnull=True,
                    )
                    if can_manage_absence(request.user, user, workspace, "Absence.Create", request=request)
                ],
                "delegations": [
                    row
                    for row in delegation_context(workspace).values()
                    if has_permission(request.user, workspace, "Absence.ManageAll", request=request)
                    or row["user_id"] == request.user.id
                    or row["manager_id"] == request.user.id
                ],
            }
        )

    @require_permission("Absence.Create")
    def post(self, request, slug):
        workspace = get_object_or_404(Workspace, slug=slug)
        serializer = AbsenceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        row = UserAbsence(workspace=workspace, **serializer.validated_data)
        if not can_manage_absence(request.user, row.user, workspace, "Absence.Create", request=request):
            raise PermissionDenied("Only an ancestor manager or authorized administrator may record this absence.")
        try:
            with transaction.atomic():
                Workspace.objects.select_for_update().get(pk=workspace.pk)
                row.full_clean(exclude=["created_by", "updated_by"])
                row.save(created_by_id=request.user.id)
                audit_access(
                    request,
                    workspace,
                    "absence.create",
                    row.id,
                    changes={"user_id": row.user_id, "starts_at": row.starts_at, "ends_at": row.ends_at},
                )
        except (ValidationError, IntegrityError) as exc:
            return bad_request(exc)
        return Response(AbsenceSerializer(row).data, status=201)


class AbsenceDetailEndpoint(BaseAPIView):
    @require_permission("Absence.Edit")
    def patch(self, request, slug, absence_id):
        row = get_object_or_404(UserAbsence, id=absence_id, workspace__slug=slug)
        if not can_manage_absence(request.user, row.user, row.workspace, "Absence.Edit", request=request):
            raise PermissionDenied()
        if "user" in request.data:
            return Response({"user": ["The absence user cannot be changed."]}, status=400)
        serializer = AbsenceSerializer(row, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                Workspace.objects.select_for_update().get(pk=row.workspace_id)
                for field, value in serializer.validated_data.items():
                    setattr(row, field, value)
                row.full_clean(exclude=["created_by", "updated_by"])
                row.save()
                audit_access(
                    request,
                    row.workspace,
                    "absence.edit",
                    row.id,
                    changes={"user_id": row.user_id, "starts_at": row.starts_at, "ends_at": row.ends_at},
                )
        except (ValidationError, IntegrityError) as exc:
            return bad_request(exc)
        return Response(AbsenceSerializer(row).data)

    @require_permission("Absence.End")
    def delete(self, request, slug, absence_id):
        row = get_object_or_404(UserAbsence, id=absence_id, workspace__slug=slug)
        if not can_manage_absence(request.user, row.user, row.workspace, "Absence.End", request=request):
            raise PermissionDenied()
        with transaction.atomic():
            Workspace.objects.select_for_update().get(pk=row.workspace_id)
            row.status = "ended" if row.starts_at <= timezone.now() else "cancelled"
            row.save(update_fields=["status", "updated_at"])
            audit_access(request, row.workspace, "absence.end", row.id)
        return Response(status=204)
