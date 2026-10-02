# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import os
import uuid

from django.db import transaction

from plane.bgtasks.workspace_seed_task import workspace_seed
from plane.db.models import Workspace, WorkspaceMember

from .workspace_project_join import process_workspace_project_invitations


def post_user_auth_workflow(user, is_signup, request):
    process_workspace_project_invitations(user=user)
    if not is_signup:
        return

    configured_slug = os.environ.get("INTERNAL_WORKSPACE_SLUG", "").strip()
    company_workspace = (
        Workspace.objects.filter(slug=configured_slug).first()
        if configured_slug
        else Workspace.objects.order_by("created_at").first()
    )
    if company_workspace is not None:
        membership, created = WorkspaceMember.objects.get_or_create(
            workspace=company_workspace,
            member=user,
            defaults={"role": 15},
        )
        if not created and not membership.is_active:
            membership.is_active = True
            membership.role = 15
            membership.save(update_fields=["is_active", "role", "updated_at"])
        return


    if WorkspaceMember.objects.filter(member=user, is_active=True).exists():
        return

    # A completely empty installation still needs a first administrator. Every
    # subsequent public registration joins that workspace as a normal member.
    with transaction.atomic():
        workspace = Workspace.objects.create(
            name="فضای کاری من",
            slug=f"workspace-{uuid.uuid4().hex[:12]}",
            owner=user,
        )
        WorkspaceMember.objects.create(
            workspace=workspace,
            member=user,
            role=20,
            is_active=True,
        )
    workspace_seed.delay(str(workspace.id))
