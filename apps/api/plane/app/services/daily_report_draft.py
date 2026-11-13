"""Ticket 8 — draft suggestions for a daily report (decision 8.6). Single source of truth.

Deterministic and traceable, by construction:

- input is only the person's *own* recorded activity of that local day (workspace calendar
  zone): ticket history rows (``EntityEvent``), created tickets, comments (``IssueComment``),
  native ``IssueActivity``, workflow decisions (``WorkflowDecision``) and past calendar events
  they took part in (``WorkEvent``; an ``ActivityConfirmation`` of "not done" removes it);
- no language model and no free text: every suggestion is built from a fixed template and
  only names facts present in the data (a ticket number/title, an action, an event title).
  Comment bodies are never copied;
- every source is filtered with the person's *current* access before use: a ticket they no
  longer see is dropped, an internal comment counts only while they still hold the owner
  relation of the ticket (the ticket-7 rule for internal notes);
- several actions on one ticket are merged into one suggestion;
- suggestions are never stored: the person keeps, edits or drops each one and only an
  explicit save of the report persists the kept lines (with ``source_kind``/``source_id``).
"""

from datetime import datetime, time, timedelta

from django.db.models import Q
from django.utils import timezone

from plane.db.models import (
    ActivityConfirmation,
    EntityEvent,
    EntityRecord,
    Issue,
    IssueActivity,
    IssueComment,
    WorkEvent,
    WorkflowDecision,
)
from .report_scope import visible_ticket_ids
from .ticket_core import CATEGORY_TITLES, DONE, category_of, is_owner
from .work_calendar import calendar_zone

ACTION_TEMPLATES = {
    "ticket.category_changed": "تغییر وضعیت به «{after}»",
    "record.status_changed": "تغییر وضعیت",
    "ticket.closed": "بستن تیکت",
    "ticket.reopened": "بازگشایی تیکت",
    "ticket.referred": "ارجاع تیکت",
    "ticket.referral_accepted": "پذیرش ارجاع",
    "ticket.referral_rejected": "رد ارجاع",
    "ticket.routed": "ارجاع خودکار",
    "ticket.contact": "ثبت تماس با مشتری",
    "ticket.delay_reported": "ثبت گزارش تأخیر",
    "ticket.extension_requested": "درخواست تمدید موعد",
    "ticket.extension_approved": "تأیید تمدید موعد",
    "ticket.extension_rejected": "رد تمدید موعد",
    "ticket.target_changed": "تغییر مدت هدف",
    "portal.reply": "پاسخ به مشتری",
    "portal.request_approved": "پذیرش درخواست مشتری",
    "portal.request_rejected": "رد درخواست مشتری",
    "portal.info_requested": "درخواست تکمیل اطلاعات از مشتری",
    "quote.created": "ساخت برآورد هزینه",
    "quote.sent": "ارسال برآورد هزینه",
}
STATUS_FIELDS = ("ticket_state", "task_status", "status")
EVENT_TEMPLATES = {
    "meeting": "شرکت در جلسهٔ «{title}»",
    "mission": "انجام مأموریت «{title}»",
    "event": "شرکت در رویداد «{title}»",
}


def _bounds(day, workspace):
    zone = calendar_zone(workspace)
    start = datetime.combine(day, time(0), tzinfo=zone)
    return start, start + timedelta(days=1)


def _add(actions, issue_id, phrase, at):
    entry = actions.setdefault(issue_id, {"phrases": [], "at": at})
    if phrase not in entry["phrases"]:
        entry["phrases"].append(phrase)
    entry["at"] = max(entry["at"], at)


