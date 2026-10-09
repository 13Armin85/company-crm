"""Single source of truth for CRM authorization and temporary substitution."""

from django.core.exceptions import ValidationError
from django.db.models import Q
from django.utils import timezone

from plane.db.models import (
    OrganizationPermission,
    OrganizationUnit,
    OrganizationUnitMember,
    ProjectMember,
    RolePermission,
    UserAbsence,
    UserOrganizationRole,
    UserPermissionException,
    Workspace,
    WorkspaceMember,
)
from .permission_registry import PERMISSION_REGISTRY


def active_period(queryset, now):
    return queryset.filter(Q(starts_at__isnull=True) | Q(starts_at__lte=now)).filter(
        Q(ends_at__isnull=True) | Q(ends_at__gt=now)
    )


def role_permissions(user_id, workspace_id):
    return (
        RolePermission.objects.filter(
            role__workspace_id=workspace_id,
            role__is_active=True,
            role__deleted_at__isnull=True,
            role__user_roles__user_id=user_id,
            role__user_roles__workspace_id=workspace_id,
            role__user_roles__is_active=True,
            role__user_roles__deleted_at__isnull=True,
            permission__workspace_id=workspace_id,
            permission__is_active=True,
            permission__deleted_at__isnull=True,
            permission__code__in=PERMISSION_REGISTRY,
        )
        .values("permission__code", "permission__is_delegatable", "role_id", "role__name")
        .distinct()
    )


def delegation_context(workspace, now=None):
    """Resolve all substitutions in batches; no transitive or exception inheritance."""
    now = now or timezone.now()
    workspace_id = getattr(workspace, "id", workspace)
    absences = {
        row.user_id: row
        for row in UserAbsence.objects.filter(
            workspace_id=workspace_id, status="scheduled", starts_at__lte=now, ends_at__gt=now
        )
    }
    members = set(
        WorkspaceMember.objects.filter(workspace_id=workspace_id, is_active=True, member__is_active=True).values_list(
            "member_id", flat=True
        )
    )
    result = {}
    units = (
        OrganizationUnit.objects.filter(workspace_id=workspace_id, is_active=True, manager_id__in=absences)
        .select_related("manager")
        .prefetch_related("delegates__user")
    )
    for unit in units:
        if unit.manager_id not in members:
            continue
        for delegate in unit.delegates.all():
            if (
                delegate.deleted_at is None
                and delegate.is_active
                and delegate.user_id in members
                and delegate.user_id not in absences
                and delegate.user_id != unit.manager_id
            ):
                absence = absences[unit.manager_id]
                result[unit.id] = {
                    "unit_id": str(unit.id),
                    "unit_name": unit.title,
                    "manager_id": unit.manager_id,
                    "manager_name": unit.manager.display_name or unit.manager.username,
                    "user_id": delegate.user_id,
                    "user_name": delegate.user.display_name or delegate.user.username,
                    "reason": absence.reason,
                    "starts_at": absence.starts_at,
                    "ends_at": absence.ends_at,
                }
                break
    return result


def get_effective_permissions(user, workspace, *, now=None, include_delegation=True):
    workspace_id = getattr(workspace, "id", workspace)
    now = now or timezone.now()
    if (
        not user.is_authenticated
        or not user.is_active
        or not WorkspaceMember.objects.filter(workspace_id=workspace_id, member=user, is_active=True).exists()
    ):
        return {"permissions": [], "explanations": []}
    catalog = list(
        OrganizationPermission.objects.filter(
            workspace_id=workspace_id, is_active=True, code__in=PERMISSION_REGISTRY
        ).values("id", "code", "name", "category")
    )
    sources = {}
    for row in role_permissions(user.id, workspace_id):
        entry = sources.setdefault(row["permission__code"], {"source": "role", "role_ids": []})
        entry["role_ids"].append(str(row["role_id"]))
        entry.setdefault("role_names", []).append(row["role__name"])
    if include_delegation:
        contexts = [item for item in delegation_context(workspace_id, now).values() if item["user_id"] == user.id]
        manager_ids = {item["manager_id"] for item in contexts}
        grants = (
            RolePermission.objects.filter(
                role__workspace_id=workspace_id,
                role__is_active=True,
                role__deleted_at__isnull=True,
                role__user_roles__user_id__in=manager_ids,
                role__user_roles__workspace_id=workspace_id,
                role__user_roles__is_active=True,
                role__user_roles__deleted_at__isnull=True,
                permission__workspace_id=workspace_id,
                permission__is_active=True,
                permission__deleted_at__isnull=True,
                permission__is_delegatable=True,
                permission__code__in=[
                    code for code, definition in PERMISSION_REGISTRY.items() if definition["is_delegatable"]
                ],
            )
            .values("permission__code", "role__user_roles__user_id")
            .distinct()
        )
        for row in grants:
            code = row["permission__code"]
            if code in sources and sources[code]["source"] == "role":
                continue
            entry = sources.setdefault(code, {"source": "delegation", "delegations": []})
            entry["delegations"].extend(
                {**item, "manager_id": str(item["manager_id"]), "user_id": str(item["user_id"])}
                for item in contexts
                if item["manager_id"] == row["role__user_roles__user_id"]
            )
    exceptions = list(
        active_period(
            UserPermissionException.objects.filter(
                workspace_id=workspace_id,
                user=user,
                is_active=True,
                permission__workspace_id=workspace_id,
                permission__is_active=True,
                permission__deleted_at__isnull=True,
            ),
            now,
        )
        .order_by("created_at", "id")
        .values("id", "effect", "permission__code")
    )
    effects = {}
    for row in exceptions:
        effects.setdefault(row["permission__code"], set()).add(row["effect"])
    # DENY is applied last and therefore always wins, even across overlapping exceptions.
    for effect, source in (("ALLOW", "user_allow"), ("DENY", "user_deny")):
        for row in exceptions:
            if row["effect"] == effect:
                sources[row["permission__code"]] = {"source": source, "exception_id": str(row["id"])}
    explanations = [
        {
            **permission,
            **sources.get(permission["code"], {"source": "no_access"}),
            "exception_effects": sorted(effects.get(permission["code"], set())),
            "has_conflict": len(effects.get(permission["code"], set())) > 1,
            "granted": permission["code"] in sources and sources[permission["code"]]["source"] != "user_deny",
        }
        for permission in catalog
    ]
    return {"permissions": sorted(row["code"] for row in explanations if row["granted"]), "explanations": explanations}


