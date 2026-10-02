# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
import uuid
import re

from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.db.models import Count, Q, OuterRef, Subquery, IntegerField
from django.utils import timezone
from django.db.models.functions import Coalesce

# Third party modules
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import WorkspaceEntityPermission, allow_permission, ROLE

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

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
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

        with transaction.atomic():
            workspace = Workspace.objects.get(slug=slug)
            if user is None:
                user = User(
                    email=email,
                    username=username or f"workspace-user-{uuid.uuid4().hex}",
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

        return Response(WorkspaceMemberAdminSerializer(membership).data, status=status.HTTP_201_CREATED)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def list(self, request, slug):
        workspace_member = WorkspaceMember.objects.get(member=request.user, workspace__slug=slug, is_active=True)

        workspace_members = self.get_queryset().filter(is_active=True, member__is_bot=False)
        if workspace_member.role == ROLE.ADMIN.value:
            serializer = WorkspaceMemberAdminSerializer(workspace_members, fields=("id", "member", "role"), many=True)
        else:
            serializer = WorkSpaceMemberSerializer(workspace_members, fields=("id", "member", "role"), many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def retrieve(self, request, slug, pk):
        workspace_member = WorkspaceMember.objects.get(member=request.user, workspace__slug=slug, is_active=True)

        try:
            # Get the specific workspace member by pk
            member = self.get_queryset().get(pk=pk)
        except WorkspaceMember.DoesNotExist:
            return Response(
                {"error": "فضای کاری"},
                status=status.HTTP_404_NOT_FOUND,
            )

        if workspace_member.role > ROLE.GUEST.value:
            serializer = WorkspaceMemberAdminSerializer(member, fields=("id", "member", "role"))
        else:
            serializer = WorkSpaceMemberSerializer(member, fields=("id", "member", "role"))
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def partial_update(self, request, slug, pk):
        if "role" in request.data:
            try:
                role = int(request.data["role"])
            except (TypeError, ValueError):
                return Response({"error": "نقش کاربر نامعتبر است"}, status=status.HTTP_400_BAD_REQUEST)
            if role not in [ROLE.MEMBER.value, ROLE.ADMIN.value]:
                return Response({"error": "نقش باید مدیر یا کاربر عادی باشد"}, status=status.HTTP_400_BAD_REQUEST)

        workspace_member = WorkspaceMember.objects.get(
            pk=pk, workspace__slug=slug, member__is_bot=False, is_active=True
        )
        if request.user.id == workspace_member.member_id:
            return Response(
                {"error": "نمی‌توانید نقش خود را به‌روز کنید"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = WorkSpaceMemberSerializer(workspace_member, data=request.data, partial=True)

        if serializer.is_valid():
            serializer.save()
            if "role" in request.data:
                ProjectMember.objects.filter(
                    workspace__slug=slug,
                    member_id=workspace_member.member_id,
                    is_active=True,
                ).update(role=role, updated_at=timezone.now())
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def destroy(self, request, slug, pk):
        # Check the user role who is deleting the user
        workspace_member = WorkspaceMember.objects.get(
            workspace__slug=slug, pk=pk, member__is_bot=False, is_active=True
        )

        # check requesting user role
        requesting_workspace_member = WorkspaceMember.objects.get(
            workspace__slug=slug, member=request.user, is_active=True
        )

        if str(workspace_member.id) == str(requesting_workspace_member.id):
            return Response(
                {"error": "نمی‌توانید خودتان را از فضای کاری حذف کنید. لطفاً از گزینه ترک فضای کاری استفاده کنید"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if requesting_workspace_member.role < workspace_member.role:
            return Response(
                {"error": "نمی‌توانید کاربری را که نقش بالاتر از شماست، حذف کنید"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if (
            Project.objects.annotate(
                total_members=Count("project_projectmember"),
                member_with_role=Count(
                    "project_projectmember",
                    filter=Q(
                        project_projectmember__member_id=workspace_member.id,
                        project_projectmember__role=20,
                    ),
                ),
            )
            .filter(total_members=1, member_with_role=1, workspace__slug=slug)
            .exists()
        ):
            return Response(
                {
                    "error": "کاربر در برخی پروژه‌ها عضو است که در آن‌ها تنها مدیر است؛ باید از آن پروژه خارج شود یا کاربر دیگری را به مدیریت تفویض کند."  # noqa: E501
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Deactivate the users from the projects where the user is part of
        _ = ProjectMember.objects.filter(
            workspace__slug=slug, member_id=workspace_member.member_id, is_active=True
        ).update(is_active=False, updated_at=timezone.now())

        workspace_member.is_active = False
        workspace_member.save()

        # Accounts created by workspace administrators are lifecycle-managed by
        # the application. Once their final membership is removed, anonymize
        # login identifiers so the username/email can safely be reused while
        # historical issue and audit foreign keys remain intact.
        user = workspace_member.member
        if user.is_managed and not WorkspaceMember.objects.filter(member=user, is_active=True).exists():
            tombstone = uuid.uuid4().hex
            user.username = f"deleted-{tombstone}"
            user.email = f"deleted-{tombstone}@invalid.local"
            user.is_active = False
            user.set_unusable_password()
            user.save(update_fields=["username", "email", "is_active", "password", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)

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
        workspace_member = WorkspaceMember.objects.get(workspace__slug=slug, member=request.user, is_active=True)

        # Check if the leaving user is the only admin of the workspace
        if (
            workspace_member.role == 20
            and not WorkspaceMember.objects.filter(workspace__slug=slug, role=20, is_active=True).count() > 1
        ):
            return Response(
                {
                    "error": "نمی‌توانید فضای کاری را ترک کنید، چون شما تنها مدیر فضای کاری هستید. شما باید فضای کاری را حذف کنید یا کاربر دیگری را به مدیریت ارتقا دهید."  # noqa: E501
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if (
            Project.objects.annotate(
                total_members=Count("project_projectmember"),
                member_with_role=Count(
                    "project_projectmember",
                    filter=Q(
                        project_projectmember__member_id=request.user.id,
                        project_projectmember__role=20,
                    ),
                ),
            )
            .filter(total_members=1, member_with_role=1, workspace__slug=slug)
            .exists()
        ):
            return Response(
                {
                    "error": "شما در برخی پروژه‌هایی که عضو ادمن تنها هستید، باید از پروژه خارج شوید یا کاربر دیگری را به ادمنیت تفویض کنید."  # noqa: E501
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # # Deactivate the users from the projects where the user is part of
        _ = ProjectMember.objects.filter(
            workspace__slug=slug, member_id=workspace_member.member_id, is_active=True
        ).update(is_active=False, updated_at=timezone.now())

        # # Deactivate the user
        workspace_member.is_active = False
        workspace_member.save()
        return Response(status=status.HTTP_204_NO_CONTENT)


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
        is_workspace_admin = WorkspaceMember.objects.filter(
            workspace__slug=slug,
            member=request.user,
            role=ROLE.ADMIN.value,
            is_active=True,
        ).exists()
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
