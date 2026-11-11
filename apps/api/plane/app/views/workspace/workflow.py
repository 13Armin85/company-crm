"""Workflow engine API. Views only call ``workflow_engine`` (read) and ``workflow_actions`` (write).

Every endpoint re-checks access on the server; the UI only mirrors the flags it gets.
"""

from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response

from plane.app.services import workflow_actions as actions
from plane.app.services import workflow_engine as engine
from plane.db.models import (
    EntityType,
    OrganizationRole,
    User,
    WorkflowDefinition,
    WorkflowInstance,
    WorkflowVersion,
)
from .entity import EngineAPIView


class WorkflowBase(EngineAPIView):
    def base(self, request, slug, code="Workflow.View"):
        workspace = self.workspace(slug)
        self.require(request, workspace, "Workflow.View")
        if code != "Workflow.View":
            self.require(request, workspace, code)
        return workspace

    def definition(self, workspace, definition_id):
        return get_object_or_404(
            WorkflowDefinition.objects.select_related("entity", "subtype", "workspace"),
            workspace=workspace,
            id=definition_id,
        )

    def version(self, workspace, version_id):
        return get_object_or_404(
            WorkflowVersion.objects.select_related(
                "definition__entity", "definition__subtype", "definition__workspace"
            ),
            definition__workspace=workspace,
            id=version_id,
        )

    def instance(self, workspace, instance_id):
        return get_object_or_404(
            WorkflowInstance.objects.select_related("version", "definition", "entity", "workspace", "subject"),
            workspace=workspace,
            id=instance_id,
        )

    def payload(self, request, instance):
        instance = self.instance(instance.workspace, instance.id)
        return engine.instance_payload(instance, request.user, request)


class WorkflowMetaEndpoint(WorkflowBase):
    """What the designer may choose from: existing statuses, fields, roles, people."""

    def get(self, request, slug):
        workspace = self.base(request, slug)
        code = request.query_params.get("entity")
        entities = EntityType.objects.filter(workspace=workspace, parent__isnull=True, is_active=True).order_by("title")
        result = {
            "entities": [
                {
                    "code": row.code,
                    "title": row.title,
                    "adapter": row.adapter,
                    "subtypes": [{"code": s.code, "title": s.title} for s in row.subtypes.filter(is_active=True)],
                }
                for row in entities
                if row.adapter not in {"user", "unit", "project"}
            ],
            "step_types": engine.STEP_TYPES,
            "transition_kinds": engine.TRANSITION_KINDS,
            "assignee_types": engine.ASSIGNEE_TYPES,
            "pause_kinds": engine.PAUSE_KINDS,
            "max_auto_steps": engine.max_auto_steps(),
            "roles": [
                {"id": str(row.id), "name": row.name}
                for row in OrganizationRole.objects.filter(workspace=workspace, is_active=True).order_by("name")
            ],
            "members": [
                {"id": str(row.id), "name": engine.user_name(row)}
                for row in User.objects.filter(
                    is_active=True,
                    member_workspace__workspace=workspace,
                    member_workspace__is_active=True,
                    member_workspace__deleted_at__isnull=True,
                )
                .distinct()
                .order_by("display_name")
            ],
        }
        if code:
            entity = get_object_or_404(EntityType, workspace=workspace, code=code, parent__isnull=True)
            subtype = entity.subtypes.filter(code=request.query_params.get("subtype")).first()
            settings = {"status_field": request.query_params.get("status_field") or ""}
            result["statuses"] = engine.status_options(entity, settings)
            result["fields"] = [
                {"code": key, "title": field["title"], "kind": field["kind"]}
                for key, field in engine.entity_fields(entity, subtype).items()
            ]
        return Response(result)


