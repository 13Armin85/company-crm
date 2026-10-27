"""Use the owner-approved 08:00–16:00 workday for team alerts."""

from datetime import time

from django.db import migrations, models


def forward(apps, schema_editor):
    row = apps.get_model("db", "DashboardTeamSettings")
    row.objects.using(schema_editor.connection.alias).filter(
        workday_start=time(9), workday_end=time(17)
    ).update(workday_start=time(8), workday_end=time(16))


class Migration(migrations.Migration):
    dependencies = [("db", "0151_dashboard_permissions")]
    operations = [
        migrations.AlterField(model_name="dashboardteamsettings", name="workday_start", field=models.TimeField(default="08:00")),
        migrations.AlterField(model_name="dashboardteamsettings", name="workday_end", field=models.TimeField(default="16:00")),
        migrations.RunPython(forward, migrations.RunPython.noop),
    ]
