# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.db import transaction
from django.db.models import Max
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions.crm import require_permission
from plane.app.services.access_control import has_permission
from plane.app.serializers import WorkspaceTaskSerializer
from plane.app.views.base import BaseAPIView
from plane.db.models import Workspace, WorkspaceTask


class WorkspaceTaskListEndpoint(BaseAPIView):
    @require_permission("Issue.View")
    def get(self, request, slug):
        tasks = WorkspaceTask.objects.filter(workspace__slug=slug).select_related("assignee")
        if not has_permission(request.user, slug, "Issue.ViewAll", request=request):
            tasks = tasks.filter(assignee=request.user)
        return Response(WorkspaceTaskSerializer(tasks, many=True).data, status=status.HTTP_200_OK)

    @require_permission("Issue.Create")
    def post(self, request, slug):
        with transaction.atomic():
            workspace = Workspace.objects.select_for_update().get(slug=slug)
            next_sequence = (
                WorkspaceTask.all_objects.filter(workspace=workspace).aggregate(value=Max("sequence_id"))["value"] or 0
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

    @require_permission("Issue.View")
    def patch(self, request, slug, task_id):
        task = self._task(slug, task_id)
        is_admin = has_permission(request.user, slug, "Issue.Edit", request=request)
        requested_fields = set(request.data.keys())
        if "status" in requested_fields and not has_permission(
            request.user, slug, "Issue.Status.Edit", request=request
        ):
            return Response({"error": "Status permission is required."}, status=403)
        if "assignee_id" in requested_fields and not has_permission(
            request.user, slug, "Issue.Assign", request=request
        ):
            return Response({"error": "Assignment permission is required."}, status=403)
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

    @require_permission("Issue.Delete")
    def delete(self, request, slug, task_id):
        self._task(slug, task_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
