"""Ticket 8 — single source of truth for "whose data may a report show" (decision 8.8).

Every base report, the report builder, saved reports, counts and file exports take their
people/ticket scope from :func:`people_scope` and :func:`ticket_rows` only. Nothing else in
the report code accepts a user or unit id from the request without intersecting it here.

Rules (recomputed on every run; saving or sharing a report never widens them):

- the viewer always sees their own data;
- ``Report.ViewAll`` → every active member of the workspace;
- the team code of the source (``Report.Team.View``; for the daily-report status also
  ``DailyReport.Team.View``) → people below the viewer in the organization
  (``access_control.management_relation``, direct and indirect, the same scope as
  leave requests and work schedules) plus, during an active substitution
  (``access_control.delegation_context``), the people below the absent manager;
- a permission alone never opens anyone: a "team" code without subordinates is just self.

Tickets are never widened by a report: a ticket row is shown only when the viewer may
see the ticket (``task_visibility.visible_issues``, which already includes extension
approvers and referral participants via ``ticket_core.participant_q``) *and* the ticket
belongs to a person in scope (its active assignees, or its creator when it has none).

Out-of-scope ids in a filter are dropped silently (the result is narrowed, never an
error), identically in the page, the counts and the file export.
"""

from dataclasses import dataclass, field

from django.db.models import Exists, OuterRef, Q

from plane.db.models import Issue, IssueAssignee, OrganizationUnitMember, User, WorkspaceMember
from .access_control import delegation_context, has_permission

TEAM_CODES = {
    "default": ("Report.Team.View",),
    "daily_reports": ("DailyReport.Team.View", "Report.Team.View"),
}


@dataclass(frozen=True)
class Scope:
    viewer_id: object
    user_ids: frozenset
    all_people: bool = False
    team: bool = False
    unit_ids: frozenset = field(default_factory=frozenset)

    def allows(self, user_id):
        return user_id in self.user_ids

    def narrow(self, requested):
        """Intersection with the scope; ids outside it are ignored (never an error, never a widening)."""
        wanted = {str(value) for value in requested or []}
        return {user_id for user_id in self.user_ids if str(user_id) in wanted}


def _members(workspace):
    return set(
        WorkspaceMember.objects.filter(
            workspace=workspace, is_active=True, member__is_active=True, member__is_bot=False
        ).values_list("member_id", flat=True)
    )


def managed_people(manager_id, workspace, request=None):
    """People below ``manager_id`` (direct or indirect); the shared leave/work-schedule scope."""
    from .leave_requests import managed_user_ids

    return managed_user_ids(User(id=manager_id), workspace, request)


def team_allowed(viewer, workspace, source=None, request=None):
    codes = TEAM_CODES.get(source or "", TEAM_CODES["default"])
    return any(has_permission(viewer, workspace, code, request=request) for code in codes)


def people_scope(viewer, workspace, *, source=None, request=None, team=True):
    members = _members(workspace)
    ids = {viewer.id}
    if team and has_permission(viewer, workspace, "Report.ViewAll", request=request):
        ids = members | {viewer.id}
        return Scope(viewer.id, frozenset(ids & (members | {viewer.id})), all_people=True, team=True)
    widened = False
    if team and team_allowed(viewer, workspace, source, request):
        ids |= managed_people(viewer.id, workspace, request)
        for item in delegation_context(workspace).values():
            if item["user_id"] == viewer.id:
                ids |= managed_people(item["manager_id"], workspace, request)
        widened = len(ids) > 1
    ids = {user_id for user_id in ids if user_id in members or user_id == viewer.id}
    units = frozenset(
        OrganizationUnitMember.objects.filter(
            unit__workspace=workspace, unit__is_active=True, is_active=True, user_id__in=ids
        ).values_list("unit_id", flat=True)
    )
    return Scope(viewer.id, frozenset(ids), all_people=False, team=widened, unit_ids=units)


def owner_q(user_ids):
    """A ticket "belongs" to its active assignees, or to its creator when it has none."""
    active = IssueAssignee.objects.filter(issue_id=OuterRef("pk"), deleted_at__isnull=True)
    return Q(issue_assignee__assignee_id__in=user_ids, issue_assignee__deleted_at__isnull=True) | (
        ~Q(Exists(active)) & Q(created_by_id__in=user_ids)
    )


def visible_ticket_ids(viewer, workspace, request=None):
    """Subquery of ticket ids the viewer may see (the one ticket-visibility rule of the project)."""
    from .task_visibility import visible_issues

    rows = Issue.objects.filter(workspace=workspace, is_draft=False)
    return visible_issues(rows, viewer, workspace.slug, request=request).values("id")


def ticket_rows(viewer, workspace, scope, request=None):
    """Tickets visible to the viewer and owned by a person in scope (never wider than either)."""
    return (
        Issue.objects.filter(workspace=workspace, is_draft=False, id__in=visible_ticket_ids(viewer, workspace, request))
        .filter(owner_q(list(scope.user_ids)))
        .distinct()
    )
