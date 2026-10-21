"""Bridge entity subtypes to Plane IssueType without duplicating native ticket types.

New native types use Plane's external_source/external_id pair as a stable adapter
key. Existing integrated types retain their original external identifiers and
receive a stable metadata code derived from their native id during bootstrap.
Portable imports keep that code and resolve/create the destination IssueType.
"""

from django.db import transaction, ProgrammingError

from plane.db.models import EntityType, IssueType, FormLayout, FormVersion, Workspace

SOURCE = "crm-entity-engine"


def native_type_for_subtype(subtype, create=True):
    if not subtype or not subtype.parent_id or subtype.parent.adapter != "ticket":
        return None
    native = IssueType.objects.filter(
        workspace=subtype.workspace, external_source=SOURCE, external_id=subtype.code
    ).first()
    if not native and subtype.code.startswith("issue-type-"):
        from uuid import UUID

        try:
            identifier = UUID(subtype.code.removeprefix("issue-type-"))
        except ValueError:
            identifier = None
        if identifier:
            native = IssueType.objects.filter(workspace=subtype.workspace, id=identifier).first()
    if not native and create:
        native = IssueType.objects.create(
            workspace=subtype.workspace,
            name=subtype.title,
            description=subtype.description,
            is_active=subtype.is_active,
            external_source=SOURCE,
            external_id=subtype.code,
        )
    return native


@transaction.atomic
def sync_native_subtype(native):
    try:
        with transaction.atomic():
            root = EntityType.objects.filter(workspace=native.workspace, adapter="ticket", parent__isnull=True).first()
    except ProgrammingError as exc:
        if getattr(exc.__cause__, "sqlstate", None) == "42P01":
            return None
        raise
    if not root:
        return None
    Workspace.objects.select_for_update().get(id=native.workspace_id)
    code = native.external_id if native.external_source == SOURCE else f"issue-type-{native.id}"
    subtype, created = EntityType.objects.get_or_create(
        workspace=native.workspace,
        code=code,
        defaults={
            "parent": root,
            "title": native.name,
            "description": native.description,
            "is_active": native.is_active and native.deleted_at is None,
            "title_field": root.title_field,
            "record_permissions": root.record_permissions,
        },
    )
    if not created:
        EntityType.objects.filter(id=subtype.id).update(
            title=native.name, description=native.description, is_active=native.is_active and native.deleted_at is None
        )
    layout = {"tabs": [], "sections": []}
    form, new_form = FormLayout.objects.get_or_create(entity=subtype, defaults={"draft": layout})
    if new_form:
        form.published = FormVersion.objects.create(
            layout=form, number=1, schema=layout, change_note="اتصال نوع تیکت موجود"
        )
        form.save(update_fields=["published", "updated_at"])
    return subtype
