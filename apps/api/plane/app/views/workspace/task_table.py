"""One page of the task tables ("همه کارها" and "کارهای من"), filtered on the server.

Project work items and standalone workspace tasks share the Issue table, so a
single ordered queryset serves both and paging needs no merging. The rules
mirror the browser code they replace (filter-rules.ts and task-access.ts).
"""

import re
from datetime import timedelta

from django.db.models import Exists, OuterRef, Prefetch, Q
from django.utils import timezone
from rest_framework.response import Response

from plane.app.permissions.crm import require_permission
from plane.app.serializers.workspace_task import WorkspaceTaskSerializer
from plane.app.services.access_control import has_permission
from plane.app.services.project_visibility import visible_projects
from plane.app.services.table_filters import UNASSIGNED, WORKSPACE_TASKS, deadline_q, parse_day, status_q
from plane.app.services.table_page import list_values, normalize, paginate
from plane.app.services.task_policy import is_workspace_administrator
from plane.app.views.base import BaseAPIView
from plane.app.views.workspace.task_history import PersonalIssueSerializer
from plane.db.models import Issue, IssueActivity, IssueAssignee, Notification, Project, Workspace, WorkspaceTask

STANDALONE_STATUS = {
    "Todo": "todo",
    "In Progress": "in_progress",
    "Review": "review",
    "Done": "done",
    "Blocked": "blocked",
}
PRIORITIES = {"urgent", "high", "medium", "low", "none"}
DONE = Q(project__isnull=False, state__group="completed") | Q(project__isnull=True, status="done")
ARCHIVED = Q(archived_at__isnull=False) | Q(project__archived_at__isnull=False)


def _statuses(values):
    standalone = [STANDALONE_STATUS[value] for value in values if value in STANDALONE_STATUS]
    return Q(project__isnull=False) & status_q(values) | Q(project__isnull=True, status__in=standalone)


def _search(raw):
    query = Q()
    text = raw.translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789"))
    for term in normalize(text).split():
        reference = re.fullmatch(r"([a-z0-9]+)-([0-9]{1,10})", term)
        forms = {term, term.replace("ی", "ي").replace("ک", "ك")}
        any_field = Q()
        for form in forms:
            any_field |= (
                Q(name__icontains=form)
                | Q(project__name__icontains=form)
                | Q(project__identifier__icontains=form)
                | Q(assignee__display_name__icontains=form)
                | Q(created_by__display_name__icontains=form)
                | Q(issue_assignee__assignee__display_name__icontains=form, issue_assignee__deleted_at__isnull=True)
                | Q(labels__name__icontains=form)
            )
        if term.isdigit() and int(term) <= 2147483647:
            any_field |= Q(sequence_id=int(term))
        if reference and int(reference[2]) <= 2147483647:
            sequence = int(reference[2])
            prefix = reference[1].upper()
            any_field |= Q(project__identifier__iexact=prefix, sequence_id=sequence)
            if prefix == "TEAM":
                any_field |= Q(project__isnull=True, sequence_id=sequence)
        query &= any_field
    return query


