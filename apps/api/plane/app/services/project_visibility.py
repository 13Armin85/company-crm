"""Project visibility follows active membership, with a CRM administrator override."""

from django.db.models import Exists, OuterRef

from plane.db.models import ProjectMember
from .task_policy import is_workspace_administrator


def visible_projects(queryset, user, workspace):
    if is_workspace_administrator(user, workspace):
        return queryset
    memberships = ProjectMember.objects.filter(
        project_id=OuterRef("pk"), member=user, is_active=True,
        workspace__slug=workspace,
    )
    return queryset.filter(Exists(memberships))
