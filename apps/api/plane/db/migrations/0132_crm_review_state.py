from django.db import migrations
from django.db.models import Q


def add_review_state(apps, schema_editor):
    Project = apps.get_model("db", "Project")
    State = apps.get_model("db", "State")
    alias = schema_editor.connection.alias
    for project in Project.objects.using(alias).filter(deleted_at__isnull=True).iterator():
        states = State.objects.using(alias).filter(project_id=project.id, deleted_at__isnull=True)
        if states.filter(group="started").filter(Q(name__icontains="review") | Q(name__icontains="بازبینی")).exists():
            continue
        name = "Review"
        suffix = 1
        while states.filter(name=name).exists():
            name = "بازبینی" if suffix == 1 else f"بازبینی {suffix}"
            suffix += 1
        states.get_or_create(
            name=name,
            defaults={
                "workspace_id": project.workspace_id,
                "project_id": project.id,
                "group": "started",
                "color": "#8B5CF6",
                "sequence": 40000,
                "slug": "review",
                "default": False,
            },
        )


class Migration(migrations.Migration):
    dependencies = [("db", "0131_crm_delete_permissions")]
    operations = [migrations.RunPython(add_review_state, migrations.RunPython.noop)]
