"""Ticket 8 — report sources and the one report execution path (decisions 8.9, 8.10, 8.12).

A *source* declares a whitelist of fields (type, Persian label, whether it can be filtered,
grouped or aggregated, and how it is computed) and a function that builds its rows from the
scope given by ``report_scope`` (and the date range), with a constant number of queries.
Base reports are the same sources with their default definition: there is one run path
(:func:`run`), shared by the page, saved reports, counts and the file export.

Definition (validated here against the registry; unknown field/operator → 400 in Persian)::

    {"columns": [field, …], "filters": [{"field", "op", "value"}, …],
     "range": {"type": "relative", "days": 30} | {"type": "absolute", "from", "to"} | null,
     "sort": [{"field", "dir": "asc"|"desc"}, …], "group_by": [field, ≤2],
     "aggregates": [{"fn": "count"} | {"fn": "sum"|"avg", "field": numeric field}, …]}

A saved definition that no longer fits the source (a removed column, an incompatible
schema version) is refused with :class:`Incompatible` — never silently trimmed.

Nothing here computes attendance, entry/exit, lateness or overtime; ``effort_minutes`` of a
daily report is not exposed as working time anywhere.
"""

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal

from django.db import connection, transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError

from plane.db.models import (
    DailyReportItem,
    EntityEvent,
    EntityRecord,
    EntityRelationLink,
    EntityType,
    Issue,
    IssueAssignee,
    IssueComment,
    LeaveRequest,
    LookupValue,
    OrganizationUnitMember,
    PresenceDeclaration,
    User,
    WorkEvent,
    WorkflowDecision,
    WorkflowDelayReport,
    WorkflowExtension,
)
from . import daily_reports as reports
from .access_control import has_permission
from .entity_view_export import jalali
from .report_scope import Scope, people_scope, ticket_rows
from .ticket_core import CATEGORY_TITLES, DONE, category_of, deadline_states, overdue_q
from .work_calendar import bulk_resolvers, calendar_zone, local_today

STATEMENT_TIMEOUT_MS = 15000
MAX_GROUPS = 500
OPS = {
    "text": ("contains", "eq", "ne", "empty", "not_empty"),
    "number": ("eq", "ne", "gt", "gte", "lt", "lte", "empty", "not_empty"),
    "date": ("eq", "gte", "lte", "empty", "not_empty"),
    "datetime": ("gte", "lte", "empty", "not_empty"),
    "choice": ("eq", "ne", "in", "not_in"),
    "person": ("in", "not_in"),
    "bool": ("is",),
}
OP_TITLES = {
    "contains": "شامل",
    "eq": "برابر",
    "ne": "نابرابر",
    "gt": "بزرگ‌تر از",
    "gte": "از / بزرگ‌تر یا برابر",
    "lt": "کوچک‌تر از",
    "lte": "تا / کوچک‌تر یا برابر",
    "in": "یکی از",
    "not_in": "هیچ‌کدام از",
    "empty": "خالی",
    "not_empty": "خالی نیست",
    "is": "هست",
}
AGG_TITLES = {"count": "تعداد", "sum": "جمع", "avg": "میانگین"}


class Incompatible(APIException):
    status_code = 409
    default_code = "incompatible"
    default_detail = "تعریف گزارش با ساختار فعلی منبع سازگار نیست؛ گزارش را ویرایش کنید."


class TooLarge(APIException):
    status_code = 400
    default_code = "too_large"
    default_detail = (
        "نتیجهٔ این گزارش بزرگ‌تر از حد اجرای هم‌زمان است؛ بازه یا فیلتر را محدود کنید یا خروجی پس‌زمینه بگیرید."
    )


@dataclass
class Field:
    key: str
    label: str
    type: str
    filter: bool = True
    group: bool = False
    agg: bool = False
    choices: dict = None
    method: str = ""


@dataclass
class Context:
    workspace: object
    viewer: object
    scope: Scope
    date_from: date | None
    date_to: date | None
    now: datetime
    request: object
    limit: int
    zone: object = None
    filters: list = field(default_factory=list)

    def cap(self, rows):
        """Materialize at most ``limit`` rows; a larger result needs the background path."""
        rows = list(rows[: self.limit + 1]) if hasattr(rows, "__getitem__") else list(rows)
        if len(rows) > self.limit:
            raise TooLarge()
        return rows

    def moment_range(self):
        start = datetime.combine(self.date_from, datetime.min.time(), tzinfo=self.zone)
        end = datetime.combine(self.date_to + timedelta(days=1), datetime.min.time(), tzinfo=self.zone)
        return start, end

    def requested_people(self, key):
        """User ids requested by an ``in`` filter on a person field, narrowed to the scope."""
        for rule in self.filters:
            if rule.get("field") == key and rule.get("op") == "in":
                return self.scope.narrow(rule.get("value") or [])
        return None


@dataclass
class Source:
    code: str
    title: str
    description: str
    fields: list
    build: object
    default: dict
    version: int = 1
    compatible_since: int = 1
    date_field: str = ""
    date_label: str = ""
    range_required: bool = False
    note: str = ""
    team_source: str = "default"

    def field(self, key):
        return next((f for f in self.fields if f.key == key), None)


# ---------------------------------------------------------------- shared row helpers


def _name(user):
    return (user.display_name or user.email or user.username) if user else ""


def _person(user):
    return {"id": str(user.id), "name": _name(user)} if user else None


def _ticket_numbers(workspace, ids):
    return dict(
        EntityRecord.objects.filter(workspace=workspace, source_id__in=list(ids), entity__code="ticket").values_list(
            "source_id", "number"
        )
    )


def _number(numbers, issue):
    return numbers.get(issue.id) or f"#{issue.sequence_id}"


def _assignees(issue_ids):
    """{issue_id: [User…]} oldest first (the first one is the primary assignee)."""
    result = defaultdict(list)
    for row in (
        IssueAssignee.objects.filter(issue_id__in=list(issue_ids), deleted_at__isnull=True)
        .select_related("assignee")
        .order_by("created_at", "id")
    ):
        result[row.issue_id].append(row.assignee)
    return result


def _status_titles(workspace):
    return dict(
        LookupValue.objects.filter(category__workspace=workspace, category__code="task-status").values_list(
            "code", "title"
        )
    )


def _status(issue, lookup):
    if issue.project_id:
        return issue.state.name if issue.state_id else "—"
    return lookup.get(issue.status) or issue.status or "—"


def _units(workspace, user_ids):
    result = {}
    for user_id, title in (
        OrganizationUnitMember.objects.filter(
            unit__workspace=workspace, unit__is_active=True, is_active=True, user_id__in=list(user_ids)
        )
        .order_by("unit__title")
        .values_list("user_id", "unit__title")
    ):
        result.setdefault(user_id, title)
    return result


def _visible_records(entity, viewer, ids, request):
    from .entity_records import permission, record_queryset

    if entity is None or not ids or not permission(entity, viewer, "view", request):
        return {}
    title = entity.title_field
    return {
        str(row.id): (row.data or {}).get(title) or row.number or entity.title
        for row in record_queryset(entity, viewer, request).filter(id__in=list(ids))
    }


def _related(workspace, viewer, issue_ids, codes, request):
    """{issue_id: [(code, title)…]} through the existing EntityRelationLink rows only."""
    entities = {
        row.code: row
        for row in EntityType.objects.filter(workspace=workspace, code__in=codes, parent__isnull=True, is_active=True)
    }
    if not entities or not issue_ids:
        return {}
    by_id = {row.id: row for row in entities.values()}
    ids = list(issue_ids)
    links = list(
        EntityRelationLink.objects.filter(relation__deleted_at__isnull=True)
        .filter(
            Q(left_id__in=ids, relation__right_entity_id__in=list(by_id))
            | Q(right_id__in=ids, relation__left_entity_id__in=list(by_id))
        )
        .values("left_id", "right_id", "relation__left_entity_id", "relation__right_entity_id")
    )
    wanted = defaultdict(set)
    pairs = []
    id_set = set(ids)
    for link in links:
        if link["left_id"] in id_set and link["relation__right_entity_id"] in by_id:
            issue_id, other, entity_id = link["left_id"], link["right_id"], link["relation__right_entity_id"]
        else:
            issue_id, other, entity_id = link["right_id"], link["left_id"], link["relation__left_entity_id"]
        wanted[entity_id].add(other)
        pairs.append((issue_id, entity_id, str(other)))
    titles = {
        entity_id: _visible_records(by_id[entity_id], viewer, others, request) for entity_id, others in wanted.items()
    }
    result = defaultdict(list)
    seen = set()
    for issue_id, entity_id, other in pairs:
        title = titles.get(entity_id, {}).get(other)
        if title is None or (issue_id, entity_id, other) in seen:
            continue
        seen.add((issue_id, entity_id, other))
        result[issue_id].append((by_id[entity_id].code, title))
    return result


