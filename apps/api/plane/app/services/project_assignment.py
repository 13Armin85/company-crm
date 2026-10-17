"""Project owners can reassign project work without editing other people's status."""

from uuid import UUID

from django.db.models import Q
from rest_framework.exceptions import ValidationError

from plane.db.models import Project, ProjectMember, WorkspaceMember
from .task_policy import is_workspace_administrator


def is_project_assignment_manager(user, slug, project_id):
    if is_workspace_administrator(user, slug):
        return True
    return (
        WorkspaceMember.objects.filter(workspace__slug=slug, member=user, is_active=True).exists()
        and ProjectMember.objects.filter(workspace__slug=slug, project_id=project_id, member=user, is_active=True).exists()
        and Project.objects.filter(workspace__slug=slug, pk=project_id)
        .filter(Q(created_by=user) | Q(project_lead=user)).exists()
    )


def validate_project_transfer(slug, project_id, recipients):
    if not isinstance(recipients, list) or len(recipients) != 1:
        raise ValidationError({"assignees": "Select exactly one active project member."})
    try:
        recipient_id = UUID(str(recipients[0]))
    except (ValueError, TypeError, AttributeError) as exc:
        raise ValidationError({"assignees": "Invalid recipient identifier."}) from exc
    active_members = WorkspaceMember.objects.filter(
        workspace__slug=slug, is_active=True, member__is_active=True, member__is_bot=False,
    ).values("member_id")
    if not ProjectMember.objects.filter(
        workspace__slug=slug, project_id=project_id, member_id=recipient_id,
        member_id__in=active_members, is_active=True, role__gte=15,
    ).exists():
        raise ValidationError({"assignees": "The recipient must be an active member of this project."})
