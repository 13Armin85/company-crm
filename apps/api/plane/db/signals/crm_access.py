from django.db.models.signals import post_save
from django.dispatch import receiver

from plane.db.models import Workspace, WorkspaceMember, OrganizationRole, UserOrganizationRole


@receiver(post_save, sender=Workspace)
def initialize_workspace_access(sender, instance, created, raw=False, **kwargs):
    if created and not raw:
        from plane.app.services.permission_registry import bootstrap_workspace_access

        bootstrap_workspace_access(instance)


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