def _tickets(ctx, date_field=None):
    rows = ticket_rows(ctx.viewer, ctx.workspace, ctx.scope, ctx.request)
    if date_field and ctx.date_from:
        start, end = ctx.moment_range()
        rows = rows.filter(**{f"{date_field}__gte": start, f"{date_field}__lt": end})
    requested = ctx.requested_people("assignee")
    if requested is not None:
        rows = rows.filter(issue_assignee__assignee_id__in=list(requested), issue_assignee__deleted_at__isnull=True)
    return rows.select_related("state", "project", "type").order_by("-updated_at", "id")


CATEGORY_CHOICES = dict(CATEGORY_TITLES)
KIND_CHOICES = {"standalone": "تیکت / کار مستقل", "project": "کار پروژه"}
PRIORITY_CHOICES = {"urgent": "فوری", "high": "زیاد", "medium": "متوسط", "low": "کم", "none": "بدون اولویت"}


# ---------------------------------------------------------------- 1. my_work


def build_my_work(ctx):
    issues = ctx.cap(_tickets(ctx, "updated_at"))
    ids = [i.id for i in issues]
    numbers, people, lookup = _ticket_numbers(ctx.workspace, ids), _assignees(ids), _status_titles(ctx.workspace)
    customers = _related(ctx.workspace, ctx.viewer, ids, ["customer"], ctx.request)
    rows = []
    for issue in issues:
        assignees = people.get(issue.id, [])
        category = category_of(issue)
        rows.append(
            {
                "number": _number(numbers, issue),
                "title": issue.name,
                "kind": "project" if issue.project_id else "standalone",
                "category": category,
                "status": _status(issue, lookup),
                "assignee": _person(assignees[0]) if assignees else None,
                "assignees": "، ".join(_name(u) for u in assignees),
                "project": issue.project.name if issue.project_id else "",
                "customer": "، ".join(title for _, title in customers.get(issue.id, [])),
                "type": issue.type.name if issue.type_id else "",
                "priority": issue.priority or "none",
                "created_at": issue.created_at,
                "updated_at": issue.updated_at,
                "target_at": issue.target_at,
                "overdue": bool(
                    issue.target_at and issue.target_anchor_at and category != DONE and ctx.now > issue.target_at
                ),
                "_link": f"/edit/ticket/{issue.id}",
            }
        )
    return rows


MY_WORK = Source(
    code="my_work",
    title="کارهای من / تیم",
    description="تیکت‌ها و کارهای مستقل و پروژه‌ای که مسئول آن‌ها شما (یا افراد زیرمجموعهٔ شما) هستید.",
    fields=[
        Field("number", "شماره", "text"),
        Field("title", "عنوان", "text"),
        Field("kind", "نوع", "choice", group=True, choices=KIND_CHOICES),
        Field(
            "category",
            "دستهٔ وضعیت",
            "choice",
            group=True,
            choices=CATEGORY_CHOICES,
            method="نگاشت واحد ticket_core (انجام‌نشده / در حال انجام / انجام‌شده)",
        ),
        Field("status", "وضعیت", "text", group=True),
        Field("assignee", "مسئول اصلی", "person", group=True, method="قدیمی‌ترین مسئول فعال"),
        Field("assignees", "همهٔ مسئولان", "text"),
        Field("project", "پروژه", "text", group=True),
        Field(
            "customer",
            "مشتری",
            "text",
            group=True,
            method="فقط از رابطهٔ ثبت‌شدهٔ مشتری↔تیکت و رکوردهای قابل‌دیدن برای شما",
        ),
        Field("type", "نوع تیکت", "text", group=True),
        Field("priority", "اولویت", "choice", group=True, choices=PRIORITY_CHOICES),
        Field("created_at", "زمان ثبت", "datetime"),
        Field("updated_at", "آخرین تغییر", "datetime"),
        Field("target_at", "موعد", "datetime"),
        Field("overdue", "عقب‌افتاده", "bool", group=True, method="باز و موعد تقویمی گذشته (ticket_core.overdue_q)"),
    ],
    build=build_my_work,
    default={
        "columns": [
            "number",
            "title",
            "category",
            "status",
            "assignee",
            "project",
            "customer",
            "target_at",
            "updated_at",
        ],
        "filters": [{"field": "category", "op": "ne", "value": "done"}],
        "range": None,
        "sort": [{"field": "updated_at", "dir": "desc"}],
        "group_by": [],
        "aggregates": [{"fn": "count"}],
    },
    date_field="updated_at",
    date_label="آخرین تغییر",
)


# ---------------------------------------------------------------- 2. daily_reports


def build_daily_reports(ctx):
    people = ctx.requested_people("person")
    user_ids = people if people is not None else ctx.scope.user_ids
    days = (ctx.date_to - ctx.date_from).days + 1
    if len(user_ids) * days > ctx.limit:
        raise TooLarge()
    statuses = reports.day_statuses(ctx.workspace, user_ids, ctx.date_from, ctx.date_to, ctx.now)
    units = _units(ctx.workspace, user_ids)
    rows = []
    for row in statuses:
        items, report = row["items"], row["report"]
        blockers = [i for i in items if i.kind == DailyReportItem.Kind.BLOCKER and not i.needs_help]
        help_ = [i for i in items if i.kind == DailyReportItem.Kind.BLOCKER and i.needs_help]
        rows.append(
            {
                "date": row["date"],
                "weekday": reports.WEEKDAY_TITLES[row["date"].weekday()],
                "person": _person(row["user"]),
                "unit": units.get(row["user"].id, ""),
                "status": row["status"],
                "submitted_at": report.submitted_at if report and report.status == "submitted" else None,
                "is_late": bool(report and report.is_late),
                "done_count": sum(1 for i in items if i.kind == "done"),
                "in_progress_count": sum(1 for i in items if i.kind == "in_progress"),
                "blocker_count": len(blockers),
                "help_count": len(help_),
                "blockers": " | ".join(i.text for i in blockers),
                "help": " | ".join(i.text for i in help_),
                "leave": " | ".join(
                    f"مرخصی {'روزانه' if v.mode == 'daily' else 'ساعتی'}: {_period(v, ctx.workspace)}"
                    for _, v in row["leaves"]
                ),
                "_link": f"/daily-report?date={row['date'].isoformat()}&user={row['user'].id}",
            }
        )
    return rows


def _period(version, workspace):
    from .leave_requests import period_text

    return period_text(version, workspace)


DAILY_REPORTS = Source(
    code="daily_reports",
    title="وضعیت گزارش روزانه",
    description="ثبت‌شده، ثبت‌نشده، دیرهنگام و «لازم نیست» برای هر فرد و روز؛ مانع‌ها و نیاز به کمک جدا.",
    fields=[
        Field("date", "تاریخ", "date", group=True),
        Field("weekday", "روز هفته", "text", group=True),
        Field("person", "فرد", "person", group=True),
        Field("unit", "واحد", "text", group=True),
        Field(
            "status",
            "وضعیت گزارش",
            "choice",
            group=True,
            choices=reports.DAY_STATUS_TITLES,
            method=(
                "روزهای کاری برنامهٔ هر فرد (work_calendar) منهای روزهای تمام‌مرخصی تأییدشده؛ "
                "«دیرهنگام» = نخستین ثبت پس از مهلت همان روز"
            ),
        ),
        Field("submitted_at", "زمان ثبت", "datetime"),
        Field("is_late", "دیرهنگام", "bool", group=True, method="نخستین ثبت پس از مهلت تنظیم‌شدهٔ همان روز"),
        Field("done_count", "تعداد انجام‌شده", "number", agg=True),
        Field("in_progress_count", "تعداد در حال انجام", "number", agg=True),
        Field("blocker_count", "تعداد مانع", "number", agg=True),
        Field("help_count", "تعداد نیاز به کمک", "number", agg=True),
        Field("blockers", "مانع‌ها", "text"),
        Field("help", "نیاز به کمک", "text"),
        Field("leave", "مرخصی (فقط‌خواندنی)", "text", method="خواندن زندهٔ درخواست مرخصی تأییدشده؛ بدون دستهٔ مرخصی"),
    ],
    build=build_daily_reports,
    default={
        "columns": [
            "date",
            "person",
            "status",
            "submitted_at",
            "blocker_count",
            "help_count",
            "blockers",
            "help",
            "leave",
        ],
        "filters": [{"field": "status", "op": "not_in", "value": ["off", "future"]}],
        "range": {"type": "relative", "days": 7},
        "sort": [{"field": "date", "dir": "desc"}, {"field": "person", "dir": "asc"}],
        "group_by": [],
        "aggregates": [{"fn": "count"}, {"fn": "sum", "field": "blocker_count"}, {"fn": "sum", "field": "help_count"}],
    },
    date_field="date",
    date_label="روز گزارش",
    range_required=True,
    team_source="daily_reports",
)


