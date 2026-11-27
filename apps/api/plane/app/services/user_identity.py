"""Release login names only after the account has lost all live memberships."""

import uuid

from django.core.exceptions import ValidationError

from plane.db.models import User, Workspace, WorkspaceMember


def can_release_username(user):
    return (
        not user.is_superuser
        and not user.is_staff
        and WorkspaceMember.all_objects.filter(member=user, deleted_at__isnull=False).exists()
        and not WorkspaceMember.objects.filter(member=user, is_active=True, workspace__deleted_at__isnull=True).exists()
        and not Workspace.objects.filter(owner=user).exists()
    )


def release_username(user):
    # Preserve historical foreign keys while releasing unique login identifiers.
    token = uuid.uuid4().hex
    user.username = f"deleted-{token}"
    user.email = f"deleted-{token}@invalid.local"
    user.first_name = ""
    user.last_name = ""
    user.display_name = "کاربر حذف‌شده"
    user.is_active = False
    user.set_unusable_password()
    user.save(update_fields=["username", "email", "first_name", "last_name", "display_name", "is_active", "password"])


def reserve_username(username):
    if not username:
        return
    previous = User.objects.select_for_update().filter(username__iexact=username).first()
    if previous is None:
        return
    if not can_release_username(previous):
        raise ValidationError({"username": "This username is already in use."})
    release_username(previous)
