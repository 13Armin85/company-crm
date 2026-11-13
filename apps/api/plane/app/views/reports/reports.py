"""Reports API (ticket 8): base reports, builder, saved reports and exports.

Every run recomputes permission and scope (``report_sources.run`` → ``report_scope``).
"""

from django.http import FileResponse
from django.shortcuts import get_object_or_404
from rest_framework.response import Response

from plane.app.services import report_export as exports
from plane.app.services import report_sources as sources
from plane.app.services import saved_reports as saved
from plane.app.services.access_control import has_permission
from plane.app.views.workspace.entity import EngineAPIView
from plane.db.models import EntityViewExport


def _page(request):
    data = request.data if request.method == "POST" else request.query_params
    try:
        return max(1, int(data.get("page", 1))), min(200, max(1, int(data.get("page_size", 50))))
    except (TypeError, ValueError, AttributeError):
        return 1, 50


class ReportSourcesEndpoint(EngineAPIView):
    def get(self, request, slug):
        workspace = self.workspace(slug)
        sources.require_view(request.user, workspace, request)

        def can(code):
            return has_permission(request.user, workspace, code, request=request)

        return Response(
            {
                "sources": sources.catalog(request.user, workspace, request),
                "can": {
                    "build": can("Report.Build"),
                    "share": can("Report.Share"),
                    "export": can("Report.Export"),
                    "team": can("Report.Team.View") or can("Report.ViewAll"),
                },
                "aggregates": [{"code": k, "title": v} for k, v in sources.AGG_TITLES.items()],
            }
        )


class ReportRunEndpoint(EngineAPIView):
    def post(self, request, slug):
        workspace = self.workspace(slug)
        page, size = _page(request)
        result = sources.run(
            workspace,
            request.user,
            request.data.get("source"),
            request.data.get("definition"),
            page=page,
            page_size=size,
            request=request,
        )
        return Response(result)


class SavedReportsEndpoint(EngineAPIView):
    def get(self, request, slug):
        workspace = self.workspace(slug)
        sources.require_view(request.user, workspace, request)
        rows = saved.visible(workspace, request.user)
        return Response({"results": [saved.payload(row, request.user, request) for row in rows]})

    def post(self, request, slug):
        workspace = self.workspace(slug)
        sources.require_view(request.user, workspace, request)
        row = saved.create(workspace, request.user, request.data, request)
        return Response(saved.payload(row, request.user, request), status=201)


class SavedReportDetailEndpoint(EngineAPIView):
    def get(self, request, slug, report_id):
        workspace = self.workspace(slug)
        sources.require_view(request.user, workspace, request)
        return Response(saved.payload(saved.get(workspace, request.user, report_id), request.user, request))

    def patch(self, request, slug, report_id):
        workspace = self.workspace(slug)
        row = saved.update(workspace, request.user, report_id, request.data, request)
        return Response(saved.payload(row, request.user, request))

    def delete(self, request, slug, report_id):
        workspace = self.workspace(slug)
        saved.delete(workspace, request.user, report_id, request)
        return Response(status=204)


class SavedReportRunEndpoint(EngineAPIView):
    def post(self, request, slug, report_id):
        workspace = self.workspace(slug)
        page, size = _page(request)
        result = saved.run_saved(
            workspace,
            request.user,
            report_id,
            overrides=request.data.get("overrides") or {},
            page=page,
            page_size=size,
            request=request,
        )
        return Response(result)


class SavedReportCopyEndpoint(EngineAPIView):
    def post(self, request, slug, report_id):
        workspace = self.workspace(slug)
        sources.require_view(request.user, workspace, request)
        row = saved.copy(workspace, request.user, report_id, request)
        return Response(saved.payload(row, request.user, request), status=201)


class ReportShareOptionsEndpoint(EngineAPIView):
    def get(self, request, slug):
        workspace = self.workspace(slug)
        self.require(request, workspace, "Report.Share")
        return Response(saved.share_options(workspace))


class ReportExportsEndpoint(EngineAPIView):
    def post(self, request, slug):
        workspace = self.workspace(slug)
        job = exports.request_export(workspace, request.user, request.data, request)
        return Response(exports.job_payload(job), status=202)

    def get(self, request, slug):
        workspace = self.workspace(slug)
        rows = (
            EntityViewExport.objects.filter(workspace=workspace, user=request.user, entity__isnull=True)
            .exclude(report_source="")
            .order_by("-created_at")[:20]
        )
        return Response({"results": [exports.job_payload(row) for row in rows]})


class ReportExportDetailEndpoint(EngineAPIView):
    def get(self, request, slug, export_id, download=False):
        workspace = self.workspace(slug)
        # Only the requester's own report jobs exist for them; anyone else gets 404.
        job = get_object_or_404(
            EntityViewExport.objects.select_related("asset", "workspace", "user").exclude(report_source=""),
            workspace=workspace,
            user=request.user,
            id=export_id,
            entity__isnull=True,
        )
        if not download:
            return Response(exports.job_payload(job))
        exports.verify_report_export(job, request)
        return FileResponse(
            job.asset.asset.open("rb"),
            as_attachment=True,
            filename=f"report-{job.report_source}.{job.format}",
            content_type=exports.FORMATS[job.format],
        )