class WorkflowDefinitionsEndpoint(WorkflowBase):
    def get(self, request, slug):
        workspace = self.base(request, slug)
        rows = WorkflowDefinition.objects.filter(workspace=workspace).select_related("entity", "subtype")
        if request.query_params.get("entity"):
            rows = rows.filter(entity__code=request.query_params["entity"])
        return Response({"results": [engine.serialize_definition(row) for row in rows]})

    def post(self, request, slug):
        workspace = self.base(request, slug, "Workflow.Design")
        definition, _ = actions.create_definition(workspace, request.user, request.data)
        return Response(engine.serialize_definition(definition), status=201)


class WorkflowDefinitionDetailEndpoint(WorkflowBase):
    def get(self, request, slug, definition_id):
        workspace = self.base(request, slug)
        return Response(engine.serialize_definition(self.definition(workspace, definition_id)))

    def patch(self, request, slug, definition_id):
        workspace = self.base(request, slug, "Workflow.Design")
        definition = actions.update_definition(workspace, request.user, definition_id, request.data)
        return Response(engine.serialize_definition(definition))


class WorkflowDraftEndpoint(WorkflowBase):
    def post(self, request, slug, definition_id):
        workspace = self.base(request, slug, "Workflow.Design")
        version = actions.new_draft(workspace, request.user, definition_id)
        return Response(engine.serialize_version(version, workspace), status=201)


class WorkflowVersionEndpoint(WorkflowBase):
    def get(self, request, slug, version_id):
        workspace = self.base(request, slug)
        return Response(engine.serialize_version(self.version(workspace, version_id), workspace))

    def put(self, request, slug, version_id):
        workspace = self.base(request, slug, "Workflow.Design")
        version = actions.save_draft(workspace, request.user, version_id, request.data)
        return Response(engine.serialize_version(version, workspace))


class WorkflowValidateEndpoint(WorkflowBase):
    def post(self, request, slug, version_id):
        workspace = self.base(request, slug, "Workflow.Design")
        version = self.version(workspace, version_id)
        graph = request.data.get("graph") if isinstance(request.data.get("graph"), dict) else version.graph
        issues = engine.validate_graph(version.definition, graph)
        return Response({"valid": not issues, "issues": issues})


class WorkflowSimulateEndpoint(WorkflowBase):
    """Dry run with sample values. Wrapped in a rolled-back transaction as a second guard."""

    def post(self, request, slug, version_id):
        workspace = self.base(request, slug, "Workflow.Design")
        version = self.version(workspace, version_id)
        graph = request.data.get("graph") if isinstance(request.data.get("graph"), dict) else version.graph
        values = request.data.get("values") if isinstance(request.data.get("values"), dict) else {}
        subject = None
        if request.data.get("subject"):
            subject = actions._member(workspace, request.data["subject"], "subject")
        with transaction.atomic():
            issues = engine.validate_graph(version.definition, graph)
            path = engine.simulate(version.definition, graph, values, subject=subject)
            transaction.set_rollback(True)
        return Response({"issues": issues, "path": path})


class WorkflowPublishEndpoint(WorkflowBase):
    def post(self, request, slug, version_id):
        workspace = self.base(request, slug, "Workflow.Publish")
        version = actions.publish(workspace, request.user, version_id, request.data)
        return Response(engine.serialize_version(version, workspace))


class WorkflowRecordEndpoint(WorkflowBase):
    """The workflow panel of one record."""

    def get(self, request, slug, entity_code, record_id):
        self.base(request, slug)
        entity = self.entity(slug, entity_code)
        instance = engine.instance_for(entity, record_id)
        if instance is not None:
            if not engine.can_view_instance(request.user, instance, request):
                from django.http import Http404
                from plane.app.services.entity_records import get_record

                try:
                    get_record(entity, request.user, record_id, request)
                except (Http404, PermissionDenied):
                    raise PermissionDenied("اجازهٔ مشاهدهٔ گردش‌کار این رکورد را ندارید.")
            return Response({"instance": engine.instance_payload(instance, request.user, request), "can_start": False})
        from plane.app.services.entity_records import get_record

        row, _ = get_record(entity, request.user, record_id, request)
        definition = engine.definition_for(entity, row.subtype if row else None)
        return Response({"instance": None, "can_start": definition is not None})

    def post(self, request, slug, entity_code, record_id):
        workspace = self.base(request, slug)
        instance = actions.start(workspace, request.user, entity_code, record_id, request.data, request)
        return Response({"instance": self.payload(request, instance)}, status=201)