class TaskTableEndpoint(BaseAPIView):
    @require_permission("Issue.View")
    def get(self, request, slug):
        user = request.user
        admin = is_workspace_administrator(user, slug)
        visible = visible_projects(Project.objects.filter(workspace__slug=slug), user, slug).values("id")
        assigned_to_me = IssueAssignee.objects.filter(issue_id=OuterRef("pk"), assignee=user)
        rows = (
            Issue.objects.filter(workspace__slug=slug, is_draft=False)
            .filter(Q(project_id__in=visible, project__deleted_at__isnull=True) | Q(project__isnull=True))
            .exclude(state__group="triage")
            .annotate(
                was_assigned_to_me=Exists(
                    IssueAssignee.all_objects.filter(workspace__slug=slug, issue_id=OuterRef("pk"), assignee=user)
                )
                | Exists(
                    IssueActivity.all_objects.filter(
                        workspace__slug=slug, issue_id=OuterRef("pk"), field="assignees"
                    ).filter(Q(old_identifier=user.id) | Q(new_identifier=user.id))
                )
                | Exists(
                    Notification.all_objects.filter(
                        workspace__slug=slug,
                        receiver=user,
                        entity_name="workspace_task",
                        sender="crm:workspace_task",
                        entity_identifier=OuterRef("pk"),
                        data__issue_activity__field="assignees",
                    ).filter(
                        Q(data__issue_activity__new_identifier=str(user.id))
                        | Q(data__issue_activity__old_identifier=str(user.id))
                    )
                ),
                mine=Exists(assigned_to_me),
            )
        )
        if admin:
            # Administrators work from the live list: archived work stays out of it.
            rows = rows.exclude(ARCHIVED)
            if not has_permission(user, slug, "Issue.ViewAll", request=request):
                rows = rows.filter(Q(project__isnull=False) | Q(assignee=user) | Q(created_by=user))
        else:
            # Everyone else sees their own history: work they were given or sent.
            rows = rows.filter(Q(was_assigned_to_me=True) | Q(created_by=user))

        view = request.query_params.get("view", "all")
        today = parse_day(request.query_params.get("today")) or timezone.localdate()
        received = Q(mine=True) & ~Q(created_by=user) & ~DONE & ~ARCHIVED
        if view == "mine":
            mine = rows.filter(Q(mine=True) if admin else received)
            open_rows = mine.exclude(DONE)
            tabs = {
                "all": open_rows,
                "today": open_rows.filter(target_date__isnull=False, target_date__lte=today),
                "upcoming": open_rows.filter(Q(target_date__isnull=True) | Q(target_date__gt=today)),
            }
            if admin:
                tabs["done"] = mine.filter(DONE)
            completed_week = rows.filter(mine=True, completed_at__gte=timezone.now() - timedelta(days=7))
            if not admin:
                completed_week = completed_week.exclude(created_by=user)
            extra = {"stats": {"completed_this_week": completed_week.count()}}
        else:
            tabs = (
                {"all": rows}
                if admin
                else {
                    "received": rows.filter(received),
                    "history": rows.filter(Q(was_assigned_to_me=True) | Q(mine=True)),
                    "sent": rows.filter(created_by=user, mine=False),
                }
            )
            extra = {}
        extra["tab_counts"] = {key: queryset.count() for key, queryset in tabs.items()}
        tab = request.query_params.get("tab", "")
        rows = tabs.get(tab) if tab in tabs else next(iter(tabs.values()))

        statuses = list_values(request, "statuses")
        if statuses:
            rows = rows.filter(_statuses(statuses))
        priorities = [value.lower() for value in list_values(request, "priorities") if value.lower() in PRIORITIES]
        if priorities:
            rows = rows.filter(priority__in=priorities)
        project_ids = list_values(request, "project_ids")
        if project_ids:
            rows = rows.filter(
                Q(project_id__in=[value for value in project_ids if value != WORKSPACE_TASKS])
                | (Q(project__isnull=True) if WORKSPACE_TASKS in project_ids else Q(pk__in=[]))
            )
        assignee_ids = list_values(request, "assignee_ids")
        if assignee_ids:
            named = [value for value in assignee_ids if value != UNASSIGNED]
            query = Exists(IssueAssignee.objects.filter(issue_id=OuterRef("pk"), assignee_id__in=named))
            if UNASSIGNED in assignee_ids:
                query = query | ~Exists(IssueAssignee.objects.filter(issue_id=OuterRef("pk")))
            rows = rows.filter(query)
        rows = rows.filter(deadline_q(request, "target_date", completed=DONE))
        search = request.query_params.get("q", "").strip()
        if search:
            rows = rows.filter(pk__in=rows.filter(_search(search)).values("pk"))
        # Ticket 5 ready filters (من / بدون مسئول / عقب‌افتاده / بسته‌شده) on top of the same visibility,
        # tab and filters; counts are computed on the server before the preset narrows the rows.
        from plane.app.services.ticket_core import category_expression, deadline_badges, preset_counts, preset_filter

        extra["preset_counts"] = preset_counts(rows, user)
        preset = request.query_params.get("preset", "")
        if preset and preset != "all":
            rows = preset_filter(rows, preset, user)
        rows = rows.order_by("-created_at", "id")

        def serialize(chunk):
            ids = [row.id for row in chunk]
            project_items = {
                row.id: row
                for row in Issue.objects.filter(id__in=ids, project__isnull=False)
                .annotate(was_assigned_to_me=Exists(IssueAssignee.all_objects.filter(issue_id=OuterRef("pk"), assignee=user)))
                .select_related("project", "state", "created_by")
                .prefetch_related(
                    Prefetch(
                        "issue_assignee",
                        queryset=IssueAssignee.objects.select_related("assignee"),
                        to_attr="current_assignments",
                    )
                )
            }
            flags = {row.id: row.was_assigned_to_me for row in chunk}
            tasks = list(WorkspaceTask.all_objects.filter(id__in=ids).select_related("assignee", "created_by"))
            for task in tasks:
                task.was_assigned_to_me = flags[task.id]
            task_data = {
                str(item["id"]): {**item, "archived": bool(task.archived_at)}
                for item, task in zip(WorkspaceTaskSerializer(tasks, many=True).data, tasks)
            }
            results = []
            deadlines = deadline_badges(ids, Workspace.objects.get(slug=slug)) if ids else {}
            categories = dict(
                Issue.objects.filter(id__in=ids).annotate(work_category=category_expression()).values_list("id", "work_category")
            )
            for row in chunk:
                if row.id in project_items:
                    item = project_items[row.id]
                    item.was_assigned_to_me = flags[row.id]
                    data = PersonalIssueSerializer(item, context={"user_id": user.id}).data
                    results.append(
                        {"kind": "issue", "item": data, "deadline": deadlines.get(str(row.id)), "category": categories.get(row.id)}
                    )
                elif str(row.id) in task_data:
                    results.append(
                        {
                            "kind": "task",
                            "item": task_data[str(row.id)],
                            "deadline": deadlines.get(str(row.id)),
                            "category": categories.get(row.id),
                        }
                    )
            return results

        return paginate(request, rows, serialize, extra={**extra, "is_admin": admin})
