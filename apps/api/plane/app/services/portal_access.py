"""Ticket 7 — customer portal identity: accounts, login, sessions and scope.

Single source of truth for *who* a portal caller is and *which data* they may touch:

- identity is a ``PortalAccount`` (decision 7.1), never a ``User``; internal endpoints
  authenticate only the Django session cookie, so they never see a portal caller;
- a session is a random token in an HttpOnly cookie whose SHA-256 is stored in
  ``PortalSession``; idle and absolute expiry, explicit logout, account deactivation
  and password change all end it on the server;
- the data scope is computed from the account only (:func:`request_queryset`): a
  customer id is never read from a query string or a body (decision 7.2).

Account changes are ``EntityEvent`` rows on the linked customer record. Tokens and
passwords are never written to any event, log or response other than the one-time
set-up link returned to the internal user who issued it.
"""

import hashlib
import hmac
import re
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from plane.db.models import (
    EntityEvent,
    EntityRecord,
    EntityRelationLink,
    EntityType,
    Issue,
    PortalAccount,
    PortalSession,
)

from . import portal_settings

SETUP_HOURS = 72
USERNAME = re.compile(r"^[a-z0-9][a-z0-9._@+-]{2,149}$")
GENERIC_LOGIN_ERROR = "نام کاربری یا گذرواژه نادرست است."
# A real hash so an unknown username costs the same as a wrong password.
_DUMMY_HASH = make_password("portal-dummy-password")


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def root_entity(workspace_id, code):
    return EntityType.objects.filter(workspace_id=workspace_id, code=code, parent__isnull=True, is_active=True).first()


def record_title(record):
    if record is None:
        return ""
    return str((record.data or {}).get(record.entity.title_field) or record.number or "")


def _event(account, actor, event_type, **metadata):
    entity = root_entity(account.workspace_id, "customer")
    event = EntityEvent(
        workspace_id=account.workspace_id,
        entity=entity,
        record_id=account.customer_record_id,
        event_type=event_type,
        metadata={"account_id": str(account.id), "username": account.username, **metadata},
        created_by_id=getattr(actor, "id", None),
    )
    event.save(created_by_id=getattr(actor, "id", None), disable_auto_set_user=actor is None)
    return event


# ------------------------------------------------------------------ accounts (internal users)


def _customer(workspace, record_id):
    entity = root_entity(workspace.id, "customer")
    if entity is None:
        raise ValidationError({"customer_record_id": "موجودیت «مشتری» در این شرکت تعریف نشده است."})
    row = (
        EntityRecord.objects.filter(entity=entity, workspace=workspace, id=record_id, is_active=True)
        .select_related("entity")
        .first()
        if record_id
        else None
    )
    if row is None:
        raise ValidationError({"customer_record_id": "رکورد مشتری را انتخاب کنید."})
    return row


def _contact(workspace, customer, record_id):
    if not record_id:
        return None
    entity = root_entity(workspace.id, "contact")
    row = (
        EntityRecord.objects.filter(entity=entity, workspace=workspace, id=record_id, is_active=True)
        .select_related("entity")
        .first()
        if entity
        else None
    )
    if row is None:
        raise ValidationError({"contact_record_id": "رکورد مخاطب پیدا نشد."})
    linked = EntityRelationLink.objects.filter(relation__deleted_at__isnull=True).filter(
        Q(left_id=customer.id, right_id=row.id) | Q(left_id=row.id, right_id=customer.id)
    )
    if not linked.exists():
        raise ValidationError({"contact_record_id": "این مخاطب به مشتری انتخاب‌شده وصل نیست."})
    return row


def _username(value):
    value = value.strip().lower() if isinstance(value, str) else ""
    if not USERNAME.match(value):
        raise ValidationError({"username": "نام کاربری باید ۳ تا ۱۵۰ نویسهٔ لاتین (حرف، عدد، . _ @ + -) باشد."})
    return value


def _clean_text(data, key, limit, required=False):
    value = data.get(key)
    value = value.strip() if isinstance(value, str) else ""
    if required and not value:
        raise ValidationError({key: "تکمیل این فیلد الزامی است."})
    if len(value) > limit:
        raise ValidationError({key: f"حداکثر {limit} نویسه مجاز است."})
    return value


def issue_setup_link(account, actor):
    """One-time, time-limited link the internal user hands over manually (no e-mail is sent)."""
    token = secrets.token_urlsafe(32)
    account.setup_token_hash = digest(token)
    account.setup_expires_at = timezone.now() + timedelta(hours=SETUP_HOURS)
    account.save(update_fields=["setup_token_hash", "setup_expires_at", "updated_at"])
    _event(account, actor, "portal.account_link_issued", expires_at=account.setup_expires_at.isoformat())
    return {"path": f"/portal/setup?token={token}", "expires_at": account.setup_expires_at.isoformat()}


