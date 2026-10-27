from django.urls import path
from plane.app.views.workspace.dashboard import DashboardEndpoint, DashboardRoleEndpoint, DashboardWidgetEndpoint, DashboardTeamEndpoint, DashboardTeamSettingsEndpoint, DashboardTeamDetailEndpoint, DashboardTeamAssignEndpoint, DashboardTeamRemindEndpoint
from plane.app.views.workspace.entity_import import EngineRecordImportEndpoint
from plane.app.views.workspace.entity_governance import EngineFieldUsageEndpoint
from plane.app.views.workspace.entity_governance import EngineLookupColumnEndpoint, EngineRelatedRecordsEndpoint
from plane.app.views.workspace.entity_governance import EngineUniqueRulesEndpoint, EngineSettingsEndpoint, EngineNumberingEndpoint, EngineRelationDefinitionsEndpoint
from plane.app.views.workspace.surface import SurfaceEndpoint, SurfaceFieldEndpoint, SurfaceValuesEndpoint, SurfaceOptionsEndpoint, SurfaceFileEndpoint
from plane.app.views.workspace.entity_views import (
    EngineViewSchemaEndpoint, EngineViewQueryEndpoint, EngineSavedViewsEndpoint,
    EnginePresentationEndpoint, EngineSummaryEndpoint, EngineBulkEndpoint, EngineExportsEndpoint, EngineViewOptionsEndpoint,
)

from plane.app.views.workspace.entity import (
    EngineCatalogEndpoint,
    EngineDefinitionEndpoint,
    EngineFormEndpoint,
    EngineSchemaEndpoint,
    EngineRecordsEndpoint,
    EngineOptionsEndpoint,
    EngineRelationsEndpoint,
    EngineConfigEndpoint,
    EngineLookupExcelEndpoint,
    EngineLookupOrderEndpoint,
    EngineFileEndpoint,
    EngineEventsEndpoint,
    EngineDefaultFileEndpoint,
)


urlpatterns = [
    path("workspaces/<str:slug>/dashboard/", DashboardEndpoint.as_view()),
    path("workspaces/<str:slug>/dashboard/defaults/<uuid:role_id>/", DashboardRoleEndpoint.as_view()),
    path("workspaces/<str:slug>/dashboard/widgets/data/", DashboardWidgetEndpoint.as_view()),
    path("workspaces/<str:slug>/dashboard/team/", DashboardTeamEndpoint.as_view()),
    path("workspaces/<str:slug>/dashboard/team/settings/", DashboardTeamSettingsEndpoint.as_view()),
    path("workspaces/<str:slug>/dashboard/team/members/<uuid:user_id>/", DashboardTeamDetailEndpoint.as_view()),
    path("workspaces/<str:slug>/dashboard/team/members/<uuid:user_id>/assign/", DashboardTeamAssignEndpoint.as_view()),
    path("workspaces/<str:slug>/dashboard/team/members/<uuid:user_id>/remind/", DashboardTeamRemindEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/entities/<str:code>/import/", EngineRecordImportEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/definitions/fields/<uuid:identifier>/usage/", EngineFieldUsageEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/entities/<str:code>/lookup-columns/", EngineLookupColumnEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/entities/<str:code>/records/<uuid:identifier>/related/<str:field_code>/", EngineRelatedRecordsEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/relations/", EngineRelationDefinitionsEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/relations/<uuid:identifier>/", EngineRelationDefinitionsEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/entities/<str:code>/numbering-rules/", EngineNumberingEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/entities/<str:code>/numbering-rules/<uuid:identifier>/", EngineNumberingEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/settings/", EngineSettingsEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/entities/<str:code>/unique-rules/", EngineUniqueRulesEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/entities/<str:code>/unique-rules/<uuid:identifier>/", EngineUniqueRulesEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/surfaces/", SurfaceEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/surfaces/<str:code>/", SurfaceEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/surfaces/<str:code>/fields/", SurfaceFieldEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/surfaces/<str:code>/values/", SurfaceValuesEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/surfaces/<str:code>/options/<str:field_code>/", SurfaceOptionsEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/surfaces/<str:code>/files/<str:field_code>/", SurfaceFileEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/surfaces/<str:code>/files/<str:field_code>/<uuid:asset_id>/", SurfaceFileEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/entities/<str:code>/view-options/<str:field_path>/", EngineViewOptionsEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/entities/<str:code>/view-schema/", EngineViewSchemaEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/entities/<str:code>/query/", EngineViewQueryEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/entities/<str:code>/views/", EngineSavedViewsEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/entities/<str:code>/views/<uuid:identifier>/", EngineSavedViewsEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/entities/<str:code>/presentation/", EnginePresentationEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/entities/<str:code>/bulk/", EngineBulkEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/entities/<str:code>/records/<uuid:identifier>/summary/", EngineSummaryEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/entities/<str:code>/exports/", EngineExportsEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/entities/<str:code>/exports/<uuid:identifier>/", EngineExportsEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/entities/<str:code>/exports/<uuid:identifier>/download/", EngineExportsEndpoint.as_view(), {"download": True}),
    path("workspaces/<str:slug>/engine/catalog/", EngineCatalogEndpoint.as_view()),
    path(
        "workspaces/<str:slug>/engine/definitions/fields/<uuid:identifier>/default-file/",
        EngineDefaultFileEndpoint.as_view(),
    ),
    path(
        "workspaces/<str:slug>/engine/definitions/fields/<uuid:identifier>/default-file/<uuid:asset_id>/",
        EngineDefaultFileEndpoint.as_view(),
    ),
    path("workspaces/<str:slug>/engine/definitions/<str:kind>/", EngineDefinitionEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/definitions/<str:kind>/<uuid:identifier>/", EngineDefinitionEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/forms/<str:code>/", EngineFormEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/config/", EngineConfigEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/lookups/<uuid:identifier>/excel/", EngineLookupExcelEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/lookups/<uuid:identifier>/order/", EngineLookupOrderEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/events/", EngineEventsEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/entities/<str:code>/schema/", EngineSchemaEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/entities/<str:code>/records/", EngineRecordsEndpoint.as_view()),
    path(
        "workspaces/<str:slug>/engine/entities/<str:code>/records/<uuid:identifier>/", EngineRecordsEndpoint.as_view()
    ),
    path(
        "workspaces/<str:slug>/engine/entities/<str:code>/records/<uuid:identifier>/relations/",
        EngineRelationsEndpoint.as_view(),
    ),
    path(
        "workspaces/<str:slug>/engine/entities/<str:code>/records/<uuid:identifier>/events/",
        EngineEventsEndpoint.as_view(),
    ),
    path("workspaces/<str:slug>/engine/entities/<str:code>/options/<str:field_code>/", EngineOptionsEndpoint.as_view()),
    path("workspaces/<str:slug>/engine/entities/<str:code>/files/<str:field_code>/", EngineFileEndpoint.as_view()),
    path(
        "workspaces/<str:slug>/engine/entities/<str:code>/files/<str:field_code>/<uuid:identifier>/",
        EngineFileEndpoint.as_view(),
    ),
]
