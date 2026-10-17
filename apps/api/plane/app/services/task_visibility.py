from django.db.models import Q

from .access_control import has_permission
from .project_visibility import visible_projects
from plane.db.models import Project


def visible_issues(queryset, user, workspace, *, request=None):
    queryset = queryset.filter(project_id__in=visible_projects(
        Project.objects.filter(workspace__slug=workspace), user, workspace,
    ).values("id"))
    if has_permission(user, workspace, "Issue.ViewAll", request=request):
        return queryset
    return queryset.filter(
        Q(created_by=user) | Q(issue_assignee__assignee=user, issue_assignee__deleted_at__isnull=True)
        | Q(project__created_by=user) | Q(project__project_lead=user)
    ).distinct()
