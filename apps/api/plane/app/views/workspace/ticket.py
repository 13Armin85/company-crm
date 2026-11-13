"""Ticket 5 endpoints: deadline card, target, extension, delay, contact, referral, history, rules."""

from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from plane.app.permissions.crm import require_permission
from plane.app.services import ticket_core as core
from plane.app.services.access_control import has_permission
from plane.app.services.ticket_routing import TicketRoutingService, shadowed_rules
from plane.app.services.workflow_engine import contact_channels
from plane.app.views.base import BaseAPIView
from plane.db.models import TicketRoutingRule, Workspace, WorkflowExtension


class TicketAPIView(BaseAPIView):
    def workspace(self, slug):
        return get_object_or_404(Workspace, slug=slug)


def _card(workspace, user, issue, request):
    active = core._active_referral(issue)
    from plane.db.models import EntityRecord

    number = EntityRecord.objects.filter(source_id=issue.id).values_list("number", flat=True).first()
    return {
        "id": str(issue.id),
        "title": issue.name,
        "number": number or (f"{issue.project.identifier}-{issue.sequence_id}" if issue.project_id else f"#{issue.sequence_id}"),
        "deadline": core.deadline_payload(issue, user, request),
        "referrals": core.referral_chain(issue),
        "active_referral": (
            {
                "id": str(active.id),
                "to_id": str(active.assigned_user_id),
                "to": core.user_name(active.assigned_user),
                "by": core.user_name(active.referred_by),
                "reason": active.reason,
                "mine": active.assigned_user_id == user.id,
            }
            if active
            else None
        ),
        "details": {**core.details_payload(issue, user, request), "customers": core.customers_of(issue, user, request)},
        "status": core.status_payload(issue, user, request),
        "read_only": not core.is_owner(issue, user, request),
        "contact_channels": contact_channels(workspace),
        # Ticket 7: a portal request offers "inform the customer" on contact and the correspondence tab.
        "portal": bool(issue.portal_account_id),
        "can": {
            "refer": core.is_owner(issue, user, request)
            and (
                issue.issue_assignee.filter(assignee=user, deleted_at__isnull=True).exists()
                or has_permission(user, workspace, "Routing.Route", request=request)
            ),
            "contact": core.is_owner(issue, user, request) and core.category_of(issue) != core.DONE,
        },
    }


class TicketCoreEndpoint(TicketAPIView):
    def get(self, request, slug, issue_id):
        workspace = self.workspace(slug)
        issue = core.visible_ticket(workspace, request.user, issue_id, request)
        return Response(_card(workspace, request.user, issue, request))


class TicketParentEndpoint(TicketAPIView):
    def post(self, request, slug, issue_id):
        workspace = self.workspace(slug)
        issue = core.set_parent(workspace, request.user, issue_id, request.data, request)
        return Response(_card(workspace, request.user, issue, request))


class TicketTargetEndpoint(TicketAPIView):
    def post(self, request, slug, issue_id):
        workspace = self.workspace(slug)
        issue = core.set_target(workspace, request.user, issue_id, request.data, request)
        return Response(core.deadline_payload(issue, request.user, request))


class TicketTypeListEndpoint(TicketAPIView):
    @require_permission("Issue.View")
    def get(self, request, slug):
        from plane.db.models import IssueType

        workspace = self.workspace(slug)
        rows = IssueType.objects.filter(workspace=workspace, is_active=True, is_epic=False).order_by("name")
        return Response(
            [
                {
                    "id": str(row.id),
                    "name": row.name,
                    "target_minutes": row.target_minutes,
                    "can_set_target": has_permission(request.user, workspace, "Ticket.TargetSet", request=request),
                }
                for row in rows
            ]
        )


class TicketTypeTargetEndpoint(TicketAPIView):
    def get(self, request, slug, type_id):
        workspace = self.workspace(slug)
        from plane.db.models import IssueType

        row = get_object_or_404(IssueType, workspace=workspace, id=type_id)
        return Response({"id": str(row.id), "name": row.name, "target_minutes": row.target_minutes})

    def post(self, request, slug, type_id):
        workspace = self.workspace(slug)
        row = core.set_type_target(workspace, request.user, type_id, request.data, request)
        return Response({"id": str(row.id), "name": row.name, "target_minutes": row.target_minutes})


class TicketExtensionPreviewEndpoint(TicketAPIView):
    def post(self, request, slug, issue_id):
        workspace = self.workspace(slug)
        return Response(core.preview_extension(workspace, request.user, issue_id, request.data, request))


class TicketExtensionEndpoint(TicketAPIView):
    def post(self, request, slug, issue_id):
        workspace = self.workspace(slug)
        row = core.request_extension(workspace, request.user, issue_id, request.data, request)
        return Response(core.serialize_extension(row, workspace), status=status.HTTP_201_CREATED)


