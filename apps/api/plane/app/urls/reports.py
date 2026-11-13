from django.urls import path

from plane.app.views.reports.daily import (
    DailyReportDayEndpoint,
    DailyReportDraftEndpoint,
    DailyReportHistoryEndpoint,
    DailyReportMetaEndpoint,
    DailyReportOptionsEndpoint,
    DailyReportPreviousEndpoint,
    DailyReportReminderEndpoint,
    DailyReportSettingsEndpoint,
    DailyReportTeamEndpoint,
    DailyReportTemplatesEndpoint,
    DailyReportUnitReminderEndpoint,
)
from plane.app.views.reports.reports import (
    ReportExportDetailEndpoint,
    ReportExportsEndpoint,
    ReportRunEndpoint,
    ReportShareOptionsEndpoint,
    ReportSourcesEndpoint,
    SavedReportCopyEndpoint,
    SavedReportDetailEndpoint,
    SavedReportRunEndpoint,
    SavedReportsEndpoint,
)

daily = "workspaces/<str:slug>/daily-reports/"
reports = "workspaces/<str:slug>/reports/"

# Never put the word "instances" in these paths (Plane's admin session middleware reads it).
urlpatterns = [
    path(f"{daily}meta/", DailyReportMetaEndpoint.as_view()),
    path(f"{daily}today/", DailyReportDayEndpoint.as_view()),
    path(f"{daily}day/<str:day>/", DailyReportDayEndpoint.as_view()),
    path(f"{daily}day/<str:day>/history/", DailyReportHistoryEndpoint.as_view()),
    path(f"{daily}day/<str:day>/draft/", DailyReportDraftEndpoint.as_view()),
    path(f"{daily}options/", DailyReportOptionsEndpoint.as_view()),
    path(f"{daily}previous/", DailyReportPreviousEndpoint.as_view()),
    path(f"{daily}templates/", DailyReportTemplatesEndpoint.as_view()),
    path(f"{daily}team/", DailyReportTeamEndpoint.as_view()),
    path(f"{daily}reminder/", DailyReportReminderEndpoint.as_view()),
    path(f"{daily}reminder/units/<uuid:unit_id>/", DailyReportUnitReminderEndpoint.as_view()),
    path(f"{daily}settings/", DailyReportSettingsEndpoint.as_view()),
    path(f"{reports}sources/", ReportSourcesEndpoint.as_view()),
    path(f"{reports}run/", ReportRunEndpoint.as_view()),
    path(f"{reports}saved/", SavedReportsEndpoint.as_view()),
    path(f"{reports}saved/<uuid:report_id>/", SavedReportDetailEndpoint.as_view()),
    path(f"{reports}saved/<uuid:report_id>/run/", SavedReportRunEndpoint.as_view()),
    path(f"{reports}saved/<uuid:report_id>/copy/", SavedReportCopyEndpoint.as_view()),
    path(f"{reports}share-options/", ReportShareOptionsEndpoint.as_view()),
    path(f"{reports}exports/", ReportExportsEndpoint.as_view()),
    path(f"{reports}exports/<uuid:export_id>/", ReportExportDetailEndpoint.as_view()),
    path(
        f"{reports}exports/<uuid:export_id>/download/",
        ReportExportDetailEndpoint.as_view(),
        {"download": True},
    ),
]
