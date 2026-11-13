"""Customer-facing endpoints. Every queryset is derived from the session's account only."""

from django.conf import settings
from rest_framework import status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from plane.app.services import portal_access, portal_files, portal_requests, portal_settings, quotes
from plane.app.services.portal_access import record_title
from plane.db.models import PORTAL_ATTACHMENT, FileAsset

from .base import (
    COOKIE,
    PortalAPIView,
    PortalDecisionThrottle,
    PortalLoginIPThrottle,
    PortalLoginUserThrottle,
    PortalMessageThrottle,
    PortalReadThrottle,
    PortalRequestThrottle,
    PortalUploadThrottle,
    client_ip,
)

COOKIE_PATH = "/api/portal/"


def profile(account):
    config = portal_settings.load(account.workspace)
    server = set(getattr(settings, "PORTAL_NOTIFY_CHANNELS", ()) or ())
    return {
        "display_name": account.display_name,
        "username": account.username,
        "customer": record_title(account.customer_record),
        "notify": {"portal": account.notify_portal, "email": account.notify_email, "sms": account.notify_sms},
        "channels_available": {
            channel: channel in server and bool(config["notify_channels"].get(channel)) for channel in ("email", "sms")
        },
        "idle_minutes": config["session"]["idle_minutes"],
    }


def uploads(request):
    return request.FILES.getlist("files") if hasattr(request.FILES, "getlist") else []


class LoginEndpoint(PortalAPIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [PortalLoginIPThrottle, PortalLoginUserThrottle]
    endpoint = "auth.login"

    def post(self, request):
        username = request.data.get("username")
        request.portal_audit_username = username if isinstance(username, str) else ""
        account, token, csrf = portal_access.login(
            username,
            request.data.get("password"),
            ip=client_ip(request),
            user_agent=request.META.get("HTTP_USER_AGENT", ""),
        )
        request.portal_audit_account = account
        config = portal_settings.load(account.workspace)
        response = Response({"account": profile(account), "csrf_token": csrf})
        response.set_cookie(
            COOKIE,
            token,
            max_age=config["session"]["absolute_hours"] * 3600,
            path=COOKIE_PATH,
            secure=settings.SESSION_COOKIE_SECURE,
            httponly=True,
            samesite="Strict",
        )
        return response


class LogoutEndpoint(PortalAPIView):
    endpoint = "auth.logout"

    def post(self, request):
        portal_access.revoke(request.auth, "logout")
        response = Response(status=status.HTTP_204_NO_CONTENT)
        response.delete_cookie(COOKIE, path=COOKIE_PATH, samesite="Strict")
        return response


class SetupEndpoint(PortalAPIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [PortalLoginIPThrottle]
    endpoint = "auth.setup"

    def post(self, request):
        account = portal_access.set_password_with_token(request.data.get("token"), request.data.get("password"))
        request.portal_audit_account = account
        return Response({"username": account.username})


class SessionEndpoint(PortalAPIView):
    endpoint = "session"

    def get(self, request):
        # A reload (or a second tab) gets the same, session-bound CSRF token.
        return Response({"account": profile(self.account), "csrf_token": portal_access.session_csrf(request.auth)})


class SettingsEndpoint(PortalAPIView):
    endpoint = "settings"

    def get(self, request):
        return Response(profile(self.account))

    def patch(self, request):
        account = self.account
        changed = []
        for key, attr in (("portal", "notify_portal"), ("email", "notify_email"), ("sms", "notify_sms")):
            if key in request.data:
                value = request.data[key]
                if not isinstance(value, bool):
                    raise ValidationError({key: "مقدار باید روشن یا خاموش باشد."})
                setattr(account, attr, value)
                changed.append(attr)
        if changed:
            type(account).objects.filter(id=account.id).update(**{attr: getattr(account, attr) for attr in changed})
        return Response(profile(account))


class RequestListEndpoint(PortalAPIView):
    endpoint = "requests"
    throttles_for_post = [PortalRequestThrottle, PortalUploadThrottle]

    def get(self, request):
        return Response(portal_requests.list_requests(self.account, request.query_params))

    def post(self, request):
        issue, _ = portal_requests.create_request(self.account, request.data, uploads(request))
        return Response(portal_requests.detail(self.account, issue.id), status=status.HTTP_201_CREATED)


class RequestDetailEndpoint(PortalAPIView):
    endpoint = "request"

    def get(self, request, issue_id):
        return Response(portal_requests.detail(self.account, issue_id))


class RequestByNumberEndpoint(PortalAPIView):
    endpoint = "request.by_number"

    def get(self, request, number):
        return Response(portal_requests.by_number(self.account, number))


class MessageEndpoint(PortalAPIView):
    endpoint = "request.message"
    throttles_for_post = [PortalMessageThrottle, PortalUploadThrottle]

    def post(self, request, issue_id):
        message = portal_requests.customer_message(self.account, issue_id, request.data, uploads(request))
        return Response(message, status=status.HTTP_201_CREATED)


class FeedbackEndpoint(PortalAPIView):
    endpoint = "request.feedback"
    throttles_for_post = [PortalDecisionThrottle]
    throttles_for_patch = [PortalDecisionThrottle]

    def post(self, request, issue_id):
        return Response(portal_requests.submit_feedback(self.account, issue_id, request.data), status=201)

    patch = post


class QuoteDecisionEndpoint(PortalAPIView):
    endpoint = "quote.decision"
    throttles_for_post = [PortalDecisionThrottle]

    def post(self, request, quote_id):
        row = quotes.decide(self.account, quote_id, request.data)
        return Response(quotes.portal_payload(row), status=status.HTTP_201_CREATED)


class FileEndpoint(PortalAPIView):
    endpoint = "file"
    throttle_classes = [PortalReadThrottle]

    def get(self, request, file_id):
        asset = (
            FileAsset.objects.filter(
                id=file_id,
                entity_type=PORTAL_ATTACHMENT,
                is_deleted=False,
                comment__access="EXTERNAL",
                issue_id__in=portal_access.request_queryset(self.account).values("id"),
            )
            .select_related("comment")
            .first()
        )
        if asset is None:
            raise NotFound("فایل پیدا نشد.")
        return portal_files.download(asset)
