"""Separate optional CRM notification categories for each account."""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("db", "0167_support_activity_navigation")]

    operations = [
        migrations.AddField(model_name="usernotificationpreference", name=name, field=models.BooleanField(default=True))
        for name in (
            "crm_routing", "crm_ticket_status", "crm_workflow_action", "crm_leave_result",
            "crm_deadline", "crm_daily_report", "crm_portal",
        )
    ]
