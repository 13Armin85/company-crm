"""Leave requests, Word templates and signature images API (ticket 6).

Views only parse input and call ``leave_requests``, ``leave_templates`` and
``signatures``; every permission and visibility rule is enforced there, so the
server alone guarantees security. Approval decisions use the workflow API.
"""

from io import BytesIO

from django.http import FileResponse, HttpResponse
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from plane.app.services import leave_requests as leave
from plane.app.services import leave_templates as templates
from plane.app.services import signatures
from plane.app.services import workflow_engine as engine
from plane.app.services.access_control import has_permission
from plane.app.services.work_calendar import local_today
from plane.db.models import LeaveRequest, User, WorkflowStepRun
from .entity import EngineAPIView

DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


class LeaveBase(EngineAPIView):
    parser_classes = (JSONParser, MultiPartParser, FormParser)

    def payload(self, request, row):
        row = leave.get_request(row.workspace, row.id)
        return leave.request_payload(row, request.user, request)


class LeaveMetaEndpoint(LeaveBase):
    def get(self, request, slug):
        workspace = self.workspace(slug)
        members = (
            User.objects.filter(
                is_active=True,
                is_bot=False,
                member_workspace__workspace=workspace,
                member_workspace__is_active=True,
                member_workspace__deleted_at__isnull=True,
            )
            .exclude(id=request.user.id)
            .distinct()
            .order_by("display_name", "username")
        )
        return Response(
            {
                "modes": [{"code": code, "title": title} for code, title in leave.MODE_TITLES.items()],
                "statuses": [{"code": code, "title": title} for code, title in leave.STATUS_TITLES.items()],
                "members": [leave.person(user) for user in members],
                "attachment": leave.ATTACHMENT_CONFIG,
                "signature_notice": signatures.NOTICE,
                "can_create": has_permission(request.user, workspace, "LeaveRequest.Create", request=request),
                "has_workflow": engine.definition_for(leave.leave_entity(workspace)) is not None,
                "today": local_today(workspace).isoformat(),
            }
        )


class LeaveRequestsEndpoint(LeaveBase):
    def get(self, request, slug):
        workspace = self.workspace(slug)
        rows = leave.visible_queryset(request.user, workspace, request).select_related("requester", "absence")
        scope = request.query_params.get("scope") or "all"
        if scope == "mine":
            rows = rows.filter(requester=request.user)
        elif scope == "others":
            rows = rows.exclude(requester=request.user)
        elif scope == "waiting":
            entity = leave.leave_entity(workspace)
            waiting = WorkflowStepRun.objects.filter(
                instance__entity=entity, instance__status="running", status=WorkflowStepRun.Status.ACTIVE
            )
            ids = [
                run.instance.record_id
                for run in waiting.select_related("instance__workspace", "assignee")
                if engine.actor_role(request.user, run, workspace)
            ]
            rows = rows.filter(id__in=ids)
        status = request.query_params.get("status")
        if status in LeaveRequest.Status.values:
            rows = rows.filter(status=status)
        return Response(
            {"results": [leave.request_payload(row, request.user, request, detail=False) for row in rows[:200]]}
        )

    def post(self, request, slug):
        workspace = self.workspace(slug)
        row = leave.create(workspace, request.user, request.data, request)
        return Response(self.payload(request, row), status=201)


class LeaveDurationEndpoint(LeaveBase):
    def post(self, request, slug):
        return Response(leave.preview_duration(self.workspace(slug), request.user, request.data, request))


class LeaveAttachmentUploadEndpoint(LeaveBase):
    def post(self, request, slug):
        result = leave.upload_attachment(self.workspace(slug), request.user, request.FILES.get("file"), request)
        return Response(result, status=201)


class LeaveRequestDetailEndpoint(LeaveBase):
    def get(self, request, slug, request_id):
        workspace = self.workspace(slug)
        row = leave.get_request(workspace, request_id)
        leave.require_view(request.user, row, request)
        return Response(leave.request_payload(row, request.user, request))

    def patch(self, request, slug, request_id):
        workspace = self.workspace(slug)
        row = leave.update(workspace, request.user, request_id, request.data, request)
        return Response(self.payload(request, row))


ACTIONS = {
    "new-version": leave.new_version,
    "sign": leave.sign_and_submit,
    "cancel": leave.cancel,
}


class LeaveRequestActionEndpoint(LeaveBase):
    def post(self, request, slug, request_id, action):
        workspace = self.workspace(slug)
        if action not in ACTIONS:
            raise ValidationError("این اقدام وجود ندارد.")
        row = ACTIONS[action](workspace, request.user, request_id, request.data, request)
        return Response(self.payload(request, row))