def has_permission(user, workspace, permission_code, *, request=None):
    if permission_code not in PERMISSION_REGISTRY:
        return False
    if isinstance(workspace, str):
        workspaces = getattr(request, "_crm_workspaces", {}) if request is not None else {}
        if workspace not in workspaces:
            workspaces[workspace] = Workspace.objects.filter(slug=workspace).first()
        if request is not None:
            request._crm_workspaces = workspaces
        workspace = workspaces[workspace]
        if workspace is None:
            return False
    key = (str(user.id), str(getattr(workspace, "id", workspace)))
    if request is None:
        return permission_code in get_effective_permissions(user, workspace)["permissions"]
    cache = getattr(request, "_crm_permissions", {})
    if key not in cache:
        cache[key] = set(get_effective_permissions(user, workspace)["permissions"])
    request._crm_permissions = cache
    return permission_code in cache[key]


def explain_permission(user, workspace, permission_code):
    return next(
        (row for row in get_effective_permissions(user, workspace)["explanations"] if row["code"] == permission_code),
        {"code": permission_code, "granted": False, "source": "no_access"},
    )


def can_manage_absence(actor, target, workspace, code, *, request=None):
    if not has_permission(actor, workspace, code, request=request):
        return False
    if has_permission(actor, workspace, "Absence.ManageAll", request=request):
        return True
    if actor.id == target.id:
        return False
    scopes = getattr(request, "_crm_absence_scope", {}) if request is not None else {}
    key = str(workspace.id)
    if key not in scopes:
        units = {unit.id: unit for unit in OrganizationUnit.objects.filter(workspace=workspace, is_active=True)}
        target_units = {}
        for user_id, unit_id in OrganizationUnitMember.objects.filter(
            unit__workspace=workspace, unit__is_active=True, unit__deleted_at__isnull=True, is_active=True
        ).values_list("user_id", "unit_id"):
            target_units.setdefault(user_id, set()).add(unit_id)
        for unit in units.values():
            if unit.manager_id:
                target_units.setdefault(unit.manager_id, set()).add(unit.id)
        scopes[key] = (units, target_units)
        if request is not None:
            request._crm_absence_scope = scopes
    units, target_units = scopes[key]
    targets = target_units.get(target.id, set())
    for unit_id in targets:
        unit = units.get(unit_id)
        visited = set()
        # The manager of the target's unit, or any ancestor manager, may act.
        while unit and unit.id not in visited:
            visited.add(unit.id)
            if unit.manager_id == actor.id:
                return True
            unit = units.get(unit.parent_id)
    return False


ADMIN_REQUIRED = {"User.View", "User.Role.Assign", "Role.View", "Role.Permission.Assign", "Access.UserException.Manage"}


def ensure_admin_available(workspace, *, excluding_user_id=None):
    """Call inside a transaction holding the Workspace row lock, after mutation."""
    admins = list(
        WorkspaceMember.objects.filter(
            workspace=workspace,
            is_active=True,
            member__is_active=True,
            member__organization_roles__workspace=workspace,
            member__organization_roles__is_active=True,
            member__organization_roles__deleted_at__isnull=True,
            member__organization_roles__role__is_active=True,
            member__organization_roles__role__deleted_at__isnull=True,
            member__organization_roles__role__system_key="admin",
        )
        .exclude(member_id=excluding_user_id)
        .select_related("member")
        .distinct()
    )
    now = timezone.now()
    boundaries = {now}
    for starts_at, ends_at in UserPermissionException.objects.filter(
        workspace=workspace,
        user_id__in=[row.member_id for row in admins],
        is_active=True,
        permission__code__in=ADMIN_REQUIRED,
    ).values_list("starts_at", "ends_at"):
        boundaries.update(value for value in (starts_at, ends_at) if value and value > now)
    # A scheduled denial or an expiring allow must not silently lock out all admins.
    for boundary in sorted(boundaries):
        if not any(
            ADMIN_REQUIRED.issubset(
                get_effective_permissions(row.member, workspace, now=boundary, include_delegation=False)["permissions"]
            )
            for row in admins
        ):
            raise ValidationError({"access": "The last workspace administrator cannot lose administrative access."})


def sync_plane_membership(workspace, user):
    """Plane compatibility only; CRM decisions never read the numeric role."""
    admin = UserOrganizationRole.objects.filter(
        workspace=workspace,
        user=user,
        is_active=True,
        role__is_active=True,
        role__deleted_at__isnull=True,
        role__system_key="admin",
    ).exists()
    role = 20 if admin else 15
    WorkspaceMember.objects.filter(workspace=workspace, member=user).update(role=role)
    ProjectMember.objects.filter(workspace=workspace, member=user).update(role=role)