ACTIONS = {
    "transition": lambda w, r, i: actions.transition(w, r.user, i, r.data, r),
    "reassign": lambda w, r, i: actions.reassign(w, r.user, i, r.data, r),
    "pause": lambda w, r, i: actions.pause(w, r.user, i, r.data),
    "resume": lambda w, r, i: actions.resume(w, r.user, i, r.data),
    "delay-report": lambda w, r, i: actions.delay_report(w, r.user, i, r.data),
    "extension": lambda w, r, i: actions.request_extension(w, r.user, i, r.data),
    "contact-resolve": lambda w, r, i: actions.contact_resolve(w, r.user, i, r.data),
    "to-standard": lambda w, r, i: actions.to_standard(w, r.user, i, r.data, r),
    "migrate": lambda w, r, i: actions.migrate(w, r.user, i, r.data, r),
}


class WorkflowInstanceActionEndpoint(WorkflowBase):
    def post(self, request, slug, instance_id, action):
        workspace = self.base(request, slug)
        if action not in ACTIONS:
            raise NotFound("این اقدام وجود ندارد.")
        ACTIONS[action](workspace, request, instance_id)
        instance = self.instance(workspace, instance_id)
        return Response({"instance": engine.instance_payload(instance, request.user, request)})


class WorkflowMigrationPreviewEndpoint(WorkflowBase):
    def get(self, request, slug, instance_id):
        workspace = self.base(request, slug, "Workflow.Migrate")
        instance = self.instance(workspace, instance_id)
        version = WorkflowVersion.objects.filter(
            definition=instance.definition, id=request.query_params.get("version")
        ).first()
        if version is None:
            raise ValidationError({"version": "نسخهٔ مقصد پیدا نشد."})
        target_step = request.query_params.get("step")
        step_map = {instance.current_step: target_step} if target_step else None
        return Response(engine.migration_preview(instance, version, step_map))


class WorkflowExtensionDecisionEndpoint(WorkflowBase):
    def post(self, request, slug, extension_id):
        workspace = self.base(request, slug)
        extension = actions.decide_extension(workspace, request.user, extension_id, request.data, request)
        instance = self.instance(workspace, extension.step_run.instance_id)
        return Response({"instance": engine.instance_payload(instance, request.user, request)})


class WorkflowInboxEndpoint(WorkflowBase):
    def get(self, request, slug):
        workspace = self.base(request, slug)
        return Response(engine.inbox(request.user, workspace, request))


class WorkflowInstancesEndpoint(WorkflowBase):
    """Management list; errors stay visible here until someone fixes them."""

    def get(self, request, slug):
        workspace = self.base(request, slug)
        rows = WorkflowInstance.objects.filter(workspace=workspace).select_related(
            "version", "definition", "entity", "workspace", "subject"
        )
        status = request.query_params.get("status")
        if status:
            rows = rows.filter(status=status)
        results = []
        for instance in rows[:200]:
            if not engine.can_view_instance(request.user, instance, request):
                continue
            row, native = engine.record_parts(instance.entity, instance.record_id)
            results.append(
                {
                    "id": str(instance.id),
                    "entity": instance.entity.code,
                    "record_id": str(instance.record_id),
                    "record_title": engine.record_title(instance.entity, row, native),
                    "definition": instance.definition.title,
                    "version": instance.version.number,
                    "status": instance.status,
                    "current_step": engine.current_step(instance).get("title", instance.current_step),
                    "error_message": instance.error_message,
                }
            )
        return Response({"results": results})
