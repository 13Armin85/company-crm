# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third Party imports
from rest_framework.response import Response
from rest_framework import status
from django.db.models import Min

# Module imports
from .base import BaseViewSet, BaseAPIView
from plane.app.serializers import (
    ProjectMemberSerializer,
    ProjectMemberAdminSerializer,
    ProjectMemberRoleSerializer,
    ProjectMemberPreferenceSerializer,
)

from plane.app.permissions import WorkspaceUserPermission

from plane.db.models import Project, ProjectMember, ProjectUserProperty, WorkspaceMember
from plane.bgtasks.project_add_user_email_task import project_add_user_email
from plane.utils.host import base_host
from plane.app.permissions.base import allow_permission, ROLE


class ProjectMemberViewSet(BaseViewSet):
    serializer_class = ProjectMemberAdminSerializer
    model = ProjectMember

    search_fields = ["member__display_name", "member__first_name"]

    def get_queryset(self):
        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(member__is_bot=False)
            .filter()
            .select_related("project")
            .select_related("member")
            .select_related("workspace", "workspace__owner")
        )

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def create(self, request, slug, project_id):
        # Get the list of members to be added to the project and their roles i.e. the user_id and the role
        members = request.data.get("members", [])

        # get the project
        project = Project.objects.get(pk=project_id, workspace__slug=slug)

        # Check if the members array is empty
        if not len(members):
            return Response(
                {"error": "حداقل یک عضو الزامی است"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Initialize the bulk arrays
        bulk_project_members = []
        bulk_issue_props = []

        member_ids = [str(member.get("member_id")) for member in members if member.get("member_id")]
        workspace_roles = {
            str(member_id): role
            for member_id, role in WorkspaceMember.objects.filter(
                workspace__slug=slug,
                member_id__in=member_ids,
                is_active=True,
            ).values_list("member_id", "role")
        }
        if len(workspace_roles) != len(set(member_ids)):
            return Response(
                {"error": "همه کاربران انتخاب‌شده باید عضو فعال شرکت باشند"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Project roles mirror the authoritative two-role company model.
        member_roles = {
            member_id: ROLE.ADMIN.value if workspace_roles[member_id] == ROLE.ADMIN.value else ROLE.MEMBER.value
            for member_id in member_ids
        }

        # Update roles in the members array based on the member_roles dictionary and set is_active to True
        for project_member in ProjectMember.objects.filter(
            project_id=project_id,
            member_id__in=[member.get("member_id") for member in members],
        ):
            project_member.role = member_roles[str(project_member.member_id)]
            project_member.is_active = True
            bulk_project_members.append(project_member)

        # Update the roles of the existing members
        ProjectMember.objects.bulk_update(bulk_project_members, ["is_active", "role"], batch_size=100)

        # Get the minimum sort_order for each member in the workspace
        member_sort_orders = (
            ProjectUserProperty.objects.filter(
                workspace__slug=slug,
                user_id__in=[member.get("member_id") for member in members],
            )
            .values("user_id")
            .annotate(min_sort_order=Min("sort_order"))
        )
        # Convert to dictionary for easy lookup: {user_id: min_sort_order}
        sort_order_map = {str(item["user_id"]): item["min_sort_order"] for item in member_sort_orders}

        # Loop through requested members
        for member in members:
            member_id = str(member.get("member_id"))
            # Get the minimum sort_order for this member, or use default
            min_sort_order = sort_order_map.get(member_id)
            # Create a new project member
            bulk_project_members.append(
                ProjectMember(
                    member_id=member.get("member_id"),
                    role=member_roles[member_id],
                    project_id=project_id,
                    workspace_id=project.workspace_id,
                )
            )
            # Create a new issue property
            bulk_issue_props.append(
                ProjectUserProperty(
                    user_id=member.get("member_id"),
                    project_id=project_id,
                    workspace_id=project.workspace_id,
                    sort_order=(min_sort_order - 10000 if min_sort_order is not None else 65535),
                )
            )

        # Bulk create the project members and issue properties
        project_members = ProjectMember.objects.bulk_create(bulk_project_members, batch_size=10, ignore_conflicts=True)

        _ = ProjectUserProperty.objects.bulk_create(bulk_issue_props, batch_size=10, ignore_conflicts=True)

        project_members = ProjectMember.objects.filter(
            project_id=project_id,
            member_id__in=[member.get("member_id") for member in members],
        )
        # Send emails to notify the users
        [
            project_add_user_email.delay(
                base_host(request=request, is_app=True),
                project_member.id,
                request.user.id,
            )
            for project_member in project_members
        ]
        # Serialize the project members
        serializer = ProjectMemberRoleSerializer(project_members, many=True)
        # Return the serialized data
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def list(self, request, slug, project_id):
        # Get the list of project members for the project
        project_members = ProjectMember.objects.filter(
            project_id=project_id,
            workspace__slug=slug,
            member__is_bot=False,
            is_active=True,
            member__member_workspace__workspace__slug=slug,
            member__member_workspace__is_active=True,
        ).select_related("project", "member", "workspace")

        serializer = ProjectMemberRoleSerializer(project_members, fields=("id", "member", "role"), many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def retrieve(self, request, slug, project_id, pk):
        requesting_project_member = ProjectMember.objects.filter(
            project_id=project_id,
            workspace__slug=slug,
            member=request.user,
            is_active=True,
        ).first()

        project_member = (
            ProjectMember.objects.filter(
                pk=pk,
                project_id=project_id,
                workspace__slug=slug,
                member__is_bot=False,
                is_active=True,
            )
            .select_related("project", "member", "workspace")
            .first()
        )

        if not project_member:
            return Response(
                {"error": "عضو پروژه پیدا نشد"},
                status=status.HTTP_404_NOT_FOUND,
            )

        if WorkspaceMember.objects.filter(
            workspace__slug=slug,
            member=request.user,
            role=ROLE.ADMIN.value,
            is_active=True,
        ).exists() or (requesting_project_member and requesting_project_member.role > ROLE.GUEST.value):
            serializer = ProjectMemberAdminSerializer(project_member)
        else:
            serializer = ProjectMemberRoleSerializer(project_member, fields=("id", "member", "role"))

        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def partial_update(self, request, slug, project_id, pk):
        project_member = ProjectMember.objects.get(pk=pk, workspace__slug=slug, project_id=project_id, is_active=True)

        # Fetch the target's workspace role (used to cap the new project role)
        target_workspace_role = WorkspaceMember.objects.get(
            workspace__slug=slug, member=project_member.member, is_active=True
        ).role
        # Fetch the requester's workspace role to decide if they may bypass project-role checks
        requester_workspace_role = WorkspaceMember.objects.get(
            workspace__slug=slug, member=request.user, is_active=True
        ).role
        is_workspace_admin = requester_workspace_role == ROLE.ADMIN.value

        # Check if the user is not editing their own role if they are not an admin
        if request.user.id == project_member.member_id and not is_workspace_admin:
            return Response(
                {"error": "نمی‌توانید نقش خود را به‌روز کنید"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Check while updating user roles
        requested_project_member = ProjectMember.objects.filter(
            project_id=project_id,
            workspace__slug=slug,
            member=request.user,
            is_active=True,
        ).first()
        requester_project_role = requested_project_member.role if requested_project_member else ROLE.ADMIN.value

        if "role" in request.data:
            # Only Admins can modify roles
            if requester_project_role < ROLE.ADMIN.value and not is_workspace_admin:
                return Response(
                    {"error": "مجوز به‌روزرسانی نقش‌ها را ندارید"},
                    status=status.HTTP_403_FORBIDDEN,
                )

            # Cannot modify a member whose role is equal to or higher than your own
            if project_member.role >= requester_project_role and not is_workspace_admin:
                return Response(
                    {"error": "نمی‌توانید نقش عضوی را که برابر یا بالاتر از نقش شماست، به‌روز کنید"},
                    status=status.HTTP_403_FORBIDDEN,
                )

            new_role = int(request.data.get("role"))

            # Cannot assign a role equal to or higher than your own
            if new_role >= requester_project_role and not is_workspace_admin:
                return Response(
                    {"error": "نمی‌توانید نقشی برابر یا بالاتر از نقش خود را اختصاص دهید"},
                    status=status.HTTP_403_FORBIDDEN,
                )

            # Cannot assign a role higher than the target's workspace role
            if target_workspace_role in [5] and new_role in [15, 20]:
                return Response(
                    {"error": "نمی‌توانید کاربری با نقش بالاتر از نقش فضای کاری اضافه کنید"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # Guard privileged `is_active` mutations (member (de)activation). These are NOT
        # covered by the role block above, so without this check a GUEST could PATCH
        # {"is_active": false} while omitting "role" to deactivate any member — including
        # admins — and take over the project. Mirror the role block and destroy(): only a
        # project admin (or workspace admin) may (de)activate a member, and never one whose
        # role is equal to or higher than the requester's own.
        if "is_active" in request.data:
            if requester_project_role < ROLE.ADMIN.value and not is_workspace_admin:
                return Response(
                    {"error": "مجوز به‌روزرسانی وضعیت عضو را ندارید"},
                    status=status.HTTP_403_FORBIDDEN,
                )

            if project_member.role >= requester_project_role and not is_workspace_admin:
                return Response(
                    {"error": "نمی‌توانید وضعیت عضوی را که برابر یا بالاتر از نقش شماست، به‌روز کنید"},
                    status=status.HTTP_403_FORBIDDEN,
                )

        update_data = request.data.copy()
        if "role" in update_data:
            update_data["role"] = (
                ROLE.ADMIN.value if target_workspace_role == ROLE.ADMIN.value else ROLE.MEMBER.value
            )
        serializer = ProjectMemberSerializer(project_member, data=update_data, partial=True)

        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def destroy(self, request, slug, project_id, pk):
        project_member = ProjectMember.objects.get(
            workspace__slug=slug,
            project_id=project_id,
            pk=pk,
            member__is_bot=False,
            is_active=True,
        )
        # check requesting user role
        requesting_project_member = ProjectMember.objects.filter(
            workspace__slug=slug,
            member=request.user,
            project_id=project_id,
            is_active=True,
        ).first()
        is_workspace_admin = WorkspaceMember.objects.filter(
            workspace__slug=slug,
            member=request.user,
            role=ROLE.ADMIN.value,
            is_active=True,
        ).exists()
        # User cannot remove himself
        if requesting_project_member and str(project_member.id) == str(requesting_project_member.id):
            return Response(
                {"error": "نمی‌توانید خودتان را از فضای کاری حذف کنید. لطفاً از گزینه ترک فضای کاری استفاده کنید"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # User cannot deactivate higher role
        if not is_workspace_admin and (
            requesting_project_member is None or requesting_project_member.role < project_member.role
        ):
            return Response(
                {"error": "نمی‌توانید کاربری را که نقش بالاتر از شماست، حذف کنید"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        project_member.is_active = False
        project_member.save()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def leave(self, request, slug, project_id):
        project_member = ProjectMember.objects.get(
            workspace__slug=slug,
            project_id=project_id,
            member=request.user,
            is_active=True,
        )

        # Check if the leaving user is the only admin of the project
        if (
            project_member.role == 20
            and not ProjectMember.objects.filter(
                workspace__slug=slug, project_id=project_id, role=20, is_active=True
            ).count()
            > 1
        ):
            return Response(
                {
                    "error": "نمی‌توانید از پروژه خارج شوید زیرا تنها مدیر پروژه هستید. باید پروژه را حذف کنید یا یک مدیر دیگر ایجاد کنید"  # noqa: E501
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Deactivate the user
        project_member.is_active = False
        project_member.save()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProjectMemberUserEndpoint(BaseAPIView):
    def get(self, request, slug, project_id):
        project_member = ProjectMember.objects.get(
            project_id=project_id,
            workspace__slug=slug,
            member=request.user,
            is_active=True,
        )
        serializer = ProjectMemberSerializer(project_member)

        return Response(serializer.data, status=status.HTTP_200_OK)


class UserProjectRolesEndpoint(BaseAPIView):
    permission_classes = [WorkspaceUserPermission]
    use_read_replica = True

    def get(self, request, slug):
        project_members = ProjectMember.objects.filter(
            workspace__slug=slug,
            member_id=request.user.id,
            is_active=True,
            member__member_workspace__workspace__slug=slug,
            member__member_workspace__is_active=True,
        ).values("project_id", "role")

        project_members = {str(member["project_id"]): member["role"] for member in project_members}
        return Response(project_members, status=status.HTTP_200_OK)


class ProjectMemberPreferenceEndpoint(BaseAPIView):
    def get_queryset(self, slug, project_id, member_id):
        return ProjectMember.objects.get(
            project_id=project_id,
            member_id=member_id,
            workspace__slug=slug,
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def patch(self, request, slug, project_id, member_id):
        project_member = self.get_queryset(slug, project_id, member_id)

        serializer = ProjectMemberPreferenceSerializer(project_member, {"preferences": request.data}, partial=True)

        if serializer.is_valid():
            serializer.save()

            return Response({"preferences": serializer.data["preferences"]}, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, member_id):
        project_member = self.get_queryset(slug, project_id, member_id)

        serializer = ProjectMemberPreferenceSerializer(project_member)

        return Response(serializer.data, status=status.HTTP_200_OK)
