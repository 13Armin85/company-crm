"""Periodic idle-work notifications during the approved Tehran workday."""

from celery import shared_task

from plane.db.models import OrganizationUnit, User, Workspace
from plane.app.services.access_control import has_permission
from plane.app.services.dashboard_team import settings_for, team_cards


@shared_task
def notify_idle_team_managers():
    from plane.app.views.workspace.dashboard import _issue_idle_alerts

    owners = OrganizationUnit.objects.filter(
        is_active=True, manager_id__isnull=False
    ).values_list("workspace_id", "manager_id").distinct()
    for workspace_id, manager_id in owners.iterator():
        workspace = Workspace.objects.filter(id=workspace_id).first()
        manager = User.objects.filter(id=manager_id, is_active=True).first()
        if not workspace or not manager or not has_permission(manager, workspace, "Dashboard.Team.View"):
            continue
        row = settings_for(workspace, manager)
        if not row.alert_enabled:
            continue
        cards = team_cards(workspace, manager)
        _issue_idle_alerts(workspace, manager, cards)
