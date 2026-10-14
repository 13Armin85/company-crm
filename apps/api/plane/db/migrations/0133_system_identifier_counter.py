from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("db", "0132_crm_review_state")]

    operations = [
        migrations.CreateModel(
            name="SystemIdentifierCounter",
            fields=[
                ("key", models.CharField(max_length=100, primary_key=True, serialize=False)),
                ("value", models.PositiveBigIntegerField(default=0)),
            ],
            options={"db_table": "system_identifier_counters"},
        ),
    ]
