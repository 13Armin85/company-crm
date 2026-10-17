"""Personal task history, including completed, archived and transferred work."""

from django.db.models import BooleanField, Case, Exists, OuterRef, Prefetch, Q, Value, When
from rest_framework import serializers
from rest_framework.response import Response

from plane.app.permissions.crm import require_permission
from plane.app.services.project_visibility import visible_projects
from plane.app.serializers.user import UserLiteSerializer
from plane.app.serializers.state import StateSerializer
from plane.app.serializers.project import ProjectLiteSerializer
from plane.app.serializers.workspace_task import WorkspaceTaskSerializer
from plane.app.views.base import BaseAPIView
from plane.db.models import Issue, IssueActivity, IssueAssignee, Notification, WorkspaceTask, Project


class PersonalIssueSerializer(serializers.ModelSerializer):
    state_detail = StateSerializer(source="state", read_only=True)
    project_detail = ProjectLiteSerializer(source="project", read_only=True)
    created_by_detail = UserLiteSerializer(source="created_by", read_only=True)
    assignee_details = serializers.SerializerMethodField()
    was_assigned_to_me = serializers.BooleanField(read_only=True)
    archived = serializers.SerializerMethodField()

    class Meta:
        model = Issue
        fields = (
            "id", "name", "sequence_id", "project_id", "priority", "state_detail", "project_detail",
            "assignee_details", "created_by", "created_by_detail", "target_date", "completed_at",
            "created_at", "updated_at", "was_assigned_to_me", "archived",
        )
        read_only_fields = fields

    def get_assignee_details(self, issue):
        assignments = sorted(
            issue.current_assignments,
            key=lambda row: row.assignee_id != self.context["user_id"],
        )
        return UserLiteSerializer([row.assignee for row in assignments], many=True).data

    def get_archived(self, issue):
        return bool(issue.archived_at or issue.project.archived_at)


class TaskHistoryEndpoint(BaseAPIView):
    @require_permission("Issue.View")
    def get(self, request, slug):
        previous_assignments = IssueAssignee.all_objects.filter(
            workspace__slug=slug, issue_id=OuterRef("pk"), assignee=request.user,
        )
        assignment_events = IssueActivity.all_objects.filter(
            workspace__slug=slug, issue_id=OuterRef("pk"), field="assignees",
        ).filter(Q(old_identifier=request.user.id) | Q(new_identifier=request.user.id))
        issues = (
            Issue.objects.filter(workspace__slug=slug, project__deleted_at__isnull=True, is_draft=False)
            .filter(project_id__in=visible_projects(
                Project.objects.filter(workspace__slug=slug), request.user, slug,
            ).values("id"))
            .exclude(state__group="triage")
            .annotate(was_assigned_to_me=Exists(previous_assignments) | Exists(assignment_events))
            .filter(Q(was_assigned_to_me=True) | Q(created_by=request.user))
            .select_related("project", "state", "created_by")
            .prefetch_related(Prefetch(
                "issue_assignee", queryset=IssueAssignee.objects.select_related("assignee"),
                to_attr="current_assignments",
            ))
            .order_by("-created_at", "id")
        )
        # Assignment notifications are persisted independently of inbox read/archive
        # state. Looking at all rows also preserves history after an inbox deletion.
        task_events = Notification.all_objects.filter(
            workspace__slug=slug, receiver=request.user, entity_name="workspace_task",
            sender="crm:workspace_task", entity_identifier=OuterRef("pk"),
            data__issue_activity__field="assignees",
        ).filter(
            Q(data__issue_activity__new_identifier=str(request.user.id)) |
            Q(data__issue_activity__old_identifier=str(request.user.id))
        )
        tasks = (
            WorkspaceTask.objects.filter(workspace__slug=slug)
            .annotate(was_assigned_to_me=Case(
                When(assignee=request.user, then=Value(True)), default=Exists(task_events),
                output_field=BooleanField(),
            ))
            .filter(Q(was_assigned_to_me=True) | Q(created_by=request.user))
            .select_related("assignee", "created_by")
            .order_by("-created_at", "id")
        )
        # No date cutoff or first-page truncation: this endpoint is the user's
        # complete personal history, rather than the project work-item feed.
        return Response({
            "project_issues": PersonalIssueSerializer(issues, many=True, context={"user_id": request.user.id}).data,
            "workspace_tasks": WorkspaceTaskSerializer(tasks, many=True).data,
        }, headers={"Cache-Control": "private, no-store"})