class TicketExtensionDecisionEndpoint(TicketAPIView):
    def post(self, request, slug, extension_id):
        workspace = self.workspace(slug)
        row = core.decide_extension(workspace, request.user, extension_id, request.data, request)
        return Response(core.serialize_extension(row, workspace))


class TicketExtensionInboxEndpoint(TicketAPIView):
    def get(self, request, slug):
        workspace = self.workspace(slug)
        rows = core.pending_extensions_for(request.user, workspace)
        return Response(
            [
                {
                    **core.serialize_extension(row, workspace),
                    "issue_id": str(row.issue_id),
                    "issue_name": row.issue.name,
                    "history": [
                        core.serialize_extension(item, workspace)
                        for item in WorkflowExtension.objects.filter(issue_id=row.issue_id)
                        .exclude(id=row.id)
                        .select_related("approver", "decided_by", "requested_by")
                    ],
                }
                for row in rows
            ]
        )


class TicketDelayReportEndpoint(TicketAPIView):
    def post(self, request, slug, issue_id):
        workspace = self.workspace(slug)
        row = core.delay_report(workspace, request.user, issue_id, request.data, request)
        return Response(core.serialize_report(row, workspace), status=status.HTTP_201_CREATED)


class TicketContactEndpoint(TicketAPIView):
    def post(self, request, slug, issue_id):
        workspace = self.workspace(slug)
        result = core.contact_resolve(workspace, request.user, issue_id, request.data, request)
        routed = result["routed"]
        return Response(
            {
                "contact": result["contact"],
                "routed": {"outcome": routed.outcome, "reason": routed.reason} if routed else None,
            },
            status=status.HTTP_201_CREATED,
        )


class TicketReferEndpoint(TicketAPIView):
    def post(self, request, slug, issue_id):
        workspace = self.workspace(slug)
        core.refer(workspace, request.user, issue_id, request.data, request)
        issue = core.visible_ticket(workspace, request.user, issue_id, request)
        return Response(_card(workspace, request.user, issue, request), status=status.HTTP_201_CREATED)


class TicketReferralResponseEndpoint(TicketAPIView):
    def post(self, request, slug, issue_id):
        workspace = self.workspace(slug)
        core.respond_referral(workspace, request.user, issue_id, request.data, request)
        try:
            issue = core.visible_ticket(workspace, request.user, issue_id, request)
        except Exception:
            return Response({"id": str(issue_id), "visible": False})
        return Response(_card(workspace, request.user, issue, request))


class TicketHistoryEndpoint(TicketAPIView):
    def get(self, request, slug, issue_id):
        workspace = self.workspace(slug)
        issue = core.visible_ticket(workspace, request.user, issue_id, request)
        return Response(core.history(issue, request.query_params.get("kind") or None))


class TicketAutoRouteEndpoint(TicketAPIView):
    @require_permission("Routing.Route")
    def post(self, request, slug, issue_id):
        workspace = self.workspace(slug)
        issue = core.visible_ticket(workspace, request.user, issue_id, request)
        core.require_owner(issue, request.user, request)
        with transaction.atomic():
            decision = TicketRoutingService.route_auto(issue, actor_id=request.user.id)
        return Response(
            {"outcome": decision.outcome, "reason": decision.reason, "assigned_user_id": decision.assigned_user_id},
            status=status.HTTP_201_CREATED,
        )


class RoutingRuleOrderEndpoint(TicketAPIView):
    @require_permission("Routing.Manage")
    def post(self, request, slug):
        workspace = self.workspace(slug)
        ids = request.data.get("ids")
        if not isinstance(ids, list) or not ids:
            raise ValidationError({"ids": "ترتیب قواعد را مشخص کنید."})
        rules = {str(r.id): r for r in TicketRoutingRule.objects.filter(workspace=workspace)}
        if set(map(str, ids)) != set(rules):
            raise ValidationError({"ids": "فهرست ترتیب باید همهٔ قواعد را یک‌بار شامل شود."})
        with transaction.atomic():
            for index, rule_id in enumerate(ids):
                TicketRoutingRule.objects.filter(id=rule_id).update(position=index + 1)
        return Response({"ids": ids, "shadowed": shadowed_rules(workspace.id)})


class RoutingRulePreviewEndpoint(TicketAPIView):
    @require_permission("Routing.View")
    def post(self, request, slug):
        workspace = self.workspace(slug)
        issue = core.visible_ticket(workspace, request.user, request.data.get("issue_id"), request)
        return Response(TicketRoutingService.preview(issue))

    @require_permission("Routing.View")
    def get(self, request, slug):
        workspace = self.workspace(slug)
        return Response({"shadowed": shadowed_rules(workspace.id)})


def ensure(condition, message):
    if not condition:
        raise PermissionDenied(message)
