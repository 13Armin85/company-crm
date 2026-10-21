"""Run explicitly with --migrations --create-db in the isolated test stack."""

from io import StringIO

import pytest
from django.core.management import call_command
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


@pytest.mark.django_db(transaction=True)
@pytest.mark.contract
def test_entity_migration_and_idempotent_backfill_preserve_native_records():
    executor = MigrationExecutor(connection)
    executor.migrate([("db", "0133_system_identifier_counter")])
    old = executor.loader.project_state([("db", "0133_system_identifier_counter")]).apps
    User = old.get_model("db", "User")
    Workspace = old.get_model("db", "Workspace")
    Project = old.get_model("db", "Project")
    actor = User.objects.create(email="entity-migration@example.com", username="entity-migration")
    workspace = Workspace.objects.create(name="Existing workspace", slug="entity-migration", owner_id=actor.id)
    project = Project.objects.create(
        workspace_id=workspace.id, name="Existing project", identifier="MIG", created_by_id=actor.id
    )
    Role, Permission, RolePermission = (
        old.get_model("db", model) for model in ["OrganizationRole", "OrganizationPermission", "RolePermission"]
    )
    admin = Role.objects.create(workspace_id=workspace.id, name="admin", system_key="admin")
    member = Role.objects.create(workspace_id=workspace.id, name="member", system_key="member")
    custom = Role.objects.create(workspace_id=workspace.id, name="custom")
    existing_permission = Permission.objects.create(workspace_id=workspace.id, code="Issue.View", name="view")
    RolePermission.objects.create(role_id=custom.id, permission_id=existing_permission.id)
    exception = old.get_model("db", "UserPermissionException").objects.create(
        workspace_id=workspace.id, user_id=actor.id, permission_id=existing_permission.id, effect="DENY"
    )
    legacy_view = old.get_model("db", "IssueView").objects.create(
        workspace_id=workspace.id, owned_by_id=actor.id, name="Existing view", query={"legacy": True}
    )
    try:
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())
        from plane.db.models import EntityRecord, EntityType, Project as CurrentProject

        before = (project.id, project.name, project.identifier, project.created_by_id)
        call_command("sync_entity_engine", workspace=workspace.slug, stdout=StringIO())
        attached = EntityRecord.objects.get(
            entity__workspace_id=workspace.id, entity__code="project", source_id=project.id
        )
        assert attached.data == {}
        assert EntityType.objects.filter(workspace_id=workspace.id, parent__isnull=True).count() == 4
        call_command("sync_entity_engine", workspace=workspace.slug, stdout=StringIO())
        assert EntityRecord.objects.filter(entity__workspace_id=workspace.id, source_id=project.id).count() == 1
        current = CurrentProject.objects.get(id=project.id)
        assert (current.id, current.name, current.identifier, current.created_by_id) == before
        from plane.db.models import IssueView, RolePermission as CurrentRolePermission, UserPermissionException

        new_permissions = {
            "View.Create.Personal",
            "View.Create.Shared",
            "View.Manage.All",
            "ConditionalFormat.Edit",
            "Export.Data",
        }
        assert (
            set(
                CurrentRolePermission.objects.filter(
                    role_id=admin.id, permission__code__in=new_permissions
                ).values_list("permission__code", flat=True)
            )
            == new_permissions
        )
        assert list(
            CurrentRolePermission.objects.filter(role_id=member.id, permission__code__in=new_permissions).values_list(
                "permission__code", flat=True
            )
        ) == ["View.Create.Personal"]
        assert set(
            CurrentRolePermission.objects.filter(role_id=custom.id).values_list("permission__code", flat=True)
        ) == {"Issue.View"}
        assert UserPermissionException.objects.get(id=exception.id).effect == "DENY"
        preserved = IssueView.objects.get(id=legacy_view.id)
        assert preserved.engine_entity_id is None
        assert preserved.query == {"legacy": True}
    finally:
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())
