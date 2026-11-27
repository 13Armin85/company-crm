"""User-confirmed support intervals; all scopes are checked by the service."""

from django.shortcuts import get_object_or_404
from rest_framework.response import Response

from plane.app.services import support_activities as activities
from plane.app.views.base import BaseAPIView
from plane.db.models import Workspace


class SupportActivityBase(BaseAPIView):
    def workspace(self, slug):
        return get_object_or_404(Workspace, slug=slug)


class SupportActivityListEndpoint(SupportActivityBase):
    def get(self, request, slug):
        workspace = self.workspace(slug)
        return Response(activities.list_rows(workspace, request.user, request.query_params, request))

    def post(self, request, slug):
        workspace = self.workspace(slug)
        row = activities.create(workspace, request.user, request.data, request)
        return Response(activities.serialize(row, workspace), status=201)


class SupportActivityDetailEndpoint(SupportActivityBase):
    def put(self, request, slug, activity_id):
        workspace = self.workspace(slug)
        row = activities.update(workspace, request.user, activity_id, request.data, request)
        return Response(activities.serialize(row, workspace))


class SupportActivitySummaryEndpoint(SupportActivityBase):
    def get(self, request, slug):
        workspace = self.workspace(slug)
        return Response(activities.summary(workspace, request.user, request.query_params, request))
