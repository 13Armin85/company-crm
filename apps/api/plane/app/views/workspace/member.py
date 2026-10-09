# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
import uuid
import re

from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import IntegrityError
from django.db.models import Count, Q, OuterRef, Subquery, IntegerField
from django.db.models.functions import Coalesce

# Third party modules
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import WorkspaceEntityPermission, allow_permission, ROLE
from plane.app.permissions.crm import require_permission, require_any_permission
from plane.app.services.access_control import has_permission, sync_plane_membership
from plane.app.services.access_mutations import access_transaction, audit_access, remove_workspace_user, sync_user_roles
from plane.db.models import OrganizationRole, UserOrganizationRole
from django.contrib.auth.password_validation import validate_password

# Module imports
from plane.app.serializers import (
    ProjectMemberRoleSerializer,
    WorkspaceMemberAdminSerializer,
    WorkspaceMemberMeSerializer,
    WorkSpaceMemberSerializer,
)
from plane.app.views.base import BaseAPIView
from plane.db.models import DraftIssue, Profile, Project, ProjectMember, User, Workspace, WorkspaceMember
from plane.utils.cache import invalidate_cache

from .. import BaseViewSet


class WorkSpaceMemberViewSet(BaseViewSet):
    serializer_class = WorkspaceMemberAdminSerializer
    model = WorkspaceMember

    search_fields = ["member__display_name", "member__first_name"]
    use_read_replica = True

    def get_queryset(self):
        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .select_related("member", "member__avatar_asset")
        )

    @require_permission("User.Create")
    def create(self, request, slug):
        email = str(request.data.get("email", "")).strip().lower()
        password = str(request.data.get("password", ""))
        display_name = str(request.data.get("display_name", "")).strip()
        username = str(request.data.get("username", "")).strip().lower()
        try:
            role = int(request.data.get("role", ROLE.MEMBER.value))
        except (TypeError, ValueError):
            return Response({"error": "نقش کاربر نامعتبر است"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            validate_email(email)
        except ValidationError:
            return Response({"error": "ایمیل معتبر وارد کنید"}, status=status.HTTP_400_BAD_REQUEST)
        if role not in [ROLE.MEMBER.value, ROLE.ADMIN.value]:
            return Response({"error": "نقش کاربر نامعتبر است"}, status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.filter(email=email).first()
        if WorkspaceMember.objects.filter(workspace__slug=slug, member=user, is_active=True).exists():
            return Response({"error": "این کاربر قبلاً عضو فضای کاری است"}, status=status.HTTP_400_BAD_REQUEST)
        if user is None and len(password) < 8:
            return Response(
                {"error": "رمز عبور حساب جدید باید حداقل ۸ نویسه باشد"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if user is None and username and not re.fullmatch(r"[a-z0-9_.-]{3,32}", username):
            return Response(
                {"error": "نام کاربری باید ۳ تا ۳۲ نویسه و فقط شامل حروف انگلیسی، عدد، نقطه، خط تیره یا زیرخط باشد"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if user is None and username and User.objects.filter(username__iexact=username).exists():
            return Response({"error": "این نام کاربری قبلاً انتخاب شده است"}, status=status.HTTP_400_BAD_REQUEST)

        workspace = Workspace.objects.get(slug=slug)
        role_ids = request.data.get("role_ids")
        if (role_ids is not None or role == ROLE.ADMIN.value) and not has_permission(
            request.user, workspace, "User.Role.Assign", request=request
        ):
            return Response({"error": "Role assignment permission is required."}, status=403)
        if user is None:
            try:
                validate_password(password, user=User(email=email, username=username))
            except ValidationError as exc:
                return Response({"password": exc.messages}, status=400)
        try:
            with access_transaction(workspace):
                if user is None:
                    user = User(
                        email=email,
                        username=username or f"u-{uuid.uuid4().hex[:24]}",
                        display_name=display_name or email.split("@", 1)[0],
                        is_email_verified=True,
                        is_managed=True,
                    )
                    user.set_password(password)
                    user.save()
                    Profile.objects.get_or_create(user=user)
                membership, _ = WorkspaceMember.objects.update_or_create(
                    workspace=workspace,
                    member=user,
                    defaults={"role": role, "is_active": True},
                )

                if role_ids is not None:
                    sync_user_roles(workspace, user, role_ids)
                elif (
                    not UserOrganizationRole.objects.filter(
                        workspace=workspace, user=user, is_active=True, role__is_active=True
                    ).exists()
                    or "role" in request.data
                ):
                    initial_role = OrganizationRole.objects.get(
                        workspace=workspace, system_key="admin" if role == ROLE.ADMIN.value else "member"
                    )
                    sync_user_roles(workspace, user, [initial_role.id])
                sync_plane_membership(workspace, user)
                audit_access(request, workspace, "user.create", user.id)
        except (ValidationError, IntegrityError) as exc:
            return Response(
                getattr(exc, "message_dict", {"error": getattr(exc, "messages", ["Invalid membership selection."])}),
                status=400,
            )
        return Response(WorkspaceMemberAdminSerializer(membership).data, status=status.HTTP_201_CREATED)

    @require_any_permission(
        "Issue.View",
        "User.View",
        "OrganizationUnit.Member.Manage",
        "OrganizationUnit.Manager.Assign",
        "OrganizationUnit.Delegate.Manage",
        "Absence.Create",
    )
    def list(self, request, slug):
        workspace_members = self.get_queryset().filter(member__is_bot=False)
        if not any(
            has_permission(request.user, slug, code, request=request)
            for code in (
                "User.View",
                "OrganizationUnit.Member.Manage",
                "OrganizationUnit.Manager.Assign",
                "OrganizationUnit.Delegate.Manage",
                "Absence.Create",
            )
        ):
            project_ids = ProjectMember.objects.filter(
                workspace__slug=slug, member=request.user, is_active=True
            ).values_list("project_id", flat=True)
            colleague_ids = ProjectMember.objects.filter(
                workspace__slug=slug, project_id__in=project_ids, is_active=True
            ).values_list("member_id", flat=True)
            workspace_members = workspace_members.filter(is_active=True, member__is_active=True)
            if not has_permission(request.user, slug, "Issue.Assign", request=request):
                workspace_members = workspace_members.filter(Q(member_id__in=colleague_ids) | Q(member=request.user))
        if has_permission(request.user, slug, "User.View", request=request):
            serializer = WorkspaceMemberAdminSerializer(workspace_members, fields=("id", "member", "role"), many=True)
        else:
            serializer = WorkSpaceMemberSerializer(workspace_members, fields=("id", "member", "role"), many=True)
        data = serializer.data
        if isinstance(data, list):
            assignments = UserOrganizationRole.objects.filter(
                workspace__slug=slug, is_active=True, role__is_active=True
            ).select_related("role")
            roles_by_user = {}
            for assignment in assignments:
                roles_by_user.setdefault(str(assignment.user_id), []).append(
                    {
                        "id": str(assignment.role_id),
                        "name": assignment.role.name,
                        "system_key": assignment.role.system_key,
                    }
                )
            memberships_by_user = {str(row.member_id): row for row in workspace_members}
            for row in data:
                user_id = str(row["member"]["id"])
                row["organization_roles"] = roles_by_user.get(user_id, [])
                row["is_active"] = (
                    memberships_by_user[user_id].is_active and memberships_by_user[user_id].member.is_active
                )
        return Response(data, status=status.HTTP_200_OK)

    @require_any_permission("Issue.View", "User.View")
    def retrieve(self, request, slug, pk):
        try:
            # Get the specific workspace member by pk
            member = self.get_queryset().get(pk=pk)
        except WorkspaceMember.DoesNotExist:
            return Response(
                {"error": "فضای کاری"},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not any(has_permission(request.user, slug, code, request=request) for code in ("User.View", "Issue.Assign")):
            project_ids = ProjectMember.objects.filter(
                workspace__slug=slug, member=request.user, is_active=True
            ).values_list("project_id", flat=True)
            if (
                member.member_id != request.user.id
                and not ProjectMember.objects.filter(
                    workspace__slug=slug, project_id__in=project_ids, member_id=member.member_id, is_active=True
                ).exists()
            ):
                return Response(status=404)
        if has_permission(request.user, slug, "User.View", request=request):
            serializer = WorkspaceMemberAdminSerializer(member, fields=("id", "member", "role"))
        else:
            serializer = WorkSpaceMemberSerializer(member, fields=("id", "member", "role"))
        return Response(serializer.data, status=status.HTTP_200_OK)

    @require_permission("User.Role.Assign")
    def partial_update(self, request, slug, pk):
        membership = self.get_queryset().get(pk=pk)
        workspace = membership.workspace
        ids = request.data.get("role_ids")
        if ids is None and "role" in request.data:
            try:
                numeric_role = int(request.data["role"])
            except (ValueError, TypeError):
                return Response({"role": ["Invalid role."]}, status=400)
            if numeric_role not in (15, 20):
                return Response({"role": ["Invalid role."]}, status=400)
            ids = list(
                OrganizationRole.objects.filter(
                    workspace=workspace, system_key="admin" if numeric_role == 20 else "member"
                ).values_list("id", flat=True)
            )
        if ids is None:
            return Response({"role_ids": ["Role identifiers are required."]}, status=400)
        try:
            with access_transaction(workspace):
                sync_user_roles(workspace, membership.member, ids)
                audit_access(
                    request,
                    workspace,
                    "user.roles",
                    membership.member_id,
                    changes={"role_ids": [role_id for role_id in ids]},
                )
        except ValidationError as exc:
            return Response(getattr(exc, "message_dict", {"error": exc.messages}), status=400)
        membership.refresh_from_db()
        return Response(WorkspaceMemberAdminSerializer(membership).data)

    @require_permission("User.Delete")
    def destroy(self, request, slug, pk):
        membership = self.get_queryset().get(pk=pk)
        try:
            with access_transaction(membership.workspace):
                remove_workspace_user(membership.workspace, membership.member)
                audit_access(request, membership.workspace, "user.remove", membership.member_id)
        except ValidationError as exc:
            return Response(getattr(exc, "message_dict", {"error": exc.messages}), status=400)
        return Response(status=204)

    @invalidate_cache(
        path="/api/workspaces/:slug/members/",
        url_params=True,
        user=False,
        multiple=True,
    )
    @invalidate_cache(path="/api/users/me/settings/")
    @invalidate_cache(path="api/users/me/workspaces/", user=False, multiple=True)
    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def leave(self, request, slug):
        membership = WorkspaceMember.objects.get(workspace__slug=slug, member=request.user, is_active=True)
        try:
            with access_transaction(membership.workspace):
                remove_workspace_user(membership.workspace, request.user)
                audit_access(request, membership.workspace, "user.leave", request.user.id)
        except ValidationError as exc:
            return Response(getattr(exc, "message_dict", {"error": exc.messages}), status=400)
        return Response(status=204)


class WorkspaceMemberUserViewsEndpoint(BaseAPIView):
    def post(self, request, slug):
        workspace_member = WorkspaceMember.objects.get(workspace__slug=slug, member=request.user, is_active=True)
        workspace_member.view_props = request.data.get("view_props", {})
        workspace_member.save()

        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkspaceMemberUserEndpoint(BaseAPIView):
    use_read_replica = True

    def get(self, request, slug):
        draft_issue_count = (
            DraftIssue.objects.filter(created_by=request.user, workspace_id=OuterRef("workspace_id"))
            .values("workspace_id")
            .annotate(count=Count("id"))
            .values("count")
        )

        workspace_member = (
            WorkspaceMember.objects.filter(member=request.user, workspace__slug=slug, is_active=True)
            .annotate(draft_issue_count=Coalesce(Subquery(draft_issue_count, output_field=IntegerField()), 0))
            .first()
        )
        serializer = WorkspaceMemberMeSerializer(workspace_member)
        return Response(serializer.data, status=status.HTTP_200_OK)


class WorkspaceProjectMemberEndpoint(BaseAPIView):
    serializer_class = ProjectMemberRoleSerializer
    model = ProjectMember

    permission_classes = [WorkspaceEntityPermission]

    def get(self, request, slug):
        is_workspace_admin = has_permission(request.user, slug, "Project.ViewAll", request=request)
        project_ids = (
            Project.objects.filter(workspace__slug=slug).values_list("id", flat=True)
            if is_workspace_admin
            else ProjectMember.objects.filter(workspace__slug=slug, member=request.user, is_active=True)
            .values_list("project_id", flat=True)
            .distinct()
        )

        # Get all the project members in which the user is involved
        project_members = ProjectMember.objects.filter(
            workspace__slug=slug, project_id__in=project_ids, is_active=True
        ).select_related("project", "member", "workspace")
        project_members = ProjectMemberRoleSerializer(project_members, many=True).data

        project_members_dict = dict()

        # Construct a dictionary with project_id as key and project_members as value
        for project_member in project_members:
            project_id = project_member.pop("project")
            if str(project_id) not in project_members_dict:
                project_members_dict[str(project_id)] = []
            project_members_dict[str(project_id)].append(project_member)

        return Response(project_members_dict, status=status.HTTP_200_OK)
