"""Team cards with replaceable attendance and in-progress providers."""

from collections import defaultdict
from datetime import time, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db.models import Max, Q
from django.utils import timezone
from django.utils.module_loading import import_string
from rest_framework.exceptions import PermissionDenied, ValidationError

from plane.db.models import (
    DashboardTeamSettings, EntityEvent, EntityRecord, EntityType, Issue,
    IssueAssignee, Notification, OrganizationUnit, OrganizationUnitDelegate,
    OrganizationUnitMember, UserAbsence, UserOrganizationRole, WorkspaceMember,
)
from .access_control import has_permission
from .entity_query import EntityQuery
from .entity_records import emit_definition


class AbsencePresenceProvider:
    def status(self, workspace, user_ids, now):
        rows = UserAbsence.objects.filter(
            workspace=workspace, user_id__in=user_ids, status=UserAbsence.Status.SCHEDULED,
            starts_at__lte=now, ends_at__gt=now,
        ).order_by("-starts_at")
        return {row.user_id: {"present": False, "label": "غایب", "reason": row.reason, "return_at": row.ends_at.isoformat()} for row in rows}


class PlaneStartedProvider:
    def is_active(self, issue):
        # Plane's started group includes Review; the project owner confirmed
        # that Review is still work in progress.
        return (issue.get("state__group") == "started" or (not issue.get("state_id") and issue.get("status") in {"in_progress", "review"}))


def presence_provider():
    path = getattr(settings, "DASHBOARD_PRESENCE_PROVIDER", "plane.app.services.dashboard_team.AbsencePresenceProvider")
    return import_string(path)()


def progress_provider():
    path = getattr(settings, "DASHBOARD_PROGRESS_PROVIDER", "plane.app.services.dashboard_team.PlaneStartedProvider")
    return import_string(path)()


def subordinate_units(workspace, manager, include_descendants=False):
    units = list(OrganizationUnit.objects.filter(workspace=workspace, is_active=True).values("id", "parent_id", "manager_id", "title"))
    direct = {row["id"] for row in units if row["manager_id"] == manager.id}
    visible = set(direct)
    if include_descendants:
        while True:
            added = {row["id"] for row in units if row["parent_id"] in visible}
            if added.issubset(visible):
                break
            visible |= added
    return visible, {row["id"]: row for row in units}


def _rule_value(card, metric):
    return {
        "presence": card["presence"],
        "in_progress": card["in_progress_count"],
        "overdue": card["overdue_count"],
        "inactive_hours": card["inactive_hours"],
        "workload": card["workload_percent"],
    }.get(metric)


def color_for(card, rules):
    for rule in rules:
        current = _rule_value(card, rule.get("metric"))
        target = rule.get("value")
        op = rule.get("op")
        try:
            match = {"eq": current == target, "gt": current > target, "gte": current >= target, "lt": current < target, "lte": current <= target}.get(op, False)
        except TypeError:
            match = False
        if match:
            return {"color": rule["color"], "label": rule["label"]}
    if card["presence"] != "present":
        return {"color": "gray", "label": "غایب"}
    if card["in_progress_count"]:
        return {"color": "green", "label": "در حال انجام"}
    return {"color": "red", "label": "بدون کار در حال انجام"}


def validate_rules(rules):
    if not isinstance(rules, list) or len(rules) > 30:
        raise ValidationError("حداکثر ۳۰ قاعده رنگ‌بندی مجاز است.")
    for rule in rules:
        if not isinstance(rule, dict) or rule.get("metric") not in {"presence", "in_progress", "overdue", "inactive_hours", "workload"} or rule.get("op") not in {"eq", "gt", "gte", "lt", "lte"} or rule.get("color") not in {"green", "red", "gray", "yellow", "orange", "blue"} or not isinstance(rule.get("label"), str) or len(rule["label"]) > 80:
            raise ValidationError("شرط، رنگ یا برچسب قاعده معتبر نیست.")
        if rule["metric"] != "presence" and not isinstance(rule.get("value"), (int, float)):
            raise ValidationError("مقدار شرط باید عدد باشد.")
        if rule["metric"] == "presence" and rule.get("value") not in {"present", "absent"}:
            raise ValidationError("وضعیت حضور معتبر نیست.")
    return rules


