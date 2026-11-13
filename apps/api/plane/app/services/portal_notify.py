"""Ticket 7 — notifications around the customer portal (decision 7.11).

- To the customer: in-portal only by default — the "new" badge is computed from the
  request's own rows (EXTERNAL replies, status, quotes) against ``PortalAccount.seen``.
- E-mail / SMS: an adapter layer that is OFF unless *both* the server setting
  ``PORTAL_NOTIFY_CHANNELS`` and the workspace setting enable a channel, and the customer
  has not switched it off. Even then the only adapters shipped are ``DisabledAdapter``s
  that record nothing and call no external service; a real provider needs its own
  service, texts, approval and configuration (see the delivery report, section 9).
- To the team: the existing ``crm_notifications.notify_members``.
"""

from django.conf import settings

from .crm_notifications import notify_members

TEMPLATES = {
    "reply": {
        "subject": "پاسخ جدید به درخواست {number}",
        "body": "{name} گرامی، برای درخواست «{title}» پاسخ جدیدی ثبت شد. برای دیدن آن وارد درگاه مشتری شوید.",
    },
    "status": {
        "subject": "تغییر وضعیت درخواست {number}",
        "body": "{name} گرامی، وضعیت درخواست «{title}» به «{status}» تغییر کرد.",
    },
    "quote": {
        "subject": "برآورد هزینه برای درخواست {number}",
        "body": "{name} گرامی، برآورد هزینهٔ درخواست «{title}» آمادهٔ بررسی شماست.",
    },
}


class DisabledAdapter:
    """Placeholder for a provider that has not been chosen. Never talks to the network."""

    def __init__(self, channel):
        self.channel = channel

    def send(self, account, subject, body):
        return False


ADAPTERS = {"email": DisabledAdapter("email"), "sms": DisabledAdapter("sms")}


def render(template, **context):
    item = TEMPLATES[template]
    return item["subject"].format(**context), item["body"].format(**context)


def enabled_channels(account, config):
    server = set(getattr(settings, "PORTAL_NOTIFY_CHANNELS", ()) or ())
    wanted = {"email": account.notify_email, "sms": account.notify_sms}
    return [
        channel
        for channel in ("email", "sms")
        if channel in server and config["notify_channels"].get(channel) and wanted[channel]
    ]


def notify_customer(issue, template, config, **context):
    """External delivery to the request's submitter; a no-op with default settings."""
    account = issue.portal_account
    if account is None or not account.is_active:
        return 0
    channels = enabled_channels(account, config)
    if not channels:
        return 0
    subject, body = render(template, name=account.display_name, title=issue.name, **context)
    return sum(1 for channel in channels if ADAPTERS[channel].send(account, subject, body))


def team_receivers(issue):
    from plane.db.models import IssueAssignee, TicketRoutingDecision

    receivers = set(
        IssueAssignee.objects.filter(issue=issue, deleted_at__isnull=True).values_list("assignee_id", flat=True)
    )
    if not receivers:
        last = TicketRoutingDecision.objects.filter(issue=issue).order_by("-created_at").first()
        if last and last.rule_id and last.rule.unit_id and last.rule.unit.manager_id:
            receivers.add(last.rule.unit.manager_id)
    if not receivers:
        from plane.db.models import WorkspaceMember

        from .access_control import has_permission

        for row in WorkspaceMember.objects.filter(
            workspace_id=issue.workspace_id, is_active=True, member__is_active=True, member__is_bot=False
        ).select_related("member"):
            if has_permission(row.member, issue.workspace_id, "Portal.Request.Triage"):
                receivers.add(row.member_id)
    return receivers


def notify_team(issue, kind, title, message):
    notify_members(
        issue.workspace_id,
        list(team_receivers(issue)),
        actor_id=None,
        sender=f"crm:portal:{kind}",
        project_id=issue.project_id,
        entity_name="issue",
        entity_id=issue.id,
        title=title,
        message=message,
        data={"crm_event": {"kind": f"portal_{kind}", "entity": "ticket", "record_id": str(issue.id)}},
    )
