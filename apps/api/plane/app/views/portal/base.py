"""Authentication, CSRF, throttling and audit shared by every ``/api/portal/v1/`` endpoint.

- ``PortalAuthentication`` accepts only the portal session cookie; it never reads the
  internal Django session, so an internal user is anonymous here (decision 7.2).
- unsafe methods need the ``X-Portal-CSRF`` header matching the session's CSRF token.
- every call is written to ``PortalAuditLog`` (no body, password or file content).
"""

import ipaddress

from django.conf import settings
from django.contrib.auth.models import AnonymousUser
from rest_framework import exceptions
from rest_framework.authentication import BaseAuthentication
from rest_framework.permissions import SAFE_METHODS, BasePermission
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from plane.app.services.error_language import persian_errors
from plane.app.services.portal_access import csrf_ok, resolve_session
from plane.db.models import PortalAccount, PortalAuditLog
from plane.utils.ip_address import get_client_ip

COOKIE = getattr(settings, "PORTAL_SESSION_COOKIE_NAME", "portal-session")
CSRF_HEADER = "HTTP_X_PORTAL_CSRF"
DEFAULT_RATES = {
    "portal_login_ip": "20/minute",
    "portal_login_user": "10/minute",
    "portal_read": "240/minute",
    "portal_request": "20/hour",
    "portal_message": "30/minute",
    "portal_upload": "60/hour",
    "portal_decision": "20/hour",
}


def client_ip(request):
    value = (get_client_ip(request) or "").strip()
    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        return None


class SessionExpired(exceptions.AuthenticationFailed):
    default_detail = "نشست شما به پایان رسیده است؛ دوباره وارد درگاه شوید."
    default_code = "session_expired"


class CsrfFailed(exceptions.PermissionDenied):
    default_detail = "درخواست تأیید نشد؛ صفحه را تازه کنید و دوباره تلاش کنید."
    default_code = "csrf_failed"


class PortalAuthentication(BaseAuthentication):
    def authenticate(self, request):
        raw = request.COOKIES.get(COOKIE)
        if not raw:
            return None
        account, session = resolve_session(raw)
        if account is None:
            raise SessionExpired()
        if request.method not in SAFE_METHODS and not csrf_ok(session, request.META.get(CSRF_HEADER)):
            raise CsrfFailed()
        return account, session

    def authenticate_header(self, request):
        return "Portal"


class IsPortalAccount(BasePermission):
    def has_permission(self, request, view):
        return isinstance(request.user, PortalAccount)


class PortalThrottle(SimpleRateThrottle):
    """Rates come from ``settings.PORTAL_THROTTLE_RATES`` at request time (overridable in tests)."""

    scope = "portal_read"

    def get_rate(self):
        rates = {**DEFAULT_RATES, **(getattr(settings, "PORTAL_THROTTLE_RATES", None) or {})}
        return rates[self.scope]

    def get_cache_key(self, request, view):
        user = request.user
        ident = f"account:{user.id}" if isinstance(user, PortalAccount) else f"ip:{client_ip(request)}"
        return self.cache_format % {"scope": self.scope, "ident": ident}


class PortalReadThrottle(PortalThrottle):
    scope = "portal_read"


class PortalRequestThrottle(PortalThrottle):
    scope = "portal_request"


class PortalMessageThrottle(PortalThrottle):
    scope = "portal_message"


class PortalDecisionThrottle(PortalThrottle):
    scope = "portal_decision"


class PortalUploadThrottle(PortalThrottle):
    """Counts only calls that carry files."""

    scope = "portal_upload"

    def allow_request(self, request, view):
        if not request.FILES:
            return True
        return super().allow_request(request, view)


class PortalLoginIPThrottle(PortalThrottle):
    scope = "portal_login_ip"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": client_ip(request) or "unknown"}


class PortalLoginUserThrottle(PortalThrottle):
    scope = "portal_login_user"

    def get_cache_key(self, request, view):
        username = request.data.get("username") if hasattr(request.data, "get") else ""
        username = username.strip().lower()[:150] if isinstance(username, str) else ""
        if not username:
            return None
        return self.cache_format % {"scope": self.scope, "ident": username}


class PortalAPIView(APIView):
    authentication_classes = [PortalAuthentication]
    permission_classes = [IsPortalAccount]
    throttle_classes = [PortalReadThrottle]
    endpoint = "portal"

    def get_throttles(self):
        extra = getattr(self, f"throttles_for_{self.request.method.lower()}", None)
        return [throttle() for throttle in (extra if extra is not None else self.throttle_classes)]

    def perform_authentication(self, request):
        super().perform_authentication(request)
        # Model saves read the "current user" from the Django request (crum). A portal account is
        # not a ``User``: rows written during a portal call carry no internal author.
        request._request.user = AnonymousUser()

    def http_method_not_allowed(self, request, *args, **kwargs):
        # Decision 7.2: an unsupported method answers like a missing object, for any id.
        raise exceptions.NotFound("مورد درخواستی پیدا نشد.")

    @property
    def account(self):
        return self.request.user

    def handle_exception(self, exc):
        if isinstance(exc, exceptions.Throttled):
            wait = int(exc.wait or 0)
            response = super().handle_exception(exc)
            response.data = {
                "error": f"تعداد درخواست‌ها زیاد است؛ {wait or 'چند'} ثانیه دیگر دوباره تلاش کنید.",
                "code": "throttled",
            }
            response.status_code = 429
            return response
        response = super().handle_exception(exc)
        code = getattr(exc, "default_code", None) if isinstance(exc, (SessionExpired, CsrfFailed)) else None
        if code:
            response.data = {"error": str(exc.detail), "code": code}
        elif isinstance(exc, exceptions.NotAuthenticated):
            response.status_code = 401
            response.data = {"error": "برای ادامه وارد درگاه مشتری شوید.", "code": "not_authenticated"}
        elif isinstance(response.data, dict):
            # One shape for the portal UI: {"error": "...", field: [...]}.
            data = dict(response.data)
            if "detail" in data:
                data["error"] = str(data.pop("detail"))
            if isinstance(data.get("error"), list) and data["error"]:
                data["error"] = str(data["error"][0])
            response.data = data
        elif isinstance(response.data, list) and response.data:
            response.data = {"error": str(response.data[0])}
        return response

    def finalize_response(self, request, response, *args, **kwargs):
        if response.status_code >= 400 and hasattr(response, "data") and isinstance(response.data, (dict, list)):
            response.data = persian_errors(response.data, response.status_code)
        response = super().finalize_response(request, response, *args, **kwargs)
        self.audit(request, response, kwargs)
        return response

    def audit(self, request, response, kwargs):
        user = getattr(request, "_user", None)
        account = user if isinstance(user, PortalAccount) else getattr(request, "portal_audit_account", None)
        status_code = response.status_code
        outcome = (
            "ok"
            if status_code < 400
            else {401: "unauthenticated", 403: "denied", 404: "not_found", 409: "conflict", 429: "throttled"}.get(
                status_code, "invalid" if status_code < 500 else "error"
            )
        )
        object_id = next((str(v) for k, v in kwargs.items() if k.endswith("_id") or k == "number"), "")
        PortalAuditLog.objects.create(
            workspace_id=account.workspace_id if account else None,
            account=account,
            username=(getattr(request, "portal_audit_username", "") or (account.username if account else ""))[:150],
            endpoint=self.endpoint,
            method=request.method[:8],
            object_id=object_id[:64],
            status_code=status_code,
            outcome=outcome,
            ip=client_ip(request),
            user_agent=(request.META.get("HTTP_USER_AGENT") or "")[:255],
        )
