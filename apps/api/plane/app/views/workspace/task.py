# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.db import transaction
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions.crm import require_permission
from plane.app.services.access_control import has_permission
from plane.app.serializers import WorkspaceTaskSerializer
from plane.app.services.crm_notifications import notify_workspace_task, task_snapshot
from plane.app.views.base import BaseAPIView
from plane.db.models import Workspace, WorkspaceTask
from plane.utils.issue_search import search_workspace_tasks


class WorkspaceTaskListEndpoint(BaseAPIView):
    @require_permission("Issue.View")
    def get(self, request, slug):
        tasks = WorkspaceTask.objects.filter(workspace__slug=slug).select_related("assignee")
        if not has_permission(request.user, slug, "Issue.ViewAll", request=request):
            tasks = tasks.filter(assignee=request.user)
        tasks = search_workspace_tasks(request.query_params.get("search", ""), tasks)
        return Response(WorkspaceTaskSerializer(tasks, many=True).data, status=status.HTTP_200_OK)

    @require_permission("Issue.Create")
    def post(self, request, slug):
        with transaction.atomic():
            workspace = Workspace.objects.get(slug=slug)
            serializer = WorkspaceTaskSerializer(
                data=request.data,
                context={"workspace_id": workspace.id},
            )
            serializer.is_valid(raise_exception=True)
            serializer.save(workspace=workspace)
            notify_workspace_task(serializer.instance, request.user.id)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class WorkspaceTaskDetailEndpoint(BaseAPIView):
    def _task(self, slug, task_id, lock=False):
        queryset = WorkspaceTask.objects.select_related("assignee")
        if lock:
            queryset = queryset.select_for_update()
        return queryset.get(
            workspace__slug=slug,
            id=task_id,
        )

    @require_permission("Issue.View")
    @transaction.atomic
    def patch(self, request, slug, task_id):
        task = self._task(slug, task_id, lock=True)
        previous = task_snapshot(task)
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
        notify_workspace_task(serializer.instance, request.user.id, previous)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @require_permission("Issue.Delete")
    def delete(self, request, slug, task_id):
        self._task(slug, task_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
