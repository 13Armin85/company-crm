"""Ticket 7 — internal endpoints of the customer portal: settings, accounts, ticket panel tab.

Every write enforces Django CSRF (internal session) and a ``Portal.*`` / ``Quote.Manage``
permission on the server; the UI only mirrors ``can`` flags returned here.
"""

from django.conf import settings
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.response import Response

from plane.app.permissions.crm import require_any_permission, require_permission
from plane.app.services import portal_access, portal_files, portal_requests, portal_settings, quotes
from plane.app.services import ticket_core as core
from plane.app.services.access_control import has_permission
from plane.app.services.entity_records import record_queryset
from plane.app.services.ticket_core import STATUS_CATEGORY
from plane.app.views.workspace.ticket import TicketAPIView
from plane.authentication.session import BaseSessionAuthentication
from plane.db.models import PORTAL_ATTACHMENT, FileAsset, LookupValue, PortalAccount


def enforce_csrf(request):
    if isinstance(request.successful_authenticator, BaseSessionAuthentication):
        SessionAuthentication().enforce_csrf(request)


def uploads(request):
    return request.FILES.getlist("files") if hasattr(request.FILES, "getlist") else []


class PortalSettingsEndpoint(TicketAPIView):
    @require_any_permission("Portal.Settings.Manage", "Portal.Account.Manage")
    def get(self, request, slug):
        workspace = self.workspace(slug)
        statuses = [
            {"key": f"status:{row.code}", "title": row.title, "category": STATUS_CATEGORY.get(row.code, core.TODO)}
            for row in LookupValue.objects.filter(
                category__workspace=workspace, category__code="task-status", is_active=True
            ).order_by("position")
        ]
        return Response(
            {
                "settings": portal_settings.load(workspace),
                "categories": [
                    {"key": f"category:{code}", "title": title} for code, title in core.CATEGORY_TITLES.items()
                ],
                "statuses": statuses,
                "stages": [{"code": code, "title": title} for code, title in portal_settings.STAGE_TITLES.items()],
                "supported_extensions": list(portal_settings.SUPPORTED_EXTENSIONS),
                "server_channels": sorted(set(getattr(settings, "PORTAL_NOTIFY_CHANNELS", ()) or ())),
                "can_edit": has_permission(request.user, workspace, "Portal.Settings.Manage", request=request),
            }
        )

    @require_permission("Portal.Settings.Manage")
    def put(self, request, slug):
        workspace = self.workspace(slug)
        return Response({"settings": portal_settings.save(workspace, request.user, request.data)})


class PortalAccountListEndpoint(TicketAPIView):
    @require_permission("Portal.Account.Manage")
    def get(self, request, slug):
        workspace = self.workspace(slug)
        rows = PortalAccount.objects.filter(workspace=workspace).select_related(
            "customer_record__entity", "contact_record__entity"
        )
        return Response([portal_access.account_payload(row) for row in rows])

    @require_permission("Portal.Account.Manage")
    def post(self, request, slug):
        workspace = self.workspace(slug)
        account, link = portal_access.create_account(workspace, request.user, request.data)
        return Response({**portal_access.account_payload(account), "setup": link}, status=status.HTTP_201_CREATED)


class PortalAccountDetailEndpoint(TicketAPIView):
    @require_permission("Portal.Account.Manage")
    def patch(self, request, slug, account_id):
        workspace = self.workspace(slug)
        account = portal_access.update_account(workspace, request.user, account_id, request.data)
        return Response(portal_access.account_payload(account))


class PortalAccountLinkEndpoint(TicketAPIView):
    @require_permission("Portal.Account.Manage")
    def post(self, request, slug, account_id):
        workspace = self.workspace(slug)
        with transaction.atomic():
            account = get_object_or_404(PortalAccount.objects.select_for_update(), workspace=workspace, id=account_id)
            if not account.is_active:
                raise PermissionDenied("برای حساب غیرفعال پیوند صادر نمی‌شود.")
            link = portal_access.issue_setup_link(account, request.user)
        return Response({"setup": link}, status=status.HTTP_201_CREATED)


class PortalCustomerOptionsEndpoint(TicketAPIView):
    """Customers (and their contacts) the manager may pick, filtered by the engine's record permissions."""

    @require_permission("Portal.Account.Manage")
    def get(self, request, slug):
        workspace = self.workspace(slug)
        result = {}
        for code in ("customer", "contact"):
            entity = portal_access.root_entity(workspace.id, code)
            if entity is None:
                result[code] = []
                continue
            rows = record_queryset(entity, request.user, request).filter(is_active=True).order_by("number")[:500]
            result[code] = [
                {
                    "id": str(row.id),
                    "title": str((row.data or {}).get(entity.title_field) or row.number),
                    "number": row.number,
                }
                for row in rows
            ]
        return Response(result)


class TicketPortalEndpoint(TicketAPIView):
    def get(self, request, slug, issue_id):
        workspace = self.workspace(slug)
        return Response(portal_requests.internal_summary(workspace, request.user, issue_id, request))


class TicketPortalMessageEndpoint(TicketAPIView):
    def post(self, request, slug, issue_id):
        enforce_csrf(request)
        workspace = self.workspace(slug)
        portal_requests.internal_message(workspace, request.user, issue_id, request.data, uploads(request), request)
        return Response(
            portal_requests.internal_summary(workspace, request.user, issue_id, request), status=status.HTTP_201_CREATED
        )


class TicketPortalTriageEndpoint(TicketAPIView):
    def post(self, request, slug, issue_id):
        enforce_csrf(request)
        workspace = self.workspace(slug)
        portal_requests.triage(workspace, request.user, issue_id, request.data, request)
        return Response(portal_requests.internal_summary(workspace, request.user, issue_id, request))


class TicketQuoteListEndpoint(TicketAPIView):
    def post(self, request, slug, issue_id):
        enforce_csrf(request)
        workspace = self.workspace(slug)
        quotes.create(workspace, request.user, issue_id, request.data, request)
        return Response(
            portal_requests.internal_summary(workspace, request.user, issue_id, request), status=status.HTTP_201_CREATED
        )


class TicketQuoteDetailEndpoint(TicketAPIView):
    def patch(self, request, slug, quote_id):
        enforce_csrf(request)
        workspace = self.workspace(slug)
        row = quotes.update_draft(workspace, request.user, quote_id, request.data, request)
        return Response(portal_requests.internal_summary(workspace, request.user, row.data["quote_ticket"], request))


class TicketQuoteSendEndpoint(TicketAPIView):
    def post(self, request, slug, quote_id):
        enforce_csrf(request)
        workspace = self.workspace(slug)
        row = quotes.send(workspace, request.user, quote_id, request)
        return Response(portal_requests.internal_summary(workspace, request.user, row.data["quote_ticket"], request))


class TicketPortalFileEndpoint(TicketAPIView):
    def get(self, request, slug, issue_id, file_id):
        workspace = self.workspace(slug)
        issue = core.visible_ticket(workspace, request.user, issue_id, request)
        asset = FileAsset.objects.filter(
            id=file_id, issue=issue, entity_type=PORTAL_ATTACHMENT, is_deleted=False
        ).first()
        if asset is None:
            raise NotFound("فایل پیدا نشد.")
        return portal_files.download(asset)
