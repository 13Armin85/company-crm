# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from plane.db.models import (
    Issue,
    OrganizationPermission,
    OrganizationRole,
    OrganizationUnit,
    Profile,
    Project,
    TicketRoleQueueEntry,
    TicketRoutingRule,
    User,
    Workspace,
    WorkspaceMember,
    WorkspaceTask,
)
from plane.license.models import Instance, InstanceAdmin


pytestmark = [pytest.mark.unit, pytest.mark.django_db]


@pytest.fixture
def dev_environment(monkeypatch, settings):
    settings.DEBUG = True
    for key, value in {
        "DEV_BOOTSTRAP": "1",
        "DEV_ADMIN_EMAIL": "admin@plane.local",
        "DEV_ADMIN_PASSWORD": "AdminDev!2026",
        "DEV_USER_EMAIL": "user@plane.local",
        "DEV_USER_PASSWORD": "UserDev!2026",
    }.items():
        monkeypatch.setenv(key, value)


def test_creates_separate_roles_and_passwords(dev_environment):
    call_command("bootstrap_dev")
    admin = User.objects.get(email="admin@plane.local")
    member = User.objects.get(email="user@plane.local")
    assert admin.check_password("AdminDev!2026")
    assert member.check_password("UserDev!2026")
    assert Instance.objects.get().is_setup_done
    assert InstanceAdmin.objects.filter(user=admin, role=20).exists()
    assert not InstanceAdmin.objects.filter(user=member).exists()
    assert not member.is_staff and not member.is_superuser
    assert WorkspaceMember.objects.get(member=admin).role == 20
    assert WorkspaceMember.objects.get(member=member).role == 15
    assert Profile.objects.get(user=member).is_onboarded


def test_rerun_preserves_passwords_and_does_not_duplicate_data(dev_environment):
    call_command("bootstrap_dev")
    member = User.objects.get(email="user@plane.local")
    member.set_password("ChangedByDeveloper!2026")
    member.save()
    call_command("bootstrap_dev")
    member.refresh_from_db()
    assert member.check_password("ChangedByDeveloper!2026")
    assert User.objects.count() == 2
    assert Workspace.objects.count() == 1
    assert WorkspaceMember.objects.count() == 2
    assert InstanceAdmin.objects.count() == 1


def test_enterprise_seed_is_additive_idempotent_and_preserves_existing_data(dev_environment):
    call_command("bootstrap_dev")
    call_command("seed_enterprise_demo")
    project = Project.objects.get(identifier="SALE")
    project.description = "Edited by a developer and must be preserved"
    project.save(update_fields=["description", "updated_at"])
    counts = tuple(
        model.objects.count()
        for model in (
            User,
            Project,
            Issue,
            WorkspaceTask,
            OrganizationPermission,
            OrganizationRole,
            OrganizationUnit,
            TicketRoutingRule,
            TicketRoleQueueEntry,
        )
    )

    call_command("seed_enterprise_demo")

    project.refresh_from_db()
    assert project.description == "Edited by a developer and must be preserved"
    assert counts == tuple(
        model.objects.count()
        for model in (
            User,
            Project,
            Issue,
            WorkspaceTask,
            OrganizationPermission,
            OrganizationRole,
            OrganizationUnit,
            TicketRoutingRule,
            TicketRoleQueueEntry,
        )
    )
    assert TicketRoleQueueEntry.objects.filter(status="open").exists()


@pytest.mark.parametrize("debug,opt_in", [(False, "1"), (True, "0")])
def test_refuses_without_development_opt_in(dev_environment, settings, monkeypatch, debug, opt_in):
    settings.DEBUG = debug
    monkeypatch.setenv("DEV_BOOTSTRAP", opt_in)
    with pytest.raises(CommandError, match="requires DEBUG"):
        call_command("bootstrap_dev")
    assert not User.objects.exists()


def test_refuses_same_email(dev_environment, monkeypatch):
    monkeypatch.setenv("DEV_USER_EMAIL", "ADMIN@plane.local")
    with pytest.raises(CommandError, match="distinct"):
        call_command("bootstrap_dev")
    assert not Instance.objects.exists()


def test_refuses_admin_as_regular_user_and_rolls_back(dev_environment):
    User.objects.create(email="user@plane.local", username="existing-admin", is_superuser=True)
    with pytest.raises(CommandError, match="belongs to an administrator"):
        call_command("bootstrap_dev")
    assert User.objects.count() == 1
    assert not Instance.objects.exists()
