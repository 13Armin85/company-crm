from django.urls import path

from plane.app.views.workspace.leave import (
    LeaveAttachmentEndpoint,
    LeaveAttachmentUploadEndpoint,
    LeaveDocumentEndpoint,
    LeaveDurationEndpoint,
    LeaveHistoryEndpoint,
    LeaveMetaEndpoint,
    LeavePreviewEndpoint,
    LeaveRequestActionEndpoint,
    LeaveRequestDetailEndpoint,
    LeaveRequestsEndpoint,
    LeaveTemplateActivateEndpoint,
    LeaveTemplateDetailEndpoint,
    LeaveTemplateFileEndpoint,
    LeaveTemplateSampleEndpoint,
    LeaveTemplatesEndpoint,
    MySignatureConsentEndpoint,
    MySignatureEndpoint,
    SignatureHistoryEndpoint,
    SignatureImageEndpoint,
    SignaturesEndpoint,
    SignatureUserEndpoint,
)

prefix = "workspaces/<str:slug>/leave/"

# Never put the word "instances" in these paths (Plane's admin session middleware reads it).
urlpatterns = [
    path(f"{prefix}meta/", LeaveMetaEndpoint.as_view()),
    path(f"{prefix}requests/", LeaveRequestsEndpoint.as_view()),
    path(f"{prefix}duration/", LeaveDurationEndpoint.as_view()),
    path(f"{prefix}attachments/", LeaveAttachmentUploadEndpoint.as_view()),
    path(f"{prefix}requests/<uuid:request_id>/", LeaveRequestDetailEndpoint.as_view()),
    path(f"{prefix}requests/<uuid:request_id>/preview/", LeavePreviewEndpoint.as_view()),
    path(f"{prefix}requests/<uuid:request_id>/history/", LeaveHistoryEndpoint.as_view()),
    path(
        f"{prefix}requests/<uuid:request_id>/versions/<uuid:version_id>/document/",
        LeaveDocumentEndpoint.as_view(),
    ),
    path(f"{prefix}requests/<uuid:request_id>/files/<uuid:asset_id>/", LeaveAttachmentEndpoint.as_view()),
    path(f"{prefix}requests/<uuid:request_id>/<str:action>/", LeaveRequestActionEndpoint.as_view()),
    path(f"{prefix}templates/", LeaveTemplatesEndpoint.as_view()),
    path(f"{prefix}templates/sample/", LeaveTemplateSampleEndpoint.as_view()),
    path(f"{prefix}templates/<uuid:template_id>/", LeaveTemplateDetailEndpoint.as_view()),
    path(f"{prefix}templates/<uuid:template_id>/activate/", LeaveTemplateActivateEndpoint.as_view()),
    path(f"{prefix}templates/<uuid:template_id>/file/", LeaveTemplateFileEndpoint.as_view()),
    path(f"{prefix}signatures/", SignaturesEndpoint.as_view()),
    path(f"{prefix}signatures/me/", MySignatureEndpoint.as_view()),
    path(f"{prefix}signatures/me/consent/", MySignatureConsentEndpoint.as_view()),
    path(f"{prefix}signatures/<uuid:user_id>/", SignatureUserEndpoint.as_view()),
    path(f"{prefix}signatures/<uuid:user_id>/image/", SignatureImageEndpoint.as_view()),
    path(f"{prefix}signatures/<uuid:user_id>/history/", SignatureHistoryEndpoint.as_view()),
]