# ---------------------------------------------------------------- 3. leave


def build_leave(ctx):
    from .leave_requests import duration_text, leave_entity, visible_queryset

    people = ctx.requested_people("person")
    user_ids = list(people if people is not None else ctx.scope.user_ids)
    rows_qs = (
        visible_queryset(ctx.viewer, ctx.workspace, ctx.request)
        .filter(requester_id__in=user_ids)
        .filter(versions__start_date__lte=ctx.date_to, versions__end_date__gte=ctx.date_from)
        .select_related("requester")
        .prefetch_related("versions")
        .distinct()
        .order_by("-created_at")
    )
    requests = ctx.cap(rows_qs)
    entity = leave_entity(ctx.workspace)
    approvers = {}
    for decision in (
        WorkflowDecision.objects.filter(
            instance__entity=entity,
            instance__record_id__in=[r.id for r in requests if r.status == LeaveRequest.Status.APPROVED],
            actor__isnull=False,
        )
        .exclude(kind__in=("start", "error", "cancel"))
        .select_related("actor", "instance")
        .order_by("created_at")
    ):
        approvers[decision.instance.record_id] = decision.actor
    result = []
    for row in requests:
        versions = sorted(row.versions.all(), key=lambda v: v.number)
        if not versions:
            continue
        version = versions[-1]
        if not (version.start_date <= ctx.date_to and version.end_date >= ctx.date_from):
            continue
        result.append(
            {
                "number": row.number,
                "person": _person(row.requester),
                "mode": version.mode,
                "period": _period(version, ctx.workspace),
                "start_date": version.start_date,
                "end_date": version.end_date,
                "status": row.status,
                "duration": duration_text(version.mode, version.duration_days, version.duration_minutes),
                "duration_days": version.duration_days,
                "duration_minutes": version.duration_minutes,
                "approver": _person(approvers.get(row.id)) if row.status == LeaveRequest.Status.APPROVED else None,
                "created_at": row.created_at,
                "_link": f"/leave-requests/{row.id}",
            }
        )
    return result


LEAVE = Source(
    code="leave",
    title="مرخصی",
    description="درخواست‌های مرخصی روزانه و ساعتی با بازه، وضعیت، مدت و تأییدکننده (بدون دستهٔ مرخصی).",
    fields=[
        Field("number", "شماره", "text"),
        Field("person", "درخواست‌دهنده", "person", group=True),
        Field("mode", "شیوه", "choice", group=True, choices={"daily": "روزانه", "hourly": "ساعتی"}),
        Field("period", "بازه", "text"),
        Field("start_date", "از تاریخ", "date"),
        Field("end_date", "تا تاریخ", "date"),
        Field("status", "وضعیت", "choice", group=True, choices=dict(LeaveRequest.Status.choices)),
        Field("duration", "مدت", "text", filter=False),
        Field("duration_days", "مدت (روز کاری)", "number", agg=True, method="روزهای کاری تقویم فرد هنگام ثبت درخواست"),
        Field(
            "duration_minutes", "مدت (دقیقهٔ کاری)", "number", agg=True, method="دقیقه‌های کاری تقویم فرد (مرخصی ساعتی)"
        ),
        Field("approver", "تأییدکننده", "person", group=True, method="آخرین تصمیم‌گیر گردش‌کار درخواست تأییدشده"),
        Field("created_at", "زمان ثبت", "datetime"),
    ],
    build=build_leave,
    default={
        "columns": ["number", "person", "mode", "period", "duration", "status", "approver"],
        "filters": [],
        "range": {"type": "relative", "days": 30},
        "sort": [{"field": "start_date", "dir": "desc"}],
        "group_by": [],
        "aggregates": [{"fn": "count"}, {"fn": "sum", "field": "duration_days"}],
    },
    date_field="start_date",
    date_label="بازهٔ مرخصی",
    range_required=True,
)


# ---------------------------------------------------------------- 4. relations


RELATION_CHOICES = {"customer": "مشتری", "contact": "مخاطب", "product": "محصول", "project": "پروژه"}


def build_relations(ctx):
    issues = ctx.cap(_tickets(ctx, "created_at" if ctx.date_from else None))
    ids = [i.id for i in issues]
    numbers, people = _ticket_numbers(ctx.workspace, ids), _assignees(ids)
    related = _related(ctx.workspace, ctx.viewer, ids, ["customer", "contact", "product"], ctx.request)
    rows = []
    for issue in issues:
        links = list(related.get(issue.id, []))
        if issue.project_id:
            links.append(("project", issue.project.name))
        assignees = people.get(issue.id, [])
        for code, title in links:
            rows.append(
                {
                    "relation_kind": code,
                    "related": title,
                    "ticket_number": _number(numbers, issue),
                    "ticket_title": issue.name,
                    "ticket_category": category_of(issue),
                    "assignee": _person(assignees[0]) if assignees else None,
                    "ticket_created_at": issue.created_at,
                    "_link": f"/edit/ticket/{issue.id}",
                }
            )
    return rows


RELATIONS = Source(
    code="relations",
    title="مشتری، مخاطب، محصول و پروژه",
    description="تیکت‌ها به تفکیک مشتری، مخاطب، محصول و پروژهٔ مرتبط؛ فقط از رابطه‌های ثبت‌شده و کلید واقعی پروژه.",
    fields=[
        Field("relation_kind", "نوع ارتباط", "choice", group=True, choices=RELATION_CHOICES),
        Field("related", "مورد مرتبط", "text", group=True, method="فقط رکوردهایی که شما اجازهٔ دیدنشان را دارید"),
        Field("ticket_number", "شمارهٔ تیکت", "text"),
        Field("ticket_title", "عنوان تیکت", "text"),
        Field("ticket_category", "دستهٔ وضعیت تیکت", "choice", group=True, choices=CATEGORY_CHOICES),
        Field("assignee", "مسئول اصلی", "person", group=True),
        Field("ticket_created_at", "زمان ثبت تیکت", "datetime"),
    ],
    build=build_relations,
    default={
        "columns": ["relation_kind", "related", "ticket_number", "ticket_title", "ticket_category", "assignee"],
        "filters": [],
        "range": None,
        "sort": [{"field": "related", "dir": "asc"}],
        "group_by": ["relation_kind", "related"],
        "aggregates": [{"fn": "count"}],
    },
    date_field="ticket_created_at",
    date_label="زمان ثبت تیکت",
)


# ---------------------------------------------------------------- 5. activity


ACTIVITY_KINDS = {
    "status": "تغییر وضعیت",
    "referral": "ارجاع",
    "comment": "نظر",
    "correspondence": "مکاتبه",
    "event": "جلسه / مأموریت / رویداد",
    "decision": "تصمیم گردش‌کار",
    "ticket": "ثبت یا بستن تیکت",
    "deadline": "موعد و تمدید",
}
EVENT_KIND = {
    "ticket.category_changed": "status",
    "record.status_changed": "status",
    "ticket.referred": "referral",
    "ticket.referral_accepted": "referral",
    "ticket.referral_rejected": "referral",
    "ticket.routed": "referral",
    "ticket.contact": "correspondence",
    "portal.reply": "correspondence",
    "portal.request_approved": "correspondence",
    "portal.request_rejected": "correspondence",
    "portal.info_requested": "correspondence",
    "ticket.closed": "ticket",
    "ticket.reopened": "ticket",
    "ticket.extension_requested": "deadline",
    "ticket.extension_approved": "deadline",
    "ticket.extension_rejected": "deadline",
    "ticket.delay_reported": "deadline",
    "ticket.target_changed": "deadline",
}


