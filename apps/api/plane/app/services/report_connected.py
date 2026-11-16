"""Report adapters for business directories, projects and the customer request inbox."""

from collections import defaultdict

from django.db.models import Count, Q

from plane.db.models import EntityType, Project, ProjectMember
from .access_control import has_permission
from .entity_records import permission, record_queryset
from .project_visibility import visible_projects

PORTAL_PERMISSIONS = (
    "Portal.Request.Triage",
    "Portal.Reply",
    "Portal.Account.Manage",
    "Portal.Settings.Manage",
    "Portal.Feedback.View",
    "Quote.Manage",
)


def visible_titles(entity, viewer, identifiers, request=None):
    """Use the engine's published field/role/condition rules, including native public ids."""
    from .entity_query import EntityQuery

    if not identifiers or not permission(entity, viewer, "view", request):
        return {}
    query = EntityQuery(entity, viewer, request)
    query.rows = query.rows.filter(**{"source_id__in" if entity.adapter else "id__in": list(identifiers)})
    query.prepare({"version": 1, "columns": [{"field": entity.title_field, "width": 180}]})
    result = query.execute(1, max(1, len(identifiers)))
    return {row["id"]: str(row["title"]) for row in result["results"]}


def build_records(ctx):
    from .report_sources import TooLarge, _person

    rows = []
    entities = EntityType.objects.filter(
        workspace=ctx.workspace, parent__isnull=True, adapter="", is_active=True
    ).order_by("title", "code")
    for entity in entities:
        if not permission(entity, ctx.viewer, "view", ctx.request):
            continue
        records = record_queryset(entity, ctx.viewer, ctx.request)
        if not ctx.scope.all_people:
            records = records.filter(created_by_id__in=list(ctx.scope.user_ids))
        if ctx.date_from:
            start, end = ctx.moment_range()
            records = records.filter(updated_at__gte=start, updated_at__lt=end)
        records = ctx.cap(records.select_related("created_by").order_by("-updated_at", "id"))
        titles = visible_titles(entity, ctx.viewer, [row.id for row in records], ctx.request)
        for row in records:
            rows.append(
                {
                    "entity": entity.title,
                    "entity_code": entity.code,
                    "number": row.number,
                    "title": titles.get(str(row.id), "رکورد"),
                    "creator": _person(row.created_by),
                    "created_at": row.created_at,
                    "updated_at": row.updated_at,
                    "_link": f"/entities/{entity.code}/{row.id}",
                }
            )
        if len(rows) > ctx.limit:
            raise TooLarge()
    return rows


def build_projects(ctx):
    from .report_sources import _person
    from .report_scope import ticket_rows
    from .ticket_core import DONE, category_expression

    if not has_permission(ctx.viewer, ctx.workspace, "Project.View", request=ctx.request):
        return []
    projects = visible_projects(Project.objects.filter(workspace=ctx.workspace), ctx.viewer, ctx.workspace.slug)
    if not ctx.scope.all_people:
        projects = projects.filter(
            Q(created_by_id__in=list(ctx.scope.user_ids))
            | Q(project_lead_id__in=list(ctx.scope.user_ids))
            | Q(project_projectmember__member_id__in=list(ctx.scope.user_ids), project_projectmember__is_active=True)
        ).distinct()
    if ctx.date_from:
        start, end = ctx.moment_range()
        projects = projects.filter(updated_at__gte=start, updated_at__lt=end)
    projects = ctx.cap(projects.select_related("project_lead").order_by("-updated_at", "id"))
    ids = [p.id for p in projects]
    members = defaultdict(set)
    for pid, uid in ProjectMember.objects.filter(
        workspace=ctx.workspace, project_id__in=ids, is_active=True
    ).values_list("project_id", "member_id"):
        members[pid].add(uid)
    counts = defaultdict(lambda: {"tasks": 0, "done": 0, "open": 0})
    for row in (
        ticket_rows(ctx.viewer, ctx.workspace, ctx.scope, ctx.request)
        .filter(project_id__in=ids)
        .order_by()
        .annotate(report_category=category_expression())
        .values("project_id", "report_category")
        .annotate(total=Count("id", distinct=True))
    ):
        counts[row["project_id"]]["tasks"] += row["total"]
        counts[row["project_id"]]["done" if row["report_category"] == DONE else "open"] += row["total"]
    return [
        {
            "name": p.name,
            "identifier": p.identifier,
            "lead": _person(p.project_lead),
            "members": len(members[p.id]),
            **counts[p.id],
            "created_at": p.created_at,
            "updated_at": p.updated_at,
            "_link": f"/projects/{p.id}",
        }
        for p in projects
    ]


