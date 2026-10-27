"""Move standalone work into the canonical work table, preserving identifiers."""

from django.db import migrations


def move_work(apps, schema_editor):
    database = schema_editor.connection.alias
    Legacy = apps.get_model("db", "WorkspaceTask")
    Work = apps.get_model("db", "Issue")
    Assignment = apps.get_model("db", "IssueAssignee")
    Sequence = apps.get_model("db", "IssueSequence")
    source = Legacy._base_manager.using(database).all()
    if Work._base_manager.using(database).filter(id__in=source.values("id")).exists():
        raise RuntimeError(
            "Work migration stopped: an identifier exists in both source models. No source data was removed."
        )
    batch = []

    def insert(items):
        if not items:
            return
        Work._base_manager.using(database).bulk_create(
            [
                Work(
                    id=row.id,
                    workspace_id=row.workspace_id,
                    project_id=None,
                    name=row.name,
                    status=row.status,
                    assignee_id=row.assignee_id,
                    priority=row.priority,
                    sequence_id=row.sequence_id,
                    target_date=row.target_date,
                    completed_at=row.completed_at,
                    created_by_id=row.created_by_id,
                    updated_by_id=row.updated_by_id,
                    deleted_at=row.deleted_at,
                )
                for row in items
            ],
            batch_size=500,
        )
        Assignment._base_manager.using(database).bulk_create(
            [
                Assignment(
                    issue_id=row.id,
                    assignee_id=row.assignee_id,
                    workspace_id=row.workspace_id,
                    project_id=None,
                    created_by_id=row.created_by_id,
                    deleted_at=row.deleted_at,
                )
                for row in items
            ],
            batch_size=500,
        )
        Sequence._base_manager.using(database).bulk_create(
            [
                Sequence(
                    issue_id=row.id,
                    workspace_id=row.workspace_id,
                    project_id=None,
                    sequence=row.sequence_id,
                )
                for row in items
            ],
            batch_size=500,
        )

    for row in source.iterator(chunk_size=500):
        batch.append(row)
        if len(batch) == 500:
            insert(batch)
            batch = []
    insert(batch)
    # bulk_create invokes auto_now timestamps: restore the original audit dates.
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "UPDATE issues AS target SET created_at=source.created_at, updated_at=source.updated_at FROM workspace_tasks AS source WHERE target.id=source.id"
        )
        cursor.execute(
            "SELECT COUNT(*) FROM workspace_tasks s LEFT JOIN issues t ON t.id=s.id WHERE t.id IS NULL OR t.workspace_id<>s.workspace_id OR t.name IS DISTINCT FROM s.name OR t.status IS DISTINCT FROM s.status OR t.assignee_id IS DISTINCT FROM s.assignee_id OR t.sequence_id<>s.sequence_id OR t.created_at IS DISTINCT FROM s.created_at OR t.deleted_at IS DISTINCT FROM s.deleted_at"
        )
        if cursor.fetchone()[0]:
            raise RuntimeError(
                "Work migration verification failed; the entire migration was rolled back."
            )


class Migration(migrations.Migration):
    dependencies = [("db", "0144_unified_work_schema")]
    operations = [migrations.RunPython(move_work)]
