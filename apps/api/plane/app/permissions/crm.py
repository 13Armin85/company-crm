from functools import wraps

from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission, SAFE_METHODS

from plane.app.services.access_control import has_permission
from plane.authentication.session import BaseSessionAuthentication
from plane.db.models import WorkspaceMember, ProjectMember, Project


class WorkspaceScopePermission(BasePermission):
    """Membership scope only; action permissions are checked by the shared engine."""

    def has_permission(self, request, view):
        return (
            request.user.is_authenticated
            and request.user.is_active
            and WorkspaceMember.objects.filter(
                workspace__slug=view.kwargs.get("slug"), member=request.user, is_active=True
            ).exists()
        )


class ProjectScopePermission(WorkspaceScopePermission):
    """Keep project isolation without treating Plane's stored numeric role as a grant."""

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        slug = view.kwargs["slug"]
        project_id = view.kwargs.get("project_id") or view.kwargs.get("pk")
        if view.kwargs.get("project_identifier"):
            project_id = (
                Project.objects.filter(workspace__slug=slug, identifier=view.kwargs["project_identifier"])
                .values_list("id", flat=True)
                .first()
            )
            if project_id is None:
                return False
        if not project_id:
            return True
        if getattr(view, "allow_workspace_project_access", False) and has_permission(
            request.user, slug, "Project.ViewAll", request=request
        ):
            return Project.objects.filter(workspace__slug=slug, id=project_id).exists()
        if ProjectMember.objects.filter(
            workspace__slug=slug, project_id=project_id, member=request.user, is_active=True
        ).exists():
            return True
        return (
            getattr(view, "allow_public_project_access", False)
            and request.method in SAFE_METHODS
            and Project.objects.filter(workspace__slug=slug, id=project_id, network=2).exists()
        )


def require_permission(*codes):
    def decorator(view_func):
        @wraps(view_func)
        def wrapped(instance, request, *args, **kwargs):
            if isinstance(request.successful_authenticator, BaseSessionAuthentication):
                SessionAuthentication().enforce_csrf(request)
            if not all(has_permission(request.user, kwargs["slug"], code, request=request) for code in codes):
                raise PermissionDenied("You do not have permission for this action.")
            response = view_func(instance, request, *args, **kwargs)
            response["Cache-Control"] = "private, no-store"
            return response

        return wrapped

    return decorator


def require_any_permission(*codes):
    def decorator(view_func):
        @wraps(view_func)
        def wrapped(instance, request, *args, **kwargs):
            if isinstance(request.successful_authenticator, BaseSessionAuthentication):
                SessionAuthentication().enforce_csrf(request)
            if not any(has_permission(request.user, kwargs["slug"], code, request=request) for code in codes):
                raise PermissionDenied("You do not have permission for this action.")
            response = view_func(instance, request, *args, **kwargs)
            response["Cache-Control"] = "private, no-store"
            return response

        return wrapped

    return decorator
