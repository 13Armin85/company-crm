"""Server versions of the table filters the CRM pages used to run in the browser.

Rules mirror ``apps/web/app/crm/filter-rules.ts`` so a filtered page shows the
same rows the old in-browser filter showed.
"""

import re
from datetime import date

from django.db.models import Q

UNASSIGNED = "__unassigned__"
WORKSPACE_TASKS = "__workspace__"
DEADLINE_MODES = {"all", "with-date", "overdue", "today", "upcoming", "no-date"}
_REVIEW = r"(review|بازبینی)"


def parse_day(value):
    try:
        return date.fromisoformat(value) if value else None
    except ValueError:
        return None


def deadline_q(request, field, completed=Q(pk__in=[])):
    """Deadline filter on a date column. ``today`` comes from the viewer's time zone."""
    mode = request.query_params.get("deadline", "all")
    mode = mode if mode in DEADLINE_MODES else "all"
    due_from = parse_day(request.query_params.get("due_from"))
    due_to = parse_day(request.query_params.get("due_to"))
    today = parse_day(request.query_params.get("today")) or date.today()
    if mode == "no-date":
        return Q(**{f"{field}__isnull": True})
    if mode == "all" and not due_from and not due_to:
        return Q()
    query = Q(**{f"{field}__isnull": False})
    if due_from:
        query &= Q(**{f"{field}__gte": due_from})
    if due_to:
        query &= Q(**{f"{field}__lte": due_to})
    if mode == "overdue":
        query &= Q(**{f"{field}__lt": today}) & ~completed
    elif mode == "today":
        query &= Q(**{field: today})
    elif mode == "upcoming":
        query &= Q(**{f"{field}__gt": today})
    return query


def status_q(statuses, group="state__group", name="state__name"):
    """Map UI statuses back to Plane state groups (see issue-status.ts)."""
    query = Q()
    for value in statuses:
        if value == "Todo":
            query |= Q(**{f"{group}__in": ["backlog", "unstarted"]})
        elif value == "In Progress":
            query |= Q(**{group: "started"}) & ~Q(**{f"{name}__iregex": _REVIEW})
        elif value == "Review":
            query |= Q(**{group: "started", f"{name}__iregex": _REVIEW})
        elif value == "Done":
            query |= Q(**{group: "completed"})
        elif value == "Blocked":
            query |= Q(**{group: "cancelled"})
    return query


def status_from_state(group, name):
    category = (group or "").strip().lower()
    review = bool(re.search(_REVIEW, name or "", re.I))
    if category in {"backlog", "unstarted"}:
        return "Todo"
    if category == "started":
        return "Review" if review else "In Progress"
    if category == "completed":
        return "Done"
    if category == "cancelled":
        return "Blocked"
    return "Review" if review else "Todo"