class LeavePreviewEndpoint(LeaveBase):
    def get(self, request, slug, request_id):
        workspace = self.workspace(slug)
        return Response(
            leave.preview(workspace, request.user, request_id, request.query_params.get("version"), request)
        )


class LeaveHistoryEndpoint(LeaveBase):
    def get(self, request, slug, request_id):
        workspace = self.workspace(slug)
        row = leave.get_request(workspace, request_id)
        leave.require_view(request.user, row, request)
        instance = leave.instance_of(row)
        return Response({"events": leave.history(row), "workflow": engine.timeline(instance) if instance else []})


class LeaveDocumentEndpoint(LeaveBase):
    def get(self, request, slug, request_id, version_id):
        workspace = self.workspace(slug)
        name, content = leave.document_file(workspace, request.user, request_id, version_id, request)
        return FileResponse(BytesIO(content), as_attachment=True, filename=name, content_type=DOCX)


class LeaveAttachmentEndpoint(LeaveBase):
    def get(self, request, slug, request_id, asset_id):
        workspace = self.workspace(slug)
        asset = leave.attachment_file(workspace, request.user, request_id, asset_id, request)
        return FileResponse(
            asset.asset.open("rb"),
            as_attachment=True,
            filename=asset.attributes.get("name", "file"),
            content_type="application/octet-stream",
        )


# ---------------------------------------------------------------- templates


class LeaveTemplatesEndpoint(LeaveBase):
    def get(self, request, slug):
        workspace = self.workspace(slug)
        templates.require_manager(request.user, workspace, request)
        return Response(templates.overview(workspace))

    def post(self, request, slug):
        workspace = self.workspace(slug)
        row = templates.upload(workspace, request.user, request.FILES.get("file"), request.data, request)
        return Response(templates.serialize(row, local_today(workspace)), status=201)


class LeaveTemplateDetailEndpoint(LeaveBase):
    def patch(self, request, slug, template_id):
        workspace = self.workspace(slug)
        row = templates.update(workspace, request.user, template_id, request.data, request)
        return Response(templates.serialize(row, local_today(workspace)))


class LeaveTemplateActivateEndpoint(LeaveBase):
    def post(self, request, slug, template_id):
        workspace = self.workspace(slug)
        row = templates.activate(workspace, request.user, template_id, request)
        return Response(templates.serialize(row, local_today(workspace)))


class LeaveTemplateFileEndpoint(LeaveBase):
    def get(self, request, slug, template_id):
        workspace = self.workspace(slug)
        templates.require_manager(request.user, workspace, request)
        row = templates._get(workspace, template_id)
        return FileResponse(
            BytesIO(templates.content(row)), as_attachment=True, filename=row.original_name, content_type=DOCX
        )


class LeaveTemplateSampleEndpoint(LeaveBase):
    def get(self, request, slug):
        workspace = self.workspace(slug)
        templates.require_manager(request.user, workspace, request)
        return FileResponse(
            templates.sample(), as_attachment=True, filename="leave-template-sample.docx", content_type=DOCX
        )


# ---------------------------------------------------------------- signatures


class SignaturesEndpoint(LeaveBase):
    def get(self, request, slug):
        workspace = self.workspace(slug)
        self.require(request, workspace, "Signature.Manage")
        return Response({"results": signatures.overview(workspace), "notice": signatures.NOTICE})


class SignatureUserEndpoint(LeaveBase):
    def post(self, request, slug, user_id):
        workspace = self.workspace(slug)
        target = signatures.member(workspace, user_id)
        row = signatures.upload(workspace, request.user, target, request.FILES.get("file"), request)
        return Response(signatures.serialize(row), status=201)


class SignatureImageEndpoint(LeaveBase):
    def get(self, request, slug, user_id):
        workspace = self.workspace(slug)
        target = signatures.member(workspace, user_id)
        row, content = signatures.read_image(
            workspace, request.user, target, request.query_params.get("signature"), request
        )
        response = HttpResponse(content, content_type=row.content_type)
        response["Content-Disposition"] = "inline"
        response["X-Content-Type-Options"] = "nosniff"
        return response


class SignatureHistoryEndpoint(LeaveBase):
    def get(self, request, slug, user_id):
        workspace = self.workspace(slug)
        target = signatures.member(workspace, user_id)
        return Response({"results": signatures.history(workspace, request.user, target, request)})


class MySignatureEndpoint(LeaveBase):
    def get(self, request, slug):
        workspace = self.workspace(slug)
        row = signatures.current(workspace, request.user)
        return Response({"signature": signatures.serialize(row), "notice": signatures.NOTICE})


class MySignatureConsentEndpoint(LeaveBase):
    def post(self, request, slug):
        workspace = self.workspace(slug)
        row = signatures.set_consent(workspace, request.user, request.data)
        return Response({"signature": signatures.serialize(row), "notice": signatures.NOTICE})