def build_activity(ctx):
    from .report_scope import visible_ticket_ids

    people = ctx.requested_people("person")
    user_ids = list(people if people is not None else ctx.scope.user_ids)
    start, end = ctx.moment_range()
    visible = Issue.objects.filter(
        workspace=ctx.workspace, id__in=visible_ticket_ids(ctx.viewer, ctx.workspace, ctx.request)
    )
    events = ctx.cap(
        EntityEvent.objects.filter(
            workspace=ctx.workspace, created_by_id__in=user_ids, created_at__gte=start, created_at__lt=end
        )
        .filter(
            Q(event_type__in=EVENT_KIND)
            | Q(event_type="record.field_changed", field__in=("ticket_state", "task_status", "status"))
        )
        .filter(record_id__in=visible.values("id"))
        .select_related("created_by")
        .order_by("-created_at")
    )
    comments = ctx.cap(
        IssueComment.objects.filter(
            workspace=ctx.workspace, created_at__gte=start, created_at__lt=end, issue_id__in=visible.values("id")
        )
        .filter(
            Q(actor_id__in=user_ids) | Q(actor__isnull=True, created_by_id__in=user_ids, portal_account__isnull=True)
        )
        .select_related("actor", "created_by")
        .order_by("-created_at")
    )
    issue_ids = {e.record_id for e in events} | {c.issue_id for c in comments}
    issues = {i.id: i for i in Issue.objects.filter(id__in=issue_ids)}
    numbers = _ticket_numbers(ctx.workspace, issue_ids)
    if has_permission(ctx.viewer, ctx.workspace, "Issue.ViewAll", request=ctx.request):
        owned = set(issue_ids)
    else:
        owned = set(
            Issue.objects.filter(id__in=issue_ids)
            .filter(
                Q(created_by=ctx.viewer)
                | Q(issue_assignee__assignee=ctx.viewer, issue_assignee__deleted_at__isnull=True)
                | Q(project__created_by=ctx.viewer)
                | Q(project__project_lead=ctx.viewer)
            )
            .values_list("id", flat=True)
        )
    rows = []

    def subject(issue_id):
        issue = issues.get(issue_id)
        return (f"{_number(numbers, issue)} «{issue.name}»", _number(numbers, issue)) if issue else ("", "")

    for row in events:
        kind = EVENT_KIND.get(row.event_type, "status")
        text, number = subject(row.record_id)
        rows.append(
            {
                "at": row.created_at,
                "date": row.created_at.astimezone(ctx.zone).date(),
                "person": _person(row.created_by),
                "kind": kind,
                "subject": text,
                "ticket_number": number,
                "description": ACTIVITY_KINDS[kind],
                "_link": f"/edit/ticket/{row.record_id}",
            }
        )
    for comment in comments:
        internal = comment.access == "INTERNAL"
        if internal and comment.issue_id not in owned:
            continue  # internal notes are visible to the ticket's owners only (ticket-7 rule)
        author = comment.actor or comment.created_by
        text, number = subject(comment.issue_id)
        rows.append(
            {
                "at": comment.created_at,
                "date": comment.created_at.astimezone(ctx.zone).date(),
                "person": _person(author),
                "kind": "comment" if internal else "correspondence",
                "subject": text,
                "ticket_number": number,
                "description": "یادداشت داخلی" if internal else "پیام قابل‌مشاهده برای مشتری",
                "_link": f"/edit/ticket/{comment.issue_id}",
            }
        )
    for decision in ctx.cap(
        WorkflowDecision.objects.filter(
            actor_id__in=user_ids, instance__workspace=ctx.workspace, created_at__gte=start, created_at__lt=end
        )
        .exclude(kind__in=("error", "start", "engine", "system"))
        .select_related("actor", "instance__entity")
        .order_by("-created_at")
    ):
        entity = decision.instance.entity
        if entity and entity.code == "ticket" and decision.instance.record_id not in issues:
            if not visible.filter(id=decision.instance.record_id).exists():
                continue
        rows.append(
            {
                "at": decision.created_at,
                "date": decision.created_at.astimezone(ctx.zone).date(),
                "person": _person(decision.actor),
                "kind": "decision",
                "subject": entity.title if entity else "فرایند",
                "ticket_number": "",
                "description": "ثبت تصمیم در گردش‌کار",
                "_link": None,
            }
        )
    for event in ctx.cap(
        WorkEvent.objects.filter(
            workspace=ctx.workspace,
            participant_rows__user_id__in=user_ids,
            participant_rows__deleted_at__isnull=True,
            starts_at__lt=end,
            ends_at__gt=start,
            ends_at__lte=ctx.now,
        )
        .exclude(status=WorkEvent.Status.CANCELLED)
        .prefetch_related("participant_rows__user")
        .distinct()
        .order_by("-starts_at")
    ):
        for participant in event.participant_rows.all():
            if participant.deleted_at is None and participant.user_id in set(user_ids):
                rows.append(
                    {
                        "at": event.starts_at,
                        "date": event.starts_at.astimezone(ctx.zone).date(),
                        "person": _person(participant.user),
                        "kind": "event",
                        "subject": f"{event.get_kind_display()}: {event.title}",
                        "ticket_number": "",
                        "description": "شرکت در رویداد تقویم (برنامه‌ریزی‌شده و پایان‌یافته)",
                        "_link": "/calendar",
                    }
                )
    return rows


ACTIVITY = Source(
    code="activity",
    title="فعالیت",
    description="گزارش فعالیت — کارکرد حضور نیست: تغییر وضعیت، ارجاع، نظر، مکاتبه، تصمیم و رویدادهای تقویم.",
    note="گزارش فعالیت — کارکرد حضور نیست.",
    fields=[
        Field("at", "زمان", "datetime"),
        Field("date", "تاریخ", "date", group=True),
        Field("person", "فرد", "person", group=True),
        Field("kind", "نوع فعالیت", "choice", group=True, choices=ACTIVITY_KINDS),
        Field("subject", "موضوع", "text", group=True, method="فقط تیکت‌هایی که شما اجازهٔ دیدنشان را دارید"),
        Field("ticket_number", "شمارهٔ تیکت", "text"),
        Field("description", "شرح", "text"),
    ],
    build=build_activity,
    default={
        "columns": ["at", "person", "kind", "subject", "description"],
        "filters": [],
        "range": {"type": "relative", "days": 7},
        "sort": [{"field": "at", "dir": "desc"}],
        "group_by": [],
        "aggregates": [{"fn": "count"}],
    },
    date_field="at",
    date_label="زمان فعالیت",
    range_required=True,
)


# ---------------------------------------------------------------- 6. team_schedule


SCHEDULE_SOURCES = {
    "person": "برنامهٔ فرد",
    "exception": "استثنای برنامهٔ فرد",
    "team": "برنامهٔ تیم",
    "company": "برنامهٔ شرکت",
}
WORK_MODES = {"": "نامشخص", "onsite": "حضوری", "remote": "دورکاری", "hybrid": "ترکیبی"}


def build_team_schedule(ctx):
    people = ctx.requested_people("person")
    user_ids = list(people if people is not None else ctx.scope.user_ids)
    days = (ctx.date_to - ctx.date_from).days + 1
    if len(user_ids) * days > ctx.limit:
        raise TooLarge()
    users = list(User.objects.filter(id__in=user_ids).order_by("display_name", "id"))
    resolvers = bulk_resolvers(ctx.workspace, users, ctx.date_from, ctx.date_to)
    leaves = reports.approved_leaves(ctx.workspace, user_ids, ctx.date_from, ctx.date_to)
    start, end = ctx.moment_range()
    events = defaultdict(list)
    for event in (
        WorkEvent.objects.filter(
            workspace=ctx.workspace,
            participant_rows__user_id__in=user_ids,
            participant_rows__deleted_at__isnull=True,
            starts_at__lt=end,
            ends_at__gt=start,
        )
        .exclude(status=WorkEvent.Status.CANCELLED)
        .prefetch_related("participant_rows")
        .distinct()
    ):
        for participant in event.participant_rows.all():
            if participant.deleted_at is None and participant.user_id in set(user_ids):
                day, last = event.starts_at.astimezone(ctx.zone).date(), event.ends_at.astimezone(ctx.zone).date()
                while day <= last:
                    events[(participant.user_id, day)].append(event)
                    day += timedelta(days=1)
    presence = {
        (row.user_id, row.date)
        for row in PresenceDeclaration.objects.filter(
            workspace=ctx.workspace,
            user_id__in=user_ids,
            date__gte=ctx.date_from,
            date__lte=ctx.date_to,
            status=PresenceDeclaration.Status.ACTIVE,
        )
    }
    units = _units(ctx.workspace, user_ids)
    rows = []
    for user in users:
        day = ctx.date_from
        while day <= ctx.date_to:
            schedule = resolvers[user.id].day(day)
            day_events = events.get((user.id, day), [])
            day_leaves = reports.day_leaves(ctx.workspace, leaves.get(user.id, []), day, schedule)
            declared = (user.id, day) in presence
            rows.append(
                {
                    "person": _person(user),
                    "unit": units.get(user.id, ""),
                    "date": day,
                    "weekday": reports.WEEKDAY_TITLES[day.weekday()],
                    "is_working": schedule.working,
                    "hours": f"{schedule.start.strftime('%H:%M')}–{schedule.end.strftime('%H:%M')}"
                    if schedule.working and schedule.start and schedule.end
                    else "",
                    "work_mode": schedule.work_mode or "",
                    "schedule_source": schedule.source,
                    "meetings": sum(1 for e in day_events if e.kind == "meeting"),
                    "missions": sum(1 for e in day_events if e.kind == "mission"),
                    "events": " | ".join(f"{e.get_kind_display()}: {e.title}" for e in day_events),
                    "presence_type": "self_reported" if declared else "none",
                    "leave": " | ".join(_period(v, ctx.workspace) for _, v in day_leaves),
                    "_link": None,
                }
            )
            day += timedelta(days=1)
    return rows