def settings_for(workspace, manager):
    return DashboardTeamSettings.objects.get_or_create(workspace=workspace, user=manager)[0]


def save_team_settings(workspace, manager, data, request=None):
    required = "Dashboard.Team.Rules" if "rules" in data else "Dashboard.Team.View"
    if not has_permission(manager, workspace, required, request=request):
        raise PermissionDenied()
    row = settings_for(workspace, manager)
    before = {"rules": row.rules, "alert_enabled": row.alert_enabled, "alert_minutes": row.alert_minutes}
    if "rules" in data:
        row.rules = validate_rules(data["rules"])
    if "alert_enabled" in data:
        if not isinstance(data["alert_enabled"], bool):
            raise ValidationError("وضعیت هشدار معتبر نیست.")
        row.alert_enabled = data["alert_enabled"]
    if "alert_minutes" in data:
        minutes = data["alert_minutes"]
        if not isinstance(minutes, int) or not 5 <= minutes <= 480:
            raise ValidationError("فاصله هشدار باید بین ۵ و ۴۸۰ دقیقه باشد.")
        row.alert_minutes = minutes
    for key in ("workday_start", "workday_end"):
        if key in data:
            try:
                value = time.fromisoformat(data[key])
            except (TypeError, ValueError):
                raise ValidationError("ساعت کاری معتبر نیست.")
            setattr(row, key, value)
    start = time.fromisoformat(row.workday_start) if isinstance(row.workday_start, str) else row.workday_start
    end = time.fromisoformat(row.workday_end) if isinstance(row.workday_end, str) else row.workday_end
    if start >= end:
        raise ValidationError("پایان ساعت کاری باید پس از شروع باشد.")
    if "capacity" in data:
        capacity = data["capacity"]
        if not isinstance(capacity, int) or not 1 <= capacity <= 1000:
            raise ValidationError("ظرفیت باید بین ۱ تا ۱۰۰۰ باشد.")
        row.capacity = capacity
    row.save()
    emit_definition(workspace, manager, "dashboard.team_rules_changed", row, before, {"rules": row.rules, "alert_enabled": row.alert_enabled, "alert_minutes": row.alert_minutes})
    return row