def create_account(workspace, actor, data):
    with transaction.atomic():
        customer = _customer(workspace, data.get("customer_record_id"))
        contact = _contact(workspace, customer, data.get("contact_record_id"))
        username = _username(data.get("username"))
        if PortalAccount.objects.filter(username=username, deleted_at__isnull=True).exists():
            raise ValidationError({"username": "این نام کاربری قبلاً ثبت شده است."})
        account = PortalAccount.objects.create(
            workspace=workspace,
            customer_record=customer,
            contact_record=contact,
            username=username,
            display_name=_clean_text(data, "display_name", 255, required=True),
            email=_clean_text(data, "email", 255),
            phone=_clean_text(data, "phone", 32),
            created_by_id=actor.id,
        )
        _event(account, actor, "portal.account_created", customer=record_title(customer))
        link = issue_setup_link(account, actor)
    return account, link


def update_account(workspace, actor, account_id, data):
    with transaction.atomic():
        account = PortalAccount.objects.select_for_update().filter(workspace=workspace, id=account_id).first()
        if account is None:
            raise NotFound("حساب درگاه پیدا نشد.")
        changes = {}
        for key, limit in (("display_name", 255), ("email", 255), ("phone", 32)):
            if key in data:
                value = _clean_text(data, key, limit, required=key == "display_name")
                if value != getattr(account, key):
                    changes[key] = [getattr(account, key), value]
                    setattr(account, key, value)
        if "is_active" in data:
            if not isinstance(data["is_active"], bool):
                raise ValidationError({"is_active": "وضعیت حساب معتبر نیست."})
            if data["is_active"] != account.is_active:
                changes["is_active"] = [account.is_active, data["is_active"]]
                account.is_active = data["is_active"]
                if not account.is_active:
                    account.session_version += 1
                    revoke_all(account, "deactivated")
        account.save()
        if "is_active" in changes:
            _event(account, actor, "portal.account_activated" if account.is_active else "portal.account_deactivated")
        if set(changes) - {"is_active"}:
            _event(
                account, actor, "portal.account_updated", changes={k: v for k, v in changes.items() if k != "is_active"}
            )
    return account


def account_payload(account):
    return {
        "id": str(account.id),
        "username": account.username,
        "display_name": account.display_name,
        "email": account.email,
        "phone": account.phone,
        "is_active": account.is_active,
        "has_password": bool(account.password),
        "locked": bool(account.locked_until and account.locked_until > timezone.now()),
        "last_login_at": account.last_login_at.isoformat() if account.last_login_at else None,
        "customer": {"id": str(account.customer_record_id), "title": record_title(account.customer_record)},
        "contact": (
            {"id": str(account.contact_record_id), "title": record_title(account.contact_record)}
            if account.contact_record_id
            else None
        ),
    }


# ------------------------------------------------------------------ password set-up (customer)


def set_password_with_token(token, password):
    if not isinstance(token, str) or not token or not isinstance(password, str):
        raise ValidationError({"token": "پیوند تعیین گذرواژه معتبر نیست یا منقضی شده است."})
    with transaction.atomic():
        account = (
            PortalAccount.objects.select_for_update()
            .filter(setup_token_hash=digest(token), deleted_at__isnull=True)
            .first()
        )
        if account is None or not account.setup_expires_at or account.setup_expires_at < timezone.now():
            raise ValidationError({"token": "پیوند تعیین گذرواژه معتبر نیست یا منقضی شده است."})
        if not account.is_active:
            raise ValidationError({"token": "این حساب غیرفعال است."})
        if len(password) < 10:
            raise ValidationError({"password": "گذرواژه باید دست‌کم ۱۰ نویسه باشد."})
        try:
            validate_password(password)
        except DjangoValidationError as exc:
            raise ValidationError({"password": list(exc.messages)})
        account.password = make_password(password)
        account.password_changed_at = timezone.now()
        account.setup_token_hash, account.setup_expires_at = "", None
        account.failed_attempts, account.locked_until = 0, None
        account.session_version += 1
        account.save()
        revoke_all(account, "password_changed")
        _event(account, None, "portal.password_set")
    return account


# ------------------------------------------------------------------ login, sessions and logout


