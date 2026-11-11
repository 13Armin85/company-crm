"""Work calendar: schedules, exceptions, work events, presence and confirmations.

Every endpoint re-checks access on the server; the UI only mirrors these flags.
"""

from datetime import date, datetime, time, timedelta

from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from plane.app.services import work_calendar_actions as actions
from plane.app.services.access_control import has_permission
from plane.app.services.work_calendar import availability, calendar_zone, local_today, schedule_range
from plane.db.models import (
    OrganizationUnit,
    PresenceDeclaration,
    UserAbsence,
    WorkEvent,
    WorkSchedule,
    WorkScheduleException,
)
from .entity import EngineAPIView


def _range(request, workspace):
    today = local_today(workspace)
    try:
        start = date.fromisoformat(request.query_params.get("start") or today.replace(day=1).isoformat())
        end = date.fromisoformat(request.query_params.get("end") or (start + timedelta(days=41)).isoformat())
    except ValueError:
        raise ValidationError({"start": "بازهٔ تاریخ معتبر نیست."})
    if end < start or (end - start).days > actions.MAX_RANGE_DAYS:
        raise ValidationError({"end": "بازهٔ تاریخ باید حداکثر ۶۲ روز باشد."})
    return start, end


class WorkCalendarBase(EngineAPIView):
    def target(self, request, workspace, key="user"):
        user_id = request.query_params.get(key)
        return actions.member_user(workspace, user_id) if user_id else request.user


class WorkCalendarEndpoint(WorkCalendarBase):
    """Calendar layers for one person; colleagues without access get busy blocks only."""

    def get(self, request, slug):
        workspace = self.workspace(slug)
        target = self.target(request, workspace)
        actions.member_user(workspace, request.user.id)
        start, end = _range(request, workspace)
        zone = calendar_zone(workspace)
        moment_start = datetime.combine(start, time.min, tzinfo=zone)
        moment_end = datetime.combine(end + timedelta(days=1), time.min, tzinfo=zone)
        details = actions.schedule_access(request.user, target, workspace, "view", request)
        events = (
            WorkEvent.objects.filter(
                workspace=workspace,
                participant_rows__user=target,
                participant_rows__deleted_at__isnull=True,
                starts_at__lt=moment_end,
                ends_at__gt=moment_start,
            )
            .distinct()
            .order_by("starts_at")
        )
        if not details:
            events = events.filter(status=WorkEvent.Status.PLANNED)
        segments = availability(target, moment_start, moment_end, workspace)
        payload = {
            "user": {"id": str(target.id), "name": target.display_name or target.email},
            "time_zone": str(zone),
            "today": local_today(workspace).isoformat(),
            "can_view_details": details,
            "events": [
                actions.serialize_event(event, request.user, workspace, request, for_user=target if details else None)
                for event in events
            ],
            "availability": [
                {
                    "start": row["start"].isoformat(),
                    "end": row["end"].isoformat(),
                    "available": row["available"],
                    "reason": row["reason"] if details else None,
                    "label": "در دسترس" if row["available"] else "در دسترس نیست",
                }
                for row in segments
            ],
        }
        if not details:
            return Response({**payload, "restricted": True})
        payload.update(
            {
                "restricted": False,
                "is_self": target.id == request.user.id,
                "can_edit": actions.schedule_access(request.user, target, workspace, "edit", request),
                "can_edit_past": has_permission(request.user, workspace, "WorkSchedule.EditPast", request=request),
                "can_schedule": actions.can_schedule_for(request.user, target, workspace, request),
                "days": [day.as_dict(zone) for day in schedule_range(target, start, end, workspace)],
                "exceptions": [
                    actions.serialize_exception(row)
                    for row in WorkScheduleException.objects.filter(
                        workspace=workspace, user=target, date_from__lte=end, date_to__gte=start
                    )
                ],
                "absences": [
                    {
                        "id": str(row.id),
                        "starts_at": row.starts_at.isoformat(),
                        "ends_at": row.ends_at.isoformat(),
                        "reason": row.reason,
                        "label": "مرخصی",
                    }
                    for row in UserAbsence.objects.filter(
                        workspace=workspace,
                        user=target,
                        status=UserAbsence.Status.SCHEDULED,
                        starts_at__lt=moment_end,
                        ends_at__gt=moment_start,
                    )
                ],
                "presence": [
                    actions.serialize_presence(row)
                    for row in PresenceDeclaration.objects.filter(
                        workspace=workspace, user=target, date__gte=start, date__lte=end
                    )
                ],
            }
        )
        if target.id == request.user.id:
            today = local_today(workspace)
            today_schedule = next((day for day in payload["days"] if day["date"] == today.isoformat()), None)
            if today_schedule is None:
                from plane.app.services.work_calendar import schedule_for

                today_schedule = schedule_for(target, today, workspace).as_dict(zone)
            declared = PresenceDeclaration.objects.filter(
                workspace=workspace, user=target, date=today, status=PresenceDeclaration.Status.ACTIVE
            ).first()
            payload["presence_today"] = {
                "can_declare": not today_schedule["is_working"] and declared is None,
                "is_working_day": today_schedule["is_working"],
                "declaration": actions.serialize_presence(declared) if declared else None,
            }
        return Response(payload)