def suggestions(workspace, user, day, request=None, now=None):
    now = now or timezone.now()
    start, end = _bounds(day, workspace)
    end = min(end, now)
    zone = calendar_zone(workspace)
    actions = {}
    # 1. ticket history rows written by the person (EntityEvent on the ticket's record id).
    for row in EntityEvent.objects.filter(
        workspace=workspace, created_by=user, created_at__gte=start, created_at__lt=end
    ).filter(Q(event_type__in=ACTION_TEMPLATES) | Q(event_type="record.field_changed", field__in=STATUS_FIELDS)):
        template = ACTION_TEMPLATES.get(row.event_type, "تغییر وضعیت")
        after = row.after if isinstance(row.after, str) else ""
        phrase = (
            template.format(after=after) if "{after}" in template and after else template.replace(" به «{after}»", "")
        )
        _add(actions, row.record_id, phrase, row.created_at)
    # 2. tickets the person created that day.
    for issue_id, created in Issue.objects.filter(
        workspace=workspace, created_by=user, is_draft=False, created_at__gte=start, created_at__lt=end
    ).values_list("id", "created_at"):
        _add(actions, issue_id, "ثبت تیکت", created)
    # 3. comments (never their text).
    comments = list(
        IssueComment.objects.filter(
            workspace=workspace, issue__workspace=workspace, created_at__gte=start, created_at__lt=end
        )
        .filter(Q(actor=user) | Q(created_by=user, actor__isnull=True))
        .values("issue_id", "access", "created_at")
    )
    # 4. native Plane activity (project work items).
    for issue_id, field, created in IssueActivity.objects.filter(
        workspace=workspace, actor=user, created_at__gte=start, created_at__lt=end, issue__isnull=False
    ).values_list("issue_id", "field", "created_at"):
        if field in ("state", "status"):
            _add(actions, issue_id, "تغییر وضعیت", created)
        elif field in ("assignees",):
            _add(actions, issue_id, "تغییر مسئول", created)
        elif field and field not in ("comment", "attachment", "link"):
            _add(actions, issue_id, "به‌روزرسانی کار", created)
    candidate_ids = {key for key in actions if key} | {row["issue_id"] for row in comments}
    issues = {
        row.id: row
        for row in Issue.objects.filter(id__in=candidate_ids, workspace=workspace)
        .filter(id__in=visible_ticket_ids(user, workspace, request))
        .select_related("state", "project", "workspace")
    }
    owners = {}
    for row in comments:
        issue = issues.get(row["issue_id"])
        if issue is None:
            continue
        if row["access"] == "INTERNAL":
            if issue.id not in owners:
                owners[issue.id] = is_owner(issue, user, request)
            if not owners[issue.id]:
                continue
            _add(actions, issue.id, "ثبت یادداشت داخلی", row["created_at"])
        else:
            _add(actions, issue.id, "ثبت نظر", row["created_at"])
    numbers = dict(
        EntityRecord.objects.filter(workspace=workspace, source_id__in=list(issues), entity__code="ticket").values_list(
            "source_id", "number"
        )
    )
    result = []
    for issue_id, entry in actions.items():
        issue = issues.get(issue_id)
        if issue is None:
            continue  # no access any more (or not a ticket): never suggested
        number = numbers.get(issue.id) or f"#{issue.sequence_id}"
        category = category_of(issue)
        result.append(
            {
                "key": f"issue:{issue.id}",
                "kind": "done" if category == DONE else "in_progress",
                "text": f"{number} «{issue.name}»: {'، '.join(entry['phrases'])}",
                "source_kind": "issue",
                "source_id": str(issue.id),
                "source_label": f"تیکت {number} — وضعیت فعلی: {CATEGORY_TITLES[category]}",
                "issue": {"id": str(issue.id), "number": number, "title": issue.name},
                "link": f"/edit/ticket/{issue.id}",
                "at": entry["at"].astimezone(zone).isoformat(),
            }
        )
    # 5. workflow decisions taken by the person (no record details beyond the record type).
    for decision in (
        WorkflowDecision.objects.filter(
            actor=user, instance__workspace=workspace, created_at__gte=start, created_at__lt=end
        )
        .exclude(kind__in=("error", "start", "engine", "system"))
        .select_related("instance__entity")
        .order_by("created_at")
    ):
        entity = decision.instance.entity
        if entity.code == "ticket" and decision.instance.record_id not in issues:
            continue
        title = entity.title if entity else "فرایند"
        result.append(
            {
                "key": f"decision:{decision.id}",
                "kind": "done",
                "text": f"ثبت تصمیم در گردش‌کار «{title}»",
                "source_kind": "decision",
                "source_id": str(decision.id),
                "source_label": f"گردش‌کار — {title}",
                "issue": None,
                "link": None,
                "at": decision.created_at.astimezone(zone).isoformat(),
            }
        )
    # 6. calendar events of that day that are already over (planned never means done).
    events = list(
        WorkEvent.objects.filter(
            workspace=workspace,
            participant_rows__user=user,
            participant_rows__deleted_at__isnull=True,
            starts_at__lt=_bounds(day, workspace)[1],
            ends_at__gt=start,
            ends_at__lte=now,
        )
        .exclude(status=WorkEvent.Status.CANCELLED)
        .distinct()
        .order_by("starts_at")
    )
    outcomes = {
        row.source_id: row.outcome
        for row in ActivityConfirmation.objects.filter(
            workspace=workspace, user=user, source_type="event", source_id__in=[e.id for e in events]
        )
    }
    for event in events:
        if outcomes.get(event.id) == ActivityConfirmation.Outcome.NOT_DONE:
            continue
        result.append(
            {
                "key": f"event:{event.id}",
                "kind": "done",
                "text": EVENT_TEMPLATES[event.kind].format(title=event.title),
                "source_kind": "event",
                "source_id": str(event.id),
                "source_label": (
                    f"{event.get_kind_display()} تقویم — "
                    + (
                        "تأییدشده توسط شما"
                        if outcomes.get(event.id) == ActivityConfirmation.Outcome.DONE
                        else "پایان‌یافته"
                    )
                ),
                "issue": None,
                "link": "/calendar",
                "at": event.ends_at.astimezone(zone).isoformat(),
            }
        )
    result.sort(key=lambda row: row["at"])
    return result
