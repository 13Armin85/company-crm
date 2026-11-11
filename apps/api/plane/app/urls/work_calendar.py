from django.urls import path

from plane.app.views.workspace.work_calendar import (
    ActivityPendingEndpoint,
    PresenceDeclarationCancelEndpoint,
    PresenceDeclarationEndpoint,
    WorkCalendarEndpoint,
    WorkCalendarPeopleEndpoint,
    WorkEventCancelEndpoint,
    WorkEventDetailEndpoint,
    WorkEventEndpoint,
    WorkScheduleDefaultEndpoint,
    WorkScheduleEndpoint,
    WorkScheduleExceptionCancelEndpoint,
    WorkScheduleExceptionEndpoint,
)

prefix = "workspaces/<str:slug>/work-calendar/"

urlpatterns = [
    path(prefix, WorkCalendarEndpoint.as_view()),
    path(f"{prefix}people/", WorkCalendarPeopleEndpoint.as_view()),
    path(f"{prefix}schedules/", WorkScheduleEndpoint.as_view()),
    path(f"{prefix}defaults/", WorkScheduleDefaultEndpoint.as_view()),
    path(f"{prefix}exceptions/", WorkScheduleExceptionEndpoint.as_view()),
    path(f"{prefix}exceptions/<uuid:exception_id>/cancel/", WorkScheduleExceptionCancelEndpoint.as_view()),
    path(f"{prefix}events/", WorkEventEndpoint.as_view()),
    path(f"{prefix}events/<uuid:event_id>/", WorkEventDetailEndpoint.as_view()),
    path(f"{prefix}events/<uuid:event_id>/cancel/", WorkEventCancelEndpoint.as_view()),
    path(f"{prefix}presence/", PresenceDeclarationEndpoint.as_view()),
    path(f"{prefix}presence/<uuid:declaration_id>/cancel/", PresenceDeclarationCancelEndpoint.as_view()),
    path(f"{prefix}pending/", ActivityPendingEndpoint.as_view()),
]