class WorkCalendarPeopleEndpoint(WorkCalendarBase):
    def get(self, request, slug):
        workspace = self.workspace(slug)
        return Response(
            {
                "people": actions.visible_people(request.user, workspace, request),
                "can_manage_defaults": has_permission(
                    request.user, workspace, "WorkSchedule.ManageDefaults", request=request
                ),
            }
        )


class WorkScheduleEndpoint(WorkCalendarBase):
    def get(self, request, slug):
        workspace = self.workspace(slug)
        target = self.target(request, workspace)
        rows = actions.list_versions(workspace, request.user, target, request)
        return Response({"versions": [actions.serialize_version(row) for row in rows]})

    def post(self, request, slug):
        workspace = self.workspace(slug)
        target = actions.member_user(workspace, request.data.get("user") or request.user.id)
        row = actions.create_version(workspace, request.user, request.data, target=target, request=request)
        return Response(actions.serialize_version(row), status=201)


class WorkScheduleDefaultEndpoint(WorkCalendarBase):
    """Company or unit default schedules (minimal workspace default)."""

    def get(self, request, slug):
        workspace = self.workspace(slug)
        self.require(request, workspace, "WorkSchedule.ManageDefaults")
        rows = WorkSchedule.objects.filter(workspace=workspace, scope__in=["company", "unit"]).prefetch_related("days")
        return Response({"versions": [actions.serialize_version(row) for row in rows]})

    def post(self, request, slug):
        workspace = self.workspace(slug)
        scope = request.data.get("scope", "company")
        if scope not in {"company", "unit"}:
            raise ValidationError({"scope": "دامنهٔ برنامه باید شرکت یا واحد باشد."})
        unit = None
        if scope == "unit":
            unit = get_object_or_404(OrganizationUnit, workspace=workspace, id=request.data.get("unit"), is_active=True)
        row = actions.create_version(workspace, request.user, request.data, scope=scope, unit=unit, request=request)
        return Response(actions.serialize_version(row), status=201)


class WorkScheduleExceptionEndpoint(WorkCalendarBase):
    def post(self, request, slug):
        workspace = self.workspace(slug)
        target = actions.member_user(workspace, request.data.get("user") or request.user.id)
        row = actions.create_exception(workspace, request.user, target, request.data, request)
        return Response(actions.serialize_exception(row), status=201)


class WorkScheduleExceptionCancelEndpoint(WorkCalendarBase):
    def post(self, request, slug, exception_id):
        workspace = self.workspace(slug)
        row = actions.cancel_exception(workspace, request.user, exception_id, request.data, request)
        return Response(actions.serialize_exception(row))


class WorkEventEndpoint(WorkCalendarBase):
    def post(self, request, slug):
        workspace = self.workspace(slug)
        event, warnings = actions.create_event(workspace, request.user, request.data, request)
        return Response(
            {"event": actions.serialize_event(event, request.user, workspace, request), "warnings": warnings},
            status=201,
        )


class WorkEventDetailEndpoint(WorkCalendarBase):
    def get(self, request, slug, event_id):
        workspace = self.workspace(slug)
        actions.member_user(workspace, request.user.id)
        event = get_object_or_404(WorkEvent, workspace=workspace, id=event_id)
        return Response(actions.serialize_event(event, request.user, workspace, request))

    def patch(self, request, slug, event_id):
        workspace = self.workspace(slug)
        event, warnings = actions.update_event(workspace, request.user, event_id, request.data, request)
        return Response(
            {"event": actions.serialize_event(event, request.user, workspace, request), "warnings": warnings}
        )


class WorkEventCancelEndpoint(WorkCalendarBase):
    def post(self, request, slug, event_id):
        workspace = self.workspace(slug)
        event = actions.cancel_event(workspace, request.user, event_id, request.data, request)
        return Response(actions.serialize_event(event, request.user, workspace, request))


class PresenceDeclarationEndpoint(WorkCalendarBase):
    def post(self, request, slug):
        workspace = self.workspace(slug)
        actions.member_user(workspace, request.user.id)
        row = actions.declare_presence(workspace, request.user, request)
        return Response(actions.serialize_presence(row), status=201)


class PresenceDeclarationCancelEndpoint(WorkCalendarBase):
    def post(self, request, slug, declaration_id):
        workspace = self.workspace(slug)
        row = actions.cancel_presence(workspace, request.user, declaration_id, request.data, request)
        return Response(actions.serialize_presence(row))


class ActivityPendingEndpoint(WorkCalendarBase):
    def get(self, request, slug):
        workspace = self.workspace(slug)
        actions.member_user(workspace, request.user.id)
        return Response({"items": actions.pending_items(workspace, request.user)})

    def post(self, request, slug):
        workspace = self.workspace(slug)
        actions.member_user(workspace, request.user.id)
        row = actions.confirm_activity(workspace, request.user, request.data, request)
        return Response(
            {
                "id": str(row.id),
                "source_type": row.source_type,
                "source_id": str(row.source_id),
                "outcome": row.outcome,
                "summary": row.summary,
                "confirmed_at": row.confirmed_at.isoformat(),
            },
            status=201,
        )
