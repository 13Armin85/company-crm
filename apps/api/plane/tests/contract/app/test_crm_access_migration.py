import importlib

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


@pytest.mark.django_db(transaction=True)
def test_access_migration_preserves_data_and_is_idempotent():
    """Exercise an existing database, not just schema creation with --nomigrations."""
    executor = MigrationExecutor(connection)
    executor.migrate([("db", "0127_enterprise_organization")])
    old_apps = executor.loader.project_state([("db", "0127_enterprise_organization")]).apps
    User = old_apps.get_model("db", "User")
    Workspace = old_apps.get_model("db", "Workspace")
    Member = old_apps.get_model("db", "WorkspaceMember")
    Role = old_apps.get_model("db", "OrganizationRole")
    Assignment = old_apps.get_model("db", "UserOrganizationRole")
    Permission = old_apps.get_model("db", "OrganizationPermission")
    RolePermission = old_apps.get_model("db", "RolePermission")
    admin = User.objects.create(email="migration-admin@example.com", username="migration-admin")
    regular = User.objects.create(email="migration-member@example.com", username="migration-member")
    workspace = Workspace.objects.create(name="Existing company", slug="migration-company", owner=admin)
    Member.objects.create(workspace=workspace, member=admin, role=20, is_active=True)
    Member.objects.create(workspace=workspace, member=regular, role=15, is_active=True)
    custom_name = "\u0645\u062f\u06cc\u0631"
    custom = Role.objects.create(workspace=workspace, name=custom_name, level=73)
    Assignment.objects.create(workspace=workspace, user=regular, role=custom)
    legacy = Permission.objects.create(workspace=workspace, code="ticket-view", name="Legacy view", is_active=True)
    original_grant = RolePermission.objects.create(role=custom, permission=legacy)
    try:
        executor = MigrationExecutor(connection)
        executor.migrate([("db", "0128_crm_access_control")])
        # First-run inserts and column removal must succeed in one migration.
        # Pre-seeding the RunPython step would hide PostgreSQL deferred FK failures.
        executor = MigrationExecutor(connection)
        executor.migrate([("db", "0129_crm_access_data")])
        migrated_apps = executor.loader.project_state([("db", "0129_crm_access_data")]).apps
        assert (
            migrated_apps.get_model("db", "OrganizationRole")
            .objects.filter(workspace_id=workspace.id, system_key="admin")
            .count()
            == 1
        )
        assert (
            migrated_apps.get_model("db", "RolePermission")
            .objects.filter(role_id=custom.id, permission__code="Issue.View")
            .exists()
        )
        executor = MigrationExecutor(connection)
        executor.migrate([("db", "0128_crm_access_control")])
        apps = executor.loader.project_state([("db", "0128_crm_access_control")]).apps
        migration = importlib.import_module("plane.db.migrations.0129_crm_access_data")
        with connection.schema_editor() as schema_editor:
            migration.migrate_access(apps, schema_editor)
            migration.migrate_access(apps, schema_editor)
        assert (
            apps.get_model("db", "OrganizationRole")
            .objects.filter(workspace_id=workspace.id, system_key="admin")
            .count()
            == 1
        )
        assert (
            apps.get_model("db", "UserOrganizationRole")
            .objects.filter(workspace_id=workspace.id, user_id=admin.id, role__system_key="admin")
            .count()
            == 1
        )
        executor = MigrationExecutor(connection)
        executor.migrate([("db", "0129_crm_access_data")])
        apps = executor.loader.project_state([("db", "0129_crm_access_data")]).apps
        assert apps.get_model("db", "User").objects.filter(id=regular.id).exists()
        assert (
            apps.get_model("db", "UserOrganizationRole").objects.filter(user_id=regular.id, role_id=custom.id).exists()
        )
        assert apps.get_model("db", "OrganizationRole").objects.get(id=custom.id).name == custom_name
        assert apps.get_model("db", "RolePermission").objects.filter(pk=original_grant.pk).exists()
        assert (
            apps.get_model("db", "RolePermission")
            .objects.filter(role_id=custom.id, permission__code="Issue.View")
            .count()
            == 1
        )
        assert not apps.get_model("db", "OrganizationPermission").objects.get(pk=legacy.pk).is_active
        log = apps.get_model("db", "APIActivityLog").objects.get(
            token_identifier=f"crm-migration:OrganizationRole:{custom.id}"
        )
        assert '"value": 73' in log.body
        assert "level" not in {field.name for field in apps.get_model("db", "OrganizationRole")._meta.fields}
        Exception = apps.get_model("db", "UserPermissionException")
        permission = apps.get_model("db", "OrganizationPermission").objects.get(
            workspace_id=workspace.id, code="Referral.Delete"
        )
        original = Exception.objects.create(
            workspace_id=workspace.id, user_id=regular.id, permission=permission, effect="ALLOW"
        )
        duplicate = Exception.objects.create(
            workspace_id=workspace.id, user_id=regular.id, permission=permission, effect="ALLOW"
        )
        executor = MigrationExecutor(connection)
        executor.migrate([("db", "0130_crm_exception_constraints")])
        apps = executor.loader.project_state([("db", "0130_crm_exception_constraints")]).apps
        Exception = apps.get_model("db", "UserPermissionException")
        assert Exception.objects.filter(workspace_id=workspace.id).count() == 2
        assert Exception.objects.get(pk=original.pk).is_active
        assert not Exception.objects.get(pk=duplicate.pk).is_active
        executor = MigrationExecutor(connection)
        executor.migrate([("db", "0129_crm_access_data")])
        apps = executor.loader.project_state([("db", "0129_crm_access_data")]).apps
        assert apps.get_model("db", "UserPermissionException").objects.get(pk=duplicate.pk).is_active
        executor = MigrationExecutor(connection)
        executor.migrate([("db", "0128_crm_access_control")])
        apps = executor.loader.project_state([("db", "0128_crm_access_control")]).apps
        assert apps.get_model("db", "OrganizationRole").objects.get(id=custom.id).level == 73
        assert apps.get_model("db", "OrganizationPermission").objects.get(pk=legacy.pk).is_active
        assert apps.get_model("db", "RolePermission").objects.filter(pk=original_grant.pk).exists()
        assert (
            not apps.get_model("db", "RolePermission")
            .objects.filter(role_id=custom.id, permission__code="Issue.View")
            .exists()
        )
    finally:
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())
