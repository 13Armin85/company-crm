"""Keep the original task rows as a read-only recovery snapshot.

Foreign keys on a retired table would block ordinary deletion of users and
workspaces even though the application no longer reads that table.
"""

from django.db import migrations


def detach_archive(apps, schema_editor):
    table = "workspace_tasks_archive_20261026"
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT conname FROM pg_constraint WHERE conrelid = %s::regclass AND contype = 'f'",
            [table],
        )
        for (name,) in cursor.fetchall():
            cursor.execute(
                f"ALTER TABLE {schema_editor.quote_name(table)} "
                f"DROP CONSTRAINT {schema_editor.quote_name(name)}"
            )


class Migration(migrations.Migration):
    dependencies = [("db", "0147_unify_work_definitions")]
    operations = [migrations.RunPython(detach_archive)]