def build_portal_requests(ctx):
    from .report_sources import _tickets, _assignees, _person, _ticket_numbers, _number
    from .ticket_core import category_of

    if not any(has_permission(ctx.viewer, ctx.workspace, code, request=ctx.request) for code in PORTAL_PERMISSIONS):
        return []
    issues = ctx.cap(
        _tickets(ctx, "created_at")
        .filter(portal_account__isnull=False)
        .select_related("portal_account__customer_record__entity")
    )
    ids = [i.id for i in issues]
    people, numbers = _assignees(ids), _ticket_numbers(ctx.workspace, ids)
    result = []
    for issue in issues:
        account = issue.portal_account
        customer = account.customer_record
        assignees = people.get(issue.id, [])
        result.append(
            {
                "number": _number(numbers, issue),
                "title": issue.name,
                "customer": str((customer.data or {}).get(customer.entity.title_field) or customer.number),
                "account": account.display_name,
                "stage": issue.portal_stage,
                "category": category_of(issue),
                "assignee": _person(assignees[0]) if assignees else None,
                "created_at": issue.created_at,
                "updated_at": issue.updated_at,
                "_link": f"/portal-settings/requests/{issue.id}",
            }
        )
    return result


def connected_sources(Source, Field):
    from .portal_settings import STAGE_TITLES
    from .ticket_core import CATEGORY_TITLES

    def definition(columns, date_field="updated_at"):
        return {
            "columns": columns,
            "filters": [],
            "range": None,
            "sort": [{"field": date_field, "dir": "desc"}],
            "group_by": [],
            "aggregates": [{"fn": "count"}],
        }

    return [
        Source(
            code="records",
            title="مشتریان، مخاطبان، محصولات و داده‌ها",
            description="رکوردهای قابل مشاهدهٔ بخش داده‌ها، حتی بدون تیکت؛ شامل انواع سفارشی شرکت.",
            fields=[
                Field("entity", "نوع داده", "text", group=True),
                Field("entity_code", "کد نوع داده", "text"),
                Field("number", "شماره", "text"),
                Field("title", "عنوان", "text"),
                Field("creator", "ثبت‌کننده", "person", group=True),
                Field("created_at", "زمان ثبت", "datetime"),
                Field("updated_at", "آخرین تغییر", "datetime"),
            ],
            build=build_records,
            default=definition(["entity", "number", "title", "creator", "updated_at"]),
            date_field="updated_at",
            date_label="آخرین تغییر",
        ),
        Source(
            code="projects",
            title="پروژه‌ها",
            description="پروژه‌های قابل مشاهده، مسئول پروژه، اعضا و شمار کارهای قابل دسترسی؛ پروژه‌های بدون کار نیز نمایش داده می‌شوند.",
            fields=[
                Field("name", "نام پروژه", "text"),
                Field("identifier", "شناسهٔ پروژه", "text"),
                Field("lead", "مسئول پروژه", "person", group=True),
                Field("members", "تعداد اعضا", "number", agg=True),
                Field("tasks", "کارهای قابل مشاهده", "number", agg=True),
                Field("done", "کارهای انجام‌شده", "number", agg=True),
                Field("open", "کارهای باز", "number", agg=True),
                Field("created_at", "زمان ثبت", "datetime"),
                Field("updated_at", "آخرین تغییر", "datetime"),
            ],
            build=build_projects,
            default=definition(["name", "identifier", "lead", "members", "tasks", "open", "done"]),
            date_field="updated_at",
            date_label="آخرین تغییر",
        ),
        Source(
            code="portal_requests",
            title="درخواست‌های درگاه مشتری",
            description="درخواست‌های مشتری از زمان ثبت، مرحلهٔ رسیدگی و مسئول؛ شامل صف درخواست‌های بدون مسئول برای مدیر دارای دسترسی کل.",
            fields=[
                Field("number", "شماره", "text"),
                Field("title", "موضوع", "text"),
                Field("customer", "مشتری", "text", group=True),
                Field("account", "ثبت‌کنندهٔ مشتری", "text"),
                Field("stage", "مرحلهٔ رسیدگی", "choice", group=True, choices=STAGE_TITLES),
                Field("category", "دستهٔ وضعیت", "choice", group=True, choices=dict(CATEGORY_TITLES)),
                Field("assignee", "مسئول", "person", group=True),
                Field("created_at", "زمان ثبت", "datetime"),
                Field("updated_at", "آخرین تغییر", "datetime"),
            ],
            build=build_portal_requests,
            default=definition(
                ["number", "title", "customer", "account", "stage", "assignee", "created_at"], "created_at"
            ),
            date_field="created_at",
            date_label="زمان ثبت",
        ),
    ]
