"""Confirmed support intervals; no attendance, billing, or payroll columns."""

import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("db", "0165_report_permissions")]

    operations = [
        migrations.CreateModel(
            name="SupportActivity",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
                ("id", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ("kind", models.CharField(choices=[("support", "پشتیبانی/رسیدگی"), ("phone", "تماس تلفنی")], max_length=12)),
                ("starts_at", models.DateTimeField()),
                ("ends_at", models.DateTimeField()),
                ("duration_minutes", models.PositiveIntegerField()),
                ("summary", models.TextField(blank=True)),
                ("confirmed_at", models.DateTimeField()),
                ("revision", models.PositiveIntegerField(default=1)),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="%(class)s_created_by", to=settings.AUTH_USER_MODEL, verbose_name="Created By")),
                ("updated_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="%(class)s_updated_by", to=settings.AUTH_USER_MODEL, verbose_name="Last Modified By")),
                ("customer", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="support_activities", to="db.entityrecord")),
                ("issue", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="support_activities", to="db.issue")),
                ("supporter", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="support_activities", to=settings.AUTH_USER_MODEL)),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="support_activities", to="db.workspace")),
            ],
            options={"db_table": "crm_support_activities", "ordering": ("-starts_at", "-created_at")},
        ),
        migrations.AddIndex(
            model_name="supportactivity",
            index=models.Index(fields=["workspace", "supporter", "starts_at"], name="crm_support_person_time_idx"),
        ),
        migrations.AddConstraint(
            model_name="supportactivity",
            constraint=models.CheckConstraint(condition=models.Q(ends_at__gt=models.F("starts_at")), name="crm_support_activity_period"),
        ),
    ]
