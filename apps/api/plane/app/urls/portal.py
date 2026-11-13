"""Ticket 7 — customer portal URLs.

``portal/v1/…`` is mounted under ``/api/`` (→ ``/api/portal/v1/``): the customer API, with its
own authentication class. The ``workspaces/<slug>/…`` routes are the internal side.
"""

from django.urls import path

from plane.app.views.portal.customer import (
    FeedbackEndpoint,
    FileEndpoint,
    LoginEndpoint,
    LogoutEndpoint,
    MessageEndpoint,
    QuoteDecisionEndpoint,
    RequestByNumberEndpoint,
    RequestDetailEndpoint,
    RequestListEndpoint,
    SessionEndpoint,
    SettingsEndpoint,
    SetupEndpoint,
)
from plane.app.views.workspace.portal import (
    PortalAccountDetailEndpoint,
    PortalAccountLinkEndpoint,
    PortalAccountListEndpoint,
    PortalCustomerOptionsEndpoint,
    PortalSettingsEndpoint,
    TicketPortalEndpoint,
    TicketPortalFileEndpoint,
    TicketPortalMessageEndpoint,
    TicketPortalTriageEndpoint,
    TicketQuoteDetailEndpoint,
    TicketQuoteListEndpoint,
    TicketQuoteSendEndpoint,
)

P = "portal/v1/"
W = "workspaces/<str:slug>/"

urlpatterns = [
    path(f"{P}auth/login/", LoginEndpoint.as_view()),
    path(f"{P}auth/logout/", LogoutEndpoint.as_view()),
    path(f"{P}auth/setup/", SetupEndpoint.as_view()),
    path(f"{P}session/", SessionEndpoint.as_view()),
    path(f"{P}settings/", SettingsEndpoint.as_view()),
    path(f"{P}requests/", RequestListEndpoint.as_view()),
    path(f"{P}requests/by-number/<str:number>/", RequestByNumberEndpoint.as_view()),
    path(f"{P}requests/<uuid:issue_id>/", RequestDetailEndpoint.as_view()),
    path(f"{P}requests/<uuid:issue_id>/messages/", MessageEndpoint.as_view()),
    path(f"{P}requests/<uuid:issue_id>/feedback/", FeedbackEndpoint.as_view()),
    path(f"{P}quotes/<uuid:quote_id>/decision/", QuoteDecisionEndpoint.as_view()),
    path(f"{P}files/<uuid:file_id>/", FileEndpoint.as_view()),
    path(f"{W}portal/settings/", PortalSettingsEndpoint.as_view()),
    path(f"{W}portal/accounts/", PortalAccountListEndpoint.as_view()),
    path(f"{W}portal/accounts/options/", PortalCustomerOptionsEndpoint.as_view()),
    path(f"{W}portal/accounts/<uuid:account_id>/", PortalAccountDetailEndpoint.as_view()),
    path(f"{W}portal/accounts/<uuid:account_id>/link/", PortalAccountLinkEndpoint.as_view()),
    path(f"{W}tickets/<uuid:issue_id>/portal/", TicketPortalEndpoint.as_view()),
    path(f"{W}tickets/<uuid:issue_id>/portal/messages/", TicketPortalMessageEndpoint.as_view()),
    path(f"{W}tickets/<uuid:issue_id>/portal/triage/", TicketPortalTriageEndpoint.as_view()),
    path(f"{W}tickets/<uuid:issue_id>/portal/files/<uuid:file_id>/", TicketPortalFileEndpoint.as_view()),
    path(f"{W}tickets/<uuid:issue_id>/quotes/", TicketQuoteListEndpoint.as_view()),
    path(f"{W}quotes/<uuid:quote_id>/", TicketQuoteDetailEndpoint.as_view()),
    path(f"{W}quotes/<uuid:quote_id>/send/", TicketQuoteSendEndpoint.as_view()),
]
