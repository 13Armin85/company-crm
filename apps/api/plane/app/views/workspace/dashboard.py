"""Personal dashboards and scoped team monitoring."""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from plane.app.services.access_control import has_permission
from plane.app.services.dashboard_layout import WIDGETS, default_layout, personal_layout, save_layout, shared_tabs
from plane.app.services.dashboard_team import settings_for, save_team_settings, subordinate_units, team_cards, validate_rules, color_for
from plane.app.services.dashboard_widgets import widget_data
from plane.app.services.entity_records import emit_definition, get_record, record_payload, save_record
from plane.db.models import (
    DashboardConfiguration, EntityType, EntityEvent, Issue, Notification,
    OrganizationRole, OrganizationUnitMember, WorkspaceMember,
)
from .entity import EngineAPIView


class DashboardEndpoint(EngineAPIView):
    def get(self, request, slug):
        workspace = self.workspace(slug)
        if not has_permission(request.user, workspace, "Dashboard.Personal.Manage", request=request):
            raise PermissionDenied()
        config, added = personal_layout(workspace, request.user)
        return Response({
            "tabs": config.tabs, "revision": config.revision,
            "default_updated": added, "shared_tabs": shared_tabs(workspace, request.user),
            "gallery": [{"type": key, "title": title} for key, title in WIDGETS.items()],
            "can_share": has_permission(request.user, workspace, "Dashboard.Share", request=request),
            "can_team": has_permission(request.user, workspace, "Dashboard.Team.View", request=request),
            "can_manage_defaults": has_permission(request.user, workspace, "Dashboard.Default.Manage", request=request),
        })

    def put(self, request, slug):
        workspace = self.workspace(slug)
        row = save_layout(workspace, request.user, request.data.get("tabs"), request.data.get("revision"), request=request)
        return Response({"tabs": row.tabs, "revision": row.revision})

    def delete(self, request, slug):
        workspace = self.workspace(slug)
        if not has_permission(request.user, workspace, "Dashboard.Personal.Manage", request=request):
            raise PermissionDenied()
        with transaction.atomic():
            DashboardConfiguration.objects.filter(workspace=workspace, user=request.user).delete()
            row, _ = personal_layout(workspace, request.user)
        return Response({"tabs": row.tabs, "revision": row.revision})


class DashboardRoleEndpoint(EngineAPIView):
    def get(self, request, slug, role_id):
        workspace = self.workspace(slug)
        if not has_permission(request.user, workspace, "Dashboard.Default.Manage", request=request):
            raise PermissionDenied()
        role = get_object_or_404(OrganizationRole, workspace=workspace, id=role_id, is_active=True)
        row = DashboardConfiguration.objects.filter(workspace=workspace, role=role).first()
        return Response({
            "role": str(role.id), "tabs": row.tabs if row else [], "revision": row.revision if row else 0,
            "gallery": [{"type": key, "title": title} for key, title in WIDGETS.items()],
            "can_team": has_permission(request.user, workspace, "Dashboard.Team.View", request=request),
            "can_manage_defaults": True,
        })

    def put(self, request, slug, role_id):
        workspace = self.workspace(slug)
        role = get_object_or_404(OrganizationRole, workspace=workspace, id=role_id, is_active=True)
        row = save_layout(workspace, request.user, request.data.get("tabs"), request.data.get("revision"), role=role, request=request)
        return Response({"role": str(role.id), "tabs": row.tabs, "revision": row.revision})


class DashboardWidgetEndpoint(EngineAPIView):
    def post(self, request, slug):
        workspace = self.workspace(slug)
        widget = request.data.get("widget")
        if not isinstance(widget, dict):
            raise ValidationError("ویجت معتبر نیست.")
        return Response(widget_data(widget, request, workspace))


class DashboardTeamEndpoint(EngineAPIView):
    def get(self, request, slug):
        workspace = self.workspace(slug)
        options = request.query_params.dict()
        options["descendants"] = options.get("descendants") == "true"
        data = team_cards(workspace, request.user, request, options)
        _issue_idle_alerts(workspace, request.user, data)
        return Response(data)


def _issue_idle_alerts(workspace, manager, result):
    with transaction.atomic():
        settings = type(settings_for(workspace, manager)).objects.select_for_update().get(workspace=workspace, user=manager)
        if not settings.alert_enabled:
            return
        now = timezone.now()
        local = now.astimezone(ZoneInfo("Asia/Tehran"))
        if not settings.workday_start <= local.time() < settings.workday_end:
            return
        changed = False
        last_alerted = dict(settings.last_alerted)
        start = datetime.combine(local.date(), settings.workday_start, tzinfo=local.tzinfo)
        for card in result["cards"]:
            if card["presence"] != "present" or card["in_progress_count"]:
                continue
            since = datetime.fromisoformat(card["last_activity"]).astimezone(local.tzinfo) if card["last_activity"] else start
            since = max(start, since)
            if (local - since).total_seconds() < settings.alert_minutes * 60:
                continue
            previous = datetime.fromisoformat(last_alerted[card["id"]]) if card["id"] in last_alerted else None
            if previous and now - previous < timedelta(minutes=settings.alert_minutes):
                continue
            Notification.objects.create(
                workspace=workspace, receiver=manager, sender="crm:dashboard-team",
                entity_name="team_idle", entity_identifier=card["id"],
                title="عضو تیم بدون کار در حال انجام",
                message={"user_id": card["id"], "name": card["name"]},
                message_stripped=f"{card['name']} در ساعت کاری کار در حال انجام ندارد.",
                data={"user_id": card["id"]},
            )
            last_alerted[card["id"]] = now.isoformat()
            changed = True
        if changed:
            settings.last_alerted = last_alerted
            settings.save(update_fields=["last_alerted"])


