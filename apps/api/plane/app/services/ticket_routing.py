"""Deterministic organization-aware ticket routing."""

from django.db import transaction
from .crm_notifications import notify_role_queue, notify_routed_issue

from plane.db.models import (
    Issue,
    IssueAssignee,
    OrganizationUnit,
    TicketRoleQueueEntry,
    TicketRoutingDecision,
    TicketRoutingRule,
    UserOrganizationRole,
    WorkspaceMember,
)


class TicketRoutingService:
    """Route an issue to the first eligible manager in a unit's ancestry."""

    @staticmethod
    def _eligible_manager(unit: OrganizationUnit, rule: TicketRoutingRule):
        manager = unit.manager
        if manager is None or not manager.is_active:
            return None
        if not WorkspaceMember.objects.filter(
            workspace_id=rule.workspace_id,
            member_id=manager.id,
            is_active=True,
        ).exists():
            return None

        active_roles = UserOrganizationRole.objects.filter(
            workspace_id=rule.workspace_id,
            user_id=manager.id,
            is_active=True,
            role__is_active=True,
        )
        if not active_roles.filter(role_id=rule.required_role_id).exists():
            return None
        from .access_control import delegation_context

        substitution = delegation_context(rule.workspace_id).get(unit.id)
        if substitution:
            from plane.db.models import User

            return User.objects.get(pk=substitution["user_id"])
        from plane.db.models import UserAbsence
        from django.utils import timezone

        now = timezone.now()
        if UserAbsence.objects.filter(
            workspace_id=rule.workspace_id, user=manager, status="scheduled", starts_at__lte=now, ends_at__gt=now
        ).exists():
            return None
        return manager

    @classmethod
    @transaction.atomic
    def route(cls, issue: Issue, rule: TicketRoutingRule, actor_id=None) -> TicketRoutingDecision:
        if issue.workspace_id != rule.workspace_id:
            raise ValueError("Issue and routing rule must belong to the same workspace.")
        if not rule.is_active:
            raise ValueError("Inactive routing rules cannot be used.")

        unit = (
            OrganizationUnit.objects.select_for_update(of=("self",))
            .select_related("manager", "parent")
            .get(pk=rule.unit_id)
        )
        resolved_unit = None
        assignee = None
        visited = set()
        while unit is not None and unit.id not in visited:
            visited.add(unit.id)
            if unit.is_active:
                assignee = cls._eligible_manager(unit, rule)
                if assignee:
                    resolved_unit = unit
                    break
            unit = unit.parent

        if assignee:
            if actor_id:
                from plane.db.models import User
                from .task_policy import validate_other_assignees
                validate_other_assignees(User.objects.get(pk=actor_id), issue.workspace_id, [assignee.id])
            _, created = IssueAssignee.objects.get_or_create(
                issue=issue,
                assignee=assignee,
                defaults={"workspace_id": issue.workspace_id, "project_id": issue.project_id},
            )
            if created:
                notify_routed_issue(issue, assignee.id, actor_id or issue.created_by_id)
            TicketRoleQueueEntry.objects.filter(issue=issue, rule=rule, status="open").update(status="closed")
            return TicketRoutingDecision.objects.create(
                issue=issue,
                rule=rule,
                resolved_unit=resolved_unit,
                assigned_user=assignee,
                outcome=TicketRoutingDecision.Outcome.ASSIGNED,
            )

        entry, created = TicketRoleQueueEntry.objects.get_or_create(
            issue=issue,
            rule=rule,
            status=TicketRoleQueueEntry.Status.OPEN,
            defaults={
                "required_role": rule.required_role,
            },
        )
        if created:
            notify_role_queue(entry, actor_id or issue.created_by_id)
        return TicketRoutingDecision.objects.create(
            issue=issue,
            rule=rule,
            outcome=TicketRoutingDecision.Outcome.QUEUED,
        )
