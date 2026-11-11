from django.urls import path

from plane.app.views.workspace.workflow import (
    WorkflowDefinitionDetailEndpoint,
    WorkflowDefinitionsEndpoint,
    WorkflowDraftEndpoint,
    WorkflowExtensionDecisionEndpoint,
    WorkflowInboxEndpoint,
    WorkflowInstanceActionEndpoint,
    WorkflowInstancesEndpoint,
    WorkflowMetaEndpoint,
    WorkflowMigrationPreviewEndpoint,
    WorkflowPublishEndpoint,
    WorkflowRecordEndpoint,
    WorkflowSimulateEndpoint,
    WorkflowValidateEndpoint,
    WorkflowVersionEndpoint,
)

prefix = "workspaces/<str:slug>/workflows/"

# Never put the word "instances" in these paths: Plane's SessionMiddleware reads the
# god-mode admin session cookie for any path containing it, so members would be anonymous.

urlpatterns = [
    path(f"{prefix}meta/", WorkflowMetaEndpoint.as_view()),
    path(f"{prefix}definitions/", WorkflowDefinitionsEndpoint.as_view()),
    path(f"{prefix}definitions/<uuid:definition_id>/", WorkflowDefinitionDetailEndpoint.as_view()),
    path(f"{prefix}definitions/<uuid:definition_id>/versions/", WorkflowDraftEndpoint.as_view()),
    path(f"{prefix}versions/<uuid:version_id>/", WorkflowVersionEndpoint.as_view()),
    path(f"{prefix}versions/<uuid:version_id>/validate/", WorkflowValidateEndpoint.as_view()),
    path(f"{prefix}versions/<uuid:version_id>/simulate/", WorkflowSimulateEndpoint.as_view()),
    path(f"{prefix}versions/<uuid:version_id>/publish/", WorkflowPublishEndpoint.as_view()),
    path(f"{prefix}records/<str:entity_code>/<uuid:record_id>/", WorkflowRecordEndpoint.as_view()),
    path(f"{prefix}runs/", WorkflowInstancesEndpoint.as_view()),
    path(f"{prefix}runs/<uuid:instance_id>/migration-preview/", WorkflowMigrationPreviewEndpoint.as_view()),
    path(f"{prefix}runs/<uuid:instance_id>/<str:action>/", WorkflowInstanceActionEndpoint.as_view()),
    path(f"{prefix}extensions/<uuid:extension_id>/decide/", WorkflowExtensionDecisionEndpoint.as_view()),
    path(f"{prefix}inbox/", WorkflowInboxEndpoint.as_view()),
]