class DashboardTeamSettingsEndpoint(EngineAPIView):
    def get(self, request, slug):
        workspace = self.workspace(slug)
        if not has_permission(request.user, workspace, "Dashboard.Team.View", request=request):
            raise PermissionDenied()
        row = settings_for(workspace, request.user)
        return Response({"rules": row.rules, "alert_enabled": row.alert_enabled, "alert_minutes": row.alert_minutes, "workday_start": row.workday_start, "workday_end": row.workday_end, "capacity": row.capacity})

    def put(self, request, slug):
        workspace = self.workspace(slug)
        row = save_team_settings(workspace, request.user, request.data, request)
        return Response({"rules": row.rules, "alert_enabled": row.alert_enabled, "alert_minutes": row.alert_minutes})

    def post(self, request, slug):
        workspace = self.workspace(slug)
        if not has_permission(request.user, workspace, "Dashboard.Team.Rules", request=request):
            raise PermissionDenied()
        rules = validate_rules(request.data.get("rules"))
        cards = team_cards(workspace, request.user, request, {"descendants": request.data.get("descendants", False)})["cards"]
        return Response({"cards": [{"id": card["id"], **color_for(card, rules)} for card in cards]})


def _target(workspace, manager, user_id, request):
    if not has_permission(manager, workspace, "Dashboard.Team.View", request=request):
        raise PermissionDenied()
    units, _ = subordinate_units(workspace, manager, True)
    membership = OrganizationUnitMember.objects.filter(unit_id__in=units, user_id=user_id, is_active=True, user__is_active=True).select_related("user").first()
    if not membership or membership.user_id == manager.id:
        raise PermissionDenied("این فرد در زیرمجموعهٔ شما نیست.")
    return membership.user


class DashboardTeamDetailEndpoint(EngineAPIView):
    def get(self, request, slug, user_id):
        workspace = self.workspace(slug)
        target = _target(workspace, request.user, user_id, request)
        cards = team_cards(workspace, request.user, request, {"descendants": True})["cards"]
        card = next((row for row in cards if row["id"] == str(target.id)), None)
        if not card:
            raise PermissionDenied()
        events = EntityEvent.objects.filter(workspace=workspace, created_by=target, created_at__gte=timezone.now()-timedelta(days=7)).values("created_at")
        dates = {}
        for event in events:
            key = event["created_at"].date().isoformat()
            dates[key] = dates.get(key, 0) + 1
        return Response({"card": card, "week_activity": dates, "hours_logged": None})

    def patch(self, request, slug, user_id):
        workspace = self.workspace(slug)
        target = _target(workspace, request.user, user_id, request)
        if not has_permission(request.user, workspace, "Dashboard.Team.Rules", request=request):
            raise PermissionDenied()
        capacity = request.data.get("capacity")
        if not isinstance(capacity, int) or isinstance(capacity, bool) or not 1 <= capacity <= 1000:
            raise ValidationError("ظرفیت باید عددی بین ۱ تا ۱۰۰۰ باشد.")
        with transaction.atomic():
            settings = settings_for(workspace, target)
            before = {"capacity": settings.capacity}
            settings.capacity = capacity
            settings.save(update_fields=["capacity"])
            emit_definition(workspace, request.user, "dashboard.team_capacity_changed", settings, before, {"capacity": capacity})
        return Response({"capacity": capacity})


class DashboardTeamAssignEndpoint(EngineAPIView):
    def post(self, request, slug, user_id):
        workspace = self.workspace(slug)
        target = _target(workspace, request.user, user_id, request)
        if not has_permission(request.user, workspace, "Dashboard.Team.Assign", request=request):
            raise PermissionDenied()
        data = team_cards(workspace, request.user, request, {"descendants": True})
        card = next(row for row in data["cards"] if row["id"] == str(target.id))
        if card["presence"] == "absent" and request.data.get("confirm_absent") is not True:
            return Response({"warning": "این فرد غایب است؛ پیش از ارجاع تأیید کنید.", "substitute": card["substitute"]}, status=409)
        entity = get_object_or_404(EntityType, workspace=workspace, code="ticket", parent__isnull=True)
        identifier = request.data.get("task_id")
        row, _ = get_record(entity, request.user, identifier, request)
        result = save_record(entity, request.user, {"revision": row.revision, "values": {"ticket_assignees": [str(target.id)]}}, request, identifier)
        return Response(result)


class DashboardTeamRemindEndpoint(EngineAPIView):
    def post(self, request, slug, user_id):
        workspace = self.workspace(slug)
        target = _target(workspace, request.user, user_id, request)
        if not has_permission(request.user, workspace, "Dashboard.Team.Remind", request=request):
            raise PermissionDenied()
        Notification.objects.create(workspace=workspace, receiver=target, triggered_by=request.user,
            sender="crm:dashboard-team", entity_name="team_reminder", entity_identifier=target.id,
            title="یادآوری مدیر", message={"manager": str(request.user.id)},
            message_stripped=str(request.data.get("message", "لطفاً وضعیت کارهای خود را بررسی کنید."))[:500],
            data={"manager": str(request.user.id)})
        return Response({"sent": True}, status=201)
