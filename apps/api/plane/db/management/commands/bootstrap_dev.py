# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import json
import os
import uuid
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from plane.db.models import Profile, User, Workspace, WorkspaceMember
from plane.license.models import Instance, InstanceAdmin, InstanceConfiguration


class Command(BaseCommand):
    help = "Create local development accounts and a shared workspace (explicit opt-in required)."

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.DEBUG or os.environ.get("DEV_BOOTSTRAP") != "1":
            raise CommandError("Development bootstrap requires DEBUG and DEV_BOOTSTRAP=1.")

        admin_email = os.environ.get("DEV_ADMIN_EMAIL", "").strip().lower()
        user_email = os.environ.get("DEV_USER_EMAIL", "").strip().lower()
        admin_password = os.environ.get("DEV_ADMIN_PASSWORD", "")
        user_password = os.environ.get("DEV_USER_PASSWORD", "")
        if not all([admin_email, user_email, admin_password, user_password]) or admin_email == user_email:
            raise CommandError("Provide distinct DEV_ADMIN_EMAIL / DEV_USER_EMAIL and both passwords.")

        instance = Instance.objects.first()
        if instance is None:
            version = json.loads(Path("package.json").read_text())["version"]
            instance = Instance.objects.create(
                instance_name="Plane development",
                instance_id=uuid.uuid4().hex,
                current_version=version,
                latest_version=version,
                last_checked_at=timezone.now(),
                is_telemetry_enabled=False,
                is_support_required=False,
                is_test=True,
            )

        accounts = []
        for email, password, first_name in [
            (admin_email, admin_password, "Admin"),
            (user_email, user_password, "Developer"),
        ]:
            user = User.objects.filter(email=email).first()
            if user is None:
                user = User(
                    email=email,
                    username=uuid.uuid4().hex,
                    first_name=first_name,
                    is_email_verified=True,
                    is_password_autoset=False,
                )
                user.set_password(password)
                user.save()
                self.stdout.write(self.style.SUCCESS(f"Created {email}"))
            else:
                self.stdout.write(f"Kept existing account and password: {email}")
            accounts.append(user)

        admin, member = accounts
        if member.is_staff or member.is_superuser or InstanceAdmin.objects.filter(user=member).exists():
            raise CommandError("DEV_USER_EMAIL belongs to an administrator; choose a regular user email.")
        InstanceAdmin.objects.get_or_create(instance=instance, user=admin, defaults={"role": 20})
        if not instance.is_setup_done:
            instance.is_setup_done = True
            instance.save(update_fields=["is_setup_done", "updated_at"])

        workspace, _ = Workspace.objects.get_or_create(
            slug="dev-workspace", defaults={"name": "Development", "owner": admin}
        )
        for user, role in [(admin, 20), (member, 15)]:
            WorkspaceMember.objects.get_or_create(workspace=workspace, member=user, defaults={"role": role})
            Profile.objects.get_or_create(
                user=user,
                defaults={
                    "is_onboarded": True,
                    "last_workspace_id": workspace.id,
                    "onboarding_step": {
                        "profile_complete": True,
                        "workspace_create": True,
                        "workspace_invite": True,
                        "workspace_join": True,
                    },
                },
            )
        # The development stack models a single internal company. Accounts made
        # through registration or by an administrator all belong to it.
        for company_user in User.objects.filter(is_active=True, is_bot=False):
            WorkspaceMember.objects.get_or_create(
                workspace=workspace,
                member=company_user,
                defaults={"role": 15, "is_active": True},
            )
        InstanceConfiguration.objects.update_or_create(
            key="DISABLE_WORKSPACE_CREATION",
            defaults={
                "value": "1",
                "category": "WORKSPACE_MANAGEMENT",
                "is_encrypted": False,
            },
        )
        self.stdout.write(self.style.SUCCESS("Development workspace and accounts are ready."))
