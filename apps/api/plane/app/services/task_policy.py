"""Assignment rules shared by the app and public API."""

from functools import wraps
from uuid import UUID

from rest_framework.exceptions import ValidationError

from plane.db.models import UserOrganizationRole, WorkspaceMember, ProjectMember


def is_workspace_administrator(user, workspace):
    scope = {"workspace__slug": workspace} if isinstance(workspace, str) else {"workspace_id": getattr(workspace, "id", workspace)}
    return user.is_authenticated and user.is_active and (
        WorkspaceMember.objects.filter(member=user, is_active=True, **scope).exists()
        and UserOrganizationRole.objects.filter(
            user=user, is_active=True, role__system_key="admin", role__is_active=True,
            role__deleted_at__isnull=True, **scope,
        ).exists()
    )


def validate_other_assignees(user, workspace, assignee_ids):
    if not user or not user.is_authenticated or is_workspace_administrator(user, workspace):
        return
    for value in assignee_ids:
        try:
            identifier = UUID(str(getattr(value, "id", value)))
        except (ValueError, TypeError, AttributeError):
            continue  # The field serializer reports invalid identifiers.
        if identifier == user.id:
            raise ValidationError({"assignee_id": "You cannot assign a task to yourself. Select another team member."})


def validate_creation_assignees(user, slug, data, *, project_id=None, assignee_field="assignee_ids", allow_routing=False):
    if is_workspace_administrator(user, slug):
        return
    supplied = data.get(assignee_field)
    recipients = supplied if isinstance(supplied, list) else [supplied] if supplied else []
    if not recipients and not (allow_routing and data.get("routing_rule_id")):
        raise ValidationError({"assignee_id": "Select another active team member to receive this task."})
    if recipients and project_id:
        eligible = ProjectMember.objects.filter(
            workspace__slug=slug, project_id=project_id, member_id__in=recipients,
            is_active=True, member__is_active=True, role__gte=15,
        ).count()
        if eligible != len(set(map(str, recipients))):
            raise ValidationError({"assignee_id": "Select an active member of this project."})


def other_assignees_only(*, creating=False, assignee_field="assignee_ids", allow_routing=False):
    def decorator(handler):
        @wraps(handler)
        def wrapped(view, request, *args, **kwargs):
            slug = kwargs["slug"]
            values = []
            for field in ("assignee_id", "assignee_ids", "assignees"):
                value = request.data.get(field)
                if value is not None:
                    values.extend(value if isinstance(value, list) else [value])
            validate_other_assignees(request.user, slug, values)
            if creating:
                validate_creation_assignees(
                    request.user, slug, request.data, project_id=kwargs.get("project_id"),
                    assignee_field=assignee_field, allow_routing=allow_routing,
                )
            return handler(view, request, *args, **kwargs)
        return wrapped
    return decorator
