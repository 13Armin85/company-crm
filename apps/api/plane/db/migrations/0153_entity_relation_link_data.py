from django.db import migrations, models


class Migration(migrations.Migration):
    """Additive only: every existing link gets data={} and data_key="", so the new
    (relation, left, right, data_key) constraint admits exactly the rows the old
    (relation, left, right) constraint admitted."""

    dependencies = [("db", "0152_team_work_hours")]

    operations = [
        migrations.AlterField(
            model_name="entityrelation",
            name="on_delete",
            field=models.CharField(default="block", max_length=16),
        ),
        migrations.AddField(
            model_name="entityrelation",
            name="allow_duplicates",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="entityrelation",
            name="hierarchical",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="entityrelation",
            name="link_fields",
            field=models.JSONField(default=list),
        ),
        migrations.AddField(
            model_name="entityrelationlink",
            name="data",
            field=models.JSONField(default=dict),
        ),
        migrations.AddField(
            model_name="entityrelationlink",
            name="data_key",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
        migrations.AddConstraint(
            model_name="entityrelationlink",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True)),
                fields=("relation", "left_id", "right_id", "data_key"),
                name="crm_relation_pair_data_unique",
            ),
        ),
        migrations.RemoveConstraint(
            model_name="entityrelationlink",
            name="crm_relation_pair_unique",
        ),
    ]
