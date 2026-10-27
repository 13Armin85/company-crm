"""Use the agreed TT sequence for future work without renumbering history."""

from django.db import migrations


def forward(apps, schema_editor):
    entity = apps.get_model("db", "EntityType")
    for row in entity.objects.using(schema_editor.connection.alias).filter(
        code="ticket", parent__isnull=True
    ).iterator():
        config = row.numbering or {}
        # Respect an intentional administrator-defined scheme.
        if config.get("prefix") == "TKT" and config.get("padding") == 5:
            row.numbering = {**config, "prefix": "TT", "padding": 0}
            row.save(update_fields=["numbering"])


class Migration(migrations.Migration):
    dependencies = [("db", "0148_detach_work_archive")]
    operations = [migrations.RunPython(forward, migrations.RunPython.noop)]