def team_cards(workspace, manager, request=None, options=None):
    if not has_permission(manager, workspace, "Dashboard.Team.View", request=request):
        raise PermissionDenied("مجوز مشاهده تیم من را ندارید.")
    options = options or {}
    unit_ids, unit_map = subordinate_units(workspace, manager, bool(options.get("descendants")))
    memberships = list(OrganizationUnitMember.objects.filter(
        unit_id__in=unit_ids, is_active=True, user__is_active=True,
        user__member_workspace__workspace=workspace,
        user__member_workspace__is_active=True,
    ).select_related("user", "unit"))
    by_user = {}
    for membership in memberships:
        if membership.user_id != manager.id:
            by_user.setdefault(membership.user_id, membership)
    user_ids = set(by_user)
    if not user_ids:
        return {"cards": [], "summary": {}, "settings": {"refresh_seconds": 45}, "empty": "زیردستی در دامنهٔ مدیریتی شما پیدا نشد."}
    now = timezone.now()
    def unit_tree(unit_id):
        names, seen = [], set()
        current = unit_id
        while current in unit_map and current not in seen:
            seen.add(current)
            names.append(unit_map[current]["title"])
            current = unit_map[current]["parent_id"]
        return list(reversed(names))
    absences = presence_provider().status(workspace, user_ids, now)
    entity = EntityType.objects.get(workspace=workspace, code="ticket", parent__isnull=True)
    try:
        query = EntityQuery(entity, manager, request)
        allowed_ids = query.rows.values("source_id")
        tasks = list(Issue.objects.filter(workspace=workspace, id__in=allowed_ids).filter(
            Q(assignee_id__in=user_ids) | Q(issue_assignee__assignee_id__in=user_ids)
        ).distinct().values("id", "name", "assignee_id", "state_id", "state__group", "status", "target_date", "created_at", "updated_at"))
    except PermissionDenied:
        tasks = []
    task_ids = [row["id"] for row in tasks]
    assignees = defaultdict(set)
    for row in IssueAssignee.objects.filter(issue_id__in=task_ids, assignee_id__in=user_ids).values("issue_id", "assignee_id"):
        assignees[row["issue_id"]].add(row["assignee_id"])
    numbers = dict(EntityRecord.objects.filter(entity=entity, source_id__in=task_ids).values_list("source_id", "number"))
    provider = progress_provider()
    activity = {row["created_by_id"]: row["latest"] for row in EntityEvent.objects.filter(workspace=workspace, created_by_id__in=user_ids).values("created_by_id").annotate(latest=Max("created_at"))}
    roles = defaultdict(list)
    for row in UserOrganizationRole.objects.filter(workspace=workspace, user_id__in=user_ids, is_active=True).select_related("role"):
        roles[row.user_id].append({"id": str(row.role_id), "name": row.role.name})
    delegates = defaultdict(list)
    for row in OrganizationUnitDelegate.objects.filter(unit_id__in=unit_ids, is_active=True, user__is_active=True).select_related("user").order_by("priority"):
        delegates[row.unit_id].append({"id": str(row.user_id), "name": row.user.display_name})
    capacities = {row.user_id: row.capacity for row in DashboardTeamSettings.objects.filter(workspace=workspace, user_id__in=user_ids)}
    manager_settings = settings_for(workspace, manager)
    cards = {}
    for uid, membership in by_user.items():
        absence = absences.get(uid)
        last = activity.get(uid)
        cards[uid] = {
            "id": str(uid), "name": membership.user.display_name,
            "avatar": getattr(membership.user, "avatar", "") or "",
            "position": roles[uid][0]["name"] if roles[uid] else "",
            "roles": roles[uid], "unit_id": str(membership.unit_id),
            "unit": membership.unit.title, "team": membership.unit.title,
            "unit_depth": max(0, len(unit_tree(membership.unit_id)) - 1),
            "unit_path": " / ".join(unit_tree(membership.unit_id)),
            "presence": "absent" if absence else "present",
            "presence_label": absence["label"] if absence else "حاضر",
            "reason": absence["reason"] if absence else "",
            "return_at": absence["return_at"] if absence else None,
            "substitute": delegates[membership.unit_id][0] if delegates[membership.unit_id] else None,
            "active_tasks": [], "in_progress_count": 0, "open_count": 0,
            "overdue_count": 0, "capacity": capacities.get(uid, 8),
            "last_activity": last.isoformat() if last else None,
            "inactive_hours": round((now - last).total_seconds() / 3600, 1) if last else 999,
        }
    for issue in tasks:
        targets = assignees[issue["id"]] | ({issue["assignee_id"]} if issue["assignee_id"] else set())
        active = provider.is_active(issue)
        open_ = issue["state__group"] not in {"completed", "cancelled"} and issue["status"] not in {"done", "cancelled"}
        overdue = open_ and issue["target_date"] and issue["target_date"] < now.date()
        for uid in targets & user_ids:
            card = cards[uid]
            card["open_count"] += int(open_)
            card["overdue_count"] += int(bool(overdue))
            card["in_progress_count"] += int(active)
            if active and len(card["active_tasks"]) < 3:
                card["active_tasks"].append({"id": str(issue["id"]), "number": numbers.get(issue["id"]), "title": issue["name"], "started_at": issue["updated_at"].isoformat() if issue["updated_at"] else issue["created_at"].isoformat()})
    for card in cards.values():
        card["workload_percent"] = round(card["open_count"] * 100 / max(1, card["capacity"]))
        card.update(color_for(card, manager_settings.rules))
    result = list(cards.values())
    term = str(options.get("search", "")).strip().casefold()[:100]
    if term:
        result = [card for card in result if term in card["name"].casefold()]
    for key in ("unit", "role", "status"):
        value = options.get(key)
        if value:
            result = [card for card in result if (card["unit_id"] == value if key == "unit" else any(role["id"] == value for role in card["roles"]) if key == "role" else card["color"] == value)]
    result.sort(key=(lambda card: -card["workload_percent"]) if options.get("sort") == "workload" else (lambda card: card["name"]))
    summary = defaultdict(int)
    for card in cards.values():
        summary[card["color"]] += 1
    return {"cards": result, "summary": dict(summary), "settings": {"refresh_seconds": 45, "alert_enabled": manager_settings.alert_enabled, "alert_minutes": manager_settings.alert_minutes}, "empty": "زیردستی در دامنهٔ مدیریتی شما پیدا نشد." if not result else None}
