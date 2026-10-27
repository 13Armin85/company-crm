"""One work entity and compatibility names for previous task clients."""

from plane.db.models import EntityType


def canonical_entity(entity):
    if entity.code == "task" and entity.parent_id is None:
        return (
            EntityType.objects.select_related("workspace")
            .filter(
                workspace_id=entity.workspace_id, code="ticket", parent__isnull=True
            )
            .first()
            or entity
        )
    return entity


def work_status(native):
    return (
        str(native.state_id) if native.project_id and native.state_id else native.status
    )


def work_status_expression():
    from django.db.models import Case, When, F, CharField
    from django.db.models.functions import Cast

    return Case(
        When(project__isnull=True, then=F("status")),
        default=Cast(F("state_id"), CharField()),
        output_field=CharField(),
    )
