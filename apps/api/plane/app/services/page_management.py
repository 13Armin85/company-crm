"""Server-owned page actions and dependency checks, shared by catalog and deletion."""

from functools import cache

from django.db.models import Exists, OuterRef, PROTECT
from django.db.models.functions import JSONArray, JSONObject
from rest_framework.exceptions import ValidationError

from plane.db.models import DashboardConfiguration, EntityType, FormLayout

DEPENDENCY_LABELS = {
    "entityrecord": "این صفحه رکورد فعلی یا تاریخی دارد.",
    "entitytype": "صفحه دارای نوع فرعی است.",
    "fielddefinition": "فیلد ارتباطی صفحهٔ دیگری به این صفحه متصل است.",
    "entityrelation": "این صفحه در تعریف یک ارتباط استفاده شده است.",
    "workflowdefinition": "برای این صفحه گردش‌کار تعریف شده است.",
    "workflowinstance": "گردش‌کار ثبت‌شده به این صفحه وابسته است.",
    "view": "نمای ذخیره‌شده به این صفحه وابسته است.",
    "issueview": "نمای ذخیره‌شده به این صفحه وابسته است.",
    "entityviewexport": "خروجی ثبت‌شده به این صفحه وابسته است.",
}


@cache
def dependency_relations():
    # Include soft-deleted references: their foreign keys still protect history.
    return [
        relation
        for relation in EntityType._meta.related_objects
        if relation.on_delete is PROTECT and relation.related_model is not FormLayout
    ]


def with_page_dependencies(queryset):
    return queryset.annotate(
        page_dashboard_dependency=Exists(
            DashboardConfiguration._base_manager.filter(
                workspace_id=OuterRef("workspace_id"),
                tabs__contains=JSONArray(
                    JSONObject(widgets=JSONArray(JSONObject(config=JSONObject(entity=OuterRef("code")))))
                ),
            )
        ),
        **{
            f"page_dependency_{index}": Exists(
                relation.related_model._base_manager.filter(**{relation.field.attname: OuterRef("pk")})
            )
            for index, relation in enumerate(dependency_relations())
        },
    )


def delete_blockers(entity):
    if entity.adapter:
        return ["صفحه‌های اصلی سامانه قابل حذف نیستند."]
    blockers = list(
        dict.fromkeys(
            DEPENDENCY_LABELS.get(
                relation.related_model._meta.model_name,
                "اطلاعات وابسته به این صفحه وجود دارد.",
            )
            for index, relation in enumerate(dependency_relations())
            if getattr(entity, f"page_dependency_{index}")
        )
    )
    if entity.page_dashboard_dependency:
        blockers.append("ابزارک داشبورد به این صفحه وابسته است.")
    return blockers


def page_management(entity, can_delete, can_edit):
    allowed = not entity.adapter and (can_delete or can_edit)
    blockers = delete_blockers(entity) if allowed else []
    return {
        "can_manage": allowed,
        "can_delete": allowed and can_delete and not blockers,
        "can_archive": allowed and can_edit and entity.is_active,
        "can_restore": allowed and can_edit and not entity.is_active,
        "delete_blockers": blockers,
    }


def assert_page_deletable(entity):
    checked = with_page_dependencies(EntityType.objects.filter(pk=entity.pk)).get()
    blockers = delete_blockers(checked)
    if blockers:
        raise ValidationError(
            {"detail": "این صفحه فعلاً قابل حذف نیست؛ می‌توانید آن را غیرفعال کنید.", "blockers": blockers}
        )