TEAM_SCHEDULE = Source(
    code="team_schedule",
    title="برنامهٔ تیم",
    description="برنامهٔ هفتگی، روزهای کاری، جلسه، مأموریت و اعلام حضور خوداظهاری افراد.",
    note="اعلام حضور فقط خوداظهاری است و حضور تأییدشده نیست.",
    fields=[
        Field("person", "فرد", "person", group=True),
        Field("unit", "واحد", "text", group=True),
        Field("date", "تاریخ", "date", group=True),
        Field("weekday", "روز هفته", "text", group=True),
        Field(
            "is_working", "روز کاری", "bool", group=True, method="برنامهٔ کاری حل‌شدهٔ فرد (استثنا > فرد > واحد > شرکت)"
        ),
        Field("hours", "ساعت برنامه", "text"),
        Field("work_mode", "شیوهٔ کار", "choice", group=True, choices=WORK_MODES),
        Field("schedule_source", "منبع برنامه", "choice", group=True, choices=SCHEDULE_SOURCES),
        Field("meetings", "تعداد جلسه", "number", agg=True),
        Field("missions", "تعداد مأموریت", "number", agg=True),
        Field("events", "رویدادها", "text"),
        Field(
            "presence_type",
            "نوع اعلام حضور",
            "choice",
            group=True,
            choices={"self_reported": "خوداظهاری", "none": "—"},
            method="فقط اعلام خود فرد؛ حضور تأییدشده نیست",
        ),
        Field("leave", "مرخصی", "text"),
    ],
    build=build_team_schedule,
    default={
        "columns": [
            "person",
            "date",
            "weekday",
            "is_working",
            "hours",
            "work_mode",
            "meetings",
            "missions",
            "presence_type",
            "leave",
        ],
        "filters": [],
        "range": {"type": "relative", "days": 7},
        "sort": [{"field": "person", "dir": "asc"}, {"field": "date", "dir": "asc"}],
        "group_by": [],
        "aggregates": [{"fn": "count"}],
    },
    date_field="date",
    date_label="روز",
    range_required=True,
)


# ---------------------------------------------------------------- 7. status_trend


def build_status_trend(ctx):
    people = ctx.requested_people("person")
    user_ids = set(people if people is not None else ctx.scope.user_ids)
    issues = ctx.cap(
        ticket_rows(ctx.viewer, ctx.workspace, ctx.scope, ctx.request).select_related("state").order_by("id")
    )
    owners = _assignees([i.id for i in issues])
    start, end = ctx.moment_range()
    overdue_ids = set(
        Issue.objects.filter(id__in=[i.id for i in issues]).filter(overdue_q(ctx.now)).values_list("id", flat=True)
    )
    stats = {
        uid: {"open": 0, "in_progress": 0, "created": 0, "closed": 0, "overdue": 0, "waits": []} for uid in user_ids
    }
    for issue in issues:
        people_of = [u.id for u in owners.get(issue.id, [])] or [issue.created_by_id]
        category = category_of(issue)
        for uid in people_of:
            if uid not in stats:
                continue
            row = stats[uid]
            if category != DONE:
                row["open"] += 1
                row["in_progress"] += int(category == "in_progress")
                row["overdue"] += int(issue.id in overdue_ids)
            if start <= issue.created_at < end:
                row["created"] += 1
            if category == DONE and issue.completed_at and start <= issue.completed_at < end:
                row["closed"] += 1
            if issue.target_started_at and start <= issue.target_started_at < end:
                row["waits"].append((issue.target_started_at - issue.created_at).total_seconds() / 3600)
    users = {u.id: u for u in User.objects.filter(id__in=list(user_ids))}
    units = _units(ctx.workspace, user_ids)
    return [
        {
            "person": _person(users.get(uid)),
            "unit": units.get(uid, ""),
            "open_now": row["open"],
            "in_progress_now": row["in_progress"],
            "overdue_now": row["overdue"],
            "created": row["created"],
            "closed": row["closed"],
            "avg_wait_hours": round(sum(row["waits"]) / len(row["waits"]), 1) if row["waits"] else None,
            "_link": None,
        }
        for uid, row in stats.items()
        if uid in users
    ]


STATUS_TREND = Source(
    code="status_trend",
    title="وضعیت و روند",
    description="باز، بسته‌شده، عقب‌افتاده، زمان انتظار و حجم کار هر مسئول در بازه.",
    fields=[
        Field("person", "مسئول", "person", group=True),
        Field("unit", "واحد", "text", group=True),
        Field(
            "open_now",
            "باز (اکنون) — حجم کار",
            "number",
            agg=True,
            method="تیکت‌های غیر «انجام‌شده» که فرد مسئول آن‌هاست (اکنون)",
        ),
        Field(
            "in_progress_now", "در حال انجام (اکنون)", "number", agg=True, method="دستهٔ «در حال انجام» در ticket_core"
        ),
        Field(
            "overdue_now", "عقب‌افتاده (اکنون)", "number", agg=True, method="باز و موعد گذشته (ticket_core.overdue_q)"
        ),
        Field("created", "ثبت‌شده در بازه", "number", agg=True, method="زمان ثبت تیکت در بازه"),
        Field("closed", "بسته‌شده در بازه", "number", agg=True, method="تیکت «انجام‌شده» با زمان پایان در بازه"),
        Field(
            "avg_wait_hours",
            "میانگین زمان انتظار (ساعت تقویمی)",
            "number",
            agg=True,
            method="میانگین فاصلهٔ ثبت تا شروع ساعت موعد، برای تیکت‌هایی که در بازه شروع شده‌اند",
        ),
    ],
    build=build_status_trend,
    default={
        "columns": ["person", "open_now", "in_progress_now", "overdue_now", "created", "closed", "avg_wait_hours"],
        "filters": [],
        "range": {"type": "relative", "days": 30},
        "sort": [{"field": "open_now", "dir": "desc"}],
        "group_by": [],
        "aggregates": [
            {"fn": "sum", "field": "open_now"},
            {"fn": "sum", "field": "closed"},
            {"fn": "avg", "field": "avg_wait_hours"},
        ],
    },
    date_field="created",
    date_label="بازهٔ روند",
    range_required=True,
)


# ---------------------------------------------------------------- 8. ticket_deadlines


DEADLINE_LABELS = {
    "running": "در موعد",
    "near_due": "نزدیک موعد",
    "overdue": "دیرکرده",
    "closed": "بسته در موعد",
    "closed_late": "بسته با دیرکرد",
    "not_started": "شروع‌نشده",
}


