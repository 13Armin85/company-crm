from django.db import migrations, models
import django.db.models.deletion
import uuid


def base_fields():
    return [
        (
            "id",
            models.UUIDField(
                default=uuid.uuid4,
                editable=False,
                primary_key=True,
                serialize=False,
                unique=True,
                db_index=True,
            ),
        ),
        (
            "created_at",
            models.DateTimeField(auto_now_add=True, verbose_name="Created At"),
        ),
        (
            "updated_at",
            models.DateTimeField(auto_now=True, verbose_name="Last Modified At"),
        ),
        (
            "deleted_at",
            models.DateTimeField(blank=True, null=True, verbose_name="Deleted At"),
        ),
        (
            "created_by",
            models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="%(class)s_created_by",
                to="db.user",
                verbose_name="Created By",
            ),
        ),
        (
            "updated_by",
            models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="%(class)s_updated_by",
                to="db.user",
                verbose_name="Last Modified By",
            ),
        ),
        (
            "workspace",
            models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE, to="db.workspace"
            ),
        ),
        ("code", models.SlugField(max_length=80)),
    ]


class Migration(migrations.Migration):
    dependencies = [("db", "0137_view_permissions")]
    operations = [
        migrations.CreateModel(
            name="SurfaceConfiguration",
            fields=base_fields()
            + [
                ("definition", models.JSONField(default=dict)),
                ("revision", models.PositiveIntegerField(default=1)),
            ],
            options={"db_table": "crm_surface_configurations"},
        ),
        migrations.CreateModel(
            name="SurfaceValues",
            fields=base_fields()
            + [
                ("object_id", models.UUIDField()),
                ("values", models.JSONField(default=dict)),
            ],
            options={"db_table": "crm_surface_values"},
        ),
        migrations.AddConstraint(
            model_name="surfaceconfiguration",
            constraint=models.UniqueConstraint(
                fields=("workspace", "code"), name="crm_surface_scope_unique"
            ),
        ),
        migrations.AddConstraint(
            model_name="surfacevalues",
            constraint=models.UniqueConstraint(
                fields=("workspace", "code", "object_id"),
                name="crm_surface_values_unique",
            ),
        ),
    ]
