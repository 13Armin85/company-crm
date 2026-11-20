from django.db import transaction
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from plane.app.services.access_control import has_permission
from plane.app.services.navigation import DESIGN_PERMISSIONS, navigation_payload
from plane.app.services.surface_config import member_workspace
from plane.app.views.workspace.entity import EngineAPIView
from plane.db.models import SurfaceConfiguration, Workspace


class NavigationEndpoint(EngineAPIView):
    def get(self, request, slug):
        workspace = member_workspace(request, slug)
        response = Response(navigation_payload(request, workspace))
        response["Cache-Control"] = "private, no-store"
        return response

    @transaction.atomic
    def patch(self, request, slug):
        workspace = member_workspace(request, slug)
        if not any(
            has_permission(request.user, workspace, code, request=request)
            for code in DESIGN_PERMISSIONS
        ):
            raise PermissionDenied("مجوز مشاهدهٔ تنظیمات طراحی را ندارید.")
        if not isinstance(request.data, dict) or set(request.data) != {
            "design_sidebar"
        }:
            raise ValidationError("فقط انتخاب صفحه‌های سایدبار طراحی قابل تغییر است.")
        codes = request.data["design_sidebar"]
        allowed = {
            page["code"]
            for page in navigation_payload(request, workspace)["design_pages"]
        }
        if codes is not None and (
            not isinstance(codes, list)
            or len(codes) > 1000
            or any(not isinstance(code, str) or code not in allowed for code in codes)
        ):
            raise ValidationError("فهرست صفحه‌های طراحی معتبر نیست.")
        Workspace.objects.select_for_update().get(pk=workspace.pk)
        SurfaceConfiguration.objects.update_or_create(
            workspace=workspace,
            code=f"navigation-user-{request.user.id}",
            defaults={
                "definition": {
                    "design_sidebar": (
                        list(dict.fromkeys(codes)) if codes is not None else None
                    )
                }
            },
        )
        response = Response(navigation_payload(request, workspace))
        response["Cache-Control"] = "private, no-store"
        return response