def login(username, password, *, ip=None, user_agent=""):
    """Returns (account, raw session token, raw csrf token). Wrong credentials share one message."""
    username = username.strip().lower() if isinstance(username, str) else ""
    password = password if isinstance(password, str) else ""
    now = timezone.now()
    with transaction.atomic():
        account = (
            PortalAccount.objects.select_for_update()
            .select_related("workspace")
            .filter(username=username, deleted_at__isnull=True)
            .first()
            if username
            else None
        )
        if account is None:
            check_password(password, _DUMMY_HASH)
            raise ValidationError({"error": GENERIC_LOGIN_ERROR})
        config = portal_settings.load(account.workspace)
        if account.locked_until and account.locked_until > now:
            minutes = max(1, int((account.locked_until - now).total_seconds() // 60) + 1)
            raise PermissionDenied(f"به‌دلیل تلاش‌های ناموفق، ورود به این حساب تا {minutes} دقیقهٔ دیگر قفل است.")
        valid = bool(account.password) and check_password(password, account.password)
        # The failure is raised after the atomic block so the attempt counter is committed.
        failure = None
        if not valid:
            account.failed_attempts += 1
            if account.failed_attempts >= config["lockout"]["attempts"]:
                account.locked_until = now + timedelta(minutes=config["lockout"]["minutes"])
                account.failed_attempts = 0
                _event(account, None, "portal.account_locked")
            account.save(update_fields=["failed_attempts", "locked_until", "updated_at"])
            failure = GENERIC_LOGIN_ERROR
        elif not account.is_active:
            # Same message as a wrong password: the login form never reveals which accounts exist.
            failure = GENERIC_LOGIN_ERROR
        else:
            account.failed_attempts, account.locked_until, account.last_login_at = 0, None, now
            account.save(update_fields=["failed_attempts", "locked_until", "last_login_at", "updated_at"])
            token = secrets.token_urlsafe(32)
            csrf = csrf_token_for(digest(token))
            PortalSession.objects.create(
                account=account,
                key_hash=digest(token),
                csrf_hash=digest(csrf),
                session_version=account.session_version,
                last_seen_at=now,
                expires_at=now + timedelta(hours=config["session"]["absolute_hours"]),
                ip=ip,
                user_agent=(user_agent or "")[:255],
            )
    if failure:
        raise ValidationError({"error": failure})
    return account, token, csrf


def revoke(session, reason):
    if session.revoked_at is None:
        session.revoked_at, session.revoked_reason = timezone.now(), reason
        session.save(update_fields=["revoked_at", "revoked_reason", "updated_at"])


def revoke_all(account, reason):
    PortalSession.objects.filter(account=account, revoked_at__isnull=True).update(
        revoked_at=timezone.now(), revoked_reason=reason
    )


def resolve_session(raw_token):
    """(account, session) for a live session, or (None, reason) — the reason drives the UI message."""
    if not raw_token:
        return None, "missing"
    session = (
        PortalSession.objects.select_related("account", "account__workspace").filter(key_hash=digest(raw_token)).first()
    )
    if session is None or session.revoked_at is not None:
        return None, "expired"
    account = session.account
    now = timezone.now()
    if account.deleted_at is not None or not account.is_active or session.session_version != account.session_version:
        revoke(session, "account_changed")
        return None, "expired"
    config = portal_settings.load(account.workspace)
    if now >= session.expires_at:
        revoke(session, "absolute")
        return None, "expired"
    if now - session.last_seen_at > timedelta(minutes=config["session"]["idle_minutes"]):
        revoke(session, "idle")
        return None, "expired"
    if (now - session.last_seen_at).total_seconds() > 30:
        PortalSession.objects.filter(id=session.id).update(last_seen_at=now)
        session.last_seen_at = now
    return account, session


def csrf_ok(session, header_value):
    return bool(header_value) and hmac.compare_digest(session.csrf_hash, digest(header_value))


def csrf_token_for(key_hash):
    """The session's CSRF token: derived (HMAC with the server secret) from the session key hash,
    so every tab of one session shares it and a reload can hand it out again without storing it."""
    return hmac.new(settings.SECRET_KEY.encode(), f"portal-csrf:{key_hash}".encode(), hashlib.sha256).hexdigest()


def session_csrf(session):
    return csrf_token_for(session.key_hash)


# ------------------------------------------------------------------ data scope


def request_queryset(account):
    """Every portal read and write starts here: the account's own customer, never an input value."""
    return Issue.objects.filter(
        workspace_id=account.workspace_id,
        portal_account__customer_record_id=account.customer_record_id,
        portal_account__workspace_id=account.workspace_id,
    )


def own_request(account, issue_id, lock=False):
    """The request or 404 — another customer's request is indistinguishable from a missing one."""
    rows = request_queryset(account)
    if lock:
        rows = rows.select_for_update(of=("self",))
    try:
        return rows.select_related("state", "workspace").get(id=issue_id)
    except (Issue.DoesNotExist, ValueError, TypeError, DjangoValidationError):
        raise NotFound("درخواست پیدا نشد.")
