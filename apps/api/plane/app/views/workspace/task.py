# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.db import transaction
from django.db.models import Max
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import WorkspaceTaskSerializer
from plane.app.views.base import BaseAPIView
from plane.db.models import Workspace, WorkspaceMember, WorkspaceTask


class WorkspaceTaskListEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug):
        membership = WorkspaceMember.objects.get(
            workspace__slug=slug,
            member=request.user,
            is_active=True,
        )
        tasks = WorkspaceTask.objects.filter(workspace__slug=slug).select_related("assignee")
        if membership.role != ROLE.ADMIN.value:
            tasks = tasks.filter(assignee=request.user)
        return Response(WorkspaceTaskSerializer(tasks, many=True).data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def post(self, request, slug):
        with transaction.atomic():
            workspace = Workspace.objects.select_for_update().get(slug=slug)
            next_sequence = (
                WorkspaceTask.all_objects.filter(workspace=workspace).aggregate(value=Max("sequence_id"))["value"]
                or 0
            ) + 1
            serializer = WorkspaceTaskSerializer(
                data=request.data,
                context={"workspace_id": workspace.id},
            )
            serializer.is_valid(raise_exception=True)
            serializer.save(workspace=workspace, sequence_id=next_sequence)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class WorkspaceTaskDetailEndpoint(BaseAPIView):
    def _task(self, slug, task_id):
        return WorkspaceTask.objects.select_related("assignee").get(
            workspace__slug=slug,
            id=task_id,
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def patch(self, request, slug, task_id):
        task = self._task(slug, task_id)
        membership = WorkspaceMember.objects.get(
            workspace__slug=slug,
            member=request.user,
            is_active=True,
        )
        is_admin = membership.role == ROLE.ADMIN.value
        requested_fields = set(request.data.keys())
        if not is_admin:
            if task.assignee_id != request.user.id:
                return Response({"error": "این کار به شما واگذار نشده است."}, status=status.HTTP_403_FORBIDDEN)
            if requested_fields - {"status", "assignee_id"}:
                return Response(
                    {"error": "کاربر عادی فقط می‌تواند وضعیت یا مسئول کار خودش را تغییر دهد."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            if "assignee_id" in request.data and str(request.data["assignee_id"]) == str(request.user.id):
                return Response(
                    {"error": "برای انتقال کار، یک عضو دیگر تیم را انتخاب کنید."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        serializer = WorkspaceTaskSerializer(
            task,
            data=request.data,
            partial=True,
            context={"workspace_id": task.workspace_id},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def delete(self, request, slug, task_id):
        self._task(slug, task_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
