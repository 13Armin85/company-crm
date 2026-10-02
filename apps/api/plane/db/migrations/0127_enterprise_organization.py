# Generated for the enterprise organization and ticket-routing domain.

import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def base_fields():
    return [
        ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
        ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
        ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
        (
            "id",
            models.UUIDField(
                db_index=True,
                default=uuid.uuid4,
                editable=False,
                primary_key=True,
                serialize=False,
                unique=True,
            ),
        ),
        (
            "created_by",
            models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="%(class)s_created_by",
                to=settings.AUTH_USER_MODEL,
                verbose_name="Created By",
            ),
        ),
        (
            "updated_by",
            models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="%(class)s_updated_by",
                to=settings.AUTH_USER_MODEL,
                verbose_name="Last Modified By",
            ),
        ),
    ]


class Migration(migrations.Migration):
    dependencies = [("db", "0126_workspace_task")]

    operations = [
        migrations.CreateModel(
            name="OrganizationPermission",
            fields=base_fields()
            + [
                ("code", models.SlugField(max_length=100)),
                ("name", models.CharField(max_length=150)),
                ("description", models.TextField(blank=True)),
                ("is_active", models.BooleanField(default=True)),
                (
                    "workspace",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="organization_permissions",
                        to="db.workspace",
                    ),
                ),
            ],
            options={"db_table": "organization_permissions", "ordering": ("code",)},
        ),
        migrations.CreateModel(
            name="OrganizationRole",
            fields=base_fields()
            + [
                ("name", models.CharField(max_length=150)),
                ("level", models.PositiveIntegerField(default=0)),
                ("is_active", models.BooleanField(default=True)),
                (
                    "workspace",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="organization_roles",
                        to="db.workspace",
                    ),
                ),
            ],
            options={"db_table": "organization_roles", "ordering": ("-level", "name")},
        ),
        migrations.CreateModel(
            name="OrganizationUnit",
            fields=base_fields()
            + [
                ("title", models.CharField(max_length=200)),
                ("is_active", models.BooleanField(default=True)),
                (
                    "manager",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="managed_organization_units",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "parent",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="children",
                        to="db.organizationunit",
                    ),
                ),
                (
                    "workspace",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="organization_units",
                        to="db.workspace",
                    ),
                ),
            ],
            options={"db_table": "organization_units", "ordering": ("title",)},
        ),
        migrations.CreateModel(
            name="RolePermission",
            fields=base_fields()
            + [
                (
                    "permission",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="permission_roles",
                        to="db.organizationpermission",
                    ),
                ),
                (
                    "role",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="role_permissions",
                        to="db.organizationrole",
                    ),
                ),
            ],
            options={"db_table": "organization_role_permissions"},
        ),
        migrations.CreateModel(
            name="UserOrganizationRole",
            fields=base_fields()
            + [
                ("is_active", models.BooleanField(default=True)),
                (
                    "role",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="user_roles",
                        to="db.organizationrole",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="organization_roles",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "workspace",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="user_organization_roles",
                        to="db.workspace",
                    ),
                ),
            ],
            options={"db_table": "user_organization_roles"},
        ),
        migrations.CreateModel(
            name="OrganizationUnitMember",
            fields=base_fields()
            + [
                ("is_active", models.BooleanField(default=True)),
                (
                    "unit",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="memberships",
                        to="db.organizationunit",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="organization_units",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"db_table": "organization_unit_members"},
        ),
        migrations.CreateModel(
            name="TicketRoutingRule",
            fields=base_fields()
            + [
                ("name", models.CharField(max_length=150)),
                ("required_level", models.PositiveIntegerField(default=0)),
                ("is_active", models.BooleanField(default=True)),
                (
                    "required_role",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="routing_rules",
                        to="db.organizationrole",
                    ),
                ),
                (
                    "unit",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="routing_rules",
                        to="db.organizationunit",
                    ),
                ),
                (
                    "workspace",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="ticket_routing_rules",
                        to="db.workspace",
                    ),
                ),
            ],
            options={"db_table": "ticket_routing_rules", "ordering": ("name",)},
        ),
        migrations.CreateModel(
            name="TicketRoutingDecision",
            fields=base_fields()
            + [
                (
                    "outcome",
                    models.CharField(choices=[("assigned", "Assigned"), ("queued", "Role queue")], max_length=20),
                ),
                (
                    "assigned_user",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="ticket_routing_decisions",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "issue",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="routing_decisions",
                        to="db.issue",
                    ),
                ),
                (
                    "resolved_unit",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="routing_decisions",
                        to="db.organizationunit",
                    ),
                ),
                (
                    "rule",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="decisions",
                        to="db.ticketroutingrule",
                    ),
                ),
            ],
            options={"db_table": "ticket_routing_decisions", "ordering": ("-created_at",)},
        ),
        migrations.CreateModel(
            name="TicketRoleQueueEntry",
            fields=base_fields()
            + [
                ("required_level", models.PositiveIntegerField(default=0)),
                (
                    "status",
                    models.CharField(
                        choices=[("open", "Open"), ("claimed", "Claimed"), ("closed", "Closed")],
                        default="open",
                        max_length=20,
                    ),
                ),
                (
                    "claimed_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="claimed_ticket_queue_entries",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "issue",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="role_queue_entries",
                        to="db.issue",
                    ),
                ),
                (
                    "required_role",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="queue_entries",
                        to="db.organizationrole",
                    ),
                ),
                (
                    "rule",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="queue_entries",
                        to="db.ticketroutingrule",
                    ),
                ),
            ],
            options={"db_table": "ticket_role_queue_entries", "ordering": ("-created_at",)},
        ),
        migrations.AddField(
            model_name="organizationrole",
            name="permissions",
            field=models.ManyToManyField(
                blank=True,
                related_name="roles",
                through="db.RolePermission",
                to="db.organizationpermission",
            ),
        ),
        migrations.AddConstraint(
            model_name="organizationpermission",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True)),
                fields=("workspace", "code"),
                name="org_permission_unique_active_code",
            ),
        ),
        migrations.AddConstraint(
            model_name="organizationrole",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True)),
                fields=("workspace", "name"),
                name="org_role_unique_active_name",
            ),
        ),
        migrations.AddConstraint(
            model_name="organizationunit",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True)),
                fields=("workspace", "parent", "title"),
                name="org_unit_unique_active_sibling",
            ),
        ),
        migrations.AddConstraint(
            model_name="rolepermission",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True)),
                fields=("role", "permission"),
                name="org_role_permission_unique_active",
            ),
        ),
        migrations.AddConstraint(
            model_name="userorganizationrole",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True)),
                fields=("workspace", "user", "role"),
                name="user_org_role_unique_active",
            ),
        ),
        migrations.AddConstraint(
            model_name="organizationunitmember",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True)),
                fields=("unit", "user"),
                name="org_unit_member_unique_active",
            ),
        ),
        migrations.AddConstraint(
            model_name="ticketrolequeueentry",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True), ("status", "open")),
                fields=("issue", "rule"),
                name="ticket_queue_unique_open_issue_rule",
            ),
        ),
    ]
