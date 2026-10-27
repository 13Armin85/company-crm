from django.db.models.signals import post_save
from django.dispatch import receiver

from plane.db.models import Workspace, WorkspaceMember, OrganizationRole, UserOrganizationRole, IssueType, EntityType, OrganizationUnit, Issue, WorkspaceTask


@receiver(post_save, sender=Workspace)
def initialize_workspace_access(sender, instance, created, raw=False, **kwargs):
    if created and not raw:
        from plane.app.services.permission_registry import bootstrap_workspace_access

        bootstrap_workspace_access(instance)
        from plane.app.services.entity_schema import initialize_engine

        initialize_engine(instance)


@receiver(post_save, sender=WorkspaceMember)
def initialize_member_access(sender, instance, created, raw=False, **kwargs):
    if raw or not instance.is_active:
        return
    if not UserOrganizationRole.objects.filter(workspace_id=instance.workspace_id, user_id=instance.member_id).exists():
        role = OrganizationRole.objects.filter(
            workspace_id=instance.workspace_id, system_key="admin" if instance.role == 20 else "member", is_active=True
        ).first()
        if role:
            UserOrganizationRole.objects.get_or_create(
                workspace_id=instance.workspace_id, user_id=instance.member_id, role=role
            )
    if created:
        entity = EntityType.objects.filter(workspace_id=instance.workspace_id, adapter="user", parent__isnull=True).first()
        if entity:
            from plane.app.services.entity_directory import ensure_directory_record

            ensure_directory_record(entity, instance.member)


@receiver(post_save, sender=OrganizationUnit)
def initialize_unit_record(sender, instance, created, raw=False, **kwargs):
    if created and not raw:
        entity = EntityType.objects.filter(workspace_id=instance.workspace_id, adapter="unit", parent__isnull=True).first()
        if entity:
            from plane.app.services.entity_directory import ensure_directory_record

            ensure_directory_record(entity, instance)


@receiver(post_save, sender=IssueType)
def synchronize_ticket_subtype(sender, instance, raw=False, **kwargs):
    if not raw:
        from plane.app.services.entity_issue_types import sync_native_subtype

        sync_native_subtype(instance)


@receiver(post_save, sender=Issue)
@receiver(post_save, sender=WorkspaceTask)
def ensure_work_record(sender, instance, created, raw=False, **kwargs):
    if not created or raw:
        return
    entity = EntityType.objects.filter(
        workspace_id=instance.workspace_id, code="ticket", parent__isnull=True
    ).first()
    if not entity:
        return
    subtype = None
    if instance.type_id:
        native_type = IssueType.objects.filter(id=instance.type_id).first()
        if native_type:
            code = (
                native_type.external_id
                if native_type.external_source == "crm-entity-engine"
                else f"issue-type-{native_type.id}"
            )
            subtype = EntityType.objects.filter(workspace_id=instance.workspace_id, parent=entity, code=code).first()
    from plane.app.services.entity_directory import ensure_directory_record

    ensure_directory_record(entity, instance, subtype)
