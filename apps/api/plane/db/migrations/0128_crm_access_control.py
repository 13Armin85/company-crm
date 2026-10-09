import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0127_enterprise_organization"),
    ]

    operations = [
        migrations.CreateModel(
            name="OrganizationUnitDelegate",
            fields=[
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
                ("priority", models.PositiveIntegerField(default=1)),
                ("is_active", models.BooleanField(default=True)),
            ],
            options={
                "db_table": "organization_unit_delegates",
                "ordering": ("priority", "created_at"),
            },
        ),
        migrations.CreateModel(
            name="UserAbsence",
            fields=[
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
                ("starts_at", models.DateTimeField()),
                ("ends_at", models.DateTimeField()),
                ("reason", models.TextField(blank=True)),
                (
                    "status",
                    models.CharField(
                        choices=[("scheduled", "Scheduled"), ("cancelled", "Cancelled"), ("ended", "Ended")],
                        default="scheduled",
                        max_length=12,
                    ),
                ),
            ],
            options={
                "db_table": "user_absences",
                "ordering": ("-starts_at",),
            },
        ),
        migrations.CreateModel(
            name="UserPermissionException",
            fields=[
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
                ("effect", models.CharField(choices=[("ALLOW", "Allow"), ("DENY", "Deny")], max_length=5)),
                ("starts_at", models.DateTimeField(blank=True, null=True)),
                ("ends_at", models.DateTimeField(blank=True, null=True)),
                ("is_active", models.BooleanField(default=True)),
            ],
            options={
                "db_table": "user_permission_exceptions",
            },
        ),
        migrations.AlterModelOptions(
            name="organizationrole",
            options={"ordering": ("name",)},
        ),
        migrations.AddField(
            model_name="organizationpermission",
            name="category",
            field=models.CharField(blank=True, max_length=80),
        ),
        migrations.AddField(
            model_name="organizationpermission",
            name="is_delegatable",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="organizationrole",
            name="description",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="organizationrole",
            name="system_key",
            field=models.CharField(blank=True, max_length=32, null=True),
        ),
        migrations.AlterField(
            model_name="organizationpermission",
            name="code",
            field=models.CharField(max_length=100),
        ),
        migrations.AddConstraint(
            model_name="organizationrole",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True), ("system_key__isnull", False)),
                fields=("workspace", "system_key"),
                name="org_role_unique_system_key",
            ),
        ),
        migrations.AddField(
            model_name="organizationunitdelegate",
            name="created_by",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="%(class)s_created_by",
                to=settings.AUTH_USER_MODEL,
                verbose_name="Created By",
            ),
        ),
        migrations.AddField(
            model_name="organizationunitdelegate",
            name="unit",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE, related_name="delegates", to="db.organizationunit"
            ),
        ),
        migrations.AddField(
            model_name="organizationunitdelegate",
            name="updated_by",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="%(class)s_updated_by",
                to=settings.AUTH_USER_MODEL,
                verbose_name="Last Modified By",
            ),
        ),
        migrations.AddField(
            model_name="organizationunitdelegate",
            name="user",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="unit_delegations",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="userabsence",
            name="created_by",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="%(class)s_created_by",
                to=settings.AUTH_USER_MODEL,
                verbose_name="Created By",
            ),
        ),
        migrations.AddField(
            model_name="userabsence",
            name="updated_by",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="%(class)s_updated_by",
                to=settings.AUTH_USER_MODEL,
                verbose_name="Last Modified By",
            ),
        ),
        migrations.AddField(
            model_name="userabsence",
            name="user",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE, related_name="absences", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="userabsence",
            name="workspace",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE, related_name="user_absences", to="db.workspace"
            ),
        ),
        migrations.AddField(
            model_name="userpermissionexception",
            name="created_by",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="%(class)s_created_by",
                to=settings.AUTH_USER_MODEL,
                verbose_name="Created By",
            ),
        ),
        migrations.AddField(
            model_name="userpermissionexception",
            name="permission",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="user_exceptions",
                to="db.organizationpermission",
            ),
        ),
        migrations.AddField(
            model_name="userpermissionexception",
            name="updated_by",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="%(class)s_updated_by",
                to=settings.AUTH_USER_MODEL,
                verbose_name="Last Modified By",
            ),
        ),
        migrations.AddField(
            model_name="userpermissionexception",
            name="user",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="permission_exceptions",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="userpermissionexception",
            name="workspace",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE, related_name="permission_exceptions", to="db.workspace"
            ),
        ),
        migrations.AddConstraint(
            model_name="organizationunitdelegate",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True), ("is_active", True)),
                fields=("unit", "user"),
                name="org_delegate_unique_user",
            ),
        ),
        migrations.AddConstraint(
            model_name="organizationunitdelegate",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True), ("is_active", True)),
                fields=("unit", "priority"),
                name="org_delegate_unique_priority",
            ),
        ),
        migrations.AddConstraint(
            model_name="organizationunitdelegate",
            constraint=models.CheckConstraint(
                condition=models.Q(("priority__gte", 1)), name="org_delegate_positive_priority"
            ),
        ),
        migrations.AddIndex(
            model_name="userabsence",
            index=models.Index(fields=["workspace", "user", "status"], name="org_absence_user_idx"),
        ),
        migrations.AddConstraint(
            model_name="userabsence",
            constraint=models.CheckConstraint(
                condition=models.Q(("ends_at__gt", models.F("starts_at"))), name="org_absence_valid_period"
            ),
        ),
        migrations.AddIndex(
            model_name="userpermissionexception",
            index=models.Index(fields=["workspace", "user", "is_active"], name="org_exception_user_idx"),
        ),
        migrations.AddConstraint(
            model_name="userpermissionexception",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("starts_at__isnull", True),
                    ("ends_at__isnull", True),
                    ("ends_at__gt", models.F("starts_at")),
                    _connector="OR",
                ),
                name="org_exception_valid_period",
            ),
        ),
    ]
