"""Expose the new support activity page in existing stored navigation documents."""

from django.db import migrations


ITEM = {
    "code": "support-activities",
    "path": "/support-activities",
    "label": "فعالیت و زمان پشتیبانی",
    "icon": "Clock3",
    "end": False,
}


def add_item(apps, schema_editor):
    SurfaceConfiguration = apps.get_model("db", "SurfaceConfiguration")
    for document in SurfaceConfiguration.objects.using(schema_editor.connection.alias).filter(code="crm-navigation"):
        definition = document.definition if isinstance(document.definition, dict) else {}
        categories = definition.get("categories") if isinstance(definition.get("categories"), list) else []
        report = next((category for category in categories if category.get("id") == "reports"), None)
        if report is None:
            continue
        items = report.get("items") if isinstance(report.get("items"), list) else []
        if any(item.get("code") == ITEM["code"] for item in items if isinstance(item, dict)):
            continue
        report["items"] = [*items, ITEM]
        document.definition = definition
        document.save(update_fields=["definition"])


class Migration(migrations.Migration):
    dependencies = [("db", "0166_support_activity")]
    operations = [migrations.RunPython(add_item, migrations.RunPython.noop)]