def build_ticket_deadlines(ctx):
    rows_qs = _tickets(ctx, "target_at" if ctx.date_from else None).filter(
        Q(target_at__isnull=False) | Q(target_minutes__isnull=False) | Q(type__target_minutes__isnull=False)
    )
    issues = ctx.cap(rows_qs)
    ids = [i.id for i in issues]
    states = deadline_states(issues, ctx.workspace, ctx.now)
    numbers, people = _ticket_numbers(ctx.workspace, ids), _assignees(ids)
    reports_by = {}
    for row in WorkflowDelayReport.objects.filter(issue_id__in=ids).order_by("created_at"):
        reports_by[row.issue_id] = row
    ext_count, ext_approved, new_target = defaultdict(int), defaultdict(int), {}
    for row in WorkflowExtension.objects.filter(issue_id__in=ids, scope=WorkflowExtension.Scope.TICKET).order_by(
        "created_at"
    ):
        ext_count[row.issue_id] += 1
        if row.status == WorkflowExtension.Status.APPROVED:
            ext_approved[row.issue_id] += 1
            new_target[row.issue_id] = row.requested_target_at
    changes = defaultdict(int)
    for record_id in EntityEvent.objects.filter(
        record_id__in=ids, event_type__in=("ticket.target_changed", "ticket.target_restarted")
    ).values_list("record_id", flat=True):
        changes[record_id] += 1
    rows = []
    for issue in issues:
        if issue.id not in states:
            continue
        state = states[issue.id]
        closed_at = issue.completed_at if category_of(issue) == DONE else None
        delay = 0
        if issue.target_at:
            if closed_at and closed_at > issue.target_at:
                delay = int((closed_at - issue.target_at).total_seconds() // 60)
            elif not closed_at and state == "overdue":
                delay = int((ctx.now - issue.target_at).total_seconds() // 60)
        if state == "closed" and delay > 0:
            state = "closed_late"
        report = reports_by.get(issue.id)
        assignees = people.get(issue.id, [])
        rows.append(
            {
                "number": _number(numbers, issue),
                "title": issue.name,
                "assignee": _person(assignees[0]) if assignees else None,
                "category": category_of(issue),
                "deadline_state": state,
                "target_minutes": issue.target_minutes or (issue.type.target_minutes if issue.type_id else None),
                "target_at": issue.target_at,
                "closed_at": closed_at,
                "delay_minutes": delay,
                "delay_reason": report.reason if report else "",
                "expected_at": report.expected_at if report else None,
                "target_changes": changes.get(issue.id, 0),
                "extensions": ext_count.get(issue.id, 0),
                "extensions_approved": ext_approved.get(issue.id, 0),
                "new_target_at": new_target.get(issue.id),
                "_link": f"/edit/ticket/{issue.id}",
            }
        )
    return rows


TICKET_DEADLINES = Source(
    code="ticket_deadlines",
    title="موعد و دیرکرد تیکت",
    description=(
        "مدت هدف، موعد تقریبی، پایان واقعی، دیرکرد و دلیل آن، تغییر موعد و تمدیدها؛ در موعد / نزدیک موعد / دیرکرده."
    ),
    fields=[
        Field("number", "شماره", "text"),
        Field("title", "عنوان", "text"),
        Field("assignee", "مسئول اصلی", "person", group=True),
        Field("category", "دستهٔ وضعیت", "choice", group=True, choices=CATEGORY_CHOICES),
        Field(
            "deadline_state",
            "وضعیت موعد",
            "choice",
            group=True,
            choices=DEADLINE_LABELS,
            method=(
                "ticket_core.deadline_states: «نزدیک موعد» = باقی‌مانده ≤ ۲۰٪ کل (NEAR_DUE_PERCENT)؛ "
                "«دیرکرده» = موعد گذشته و باز"
            ),
        ),
        Field(
            "target_minutes",
            "مدت هدف (دقیقهٔ کاری)",
            "number",
            agg=True,
            method="مقدار تیکت، در غیر این صورت پیش‌فرض نوع تیکت",
        ),
        Field("target_at", "موعد تقریبی", "datetime", method="محاسبه با تقویم کاری مسئول (add_working_time)"),
        Field("closed_at", "پایان واقعی", "datetime"),
        Field(
            "delay_minutes",
            "دیرکرد (دقیقهٔ تقویمی)",
            "number",
            agg=True,
            method="پایان واقعی (یا اکنون برای تیکت باز) منهای موعد؛ زمان تقویمی، نه ساعت کاری",
        ),
        Field("delay_reason", "دلیل تأخیر", "text", method="آخرین گزارش تأخیر ثبت‌شده (WorkflowDelayReport)"),
        Field("expected_at", "زمان پایان اعلام‌شده", "datetime"),
        Field("target_changes", "تعداد تغییر موعد", "number", agg=True),
        Field("extensions", "تعداد درخواست تمدید", "number", agg=True),
        Field("extensions_approved", "تمدید تأییدشده", "number", agg=True),
        Field("new_target_at", "موعد جدید (پس از تمدید)", "datetime"),
    ],
    build=build_ticket_deadlines,
    default={
        "columns": [
            "number",
            "title",
            "assignee",
            "deadline_state",
            "target_at",
            "closed_at",
            "delay_minutes",
            "delay_reason",
            "new_target_at",
            "extensions",
        ],
        "filters": [],
        "range": None,
        "sort": [{"field": "target_at", "dir": "asc"}],
        "group_by": [],
        "aggregates": [{"fn": "count"}, {"fn": "sum", "field": "delay_minutes"}],
    },
    date_field="target_at",
    date_label="موعد",
)


# ---------------------------------------------------------------- 9. extensions


def build_extensions(ctx):
    from .report_scope import visible_ticket_ids

    visible = visible_ticket_ids(ctx.viewer, ctx.workspace, ctx.request)
    people = ctx.requested_people("requested_by")
    user_ids = list(people if people is not None else ctx.scope.user_ids)
    rows_qs = (
        WorkflowExtension.objects.filter(
            issue__workspace=ctx.workspace, scope=WorkflowExtension.Scope.TICKET, issue_id__in=visible
        )
        .filter(Q(requested_by_id__in=user_ids) | Q(approver=ctx.viewer))
        .select_related("issue", "requested_by", "approver", "decided_by")
        .order_by("-created_at")
    )
    if ctx.date_from:
        start, end = ctx.moment_range()
        rows_qs = rows_qs.filter(created_at__gte=start, created_at__lt=end)
    rows_list = ctx.cap(rows_qs)
    numbers = _ticket_numbers(ctx.workspace, {r.issue_id for r in rows_list})
    return [
        {
            "ticket_number": _number(numbers, row.issue),
            "ticket_title": row.issue.name,
            "requested_by": _person(row.requested_by),
            "minutes": row.minutes,
            "reason": row.reason,
            "approver": _person(row.approver),
            "decided_by": _person(row.decided_by),
            "status": row.status,
            "previous_target_at": row.previous_target_at,
            "requested_target_at": row.requested_target_at,
            "created_at": row.created_at,
            "decided_at": row.decided_at,
            "decision_reason": row.decision_reason,
            "_link": f"/edit/ticket/{row.issue_id}",
        }
        for row in rows_list
    ]


EXTENSIONS = Source(
    code="extensions",
    title="درخواست‌های تمدید",
    description="مدت خواسته‌شده، دلیل، تصمیم‌گیر، وضعیت و موعد قبلی/جدید؛ با فیلتر «در انتظار تصمیم».",
    fields=[
        Field("ticket_number", "شمارهٔ تیکت", "text"),
        Field("ticket_title", "عنوان تیکت", "text"),
        Field("requested_by", "درخواست‌دهنده", "person", group=True),
        Field("minutes", "مدت خواسته‌شده (دقیقهٔ کاری)", "number", agg=True),
        Field("reason", "دلیل", "text"),
        Field("approver", "تصمیم‌گیر", "person", group=True),
        Field("decided_by", "تصمیم‌گرفته توسط", "person", group=True),
        Field("status", "وضعیت", "choice", group=True, choices=dict(WorkflowExtension.Status.choices)),
        Field("previous_target_at", "موعد قبلی", "datetime"),
        Field("requested_target_at", "موعد جدید درخواستی", "datetime"),
        Field("created_at", "زمان درخواست", "datetime"),
        Field("decided_at", "زمان تصمیم", "datetime"),
        Field("decision_reason", "دلیل تصمیم", "text"),
    ],
    build=build_extensions,
    default={
        "columns": [
            "ticket_number",
            "ticket_title",
            "requested_by",
            "minutes",
            "reason",
            "approver",
            "status",
            "previous_target_at",
            "requested_target_at",
        ],
        "filters": [{"field": "status", "op": "eq", "value": "pending"}],
        "range": None,
        "sort": [{"field": "created_at", "dir": "desc"}],
        "group_by": [],
        "aggregates": [{"fn": "count"}],
    },
    date_field="created_at",
    date_label="زمان درخواست",
)


SOURCES = {
    source.code: source
    for source in (
        MY_WORK,
        DAILY_REPORTS,
        LEAVE,
        RELATIONS,
        ACTIVITY,
        TEAM_SCHEDULE,
        STATUS_TREND,
        TICKET_DEADLINES,
        EXTENSIONS,
    )
}
# Words that must never appear as a report column (decision: attendance is out of scope).
FORBIDDEN_WORDS = ("ورود", "خروج", "تأخیر ورود", "اضافه‌کاری", "کارکرد", "attendance", "overtime", "clock")


# ---------------------------------------------------------------- definition


def get_source(code):
    source = SOURCES.get(code)
    if source is None:
        raise ValidationError({"source": "منبع گزارش معتبر نیست."})
    return source


def _bad(message):
    raise ValidationError({"definition": message})


def validate(source, raw, *, saved=False, schema_version=None):
    """Whitelist validation. ``saved``: unknown fields mean the source changed → :class:`Incompatible`."""
    if saved and schema_version is not None and schema_version < source.compatible_since:
        raise Incompatible(
            {
                "error": (
                    f"ساختار منبع «{source.title}» تغییر کرده است و این گزارش با آن سازگار نیست؛ "
                    "گزارش را ویرایش و دوباره ذخیره کنید."
                ),
                "code": "incompatible",
                "missing": [],
            }
        )
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        _bad("تعریف گزارش باید یک شیء معتبر باشد.")
    unknown_keys = set(raw) - {"columns", "filters", "range", "sort", "group_by", "aggregates"}
    if unknown_keys:
        _bad(f"کلید ناشناخته در تعریف گزارش: {', '.join(sorted(unknown_keys))}")
    data = {**source.default, **raw}
    referenced = []
    columns = data.get("columns") or []
    if not isinstance(columns, list) or not columns:
        _bad("دست‌کم یک ستون انتخاب کنید.")
    referenced += [c for c in columns if isinstance(c, str)]
    filters = data.get("filters") or []
    if not isinstance(filters, list):
        _bad("فیلترها معتبر نیستند.")
    referenced += [f.get("field") for f in filters if isinstance(f, dict)]
    sort = data.get("sort") or []
    if not isinstance(sort, list):
        _bad("ترتیب معتبر نیست.")
    referenced += [s.get("field") for s in sort if isinstance(s, dict)]
    group_by = data.get("group_by") or []
    if not isinstance(group_by, list) or len(group_by) > 2:
        _bad("گروه‌بندی حداکثر دو سطح دارد.")
    referenced += list(group_by)
    aggregates = data.get("aggregates") or []
    if not isinstance(aggregates, list):
        _bad("تجمیع معتبر نیست.")
    referenced += [a.get("field") for a in aggregates if isinstance(a, dict) and a.get("field")]
    missing = [key for key in dict.fromkeys(referenced) if not isinstance(key, str) or source.field(key) is None]
    if missing:
        labels = "، ".join(f"«{key}»" for key in missing)
        if saved:
            raise Incompatible(
                {
                    "error": (
                        f"ستون {labels} دیگر در منبع «{source.title}» وجود ندارد؛ گزارش را ویرایش و دوباره ذخیره کنید."
                    ),
                    "code": "incompatible",
                    "missing": [str(key) for key in missing],
                }
            )
        _bad(f"فیلد ناشناخته در تعریف گزارش: {labels}")
    clean_filters = []
    for rule in filters:
        if not isinstance(rule, dict):
            _bad("ساختار فیلتر معتبر نیست.")
        item = source.field(rule["field"])
        op = rule.get("op")
        if not item.filter or op not in OPS[item.type]:
            _bad(f"عملگر «{op}» برای «{item.label}» مجاز نیست.")
        value = rule.get("value")
        if op in ("in", "not_in") and not isinstance(value, list):
            _bad(f"مقدار فیلتر «{item.label}» باید فهرست باشد.")
        if item.type == "choice":
            values = value if isinstance(value, list) else [value]
            if any(v not in (item.choices or {}) for v in values):
                _bad(f"مقدار فیلتر «{item.label}» معتبر نیست.")
        if item.type in ("date", "datetime") and op not in ("empty", "not_empty"):
            try:
                date.fromisoformat(str(value)[:10])
            except ValueError:
                _bad(f"تاریخ فیلتر «{item.label}» معتبر نیست.")
        if item.type == "number" and op not in ("empty", "not_empty"):
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                _bad(f"مقدار فیلتر «{item.label}» باید عدد باشد.")
        if item.type == "bool" and not isinstance(value, bool):
            _bad(f"مقدار فیلتر «{item.label}» باید بله یا خیر باشد.")
        if item.type == "text" and op in ("contains", "eq", "ne") and not isinstance(value, str):
            _bad(f"مقدار فیلتر «{item.label}» باید متن باشد.")
        clean_filters.append({"field": rule["field"], "op": op, "value": value})
    clean_sort = []
    for rule in sort:
        if not isinstance(rule, dict) or rule.get("dir", "asc") not in ("asc", "desc"):
            _bad("جهت ترتیب معتبر نیست.")
        clean_sort.append({"field": rule["field"], "dir": rule.get("dir", "asc")})
    for key in group_by:
        if not source.field(key).group:
            _bad(f"گروه‌بندی بر اساس «{source.field(key).label}» مجاز نیست.")
    clean_aggs = []
    for agg in aggregates:
        if not isinstance(agg, dict) or agg.get("fn") not in AGG_TITLES:
            _bad("نوع تجمیع معتبر نیست (فقط شمارش، جمع و میانگین).")
        if agg["fn"] == "count":
            clean_aggs.append({"fn": "count"})
            continue
        item = source.field(agg.get("field") or "")
        if item is None or item.type != "number" or not item.agg:
            _bad("جمع و میانگین فقط روی فیلدهای عددی مجاز است.")
        clean_aggs.append({"fn": agg["fn"], "field": agg["field"]})
    rng = data.get("range")
    if rng is not None:
        if not isinstance(rng, dict) or rng.get("type") not in ("relative", "absolute"):
            _bad("بازهٔ زمانی معتبر نیست.")
        if rng["type"] == "relative":
            days = rng.get("days")
            if not isinstance(days, int) or isinstance(days, bool) or days < 1:
                _bad("تعداد روزهای بازهٔ نسبی معتبر نیست.")
            rng = {"type": "relative", "days": days}
        else:
            try:
                rng = {
                    "type": "absolute",
                    "from": date.fromisoformat(str(rng.get("from"))).isoformat(),
                    "to": date.fromisoformat(str(rng.get("to"))).isoformat(),
                }
            except ValueError:
                _bad("تاریخ آغاز و پایان بازه معتبر نیست.")
            if rng["from"] > rng["to"]:
                _bad("تاریخ آغاز بازه نباید پس از تاریخ پایان باشد.")
    elif source.range_required:
        rng = deepcopy_range(source.default.get("range"))
    return {
        "columns": list(dict.fromkeys(columns)),
        "filters": clean_filters,
        "range": rng,
        "sort": clean_sort,
        "group_by": list(group_by),
        "aggregates": clean_aggs,
    }


def deepcopy_range(rng):
    return dict(rng) if rng else {"type": "relative", "days": 30}


def resolve_range(rng, workspace, cap_days, now):
    if not rng:
        return None, None
    today = local_today(workspace, now)
    if rng["type"] == "relative":
        date_from, date_to = today - timedelta(days=rng["days"] - 1), today
    else:
        date_from, date_to = date.fromisoformat(rng["from"]), date.fromisoformat(rng["to"])
    if (date_to - date_from).days + 1 > cap_days:
        raise ValidationError({"range": f"بازهٔ گزارش حداکثر {reports.fa(cap_days)} روز است."})
    return date_from, date_to


# ---------------------------------------------------------------- cells, filters, sort, groups


def cell(item, value, zone):
    """The one display value of a cell; the page and the file export both use it."""
    if value is None or value == "":
        return ""
    if item.type == "person":
        return value.get("name", "") if isinstance(value, dict) else str(value)
    if item.type == "choice":
        return (item.choices or {}).get(value, str(value))
    if item.type == "bool":
        return "بله" if value else "خیر"
    if item.type == "date":
        return jalali(value)
    if item.type == "datetime":
        local = value.astimezone(zone)
        return f"{jalali(local.date())} {local.strftime('%H:%M')}"
    if item.type == "number":
        if isinstance(value, float):
            return round(value, 2)
        return value
    return str(value)


def _matches(item, rule, value, zone):
    op, target = rule["op"], rule["value"]
    if op == "empty":
        return value in (None, "")
    if op == "not_empty":
        return value not in (None, "")
    if item.type == "person":
        pid = value.get("id") if isinstance(value, dict) else None
        wanted = {str(v) for v in target or []}
        return (pid in wanted) if op == "in" else (pid not in wanted)
    if item.type == "choice":
        if op == "eq":
            return value == target
        if op == "ne":
            return value != target
        return (value in target) if op == "in" else (value not in target)
    if item.type == "bool":
        return bool(value) is target
    if item.type in ("date", "datetime"):
        if value in (None, ""):
            return False
        day = value.astimezone(zone).date() if isinstance(value, datetime) else value
        bound = date.fromisoformat(str(target)[:10])
        return {"eq": day == bound, "gte": day >= bound, "lte": day <= bound}[op]
    if item.type == "number":
        if value is None:
            return False
        return {
            "eq": value == target,
            "ne": value != target,
            "gt": value > target,
            "gte": value >= target,
            "lt": value < target,
            "lte": value <= target,
        }[op]
    text = str(value or "")
    if op == "contains":
        return str(target).casefold() in text.casefold()
    return (text == target) if op == "eq" else (text != target)


def _sort_key(item, value):
    if value is None or value == "":
        return (1, "")
    if item.type == "person":
        return (0, (value.get("name") or "").casefold()) if isinstance(value, dict) else (0, str(value))
    if item.type == "choice":
        return (0, list((item.choices or {}).keys()).index(value) if value in (item.choices or {}) else 99)
    if isinstance(value, str):
        return (0, value.casefold())
    if isinstance(value, bool):
        return (0, int(value))
    return (0, value)


def apply(source, definition, rows, zone):
    for rule in definition["filters"]:
        item = source.field(rule["field"])
        rows = [row for row in rows if _matches(item, rule, row.get(item.key), zone)]
    for rule in reversed(definition["sort"] or []):
        item = source.field(rule["field"])
        present = [r for r in rows if r.get(item.key) not in (None, "")]
        empty = [r for r in rows if r.get(item.key) in (None, "")]
        present.sort(key=lambda r: _sort_key(item, r.get(item.key)), reverse=rule["dir"] == "desc")
        rows = present + empty
    if definition["group_by"]:
        keys = [source.field(k) for k in definition["group_by"]]
        rows.sort(key=lambda r: tuple(_sort_key(k, r.get(k.key)) for k in keys))
    return rows


def aggregate(source, definition, rows):
    result = []
    for agg in definition["aggregates"]:
        if agg["fn"] == "count":
            result.append({"fn": "count", "label": "تعداد", "value": len(rows), "method": "شمارش ردیف‌ها پس از فیلتر"})
            continue
        item = source.field(agg["field"])
        values = [
            r.get(item.key)
            for r in rows
            if isinstance(r.get(item.key), (int, float, Decimal)) and not isinstance(r.get(item.key), bool)
        ]
        if agg["fn"] == "sum":
            value = sum(values) if values else 0
            method = f"جمع «{item.label}» روی ردیف‌های فیلترشده"
        else:
            value = round(sum(values) / len(values), 2) if values else None
            method = f"میانگین «{item.label}» روی ردیف‌های دارای مقدار ({reports.fa(len(values))} ردیف)"
        if isinstance(value, float):
            value = round(value, 2)
        result.append(
            {
                "fn": agg["fn"],
                "field": item.key,
                "label": f"{AGG_TITLES[agg['fn']]} {item.label}",
                "value": value,
                "method": method,
            }
        )
    return result


def groups(source, definition, rows, zone):
    if not definition["group_by"]:
        return []
    keys = [source.field(k) for k in definition["group_by"]]
    buckets = {}
    for row in rows:
        key = tuple(cell(k, row.get(k.key), zone) for k in keys)
        buckets.setdefault(key, []).append(row)
    result = []
    for key, members in list(buckets.items())[:MAX_GROUPS]:
        result.append(
            {
                "keys": [{"field": k.key, "label": k.label, "value": v} for k, v in zip(keys, key)],
                "count": len(members),
                "aggregates": aggregate(source, definition, members),
            }
        )
    return result


# ---------------------------------------------------------------- run


def require_view(viewer, workspace, request=None):
    if not has_permission(viewer, workspace, "Report.View", request=request) and not has_permission(
        viewer, workspace, "Report.ViewAll", request=request
    ):
        raise PermissionDenied("مجوز مشاهدهٔ گزارش‌ها را ندارید.")


def _statement_timeout():
    if connection.vendor == "postgresql":
        with connection.cursor() as cursor:
            cursor.execute(f"SET LOCAL statement_timeout = {int(STATEMENT_TIMEOUT_MS)}")


def compute(workspace, viewer, source, definition, request=None, now=None, limit=None):
    """Scope + range + rows for a *validated* definition; recomputed on every call (never cached)."""
    now = now or timezone.now()
    settings = reports.policy(workspace)
    date_from, date_to = resolve_range(definition["range"], workspace, settings["report_range_days"], now)
    scope = people_scope(viewer, workspace, source=source.team_source, request=request)
    ctx = Context(
        workspace=workspace,
        viewer=viewer,
        scope=scope,
        date_from=date_from,
        date_to=date_to,
        now=now,
        request=request,
        limit=limit or settings["sync_row_limit"],
        zone=calendar_zone(workspace),
        filters=definition["filters"],
    )
    with transaction.atomic():
        _statement_timeout()
        rows = source.build(ctx)
    rows = apply(source, definition, rows, ctx.zone)
    return ctx, rows


def columns_payload(source, definition):
    return [
        {
            "key": key,
            "label": source.field(key).label,
            "type": source.field(key).type,
            "method": source.field(key).method,
        }
        for key in definition["columns"]
    ]


def run(workspace, viewer, source_code, raw_definition, *, page=1, page_size=50, request=None, now=None, saved=None):
    require_view(viewer, workspace, request)
    source = get_source(source_code)
    definition = validate(
        source, raw_definition, saved=saved is not None, schema_version=getattr(saved, "schema_version", None)
    )
    ctx, rows = compute(workspace, viewer, source, definition, request, now)
    page = max(1, int(page or 1))
    page_size = min(200, max(1, int(page_size or 50)))
    total = len(rows)
    chunk = rows[(page - 1) * page_size : page * page_size]
    columns = [source.field(key) for key in definition["columns"]]
    return {
        "source": source.code,
        "title": source.title,
        "note": source.note,
        "definition": definition,
        "columns": columns_payload(source, definition),
        "rows": [
            {"cells": [cell(item, row.get(item.key), ctx.zone) for item in columns], "link": row.get("_link")}
            for row in chunk
        ],
        "total": total,
        "page": page,
        "pages": max(1, -(-total // page_size)),
        "page_size": page_size,
        "aggregates": aggregate(source, definition, rows),
        "groups": groups(source, definition, rows, ctx.zone),
        "range": (
            {
                "from": ctx.date_from.isoformat(),
                "to": ctx.date_to.isoformat(),
                "from_text": reports.fa_date(ctx.date_from),
                "to_text": reports.fa_date(ctx.date_to),
                "field": source.date_label,
            }
            if ctx.date_from
            else None
        ),
        "scope": {"team": ctx.scope.team, "people": len(ctx.scope.user_ids), "all": ctx.scope.all_people},
        "generated_at": ctx.now.astimezone(ctx.zone).isoformat(),
    }


def all_rows(workspace, viewer, source, definition, request=None, now=None, limit=None):
    """Every row in display form (used by the export and its re-verification)."""
    ctx, rows = compute(workspace, viewer, source, definition, request, now, limit)
    columns = [source.field(key) for key in definition["columns"]]
    return columns, [[cell(item, row.get(item.key), ctx.zone) for item in columns] for row in rows]


def catalog(viewer, workspace, request=None):
    team = {
        code: people_scope(viewer, workspace, source=src.team_source, request=request).team
        for code, src in SOURCES.items()
    }
    return [
        {
            "code": source.code,
            "title": source.title,
            "description": source.description,
            "note": source.note,
            "version": source.version,
            "date_field": source.date_field,
            "date_label": source.date_label,
            "range_required": source.range_required,
            "team": team[source.code],
            "default": source.default,
            "fields": [
                {
                    "key": f.key,
                    "label": f.label,
                    "type": f.type,
                    "filter": f.filter,
                    "group": f.group,
                    "agg": f.agg,
                    "ops": [{"code": op, "title": OP_TITLES[op]} for op in OPS[f.type]] if f.filter else [],
                    "choices": [{"code": k, "title": v} for k, v in (f.choices or {}).items()],
                    "method": f.method,
                }
                for f in source.fields
            ],
        }
        for source in SOURCES.values()
    ]
