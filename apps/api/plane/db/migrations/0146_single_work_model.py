from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("db", "0145_move_standalone_work")]
    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunSQL(
                    "ALTER TABLE workspace_tasks RENAME TO workspace_tasks_archive_20261026",
                    "ALTER TABLE workspace_tasks_archive_20261026 RENAME TO workspace_tasks",
                )
            ],
            state_operations=[
                migrations.DeleteModel(name="WorkspaceTask"),
                migrations.CreateModel(
                    name="WorkspaceTask",
                    fields=[],
                    options={
                        "proxy": True,
                        "ordering": ("-created_at",),
                        "indexes": [],
                        "constraints": [],
                    },
                    bases=("db.issue",),
                ),
            ],
        )
    ]
