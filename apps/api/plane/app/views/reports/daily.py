"""Daily report API (ticket 8). Every permission, scope and lock rule is enforced in the services."""

from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from plane.app.services import daily_report_draft as draft
from plane.app.services import daily_report_reminders as reminders
from plane.app.services import daily_reports as reports
from plane.app.services.access_control import has_permission
from plane.app.services.work_calendar import local_today
from plane.app.views.workspace.entity import EngineAPIView


class DailyReportBase(EngineAPIView):
    def day(self, workspace, value):
        return reports.parse_day(value, workspace)


class DailyReportMetaEndpoint(DailyReportBase):
    def get(self, request, slug):
        workspace = self.workspace(slug)
        policy = reports.policy(workspace)

        def can(code):
            return has_permission(request.user, workspace, code, request=request)

        return Response(
            {
                "today": local_today(workspace).isoformat(),
                "kinds": [{"code": code, "title": title} for code, title in reports.KIND_TITLES.items()],
                "effort_label": reports.EFFORT_LABEL,
                "presence_label": reports.PRESENCE_LABEL,
                "statuses": reports.DAY_STATUS_TITLES,
                "deadline_time": policy["deadline_time"],
                "edit_window": policy["edit_window"],
                "can": {
                    "submit": can("DailyReport.Submit"),
                    "team": can("DailyReport.Team.View") or can("Report.ViewAll"),
                    "manage_reminders": can("DailyReport.Reminder.Manage"),
                },
            }
        )


class DailyReportDayEndpoint(DailyReportBase):
    def get(self, request, slug, day="today"):
        workspace = self.workspace(slug)
        target = reports.resolve_person(request.user, workspace, request.query_params.get("user"), request)
        return Response(reports.day_payload(workspace, request.user, target, self.day(workspace, day), request))

    def put(self, request, slug, day="today"):
        workspace = self.workspace(slug)
        work_date = self.day(workspace, day)
        reports.save_day(workspace, request.user, work_date, request.data, request)
        return Response(reports.day_payload(workspace, request.user, request.user, work_date, request))


class DailyReportHistoryEndpoint(DailyReportBase):
    def get(self, request, slug, day):
        workspace = self.workspace(slug)
        target = reports.resolve_person(request.user, workspace, request.query_params.get("user"), request)
        return Response({"events": reports.history(workspace, request.user, target, self.day(workspace, day), request)})


class DailyReportDraftEndpoint(DailyReportBase):
    def get(self, request, slug, day):
        workspace = self.workspace(slug)
        if not has_permission(request.user, workspace, "DailyReport.Submit", request=request):
            raise PermissionDenied("مجوز ثبت گزارش روزانه را ندارید.")
        work_date = self.day(workspace, day)
        if work_date > local_today(workspace):
            raise ValidationError({"date": "برای روز آینده پیش‌نویس ساخته نمی‌شود."})
        items = draft.suggestions(workspace, request.user, work_date, request)
        return Response(
            {
                "date": work_date.isoformat(),
                "suggestions": items,
                "empty": "برای این روز فعالیت ثبت‌شده‌ای پیدا نشد." if not items else None,
            }
        )


class DailyReportOptionsEndpoint(DailyReportBase):
    def get(self, request, slug):
        workspace = self.workspace(slug)
        return Response(reports.work_options(workspace, request.user, request.query_params.get("q", ""), request))


class DailyReportPreviousEndpoint(DailyReportBase):
    def get(self, request, slug):
        workspace = self.workspace(slug)
        before = self.day(workspace, request.query_params.get("before"))
        return Response({"previous": reports.previous_report(workspace, request.user, before, request)})


class DailyReportTemplatesEndpoint(DailyReportBase):
    def get(self, request, slug):
        workspace = self.workspace(slug)
        return Response({"templates": reports.templates(workspace, request.user)})

    def put(self, request, slug):
        workspace = self.workspace(slug)
        saved = reports.save_templates(workspace, request.user, request.data.get("templates"), request)
        return Response({"templates": saved})


class DailyReportTeamEndpoint(DailyReportBase):
    def get(self, request, slug):
        workspace = self.workspace(slug)
        day = self.day(workspace, request.query_params.get("date"))
        return Response(reports.team_day(workspace, request.user, day, request))


class DailyReportReminderEndpoint(DailyReportBase):
    def get(self, request, slug):
        workspace = self.workspace(slug)
        return Response(reminders.settings_payload(workspace, request.user, request))

    def put(self, request, slug):
        workspace = self.workspace(slug)
        reminders.save_personal(workspace, request.user, request.data.get("reminder"), request)
        return Response(reminders.settings_payload(workspace, request.user, request))


class DailyReportUnitReminderEndpoint(DailyReportBase):
    def put(self, request, slug, unit_id):
        workspace = self.workspace(slug)
        reminders.save_unit(workspace, request.user, unit_id, request.data, request)
        return Response(reminders.settings_payload(workspace, request.user, request))


class DailyReportSettingsEndpoint(DailyReportBase):
    def put(self, request, slug):
        workspace = self.workspace(slug)
        reminders.save_workspace(workspace, request.user, request.data, request)
        return Response(reminders.settings_payload(workspace, request.user, request))
