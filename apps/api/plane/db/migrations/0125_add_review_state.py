from django.db import migrations


def add_review_state(apps, schema_editor):
    Project = apps.get_model("db", "Project")
    State = apps.get_model("db", "State")

    states = []
    for project in Project.objects.filter(deleted_at__isnull=True).iterator():
        if not State.objects.filter(project_id=project.id, name="Review", deleted_at__isnull=True).exists():
            states.append(
                State(
                    name="Review",
                    color="#8B5CF6",
                    sequence=40000,
                    group="started",
                    project_id=project.id,
                    workspace_id=project.workspace_id,
                )
            )
    State.objects.bulk_create(states, batch_size=500)


class Migration(migrations.Migration):
    dependencies = [("db", "0124_project_target_date")]

    operations = [migrations.RunPython(add_review_state, migrations.RunPython.noop)]
