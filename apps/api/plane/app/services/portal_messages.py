"""Ticket 7 — correspondence on a ticket = native ``IssueComment`` rows (decision 7.5).

Single source of truth for message visibility:
- ``access="EXTERNAL"``: customer messages and the team's replies to the customer;
- ``access="INTERNAL"`` (the column default, so older comments never leak): internal notes.

The portal reads messages only through :func:`external_comments`, which filters in the
queryset; the portal payload is built from an explicit field whitelist
(:func:`portal_message`), never by removing keys from an internal serializer.
Text is stored as escaped plain text (``comment_html`` holds only ``<p>``/``<br>`` produced
here) and every UI shows ``comment_stripped`` as text, so customer input can never run as
markup in the internal UI.
"""

from django.db import transaction
from django.utils import timezone
from django.utils.html import escape
from rest_framework.exceptions import ValidationError

from plane.db.models import IssueComment, PORTAL_ATTACHMENT

from . import portal_files
from .ticket_core import fa_moment, iso, user_name

EXTERNAL, INTERNAL = "EXTERNAL", "INTERNAL"
MESSAGE_LIMIT = 5000


def clean_text(value, key="text", *, limit=MESSAGE_LIMIT, minimum=1, required=True):
    """Plain text only: tags are not interpreted, control characters are dropped."""
    text = value if isinstance(value, str) else ""
    text = "".join(ch for ch in text if ch in "\n\t" or ord(ch) >= 32).strip()
    if required and len(text) < minimum:
        raise ValidationError({key: "متن پیام را وارد کنید." if minimum <= 1 else f"حداقل {minimum} نویسه وارد کنید."})
    if len(text) > limit:
        raise ValidationError({key: f"حداکثر {limit} نویسه مجاز است."})
    return text


def to_html(text):
    return "".join(f"<p>{escape(line) or '<br>'}</p>" for line in text.split("\n")) or "<p></p>"


def post(issue, *, text, access, account=None, staff=None, checked_files=(), kind="message"):
    """One comment (+ its files) in the caller's transaction. ``checked_files`` come from portal_files."""
    if access not in (EXTERNAL, INTERNAL):
        raise ValidationError({"access": "سطح دید پیام معتبر نیست."})
    if account is not None and access != EXTERNAL:
        raise ValidationError({"access": "پیام مشتری همیشه قابل‌مشاهده برای مشتری است."})
    with transaction.atomic():
        comment = IssueComment(
            workspace_id=issue.workspace_id,
            project_id=issue.project_id,
            issue=issue,
            comment_html=to_html(text),
            comment_json={},
            access=access,
            actor=staff,
            portal_account=account,
            external_source="crm-portal" if kind != "message" else None,
            external_id=kind if kind != "message" else None,
        )
        comment.save(created_by_id=getattr(staff, "id", None), disable_auto_set_user=staff is None)
        files = portal_files.store(comment, checked_files, user=staff)
    return comment, files


def external_comments(issue):
    return IssueComment.objects.filter(issue=issue, access=EXTERNAL).order_by("created_at", "id")


def staff_label(comment, config):
    if config["staff_name"] == "display_name" and comment.actor_id:
        return comment.actor.display_name or config["team_name"]
    return config["team_name"]


def portal_message(comment, config, files):
    """Whitelisted fields only: no user id, e-mail, internal flag or storage path."""
    workspace = comment.workspace
    customer = comment.portal_account_id is not None
    return {
        "id": str(comment.id),
        "author": {
            "kind": "customer" if customer else "staff",
            "name": comment.portal_account.display_name if customer else staff_label(comment, config),
        },
        "kind": comment.external_id or "message",
        "text": comment.comment_stripped or "",
        "created_at": iso(comment.created_at, workspace),
        "created_text": fa_moment(comment.created_at, workspace),
        "files": [portal_files.file_payload(f, portal=True) for f in files],
    }


def portal_thread(issue, config):
    rows = list(external_comments(issue).select_related("actor", "portal_account", "workspace"))
    files = {}
    for asset in issue.assets.filter(
        entity_type=PORTAL_ATTACHMENT, comment_id__in=[r.id for r in rows], is_deleted=False
    ).order_by("created_at"):
        files.setdefault(asset.comment_id, []).append(asset)
    return [portal_message(row, config, files.get(row.id, [])) for row in rows]


def internal_thread(issue):
    """Both kinds, with the visibility marked — for the internal ticket panel only."""
    rows = list(
        IssueComment.objects.filter(issue=issue)
        .select_related("actor", "portal_account", "workspace")
        .order_by("created_at", "id")
    )
    files = {}
    for asset in issue.assets.filter(
        entity_type=PORTAL_ATTACHMENT, comment_id__in=[r.id for r in rows], is_deleted=False
    ).order_by("created_at"):
        files.setdefault(asset.comment_id, []).append(asset)
    workspace = issue.workspace
    return [
        {
            "id": str(row.id),
            "access": row.access,
            "kind": row.external_id or "message",
            "author": {
                "kind": "customer" if row.portal_account_id else "staff",
                "name": row.portal_account.display_name if row.portal_account_id else user_name(row.actor),
            },
            "text": row.comment_stripped or "",
            "created_at": iso(row.created_at, workspace),
            "created_text": fa_moment(row.created_at, workspace),
            "files": [portal_files.file_payload(f, portal=False) for f in files.get(row.id, [])],
        }
        for row in rows
    ]


def last_external_at(issue, *, from_staff=None):
    rows = external_comments(issue)
    if from_staff is True:
        rows = rows.filter(portal_account__isnull=True)
    elif from_staff is False:
        rows = rows.filter(portal_account__isnull=False)
    row = rows.order_by("-created_at").values_list("created_at", flat=True).first()
    return row


def now():
    return timezone.now()
